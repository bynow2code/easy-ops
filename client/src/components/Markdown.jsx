import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 流行的 React Markdown 阅读器：react-markdown + remark-gfm（GitHub 风格扩展）。
// 默认不渲染原始 HTML，天然防 XSS，无需 dangerouslySetInnerHTML / DOMPurify。
export default function Markdown({ content, className, maxLength }) {
  if (!content) return null

  let text = typeof content === 'string' ? content : String(content)
  if (maxLength && maxLength > 0 && text.length > maxLength) {
    text = text.slice(0, maxLength)
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={className}
      components={{
        // 链接在新标签页打开
        a: ({ node, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
