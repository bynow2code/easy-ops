import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildSourceCommand,
  buildWslSourceCommand,
  cleanupTempScript,
  isWslShell,
  writeTempScript
} from '../../src/main/pty/runner'

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

describe('buildWslSourceCommand', () => {
  it('用 wslpath 命令替换换算 Windows 路径', () => {
    expect(buildWslSourceCommand('C:\\Users\\bynow\\AppData\\Local\\Temp\\easyops-1.sh')).toBe(
      `source "$(wslpath 'C:\\Users\\bynow\\AppData\\Local\\Temp\\easyops-1.sh')"\n`
    )
  })

  it('转义 Windows 路径里的单引号', () => {
    expect(buildWslSourceCommand("C:\\temp\\it's.sh")).toBe(`source "$(wslpath 'C:\\temp\\it'\\''s.sh')"\n`)
  })
})

describe('isWslShell', () => {
  it('wsl.exe 判定为 WSL(不区分大小写)', () => {
    expect(isWslShell('C:\\Windows\\System32\\wsl.exe')).toBe(true)
    expect(isWslShell('C:\\Windows\\System32\\WSL.EXE')).toBe(true)
  })

  it('Git Bash / POSIX shell 不判定为 WSL', () => {
    expect(isWslShell('C:\\Program Files\\Git\\bin\\bash.exe')).toBe(false)
    expect(isWslShell('/bin/zsh')).toBe(false)
    // 名字含 wsl 但不是 wsl.exe 本体的不算
    expect(isWslShell('/usr/bin/wslwrapper')).toBe(false)
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

  it('文件权限为 0600,其他用户不可读', async () => {
    const filePath = await writeTempScript(dir, 'run-perm', 'echo secret')
    const info = await stat(filePath)
    // 0600 = 384;umask 不会放宽显式指定的 mode
    expect(info.mode & 0o777).toBe(0o600)
  })

  it('拒绝覆盖已存在的同名文件(防符号链接写穿)', async () => {
    const filePath = await writeTempScript(dir, 'run-dup', 'echo first')
    // 模拟攻击者预置的同名文件(真实场景可能是符号链接)
    await expect(writeTempScript(dir, 'run-dup', 'echo second')).rejects.toThrow()
    expect(await readFile(filePath, 'utf8')).toBe('echo first\n')
  })
})
