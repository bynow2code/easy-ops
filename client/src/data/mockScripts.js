/**
 * 脚本运行输出模拟器（仅前端阶段）。
 *
 * 真实 PTY 未接入前，runScript 用本函数生成与截图一致风格的模拟输出。
 * 后续接后端时由 server/index.js 暴露的 /api/run 实时流替换。
 */

// 根据脚本名生成模拟输出（与截图一致风格）
export function mockOutputFor(name) {
  const isPms = name.startsWith('PMS');
  const isWms = name.startsWith('WMS');
  const isOms = name.startsWith('OMS');
  const isDev = /-DEV$/.test(name);
  const repo = isPms
    ? isDev
      ? 'dev_mns_pms'
      : 'mns_pms'
    : isWms
      ? isDev
        ? 'dev_mns_wms'
        : 'mns_wms'
      : isOms
        ? isDev
          ? 'dev_mns_oms'
          : 'mns_oms'
        : isDev
          ? `dev_${name.toLowerCase()}`
          : name.toLowerCase();

  return [
    `======== ${repo} ========`,
    'Current branch: master',
    'Pulling latest code......',
    'Already up to date.',
    '',
    `> npm run build --workspace ${repo}`,
    'Build artifacts uploaded, skipped',
    '',
    '> ./deploy.sh --env ' + (isDev ? 'dev' : 'test'),
    'Deployment complete.',
    '',
    `Process exited with code 0 (${700 + Math.floor(Math.random() * 900)}ms)`,
  ];
}
