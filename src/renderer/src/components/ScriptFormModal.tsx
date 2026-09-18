import { useEffect, useState } from 'react'
import { App, Form, Input, Modal, Select } from 'antd'
import { SCRIPT_NAME_MAX, validateScriptContent, validateScriptName } from '../../../shared/types'
import type { ShellInfo } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { ScriptEditor } from './ScriptEditor'
import { toUserMessage } from '../utils/toUserMessage'
import {
  buildOverrideOptions,
  globalShellLabel,
  toSelectValue,
  toShellIdPatch
} from '../settings/shellOverride'

export function ScriptFormModal(): JSX.Element {
  const { message } = App.useApp()
  const form = useAppStore((s) => s.form)
  const groups = useAppStore((s) => s.groups)
  const closeForm = useAppStore((s) => s.closeForm)
  const reload = useAppStore((s) => s.reload)
  const selectScript = useAppStore((s) => s.selectScript)

  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [shellId, setShellId] = useState<string | null>(null)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [globalShellId, setGlobalShellId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isCreate = form.type === 'script-create'
  const isEdit = form.type === 'script-edit'
  const open = isCreate || isEdit

  useEffect(() => {
    if (isEdit) {
      setName(form.script.name)
      setContent(form.script.content)
      setGroupId(form.script.groupId)
      setShellId(form.script.shellId)
    } else if (isCreate) {
      setName('')
      setContent('')
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
  const contentCheck = validateScriptContent(content)

  const handleOk = async (): Promise<void> => {
    if (!nameCheck.ok) return void message.error(nameCheck.message)
    if (!contentCheck.ok) return void message.error(contentCheck.message)

    setSubmitting(true)
    try {
      if (isCreate) {
        const created = await window.api.scripts.create({ name, content, groupId, shellId })
        await reload()
        selectScript(created.id)
      } else if (isEdit) {
        await window.api.scripts.update(form.script.id, { name, content, groupId, shellId })
        await reload()
      }
      closeForm()
    } catch (err) {
      message.error(toUserMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const followGlobalHint = globalShellLabel(shells, globalShellId)

  return (
    <Modal
      open={open}
      title={isCreate ? '新建脚本' : '编辑脚本'}
      onOk={handleOk}
      onCancel={closeForm}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      width={720}
      // 编辑器挂载有几十毫秒开销(实测最慢帧 84ms),而它原本正好落在弹窗入场动画里,
      // 于是「新建脚本」的动画只有 ~39fps(其它弹窗 ~51fps、满帧 60fps)。
      // 这里让 Modal 常驻(配合上面去掉 `if (!open) return null`),把开销挪出动画窗口。
      forceRender
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

        <Form.Item
          label="脚本内容"
          required
          validateStatus={content.length > 0 && !contentCheck.ok ? 'error' : undefined}
          help={content.length > 0 && !contentCheck.ok ? contentCheck.message : undefined}
        >
          <ScriptEditor value={content} onChange={setContent} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
