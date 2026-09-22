import { app, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { compareVersions, decideMacUpdateAction, deriveAppPath, buildReplaceScript, parseLatestMacChecksums } from './version'
import { createPercentReporter, parseContentLength } from './progress'
import type { UpdateEvent } from './win-linux'

const REPO = 'bynow2code/easy-ops'
const WORK_DIR_PREFIX = 'easyops-update-'

/** API / 清单这类轻量请求的整体超时;GitHub 连接挂起时不能让检查更新永远悬着 */
const FETCH_TIMEOUT_MS = 15_000
/** zip 下载的空闲超时:整体时限在慢速网络下不可行,只惩罚「长时间一个字节都不来」的死连接 */
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000

/** mac 自研替换脚本的失败现场落点;注册 updater IPC 时消费并转为可回放的 error 事件 */
export const MAC_UPDATE_ERROR_FILE = path.join(os.tmpdir(), 'easyops-update-error.log')

/** 读取并清除上次自动替换脚本写入的错误现场;无则返回 null */
export function consumeMacUpdateError(): string | null {
  try {
    const text = readFileSync(MAC_UPDATE_ERROR_FILE, 'utf8').trim()
    fs.rm(MAC_UPDATE_ERROR_FILE, { force: true }).catch(() => undefined)
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

function sha512File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('base64')))
    stream.on('error', reject)
  })
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface Release {
  tag: string
  htmlUrl: string
  assets: ReleaseAsset[]
}

async function fetchLatestRelease(): Promise<Release> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EasyOps' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`获取最新版本失败:HTTP ${response.status}`)
  const json = (await response.json()) as {
    tag_name?: string
    html_url?: string
    assets?: ReleaseAsset[]
  }
  return {
    tag: json.tag_name ?? '',
    htmlUrl: json.html_url ?? `https://github.com/${REPO}/releases/latest`,
    assets: json.assets ?? []
  }
}

