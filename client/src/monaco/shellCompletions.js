import * as monaco from 'monaco-editor/editor/editor.api';

/**
 * shell 代码提示（IntelliSense）
 *
 * monaco 的 basic-languages/shell 仅做语法高亮，不提供补全项。
 * 这里注册一个 completion provider，给出常用 bash/sh 命令、关键字与变量，
 * 让"脚本内容"编辑框支持代码提示（输入即弹出，输入 `$` 触发变量提示）。
 *
 * 注意：本文件直接 import 单例的 editor.api（与 setup.js 同一个模块实例），
 * 不再从 ./setup 反向引入 monaco，避免循环依赖在 HMR / 打包时序下导致注册失败。
 */

const SHELL_COMMANDS = [
  // 文件 / 目录
  'ls',
  'cd',
  'pwd',
  'cat',
  'touch',
  'mkdir',
  'rmdir',
  'rm',
  'cp',
  'mv',
  'ln',
  'find',
  'locate',
  'chmod',
  'chown',
  'chgrp',
  'stat',
  'file',
  'readlink',
  'basename',
  'dirname',
  'realpath',
  // 文本处理
  'echo',
  'printf',
  'grep',
  'egrep',
  'fgrep',
  'sed',
  'awk',
  'cut',
  'sort',
  'uniq',
  'head',
  'tail',
  'wc',
  'tr',
  'tee',
  'diff',
  'comm',
  'paste',
  'column',
  'nl',
  'rev',
  // 归档 / 压缩
  'tar',
  'gzip',
  'gunzip',
  'zip',
  'unzip',
  'bzip2',
  'xz',
  'zcat',
  'zgrep',
  // 网络
  'curl',
  'wget',
  'ssh',
  'scp',
  'rsync',
  'sftp',
  'ping',
  'nc',
  'telnet',
  'dig',
  'host',
  'nslookup',
  // 进程 / 系统
  'ps',
  'top',
  'htop',
  'kill',
  'killall',
  'pkill',
  'jobs',
  'fg',
  'bg',
  'nohup',
  'screen',
  'tmux',
  'df',
  'du',
  'free',
  'uptime',
  'uname',
  'whoami',
  'id',
  'env',
  'printenv',
  'hostname',
  'date',
  'cal',
  // 包 / 构建 / 运行时
  'npm',
  'yarn',
  'pnpm',
  'node',
  'npx',
  'git',
  'make',
  'cmake',
  'gcc',
  'go',
  'python',
  'python3',
  'pip',
  'docker',
  'kubectl',
  'systemctl',
  'service',
];

const SHELL_KEYWORDS = [
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'in',
  'do',
  'done',
  'while',
  'until',
  'case',
  'esac',
  'function',
  'return',
  'exit',
  'break',
  'continue',
  'select',
  'time',
  'coproc',
  'eval',
  'exec',
  'source',
  'alias',
  'export',
  'local',
  'read',
  'set',
  'unset',
  'trap',
  'declare',
  'typeset',
  'let',
  'mapfile',
  'readarray',
  'getopts',
  'shift',
];

const SHELL_VARS = [
  '$HOME',
  '$PATH',
  '$USER',
  '$PWD',
  '$OLDPWD',
  '$SHELL',
  '$HOSTNAME',
  '$TERM',
  '$LANG',
  '$EDITOR',
  '$0',
  '$1',
  '$2',
  '$3',
  '$#',
  '$@',
  '$*',
  '$?',
  '$$',
  '$!',
  '$_',
];

/**
 * 纯函数：给定 model + position，返回补全项。
 * 抽出此函数便于单元测试（不依赖 Monaco 渲染）。
 *
 * @param {{ getWordUntilPosition: Function, getValueInRange: Function }} model
 * @param {{ lineNumber: number, column: number }} position
 */
export function getShellCompletions(model, position) {
  const word = model.getWordUntilPosition(position);
  const wordRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };

  // 当前行、光标之前的文本，用于判断是否在「变量模式」($ 开头)
  const textUntil = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  // 包含 `$` 的当前 token（shell 默认 word 定义不含 `$`，需手动截取）
  const token = textUntil.match(/[$A-Za-z0-9_.]*$/)?.[0] ?? '';

  // 以 `$` 开头 => 变量补全（按已输入部分过滤，支持续打如 $H -> $HOME）
  if (token.startsWith('$')) {
    const needle = token.slice(1).toLowerCase();
    const startColumn = Math.max(position.column - token.length, 1);
    const varRange = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn,
      endColumn: position.column,
    };
    return {
      suggestions: (needle
        ? SHELL_VARS.filter((v) => v.toLowerCase().includes(needle))
        : SHELL_VARS
      ).map((v) => ({
        label: v,
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: v,
        detail: 'Shell variable',
        range: varRange,
      })),
    };
  }

  const range = wordRange;
  const toItem = (label, kind, detail) => ({
    label,
    kind,
    insertText: label,
    detail,
    range,
  });

  return {
    suggestions: [
      ...SHELL_COMMANDS.map((c) =>
        toItem(c, monaco.languages.CompletionItemKind.Function, 'Shell command'),
      ),
      ...SHELL_KEYWORDS.map((k) =>
        toItem(k, monaco.languages.CompletionItemKind.Keyword, 'Shell keyword'),
      ),
    ],
  };
}

let registered = false;

export function registerShellCompletions() {
  if (registered) return;
  registered = true;

  monaco.languages.registerCompletionItemProvider('shell', {
    triggerCharacters: ['$', ' ', '\t'],
    provideCompletionItems(model, position) {
      return getShellCompletions(model, position);
    },
  });
}
