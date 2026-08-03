// 解释器选择解析：'global' 或空值 → 应用全局 shell 路径；
// 否则返回脚本指定的解释器路径。供运行与展示时统一解析。
export function resolveShellPath(shell, globalShellPath) {
  if (!shell || shell === 'global') return globalShellPath;
  return shell;
}

// 已运行实例的"展示用解释器"：冻结为运行时刻解析出的路径（exec.shellPath），
// 不受之后切换全局默认 shell 的影响——切换全局只应影响"新的"运行，已打开的输出窗口
// 必须继续显示它实际运行所用解释器。仅当运行时路径缺失（如 No Shell Mode 占位卡片）
// 才回退到按当前全局重新解析。
export function resolveDisplayShell(execShell, frozenShellPath, globalShellPath) {
  return frozenShellPath || resolveShellPath(execShell, globalShellPath);
}

