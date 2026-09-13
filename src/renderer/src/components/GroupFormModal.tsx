import { useEffect, useState } from 'react'
import { App, Form, Input, Modal } from 'antd'
import { GROUP_NAME_MAX, validateGroupName } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'

export function GroupFormModal(): JSX.Element | null {
  const { message } = App.useApp()
  const form = useAppStore((s) => s.form)
  const closeForm = useAppStore((s) => s.closeForm)
  const reload = useAppStore((s) => s.reload)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isCreate = form.type === 'group-create'
  const isEdit = form.type === 'group-edit'
  const open = isCreate || isEdit

  useEffect(() => {
    if (isEdit) setName(form.group.name)
    else if (isCreate) setName('')
  }, [form, isCreate, isEdit])

  if (!open) return null

  const handleOk = async (): Promise<void> => {
    const check = validateGroupName(name)
    if (!check.ok) {
      message.error(check.message)
      return
    }
    setSubmitting(true)
    try {
      if (isCreate) await window.api.groups.create(name)
      else await window.api.groups.update(form.group.id, name)
      await reload()
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
      title={isCreate ? '新建分组' : '编辑分组'}
      onOk={handleOk}
      onCancel={closeForm}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form layout="vertical">
        <Form.Item
          label="分组名称"
          required
          help={`最长 ${GROUP_NAME_MAX} 个字符,当前 ${Array.from(name).length} 个`}
          validateStatus={name.length > 0 && !validateGroupName(name).ok ? 'error' : undefined}
        >
          <Input
            value={name}
            autoFocus
            maxLength={GROUP_NAME_MAX * 2}
            placeholder="例如:后端服务"
            onChange={(e) => setName(e.target.value)}
            onPressEnter={handleOk}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
