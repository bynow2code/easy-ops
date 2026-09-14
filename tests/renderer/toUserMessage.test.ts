import { describe, expect, it } from 'vitest'
import { toUserMessage } from '../../src/renderer/src/utils/toUserMessage'

describe('toUserMessage', () => {
  it('剥掉 Electron 的 IPC 包装前缀,只留中文原文', () => {
    const err = new Error("Error invoking remote method 'config:import': 不是合法的 JSON 文件")
    expect(toUserMessage(err)).toBe('不是合法的 JSON 文件')
  })

  it('剥掉 IPC 前缀后残余的 Error: 也一并剥掉', () => {
    const err = new Error("Error invoking remote method 'scripts:update': Error: 脚本不存在")
    expect(toUserMessage(err)).toBe('脚本不存在')
  })

  it('没有 IPC 前缀时原样返回中文', () => {
    expect(toUserMessage(new Error('该路径不可用'))).toBe('该路径不可用')
  })

  it('非 Error 入参按字符串处理', () => {
    expect(toUserMessage("Error invoking remote method 'x': 导入失败")).toBe('导入失败')
    expect(toUserMessage('导入失败')).toBe('导入失败')
  })

  it('剥完为空时退回原始文案,不显示空白提示', () => {
    expect(toUserMessage(new Error('Error: '))).toBe('Error:')
  })

  it('只剥一层 Error: ,正文里的冒号文案保持完整', () => {
    expect(toUserMessage(new Error('Error: 安装更新失败: 权限不足'))).toBe('安装更新失败: 权限不足')
  })
})
