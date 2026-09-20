/**
 * 终端子 shell 用的环境变量。
 *
 * dev 下应用经 `npm run` 启动,npm 会把 `npm_config_prefix`、`npm_lifecycle_event`
 * 一类运行时变量注入 `process.env`;主进程又把整个环境传给终端 shell,
 * 于是 `~/.zshrc` 里的 nvm 检测到 `npm_config_prefix` 与自己的版本管理机制冲突,
 * 每开一个终端都会打印告警。这里把这些 `npm_*` 变量剥掉 —— 它们属于「npm 怎么跑
 * 这个应用」,对用户 shell 没有意义;打包版环境里本来就没有,此过滤是空操作。
 */
export function shellEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (/^npm_/i.test(key)) continue
    result[key] = value
  }
  return result
}
