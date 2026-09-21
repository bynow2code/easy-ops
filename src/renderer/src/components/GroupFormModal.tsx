import { useEffect, useState } from 'react'
import { App, Form, Input, Modal } from 'antd'
import { GROUP_NAME_MAX, validateGroupName } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { toUserMessage } from '../utils/toUserMessage'

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
      // 创建时透传 parentId(null = 顶层分组),子目录建到指定父级下
      if (isCreate && form.type === 'group-create') {
        await window.api.groups.create(name, form.parentId ?? null)
      } else await window.api.groups.update(form.group.id, name)
      await reload()
      closeForm()
    } catch (err) {
      message.error(toUserMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      // 从子目录菜单进来(parentId 非空)时标题体现层级
      title={isCreate ? (form.type === 'group-create' && form.parentId ? '新建子目录' : '新建分组') : '编辑分组'}
      onOk={handleOk}
      onCancel={closeForm}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
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
