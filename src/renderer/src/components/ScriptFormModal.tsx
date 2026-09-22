import { useEffect, useRef, useState } from 'react'
import { App, Form, Input, Modal, Select, Typography } from 'antd'
import { SCRIPT_NAME_MAX, validateScriptName } from '../../../shared/types'
import type { ShellInfo } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { toUserMessage } from '../utils/toUserMessage'
import {
  buildOverrideOptions,
  globalShellLabel,
  toSelectValue,
  toShellIdPatch
} from '../settings/shellOverride'

/**
 * 脚本元数据弹窗:只管名称 / 分组 / Shell。
 * 脚本内容不在这里 —— 内容面板(常驻的那块)才是唯一的内容编辑入口,
 * 这样一个职责一个地方,不存在「两处改同一份内容」的歧义。
 */
export function ScriptFormModal(): JSX.Element {
  const { message } = App.useApp()
  const form = useAppStore((s) => s.form)
  const groups = useAppStore((s) => s.groups)
  const closeForm = useAppStore((s) => s.closeForm)
  const reload = useAppStore((s) => s.reload)
  const selectScript = useAppStore((s) => s.selectScript)
  const requestContentFocus = useAppStore((s) => s.requestContentFocus)

  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [shellId, setShellId] = useState<string | null>(null)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [globalShellId, setGlobalShellId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 重入保护用 ref 而不是只看 state:setSubmitting 触发的重渲染之前连点 OK
  // 读到的仍是旧值,并发跑两次 create 就会重复建脚本
  const submittingRef = useRef(false)

  const isCreate = form.type === 'script-create'
  const isEdit = form.type === 'script-edit'
  const open = isCreate || isEdit

  useEffect(() => {
    if (isEdit) {
      setName(form.script.name)
      setGroupId(form.script.groupId)
      setShellId(form.script.shellId)
    } else if (isCreate) {
      setName('')
      setGroupId(form.groupId)
      setShellId(null)
    }
  }, [form, isCreate, isEdit])

  // 可用 shell 与全局默认 shell 只在弹窗打开时取一次,避免编辑过程中的重渲染反复请求
  useEffect(() => {
    if (!open) return
    void (async () => {
      try {
        const [list, settings] = await Promise.all([
          window.api.shell.detect(),
          window.api.settings.get()
        ])
        setShells(list)
        setGlobalShellId(settings.shellId)
      } catch (err) {
        message.error(toUserMessage(err))
      }
    })()
  }, [open, message])

  const nameCheck = validateScriptName(name)

  const handleOk = async (): Promise<void> => {
    if (submittingRef.current) return
    if (!nameCheck.ok) return void message.error(nameCheck.message)

    submittingRef.current = true
    setSubmitting(true)
    try {
      if (isCreate) {
        // 内容故意留空:创建后自动选中,到内容面板里写
        const created = await window.api.scripts.create({ name, content: '', groupId, shellId })
        await reload()
        selectScript(created.id)
        requestContentFocus(created.id)
      } else if (isEdit) {
        await window.api.scripts.update(form.script.id, { name, groupId, shellId })
        await reload()
      }
      closeForm()
    } catch (err) {
      message.error(toUserMessage(err))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const followGlobalHint = globalShellLabel(shells, globalShellId)

  return (
    <Modal
      open={open}
      centered
      title={isCreate ? '新建脚本' : '编辑脚本'}
      onOk={handleOk}
      onCancel={closeForm}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      width={720}
      // 让 Modal 常驻,把挂载开销挪出弹窗入场动画(实测不这样做动画只有 ~39fps)
      forceRender
      // 新建后要把光标交回内容面板;antd 默认在关闭时把焦点还给触发按钮,会抢走
      focusTriggerAfterClose={false}
    >
      <Form layout="vertical">
        <Form.Item
          label="脚本名称"
          required
          help={`最长 ${SCRIPT_NAME_MAX} 个字符,当前 ${Array.from(name).length} 个`}
          validateStatus={name.length > 0 && !nameCheck.ok ? 'error' : undefined}
        >
          <Input
            value={name}
            autoFocus
            placeholder="例如:启动本地服务"
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Item>

        <Form.Item label="分组" help="可留空,表示不归入任何分组">
          <Select
            value={groupId}
            allowClear
            placeholder="未分组"
            onChange={(value) => setGroupId(value ?? null)}
            options={groups.map((g) => ({ label: g.name, value: g.id }))}
          />
        </Form.Item>

        <Form.Item
          label="Shell"
          help={`不指定时跟随全局 shell${followGlobalHint ? `(当前:${followGlobalHint})` : ''}`}
        >
          <Select
            value={toSelectValue(shellId)}
            options={buildOverrideOptions(shells, shellId)}
            onChange={(value) => setShellId(toShellIdPatch(value))}
          />
        </Form.Item>

        {isCreate ? (
          <Form.Item help="创建后在下方内容区直接输入脚本内容">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              内容不在这里填 —— 建好就写,下面那块内容区才是编辑器。
            </Typography.Text>
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  )
}
