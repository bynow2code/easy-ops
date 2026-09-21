import { useEffect } from 'react'
import { App as AntdApp } from 'antd'
import { useAppStore } from '../store/useAppStore'

/**
 * 关窗拦截:有未保存的内容草稿时,给一次「保存并退出 / 放弃更改」的机会。
 *
 * 只在打包版开启 —— dev 下 HMR 的整页刷新会频繁触发 beforeunload,
 * 不能被它烦到。渲染层自己拦(Electron 里 beforeunload 返回 falsy 以外的值
 * 会取消关闭),不需要主进程参与。
 */
export function UnsavedDraftGuard(): null {
  const { modal, message } = AntdApp.useApp()

  useEffect(() => {
    let enabled = false
    void window.api.app.info().then((info) => {
      enabled = info.packaged
    })

    const dirtyDrafts = (): { id: string; value: string }[] => {
      const { contentDrafts, scripts } = useAppStore.getState()
      return Object.entries(contentDrafts)
        .filter(([id, value]) => {
          const script = scripts.find((s) => s.id === id)
          return script !== undefined && script.content !== value
        })
        .map(([id, value]) => ({ id, value }))
    }

    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      const drafts = dirtyDrafts()
      if (!enabled || drafts.length === 0) return

      // Electron:preventDefault / 给 returnValue 赋值都会取消这次关闭
      e.preventDefault()
      e.returnValue = ''

      modal.confirm({
        centered: true,
        title: '有未保存的内容',
        content: `${drafts.length} 个脚本的改动还没保存,退出前要保存吗?`,
        okText: '保存并退出',
        cancelText: '放弃更改',
        onOk: async () => {
          try {
            for (const { id, value } of drafts) {
              await window.api.scripts.update(id, { content: value })
              useAppStore.getState().clearContentDraft(id)
            }
            await useAppStore.getState().reload()
            window.close()
          } catch (err) {
            message.error(`保存失败:${err instanceof Error ? err.message : String(err)}`)
          }
        },
        onCancel: () => {
          for (const { id } of drafts) useAppStore.getState().clearContentDraft(id)
          window.close()
        }
      })
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [modal, message])

  return null
}
