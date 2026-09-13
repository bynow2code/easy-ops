import type { Completion } from '@codemirror/autocomplete'

const BUILTINS: [string, string][] = [
  ['cd', '切换目录'],
  ['echo', '输出文本'],
  ['export', '导出环境变量'],
  ['source', '在当前 shell 执行文件'],
  ['alias', '定义别名'],
  ['unalias', '删除别名'],
  ['set', '设置 shell 选项'],
  ['unset', '删除变量'],
  ['read', '读取输入'],
  ['exit', '退出 shell'],
  ['return', '从函数返回'],
  ['eval', '求值并执行'],
  ['exec', '替换当前进程'],
  ['type', '查看命令类型'],
  ['which', '查找命令路径'],
  ['history', '命令历史']
]

const COMMON: [string, string][] = [
  ['ls', '列出目录内容'],
  ['pwd', '显示当前目录'],
  ['mkdir', '创建目录'],
  ['rm', '删除文件'],
  ['cp', '复制'],
  ['mv', '移动或重命名'],
  ['cat', '查看文件内容'],
  ['less', '分页查看'],
  ['head', '查看开头'],
  ['tail', '查看结尾'],
  ['grep', '文本搜索'],
  ['find', '查找文件'],
  ['sed', '流编辑器'],
  ['awk', '文本处理'],
  ['sort', '排序'],
  ['uniq', '去重'],
  ['wc', '统计行数与字数'],
  ['chmod', '修改权限'],
  ['chown', '修改属主'],
  ['ps', '查看进程'],
  ['kill', '结束进程'],
  ['df', '磁盘占用'],
  ['du', '目录大小'],
  ['tar', '打包与解包'],
  ['curl', 'HTTP 请求'],
  ['ssh', '远程登录'],
  ['rsync', '同步文件'],
  ['docker', '容器管理'],
  ['git', '版本控制'],
  ['npm', 'Node 包管理'],
  ['node', '运行 Node'],
  ['python3', '运行 Python']
]

function toCompletion([label, detail]: [string, string]): Completion {
  return { label, type: 'keyword', detail }
}

export const SHELL_KEYWORDS: Completion[] = [...BUILTINS, ...COMMON].map(toCompletion)

const MAX_RESULTS = 20

export function completionsFor(prefix: string): Completion[] {
  if (!prefix) return []
  const lower = prefix.toLowerCase()
  return SHELL_KEYWORDS.filter((k) => k.label.toLowerCase().startsWith(lower)).slice(0, MAX_RESULTS)
}
