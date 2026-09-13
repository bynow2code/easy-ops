import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { autocompletion, closeBrackets, type CompletionContext } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import { tags as lezerTags } from '@lezer/highlight'
import { useTheme } from '../theme/provider'
import { completionsFor } from '../editor/shellKeywords'

function shellCompletionSource(context: CompletionContext): { from: number; options: ReturnType<typeof completionsFor> } | null {
  const word = context.matchBefore(/[\w.-]*/)
  if (!word || (word.from === word.to && !context.explicit)) return null
  const options = completionsFor(word.text)
  if (options.length === 0) return null
  return { from: word.from, options }
}

export function ScriptEditor({
  value,
  onChange,
  height = '260px',
  readOnly = false
}: {
  value: string
  onChange?: (next: string) => void
  height?: string
  readOnly?: boolean
}): JSX.Element {
  const { resolved } = useTheme()

  const extensions = useMemo(
    () => [
      // shell legacy 模式把内建命令(echo/ls/git 等)标为 builtin token,
      // 其默认 tag(standard(variableName))在浅色默认高亮样式下没有着色规则;
      // 改名为自定义 token shellBuiltin 并映射到 special(variableName),
      // 使明暗两套主题都能给 shell 内建命令着色。
      StreamLanguage.define({
        ...shell,
        token(stream, state) {
          const style = shell.token(stream, state)
          return style === 'builtin' ? 'shellBuiltin' : style
        },
        tokenTable: { shellBuiltin: lezerTags.special(lezerTags.variableName) }
      }),
      autocompletion({ override: [shellCompletionSource], activateOnTyping: true }),
      closeBrackets(),
      EditorView.lineWrapping
    ],
    []
  )

  return (
    <div style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 6, overflow: 'hidden' }}>
      <CodeMirror
        value={value}
        height={height}
        theme={resolved}
        readOnly={readOnly}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          highlightActiveLine: true,
          autocompletion: false
        }}
        onChange={(next) => onChange?.(next)}
      />
    </div>
  )
}
