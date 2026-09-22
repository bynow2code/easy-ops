import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** 单引号包裹并转义路径里的单引号:bash 单引号串内没有转义序列,只能靠「'\'』拼接 */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildSourceCommand(scriptPath: string): string {
  return `source ${shQuote(scriptPath)}\n`
}

/**
 * WSL 版注入命令:Windows 临时路径(C:\Users\...)在 Linux bash 里是字面不存在的路径,
 * 直接 source 必报 No such file。借 WSL 自带的 wslpath 把 Windows 路径换算成 /mnt/... 再 source。
 * 命令替换 $( ) 放在双引号里:保留结果中的空格,wslpath 的输出路径交由 bash 正确分词。
 */
export function buildWslSourceCommand(windowsPath: string): string {
  return `source "$(wslpath ${shQuote(windowsPath)})"\n`
}

/**
 * 判定 shell 是否为 WSL 入口:shell.ts 里 WSL 条目的 path 固定是 wsl.exe(发行版在 args 里)。
 * 只有 WSL 需要做路径换算;Git Bash 的 MSYS 路径层能直接消化 C:\ 形式,保持原样注入。
 * 不用 path.basename:它是平台相关的,POSIX 上不把 \ 当分隔符,Windows 路径会整个落空。
 */
export function isWslShell(shellPath: string): boolean {
  const base = shellPath.split(/[\\/]/).pop() ?? ''
  return base.toLowerCase() === 'wsl.exe'
}

export function tempScriptName(runId: string): string {
  return `easyops-${runId}.sh`
}

export async function writeTempScript(dir: string, runId: string, content: string): Promise<string> {
  const filePath = path.join(dir, tempScriptName(runId))
  const normalized = content.endsWith('\n') ? content : `${content}\n`
  // 'wx'(独占创建)+ 0600:文件名含时间戳可被同机其他用户预测,
  // writeFile 默认 0644 且跟随符号链接,攻击者可预置同名符号链接让写入穿越到别的文件。
  // O_EXCL 保证目标已存在(含符号链接)时直接失败,绝不写穿
  const handle = await fs.open(filePath, 'wx', 0o600)
  try {
    await handle.writeFile(normalized, 'utf8')
  } finally {
    await handle.close()
  }
  return filePath
}

export async function cleanupTempScript(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch {
    // 文件不存在或已被清理,视为成功
  }
}

export async function cleanupStaleTempScripts(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir)
    await Promise.all(
      entries
        .filter((name) => name.startsWith('easyops-') && name.endsWith('.sh'))
        .map((name) => cleanupTempScript(path.join(dir, name)))
    )
  } catch {
    // 目录不可读时忽略
  }
}
