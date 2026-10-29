/**
 * 终端「复制选中内容」的快捷键判定。
 *
 * 为什么不直接用 Ctrl+C:在终端里 Ctrl+C 是 SIGINT,会把正在跑的程序打断 ——
 * 这是运维工具的命门,不能让复制抢走。所以复制用各终端的通行约定:
 * - Linux/Windows:Ctrl+Shift+C(xterm / GNOME Terminal / Windows Terminal 都认这个)
 * - Windows 传统键:Ctrl+Insert
 * - macOS:Cmd+C(mac 上 Cmd 组合本来就不会进 shell)
 *
 * 判定只做「是不是复制键」,不看有没有选中内容 —— 无选中时同样吞掉按键,
 * 否则 Ctrl+Shift+C 会被 xterm 当成 Ctrl+C 往 pty 里送一个 ^C。
 */
export function isCopyShortcut(
  ev: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  isMac: boolean
): boolean {
  // AltGr 在部分布局上表现为 ctrl+alt,放行给终端,别抢
  if (ev.altKey) return false

  const isInsert = ev.code === 'Insert' || ev.key === 'Insert'
  if (isInsert) return ev.ctrlKey && !ev.metaKey

  const isC = ev.code === 'KeyC' || ev.key === 'c' || ev.key === 'C'
  if (!isC) return false

  return isMac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && ev.shiftKey && !ev.metaKey
}
