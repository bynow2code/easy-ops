import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import CodeMirror from '@uiw/react-codemirror'

const shellLanguage = StreamLanguage.define(shell)

export default function ShellEditor({ value, onChange, placeholder }) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[shellLanguage]}
      placeholder={placeholder || 'Enter shell script content...'}
      height="200px"
      theme="dark"
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        foldGutter: true,
        autocompletion: false,
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
        tabSize: 2,
      }}
    />
  )
}