/**
 * 客户端 Mock 数据
 * 仅用于 UI 设计阶段。后续接后端时由 server/index.js 暴露的 /api/scripts 替换。
 */

// 后端脚本列表
const BACKEND = [
  'PMS-后端-DEV',
  'PMS-后端-TEST',
  'WMS-后端-DEV',
  'WMS-后端-TEST',
  'OMS-后端-DEV',
  'OMS-后端-TEST',
  'CORE-后端-DEV',
  'CORE-后端-TEST',
  'CORE-后端-刷新权限-DEV',
  'CORE-后端-刷新权限-TEST',
  'INFRA-后端-DEV',
  'INFRA-后端-TEST',
  'AUDIT-后端-DEV',
  'AUDIT-后端-TEST',
  'NOTIFY-后端-DEV',
];

const FRONTEND = [
  'PMS-前端-TEST',
  'WMS-前端-DEV',
  'WMS-前端-TEST',
  'OMS-前端-TEST',
  'CORE-前端-TEST',
  'PORTAL-前端-DEV',
];

const buildGroup = (group, items) =>
  items.map((name, i) => ({
    id: `${group.toLowerCase()}-${i}`,
    group,
    name,
    status: 'idle', // idle | running | done | failed
  }));

export const initialScripts = [
  ...buildGroup('BACKEND SCRIPTS', BACKEND),
  ...buildGroup('FRONTEND SCRIPTS', FRONTEND),
];

// 根据脚本名生成模拟输出（与截图一致风格）
export function mockOutputFor(name) {
  const isPms = name.startsWith('PMS');
  const isWms = name.startsWith('WMS');
  const isOms = name.startsWith('OMS');
  const isDev = /-DEV$/.test(name);
  const repo = isPms ? (isDev ? 'dev_mns_pms' : 'mns_pms')
    : isWms ? (isDev ? 'dev_mns_wms' : 'mns_wms')
    : isOms ? (isDev ? 'dev_mns_oms' : 'mns_oms')
    : (isDev ? `dev_${name.toLowerCase()}` : name.toLowerCase());

  return [
    `======== ${repo} ========`,
    '当前分支: master',
    '开始拉取最新代码......',
    'Already up to date.',
    '',
    `> npm run build --workspace ${repo}`,
    '构建产物已上传，跳过',
    '',
    '> ./deploy.sh --env ' + (isDev ? 'dev' : 'test'),
    '部署完成。',
    '',
    `Process exited with code 0 (${(700 + Math.floor(Math.random() * 900))}ms)`,
  ];
}
