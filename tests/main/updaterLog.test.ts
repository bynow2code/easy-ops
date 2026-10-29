import { beforeEach, describe, expect, it } from 'vitest'

// 这次「更新成功后没自动打开」的排查现场完全没有日志可看,所以给更新器补一份落盘日志。
// 这里只测「日志真的写进文件、格式可用、超限会清空」,不涉及 electron。
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFileLogger } from '../../src/main/updater/log'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'easyops-updater-log-'))
})

describe('更新器文件日志', () => {
  it('首次写入时自动建目录,并按「时间 [级别] 内容」逐行追加', () => {
    const file = join(dir, 'logs', 'updater.log')
    const logger = createFileLogger(file)

    logger.info('Install: isSilent: false, isForceRunAfter: true')
    logger.error('Executing 失败:ENOENT')

    const text = readFileSync(file, 'utf8')
    const lines = text.trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[info\] Install: isSilent: false, isForceRunAfter: true$/)
    expect(lines[1]).toContain('[error] Executing 失败:ENOENT')
  })

  it('超过上限时整份清空,不会无限膨胀', () => {
    const file = join(dir, 'updater.log')
    writeFileSync(file, 'x'.repeat(512 * 1024), 'utf8')

    const logger = createFileLogger(file)
    logger.info('新的一轮更新')

    const text = readFileSync(file, 'utf8')
    expect(text).toContain('[info] 新的一轮更新')
    expect(statSync(file).size).toBeLessThan(4096)
  })

  it('日志目录不可写时静默失败 —— 排障不该反过来弄挂更新', () => {
    // 用「普通文件当父目录」造 ENOTDIR:比 /proc 之类的特殊路径安全,沙箱里不会被拦
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, '', 'utf8')
    const logger = createFileLogger(join(blocker, 'logs', 'updater.log'))
    expect(() => logger.error('boom')).not.toThrow()
  })
})
