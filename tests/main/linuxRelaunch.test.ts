import { describe, expect, it } from 'vitest'
import { canUseSystemdRun, planRelaunch } from '../../src/main/updater/linuxRelaunch'

const env = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  DISPLAY: ':0',
  XAUTHORITY: '/home/arthur/.Xauthority',
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  ...over
})

describe('canUseSystemdRun', () => {
  it('二进制与会话总线都在才用 systemd-run', () => {
    expect(canUseSystemdRun({ exists: (p) => p === '/usr/bin/systemd-run', env: env() })).toBe(true)
  })

  it('没有 systemd-run(非 systemd 发行版)时退回直接启动', () => {
    expect(canUseSystemdRun({ exists: () => false, env: env() })).toBe(false)
  })

  it('没有会话总线时不用 —— 那样 systemd-run 必然失败', () => {
    expect(
      canUseSystemdRun({
        exists: (p) => p === '/usr/bin/systemd-run',
        env: env({ DBUS_SESSION_BUS_ADDRESS: undefined })
      })
    ).toBe(false)
  })
})

describe('planRelaunch', () => {
  it('能脱离 cgroup 时交给 user manager 起独立 unit', () => {
    const plan = planRelaunch({
      target: '/home/arthur/Desktop/EasyOps-0.9.15-x86_64.AppImage',
      unitName: 'easyops-relaunch-1',
      hasSystemdRun: true,
      env: env()
    })

    expect(plan.command).toBe('systemd-run')
    expect(plan.args).toContain('--user')
    expect(plan.args).toContain('--collect')
    expect(plan.args).toContain('--unit=easyops-relaunch-1')
    // 目标必须是最后一个参数:前面全是 systemd-run 自己的开关
    expect(plan.args[plan.args.length - 1]).toBe('/home/arthur/Desktop/EasyOps-0.9.15-x86_64.AppImage')
  })

  it('把图形会话需要的环境变量显式带过去 —— user manager 的 env 不一定有 DISPLAY', () => {
    const plan = planRelaunch({
      target: '/app.AppImage',
      unitName: 'u',
      hasSystemdRun: true,
      env: env()
    })

    expect(plan.args).toContain('--setenv=DISPLAY=:0')
    expect(plan.args).toContain('--setenv=XAUTHORITY=/home/arthur/.Xauthority')
  })

  it('缺失的环境变量不生成空 --setenv', () => {
    const plan = planRelaunch({
      target: '/app.AppImage',
      unitName: 'u',
      hasSystemdRun: true,
      env: env({ XAUTHORITY: undefined })
    })

    expect(plan.args.some((a) => a.startsWith('--setenv=XAUTHORITY'))).toBe(false)
    expect(plan.args).toContain('--setenv=DISPLAY=:0')
  })

  it('没有 systemd-run 时直接起目标,不留垃圾参数', () => {
    const plan = planRelaunch({
      target: '/app.AppImage',
      unitName: 'u',
      hasSystemdRun: false,
      env: env()
    })

    expect(plan.command).toBe('/app.AppImage')
    expect(plan.args).toEqual([])
  })
})
