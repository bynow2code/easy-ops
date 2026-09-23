import { useCallback, useEffect, useRef, useState } from 'react'
import { App as AntdApp, Button, Checkbox, Modal, Space, Tooltip, Typography } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useAppStore } from '../store/useAppStore'
import { toUserMessage } from '../utils/toUserMessage'

/**
 * 页签关闭守卫:关闭带未保存草稿的页签时,弹 VS Code 风格的确认框。
 *
 * 挂在 App 层常驻(详情区会随页签清空而卸载,弹窗不能跟着它走),
 * 通过 store 的 tabCloseRequest 接收关闭请求。处理语义:
 * - 干净页签直接关;脏页签逐个弹窗询问(Don't save / Cancel / Save changes)
 * - Cancel 中止剩余队列;Save 失败同样中止(页签保留、草稿不动)
 * - 勾选 Always discard 并点了动作按钮后,本次会话内后续关闭直接丢弃不再询问
 *   (Cancel 不记忆勾选 —— 什么都没发生,偏好不该生效)
 */
export function TabCloseGuard(): JSX.Element {
  const { message } = AntdApp.useApp()
  const tabCloseRequest = useAppStore((s) => s.tabCloseRequest)
  const scripts = useAppStore((s) => s.scripts)

  // 待处理队列放 ref:advance 里连续消费,中间态不需要触发渲染
  const queueRef = useRef<string[]>([])
  // StrictMode 下 effect 会对同一个请求对象跑两次,靠 ref 去重,防止队列被重复初始化
  const lastRequestRef = useRef<{ ids: string[] } | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [checkbox, setCheckbox] = useState(false)
  const [saving, setSaving] = useState(false)
  // saving 的 ref 镜像:保存在途时连点按钮/按 Esc 都被它挡住,不等重渲染
  const savingRef = useRef(false)

  /** 取下一个待关闭页签:干净的直接关,脏的弹确认,队列走完收弹窗 */
  const advance = useCallback((): void => {
    const { openTabs, scripts, contentDrafts, closeTab, clearContentDraft, alwaysDiscardTabClose } =
      useAppStore.getState()
    let id = queueRef.current.shift()
    // 请求到处理之间页签可能已被收掉(脚本被删后 reload 收页签),跳过
    while (id !== undefined && !openTabs.includes(id)) id = queueRef.current.shift()
    if (id === undefined) {
      setConfirmId(null)
      return
    }
    const script = scripts.find((s) => s.id === id)
    const draft = contentDrafts[id]
    // 未保存判定与页签橙点同口径:改了又改回原样的不算未保存
    const dirty = script !== undefined && draft !== undefined && draft !== script.content
    if (!dirty) {
      closeTab(id)
      advance()
      return
    }
    // 会话级 Always discard:静默丢弃,不弹窗
    if (alwaysDiscardTabClose) {
      clearContentDraft(id)
      closeTab(id)
      advance()
      return
    }
    // 每个弹窗的勾选都从干净状态开始
    setCheckbox(false)
    setConfirmId(id)
  }, [])

  const handleDecision = useCallback(
    async (decision: 'discard' | 'save' | 'cancel'): Promise<void> => {
      const id = confirmId
      if (id === null || savingRef.current) return

      if (decision === 'cancel') {
        queueRef.current = []
        setConfirmId(null)
        return
      }

      const store = useAppStore.getState()

      if (decision === 'discard') {
        // 勾选只在动作真正生效时记忆(Cancel 不算,保存失败也不算):
        // 刚收到保存报错的用户,下一次关闭必须有再选一次的机会,不能被静默丢弃
        if (checkbox) store.setAlwaysDiscardTabClose(true)
        store.clearContentDraft(id)
        store.closeTab(id)
        advance()
        return
      }

      // save:走 store 的保存动作,草稿在 IPC 往返期间继续输入的话按未保存增量保留
      savingRef.current = true
      setSaving(true)
      try {
        await store.saveScriptContent(id)
        // 保存成功后才记忆勾选,失败路径不落偏好(见 discard 分支注释)
        if (checkbox) store.setAlwaysDiscardTabClose(true)
        store.closeTab(id)
      } catch (err) {
        // 保存失败:页签保留、草稿不动,后续队列中止
        queueRef.current = []
        message.error(toUserMessage(err))
      }
      savingRef.current = false
      setSaving(false)
      setConfirmId(null)
      if (queueRef.current.length > 0) advance()
    },
    [confirmId, checkbox, advance, message]
  )

  useEffect(() => {
    if (!tabCloseRequest || tabCloseRequest === lastRequestRef.current) return
    lastRequestRef.current = tabCloseRequest
    useAppStore.getState().clearTabCloseRequest()
    // 弹窗开着时遮罩挡住了页签区,理论上不会再有新请求;这里仍做合并兜底
    queueRef.current = [...queueRef.current, ...tabCloseRequest.ids]
    advance()
  }, [tabCloseRequest, advance])

  const confirmScript =
    confirmId === null ? null : (scripts.find((s) => s.id === confirmId) ?? null)

  return (
    <Modal
      open={confirmId !== null}
      width={440}
      centered
      // 遮罩点击不关:X/Esc 走 Cancel,弹窗误关不能丢用户内容
      maskClosable={false}
      onCancel={() => void handleDecision('cancel')}
      title={<span style={{ fontSize: 14, fontWeight: 600 }}>Save changes?</span>}
      footer={
        // VS Code 同款布局:Don't save 靠左,Cancel / Save changes 靠右,主按钮是保存
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button disabled={saving} onClick={() => void handleDecision('discard')}>
            Don't save
          </Button>
          <Space>
            <Button disabled={saving} onClick={() => void handleDecision('cancel')}>
              Cancel
            </Button>
            <Button type="primary" loading={saving} onClick={() => void handleDecision('save')}>
              Save changes
            </Button>
          </Space>
        </div>
      }
    >
      <Typography.Paragraph style={{ fontSize: 13, marginBottom: 12 }}>
        <Typography.Text strong>{confirmScript?.name ?? 'This script'}</Typography.Text> has
        unsaved changes. Save these changes to avoid losing your work.
      </Typography.Paragraph>
      <Checkbox checked={checkbox} onChange={(e) => setCheckbox(e.target.checked)}>
        <Typography.Text style={{ fontSize: 13 }}>
          Always discard unsaved changes when closing a tab
        </Typography.Text>
        {/* 说明图标走 antd 的 secondary 色:不引 --color-* 变量(部分变量从未被注入,别传播这个坑) */}
        <Tooltip title="Discard unsaved changes without asking whenever you close a tab. Only lasts for this session.">
          <Typography.Text type="secondary" style={{ marginLeft: 6 }}>
            <InfoCircleOutlined />
          </Typography.Text>
        </Tooltip>
      </Checkbox>
    </Modal>
  )
}
