import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'

import 'github-markdown-css/github-markdown.css'

// GitHub release 风格的 Markdown 渲染器。
// 使用 react-markdown + remark-gfm 解析 GitHub 风格 Markdown；
// 使用 rehype-raw + rehype-sanitize 渲染并消毒 GitHub release body 中常见的
// 原始 HTML（如 <a class="commit-link">、<tt>、<strong>），避免像截图里那样
// 把 HTML 标签直接当文本显示。
export default function Markdown({ content, className, maxLength }) {
  if (!content) return null

  let text = typeof content === 'string' ? content : String(content)
  if (maxLength && maxLength > 0 && text.length > maxLength) {
    text = text.slice(0, maxLength)
  }

  return (
    // github-markdown-css 要求外层容器带 markdown-body 类。
    // 注意：react-markdown v9+ 已移除 <ReactMarkdown> 的 className prop，
    // 直接传 className 会被忽略，必须用外层 div 包裹才能套上样式。
    <div className={`markdown-body ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          // 链接在新标签页打开，且保留 GitHub release 里原始链接的行为
          // 解构掉 node：react-markdown 会把 hast 节点作为 node 传入，
          // 直接 {...props} 展开到 <a> 会触发 React 的 unknown prop 警告。
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
