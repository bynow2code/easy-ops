/**
 * Monaco 加载（Vite8 / Rolldown 正规 ESM 方案，仅含 shell）
 *
 * 只引入编辑器内核 + shell(bash) 语言贡献，不打包 css/html/json/ts 等其他语言 worker，
 * 大幅减小产物体积（仅一个 editor.worker）。
 *
 * 路径规范（关键）：monaco-editor 的 package.json 中 exports 为 "./*" -> "./esm/vs/*.js"，
 * 因此裸路径须以 "monaco-editor/editor/..."、"monaco-editor/basic-languages/..." 形式书写，
 * 解析为 ./esm/vs/...；切勿写成 "monaco-editor/esm/vs/..."（会套进 ./* 变成
 * ./esm/vs/esm/vs/... 导致解析失败）。
 *
 * - 'monaco-editor/editor/editor.api'                         编辑器内核（公共 API，不含语言）
 * - 'monaco-editor/languages/definitions/shell/register'      仅注册 shell 语言（v0.56 路径；其内部经
 *   _.contribution.js 用相对路径引用同一份 editor.api，与主模块共享单例，无需额外 worker）
 * - 'monaco-editor/editor/editor.worker?worker'               编辑器基础 worker（必需，否则会告警缺 editorWorkerService）
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/shell/register';
// 关键：editor.api 仅含编辑器内核 + FormattingConflicts 一个贡献，
// 并不注册 SuggestController（补全浮层 UI / triggerSuggest 命令）。
// 补上 suggest 贡献模块，补全浮层才能被查询并显示；其余 70+ 语言包仍不引入，保住体积优化。
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import { registerShellCompletions } from './shellCompletions';

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

// 注册 shell 代码提示（命令 / 关键字 / 变量）
registerShellCompletions();

export { monaco };
