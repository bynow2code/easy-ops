import { createHash } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateEvent } from '../../src/main/updater/win-linux'

/**
 * 这一组测的是「接线」而不是换算本身:进度换算由 tests/main/update-progress.test.ts 覆盖,
 * 但那个文件里把 mac.ts 的 Transform 整段删掉也会全绿 —— 而本次要修的 bug 形态恰恰是
 * 「代码在跑、一次 emit 都没有」。所以这里桩掉网络与文件系统,断言 mac.download() 真的
 * 在下到一半时就吐出了递增的百分比,并且以下载完成收尾。
 *
 * 固定载荷 = 3000 字节,按 1000 字节切三块 → 期望 33 / 66 / 100。
 */

const fx = vi.hoisted(() => ({
  CHUNK: 1000,
  PAYLOAD: Buffer.alloc(3000, 0x41)
}))

/** mock 工厂执行时这些还没赋值,但工厂体只在返回的闭包里引用它们,调用发生在测试运行时 */
let manifestText = ''
let contentLength: string | null = null

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '0.0.1',
    getAppPath: () => '/Applications/EasyOps.app/Contents/Resources/app.asar'
  },
  shell: { openExternal: vi.fn(async () => undefined) }
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    // 落盘写进一个丢弃式 Writable:这里验的是进度事件,不是磁盘
    createWriteStream: (): Writable => new Writable({ write: (_c, _e, cb) => cb() }),
    // sha512 校验读到的必须与 manifest 里写的一致,否则流程会走 error 分支
    createReadStream: (): Readable => Readable.from([fx.PAYLOAD])
  }
})

vi.mock('node:fs/promises', () => ({
  constants: { W_OK: 2 },
  mkdtemp: async (): Promise<string> => '/tmp/easyops-update-test',
  readFile: async (): Promise<string> => manifestText,
  rm: async (): Promise<void> => undefined,
  mkdir: async (): Promise<void> => undefined,
  // cleanupStaleWorkDirs 与解压后的查找共用这一个:前者按前缀过滤(不匹配即不删),后者靠它找到 .app
  readdir: async (): Promise<string[]> => ['EasyOps.app'],
  access: async (): Promise<void> => undefined,
  writeFile: async (): Promise<void> => undefined
}))

vi.mock('node:child_process', () => ({
  execFile: (_file: string, _args: string[], cb: (err: Error | null) => void): void => cb(null),
  spawn: (): { unref: () => void } => ({ unref: () => undefined })
}))

import { createMacUpdater } from '../../src/main/updater/mac'

const ZIP_X64 = 'https://example.test/EasyOps-x64.zip'
const ZIP_ARM64 = 'https://example.test/EasyOps-arm64.zip'
const MANIFEST_URL = 'https://example.test/latest-mac.yml'

function streamedResponse(bytes: Buffer, chunkSize: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let off = 0; off < bytes.length; off += chunkSize) {
        controller.enqueue(new Uint8Array(bytes.subarray(off, off + chunkSize)))
      }
      controller.close()
    }
  })
  const headers = new Headers()
  if (contentLength !== null) headers.set('content-length', contentLength)
  return new Response(body, { status: 200, headers })
}

function setupFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/releases/latest')) {
        return new Response(
          JSON.stringify({
            tag_name: 'v9.9.9',
            html_url: 'https://github.com/bynow2code/easy-ops/releases/tag/v9.9.9',
            assets: [
              { name: 'EasyOps-9.9.9-x64.zip', browser_download_url: ZIP_X64 },
              { name: 'EasyOps-9.9.9-arm64.zip', browser_download_url: ZIP_ARM64 },
              { name: 'latest-mac.yml', browser_download_url: MANIFEST_URL }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url === MANIFEST_URL) {
        return new Response(manifestText, { status: 200 })
      }
      if (url === ZIP_X64 || url === ZIP_ARM64) {
        return streamedResponse(fx.PAYLOAD, fx.CHUNK)
      }
      throw new Error(`测试没预料到的请求:${url}`)
    })
  )
}

async function runDownload(): Promise<UpdateEvent[]> {
  const events: UpdateEvent[] = []
  const updater = createMacUpdater((event) => events.push(event))
  await updater.check()
  await updater.download()
  return events
}

function percentsOf(events: UpdateEvent[]): number[] {
  return events
    .filter((e): e is { status: 'downloading'; percent: number } => e.status === 'downloading')
    .map((e) => e.percent)
}

beforeEach(() => {
  const sha = createHash('sha512').update(fx.PAYLOAD).digest('base64')
  manifestText = [
    'version: 9.9.9',
    'files:',
    '  - url: EasyOps-9.9.9-x64.zip',
    `    sha512: ${sha}`,
    '    size: 3000',
    '  - url: EasyOps-9.9.9-arm64.zip',
    `    sha512: ${sha}`,
    '    size: 3000',
    'path: EasyOps-9.9.9-x64.zip',
    `sha512: ${sha}`,
    "releaseDate: '2026-01-01T00:00:00.000Z'",
    ''
  ].join('\n')
  contentLength = String(fx.PAYLOAD.length)
  setupFetch()
})

describe('mac 自研下载的进度接线', () => {
  it('下载进行中就报出递增的百分比,而不是等到下完才给一个 100', async () => {
    const events = await runDownload()

    // 33 / 66 / 100:三块各占三分之一。把 mac.ts 里那个 Transform 删掉、或把 reportProgress
    // 换成空实现,这里会变成 [] —— 这正是回归网要拦住的东西
    expect(percentsOf(events)).toEqual([33, 66, 100])
    expect(events.at(-1)).toEqual({ status: 'downloaded', version: '9.9.9' })
  })

  it('先下载后校验:进度不会出现在任何校验/解压之后', async () => {
    const events = await runDownload()
    const firstPercent = events.findIndex((e) => e.status === 'downloading')
    const downloaded = events.findIndex((e) => e.status === 'downloaded')
    expect(firstPercent).toBeGreaterThanOrEqual(0)
    expect(firstPercent).toBeLessThan(downloaded)
  })

  it('拿不到 content-length 时不虚报:全程只有收尾那一条 100', async () => {
    contentLength = null

    const events = await runDownload()

    // 按需求,总长度未知就宁可不报;此时 100% 只承担「已下完」这一个语义
    expect(percentsOf(events)).toEqual([100])
    expect(events.at(-1)).toEqual({ status: 'downloaded', version: '9.9.9' })
  })
})
