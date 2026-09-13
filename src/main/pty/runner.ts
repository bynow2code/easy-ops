import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export function buildSourceCommand(scriptPath: string): string {
  const escaped = scriptPath.replace(/'/g, `'\\''`)
  return `source '${escaped}'\n`
}

export function tempScriptName(runId: string): string {
  return `easyops-${runId}.sh`
}

export async function writeTempScript(dir: string, runId: string, content: string): Promise<string> {
  const filePath = path.join(dir, tempScriptName(runId))
  const normalized = content.endsWith('\n') ? content : `${content}\n`
  await fs.writeFile(filePath, normalized, 'utf8')
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
