/**
 * Electron 对 ipcMain.handle 抛出的错误统一包装成
 * `Error invoking remote method 'config:import': <原文>`,直接显示会给用户半英文长串。
 * 主进程已经保证原文是中文,这里只负责把包装层剥掉。
 */
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERROR_PREFIX = /^Error:\s*/

export function toUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const stripped = raw.replace(IPC_PREFIX, '').replace(ERROR_PREFIX, '').trim()
  return stripped.length > 0 ? stripped : raw.trim()
}
