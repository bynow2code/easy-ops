// 解释器选择解析：'global' 或空值 → 应用全局 shell 路径；
// 否则返回脚本指定的解释器路径。供运行与展示时统一解析。
export function resolveShellPath(shell, globalShellPath) {
  if (!shell || shell === 'global') return globalShellPath;
  return shell;
}