async function canWrite(targetDir: string): Promise<boolean> {
  try {
    await fs.access(targetDir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function runDitto(source: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ditto', ['-x', '-k', source, target], (err) => (err ? reject(err) : resolve()))
  })
}

/** 清掉上一轮没装成的残留临时目录,避免 /tmp 里堆积 zip 与解压产物 */
async function cleanupStaleWorkDirs(): Promise<void> {
  const tmp = os.tmpdir()
  const entries = await fs.readdir(tmp).catch(() => [])
  await Promise.all(
    entries
      .filter((name) => name.startsWith(WORK_DIR_PREFIX))
      .map((name) => fs.rm(path.join(tmp, name), { recursive: true, force: true }).catch(() => undefined))
  )
}

export interface MacUpdaterHandle {
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => void
}

export function createMacUpdater(emit: (event: UpdateEvent) => void): MacUpdaterHandle {
  let pendingRelease: Release | null = null
  let extractedAppPath: string | null = null
  let workDir: string | null = null
  // 下载重入保护:并发进入时后者开头的 cleanupStaleWorkDirs 会删掉前者正在写的 workDir,
  // 首个下载流随即报错,用户看到莫名的 error。IPC 层直接拦下第二次调用
  let downloading = false

  const openReleasePage = async (url: string): Promise<void> => {
    await shell.openExternal(url)
  }

  return {
    async check() {
      if (!app.isPackaged) {
        emit({ status: 'error', message: '开发模式不支持检查更新' })
        return
      }
      emit({ status: 'checking' })
      try {
        const release = await fetchLatestRelease()
        if (!release.tag) {
          emit({ status: 'error', message: '未获取到版本标签' })
          return
        }
        const current = app.getVersion()
        if (compareVersions(current, release.tag) >= 0) {
          emit({ status: 'not-available' })
          return
        }
        pendingRelease = release
        emit({ status: 'available', version: release.tag.replace(/^v/i, '') })
      } catch (err) {
        emit({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    },

    async download() {
      if (!pendingRelease) {
        emit({ status: 'error', message: '请先检查更新' })
        return
      }
      if (downloading) {
        emit({ status: 'error', message: '正在下载更新,请稍候' })
        return
      }

      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      // 严格匹配当前架构:fallback 到任意架构的 zip 会装上跑不起来的包(还是替换掉旧版之后),
      // 宁可走手动下载分支,绝不静默装错架构
      const asset = pendingRelease.assets.find((a) => a.name.endsWith(`${arch}.zip`))

      if (!asset) {
        emit({ status: 'error', message: '未找到适用于当前架构的更新包' })
        await openReleasePage(pendingRelease.htmlUrl)
        return
      }

      // electron-updater 的清单里有各资产的 sha512;mac 自研链路没有代码签名与 updater 内建校验,
      // 必须借它做完整性校验 —— 下载器只保证传输,不保证内容
      const manifestAsset = pendingRelease.assets.find((a) => a.name === 'latest-mac.yml')
      if (!manifestAsset) {
        emit({ status: 'error', message: '更新清单缺失,无法校验更新包完整性,已打开下载页面,请手动安装' })
        await openReleasePage(pendingRelease.htmlUrl)
        return
      }

      // 到这里为止没有 await,不存在重入窗口;标志在第一个 await 前置位,finally 必然释放
      downloading = true
      try {
        await cleanupStaleWorkDirs()
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), WORK_DIR_PREFIX))
        const zipPath = path.join(workDir, asset.name)
        const manifestPath = path.join(workDir, 'latest-mac.yml')

        const manifestResponse = await fetch(manifestAsset.browser_download_url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        })
        if (!manifestResponse.ok || !manifestResponse.body) {
          throw new Error(`下载更新清单失败:HTTP ${manifestResponse.status}`)
        }
        await pipeline(Readable.fromWeb(manifestResponse.body as never), createWriteStream(manifestPath))
        const checksums = parseLatestMacChecksums(await fs.readFile(manifestPath, 'utf8'))
        const expectedSha512 = checksums[asset.name]
        if (!expectedSha512) throw new Error(`更新清单中没有 ${asset.name} 的校验值`)

        // 空闲超时:每收到一个 chunk 就重置计时器,超过阈值一个字节都不来视为死连接,
        // abort 整条流。不能套整体超时 —— 100MB 的包在慢速网络下要下好几分钟
        const idleController = new AbortController()
        let idleTimer: ReturnType<typeof setTimeout> | null = null
        const armIdleTimer = (): void => {
          if (idleTimer) clearTimeout(idleTimer)
          idleTimer = setTimeout(
            () => idleController.abort(new Error(`下载超时:超过 ${DOWNLOAD_IDLE_TIMEOUT_MS / 1000} 秒没有收到数据`)),
            DOWNLOAD_IDLE_TIMEOUT_MS
          )
        }

        const response = await fetch(asset.browser_download_url, {
          redirect: 'follow',
          signal: idleController.signal
        })
        if (!response.ok || !response.body) throw new Error(`下载失败:HTTP ${response.status}`)

        // 更新包有 100MB 以上,慢速网络下要下几分钟 —— 进度必须边下边报。
        // 这里以 content-length 为分母逐块换算百分比,交给上报器按百分比变化节流后才推给渲染层。
        // 拿不到总长度(如 chunked)时不上报:渲染层会一直停在 0%,这是刻意的取舍 —— 不虚报一个
        // 不会收敛的数字。GitHub Release 的资产必带 content-length(实测 115151193),
        // 若哪天换成开了 chunked 的 CDN,这个分支就会真的生效,届时需要改成不确定态进度条。
        const totalBytes = parseContentLength(response.headers.get('content-length'))
        const reportProgress = createPercentReporter((percent) =>
          emit({ status: 'downloading', percent })
        )
        let receivedBytes = 0

        try {
          armIdleTimer()
          await pipeline(
            Readable.fromWeb(response.body as never),
            new Transform({
              transform(chunk: Buffer, _encoding, callback) {
                armIdleTimer()
                receivedBytes += chunk.length
                reportProgress(receivedBytes, totalBytes)
                callback(null, chunk)
              }
            }),
            createWriteStream(zipPath)
          )
        } finally {
          if (idleTimer) clearTimeout(idleTimer)
        }

        const actualSha512 = await sha512File(zipPath)
        if (actualSha512 !== expectedSha512) {
          throw new Error('更新包完整性校验失败(sha512 不匹配),已丢弃本次下载')
        }

        // 传输已完成。校验与解压阶段没有字节进度可报,这里补一个 100% 让 UI 停在满格而不是悬在中途。
        // content-length 可得时上报器已在最后一个 chunk 报过 100,再发一次只是重复 IPC;只有拿不到
        // 总长度(reporter 全程沉默)时,它才是唯一能告知「已下完」的信号。
        if (totalBytes === null) emit({ status: 'downloading', percent: 100 })

        const extractDir = path.join(workDir, 'extract')
        await fs.mkdir(extractDir, { recursive: true })
        await runDitto(zipPath, extractDir)

        const entries = await fs.readdir(extractDir)
        const appBundle = entries.find((name) => name.endsWith('.app'))
        if (!appBundle) throw new Error('更新包中未找到 .app')
        extractedAppPath = path.join(extractDir, appBundle)

        emit({ status: 'downloaded', version: pendingRelease.tag.replace(/^v/i, '') })
      } catch (err) {
        emit({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        await openReleasePage(pendingRelease.htmlUrl)
      } finally {
        downloading = false
      }
    },

    install() {
      void (async () => {
        try {
          if (!pendingRelease) {
            emit({ status: 'error', message: '请先检查更新' })
            return
          }
          if (!extractedAppPath || !workDir) {
            await openReleasePage(pendingRelease.htmlUrl)
            return
          }

          // spawn 替换脚本前确认解压产物还在:workDir 可能被下一轮清理或已被删,
          // 否则脚本会在 app 退出后静默失败,用户面对凭空消失的应用
          try {
            await fs.access(extractedAppPath)
          } catch {
            emit({ status: 'error', message: '已下载的更新包不存在,请重新下载' })
            await openReleasePage(pendingRelease.htmlUrl)
            return
          }

          const appPath = deriveAppPath(app.getAppPath())
          const targetDir = path.dirname(appPath)
          const writable = await canWrite(targetDir)

          const action = decideMacUpdateAction({ appPath, canWriteTarget: writable })
          if (action === 'manual-download') {
            emit({
              status: 'error',
              message: '当前安装位置或权限不支持自动更新,已打开下载页面,请手动替换应用'
            })
            await openReleasePage(pendingRelease.htmlUrl)
            return
          }

          // 先清掉旧的失败现场,避免下次启动把上一次的错误当成这次的
          await fs.rm(MAC_UPDATE_ERROR_FILE, { force: true }).catch(() => undefined)

          const script = buildReplaceScript({
            appPath,
            extractedAppPath,
            workDir,
            errorFile: MAC_UPDATE_ERROR_FILE
          })
          const scriptPath = path.join(os.tmpdir(), `easyops-replace-${Date.now()}.sh`)
          await fs.writeFile(scriptPath, script, { mode: 0o755 })

          const child = spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' })
          child.unref()

          app.quit()
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          console.error('[EasyOps] 安装更新失败:', detail)
          emit({ status: 'error', message: `安装更新失败:${detail},已打开下载页面,请手动替换应用` })
          if (pendingRelease) await openReleasePage(pendingRelease.htmlUrl).catch(() => undefined)
        }
      })()
    }
  }
}
