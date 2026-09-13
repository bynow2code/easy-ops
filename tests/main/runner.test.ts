import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSourceCommand, cleanupTempScript, writeTempScript } from '../../src/main/pty/runner'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'easyops-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('buildSourceCommand', () => {
  it('用单引号包裹路径以容忍空格', () => {
    expect(buildSourceCommand('/tmp/a b/c.sh')).toBe("source '/tmp/a b/c.sh'\n")
  })

  it('转义路径中的单引号', () => {
    expect(buildSourceCommand("/tmp/it's.sh")).toBe("source '/tmp/it'\\''s.sh'\n")
  })

  it('命令结尾带换行', () => {
    expect(buildSourceCommand('/tmp/a.sh').endsWith('\n')).toBe(true)
  })
})

describe('writeTempScript', () => {
  it('写入脚本内容并返回路径', async () => {
    const filePath = await writeTempScript(dir, 'run-1', 'echo hello\n')
    expect(path.dirname(filePath)).toBe(dir)
    expect(path.basename(filePath)).toBe('easyops-run-1.sh')
    expect(await readFile(filePath, 'utf8')).toBe('echo hello\n')
  })

  it('内容不以换行结尾时自动补换行', async () => {
    const filePath = await writeTempScript(dir, 'run-2', 'echo no-newline')
    expect(await readFile(filePath, 'utf8')).toBe('echo no-newline\n')
  })

  it('清理后文件不存在', async () => {
    const filePath = await writeTempScript(dir, 'run-3', 'echo x')
    await cleanupTempScript(filePath)
    await expect(readFile(filePath, 'utf8')).rejects.toThrow()
  })

  it('清理不存在的文件不抛错', async () => {
    await expect(cleanupTempScript(path.join(dir, 'nope.sh'))).resolves.toBeUndefined()
  })
})
