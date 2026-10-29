import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs'
import { dirname } from 'node:path'

/** 超过这个大小就整份清空:更新日志只是排障线索,不值得做滚动归档 */
const MAX_BYTES = 256 * 1024

export interface FileLogger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  debug: (message: string) => void
}

/**
 * 给 electron-updater 用的落盘日志。
 *
 * 它把关键的安装动作(如「Install: isSilent / isForceRunAfter」「Executing: <新 AppImage>」)
 * 只交给自己的 logger,默认实现是 console —— 打包后的应用没有终端,这些信息全丢了。
 * 2026-10-29「更新成功后没自动打开」就是因为这份现场缺失,只能靠读库源码反推。
 *
 * 任何写入失败都静默:SIGINT 级的排障工具反过来弄挂更新是不可接受的。
 */
export function createFileLogger(filePath: string): FileLogger {
  let ready = false

  const write = (level: string, message: string): void => {
    try {
      if (!ready) {
        mkdirSync(dirname(filePath), { recursive: true })
        try {
          if (statSync(filePath).size > MAX_BYTES) truncateSync(filePath, 0)
        } catch {
          // 文件还不存在:无需处理
        }
        ready = true
      }
      appendFileSync(filePath, `${new Date().toISOString()} [${level}] ${message}\n`, 'utf8')
    } catch {
      // 见上:日志失败不影响更新
    }
  }

  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
    debug: (message) => write('debug', message)
  }
}
