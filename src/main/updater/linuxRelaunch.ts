/**
 * Linux 更新后的「重新拉起新版本」。
 *
 * 背景(2026-10-30 实测定性):Deepin 等桌面用 dde-application-manager / systemd 把每个 GUI 应用
 * 放进一个 transient unit 的 cgroup 里。electron-updater 是在**自己退出前** spawn 新 AppImage 的,
 * 新进程继承同一个 cgroup;应用一退,unit 变 inactive,systemd 按 `KillMode=control-group` 清场,
 * 刚起来的新实例被一起 SIGKILL —— 用户看到的就是「更新成功,但没有自动打开」。
 * `spawn(..., { detached: true })` 只做 setsid(换 session),**换不了 cgroup**,所以躲不开。
 *
 * 实测证据:`systemd-run --user --unit=X --collect sh -c 'setsid sleep 40 & …'` 里,unit 结束后
 * 那个 detached 的 sleep 一并消失(`pgrep` 找不到)。
 *
 * 因此:能连上 user manager 时,用 `systemd-run --user --collect` 把新版本交给 user manager 起一个
 * **独立 unit**,旧 unit 死掉带不走它;连不上(非 systemd 发行版 / 无会话总线)就退回普通 detached spawn
 * —— 那种环境本来也没有 cgroup 清场问题。
 */

/** 重新拉起时需要显式带到新 unit 的图形会话变量:user manager 的 env 不一定有这些 */
const PASSTHROUGH_ENV = ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY'] as const

export interface RelaunchPlan {
  command: string
  args: string[]
}

export function canUseSystemdRun(input: {
  exists: (filePath: string) => boolean
  env: Record<string, string | undefined>
}): boolean {
  // 没有会话总线时 systemd-run --user 必然失败,不如直接按普通 spawn 走
  if (!input.env['DBUS_SESSION_BUS_ADDRESS']) return false
  return input.exists('/usr/bin/systemd-run') || input.exists('/bin/systemd-run')
}

export function planRelaunch(input: {
  target: string
  unitName: string
  hasSystemdRun: boolean
  env: Record<string, string | undefined>
}): RelaunchPlan {
  if (!input.hasSystemdRun) {
    return { command: input.target, args: [] }
  }

  // --no-block:任务入队即返回,不必等 unit 启动完成(调用方是「马上要退出的进程」,不能久等)
  const args = ['--user', '--collect', '--no-block', `--unit=${input.unitName}`]
  for (const name of PASSTHROUGH_ENV) {
    const value = input.env[name]
    if (value) args.push(`--setenv=${name}=${value}`)
  }
  // 目标放最后:前面都是 systemd-run 自己的开关,不能和程序参数混在一起
  args.push(input.target)
  return { command: 'systemd-run', args }
}
