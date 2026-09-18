import { useCallback, useEffect, useRef } from 'react'
import type { EditorView } from '@codemirror/view'
import { App, Button, Space, Typography } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import type { Script } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { ScriptEditor } from './ScriptEditor'
import { toUserMessage } from '../utils/toUserMessage'

/**
 * 内容面板:选中脚本的内容在这里**真正编辑**并显式保存。
 *
 * 职责划分(有意为之):面板只管内容,名称/分组/Shell 在弹窗里改 ——
 * 这样内容永远只有一个编辑入口,不存在「两处改同一份」的歧义。
 * 没保存的改动按脚本 id 存在 store 里,切走再切回来不丢。
 */
export function ContentPanel({ script }: { script: Script }): JSX.Element {
  const { message } = App.useApp()
  const draft = useAppStore((s) => s.contentDrafts[script.id])
  const setContentDraft = useAppStore((s) => s.setContentDraft)
  const clearContentDraft = useAppStore((s) => s.clearContentDraft)
  const contentFocusRequest = useAppStore((s) => s.contentFocusRequest)
  const clearContentFocus = useAppStore((s) => s.clearContentFocus)
  const reload = useAppStore((s) => s.reload)

  const viewRef = useRef<EditorView | null>(null)
  const value = draft ?? script.content
  const dirty = draft !== undefined && draft !== script.content

  const save = useCallback(async (): Promise<void> => {
    if (!dirty) return
    try {
      await window.api.scripts.update(script.id, { content: draft })
      await reload()
      clearContentDraft(script.id)
      message.success('已保存')
    } catch (err) {
      message.error(toUserMessage(err))
    }
  }, [dirty, draft, script.id, reload, clearContentDraft, message])

  // 新建脚本后让光标直接进编辑器,接着写内容。
  // 不能只 focus 一次:创建走的是弹窗,弹窗关闭时它内部获得焦点的输入框被移除,
  // 浏览器会把焦点重置到 body(这发生在 focusTriggerAfterClose 管不到的层面)。
  // 所以每帧重试,直到焦点真的稳定落在编辑器里(上限 2 秒,防止异常情况无限循环)。
  useEffect(() => {
    if (contentFocusRequest !== script.id) return
    const start = performance.now()
    let raf = 0
    const tryFocus = (): void => {
      const view = viewRef.current
      if (view) {
        view.focus()
        if (view.hasFocus) {
          clearContentFocus()
          return
        }
      }
      if (performance.now() - start > 2000) {
        clearContentFocus()
        return
      }
      raf = requestAnimationFrame(tryFocus)
    }
    tryFocus()
    return () => cancelAnimationFrame(raf)
  }, [contentFocusRequest, script.id, clearContentFocus])

  // Cmd/Ctrl+S = 保存(仅在有未保存改动时接管)
  useEffect(() => {
    if (!dirty) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dirty, save])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flex: '0 0 auto'
        }}
      >
        <Space size={6} align="center" style={{ minWidth: 0 }}>
          <Typography.Text ellipsis style={{ fontSize: 14, fontWeight: 500, minWidth: 0 }}>
            {script.name}
          </Typography.Text>
          {dirty ? (
            <span
              style={{
                fontSize: 11,
                lineHeight: '16px',
                padding: '1px 6px',
                borderRadius: 6,
                flex: '0 0 auto',
                color: 'var(--app-accent-text)',
                background: 'var(--app-accent-soft)'
              }}
            >
              未保存
            </span>
          ) : null}
        </Space>
        {dirty ? (
          <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => void save()}>
            保存
          </Button>
        ) : null}
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ScriptEditor
          value={value}
          onChange={(next) => setContentDraft(script.id, next)}
          height="100%"
          onReady={(view) => {
            viewRef.current = view
          }}
        />
      </div>
    </div>
  )
}
