import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, message } from 'antd'
import { SCRIPT_NAME_MAX, validateScriptContent, validateScriptName } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { ScriptEditor } from './ScriptEditor'

export function ScriptFormModal(): JSX.Element | null {
  const form = useAppStore((s) => s.form)
  const groups = useAppStore((s) => s.groups)
  const closeForm = useAppStore((s) => s.closeForm)
  const reload = useAppStore((s) => s.reload)
  const selectScript = useAppStore((s) => s.selectScript)

  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isCreate = form.type === 'script-create'
  const isEdit = form.type === 'script-edit'
  const open = isCreate || isEdit

  useEffect(() => {
    if (isEdit) {
      setName(form.script.name)
      setContent(form.script.content)
      setGroupId(form.script.groupId)
    } else if (isCreate) {
      setName('')
      setContent('')
      setGroupId(form.groupId)
    }
  }, [form, isCreate, isEdit])

  if (!open) return null

  const nameCheck = validateScriptName(name)
  const contentCheck = validateScriptContent(content)

  const handleOk = async (): Promise<void> => {
    if (!nameCheck.ok) return void message.error(nameCheck.message)
    if (!contentCheck.ok) return void message.error(contentCheck.message)

    setSubmitting(true)
    try {
      if (isCreate) {
        const created = await window.api.scripts.create({ name, content, groupId })
        await reload()
        selectScript(created.id)
      } else {
        await window.api.scripts.update(form.script.id, { name, content, groupId })
        await reload()
      }
      closeForm()
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

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
      destroyOnClose
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
