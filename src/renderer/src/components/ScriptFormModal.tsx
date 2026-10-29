import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Form, Input, Modal, Select, TreeSelect, Typography } from 'antd'
import { FolderOutlined } from '@ant-design/icons'
import { SCRIPT_NAME_MAX, validateScriptName } from '../../../shared/types'
import type { ShellInfo } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { buildGroupTree, groupAncestorIds, groupParentIds, type GroupTreeNode } from '../utils/groupTree'
import { toUserMessage } from '../utils/toUserMessage'
import {
  buildOverrideOptions,
  globalShellLabel,
  toSelectValue,
  toShellIdPatch
} from '../settings/shellOverride'

/** 分组选择器的节点:`name` 是给搜索过滤用的纯字符串副本(见 treeData 注释) */
interface GroupTreeOption {
  value: string
  name: string
  title: JSX.Element
  children?: GroupTreeOption[]
}

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
  // 展开态受控:决定"选中的值在哪一层"。搜索词有意不受控 —— 交给 antd 自己管理,
  // 它会在收起弹层时清掉,我们自己存一份反而容易留下过滤残影(重开看到被过滤过的树)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
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

  /**
   * 分组树:父子层级直接来自 groups 的 parentId,与侧栏同一份数据、同一套排序。
   * 节点额外带一个纯字符串 `name`,给 `treeNodeFilterProp` 用 —— `title` 是 ReactNode,
   * 拿它做包含匹配会过滤失效(整个对象转字符串后永远匹配不上)。
   */
  const treeData = useMemo((): GroupTreeOption[] => {
    const toOption = (node: GroupTreeNode): GroupTreeOption => {
      const option: GroupTreeOption = {
        value: node.group.id,
        name: node.group.name,
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <FolderOutlined style={{ fontSize: 13, opacity: 0.7 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.group.name}
            </span>
          </span>
        )
      }
      // 叶子节点不挂 children 空数组:rc-tree 会据此判定可展开,给每个叶子画一个空箭头槽
      if (node.children.length > 0) option.children = node.children.map(toOption)
      return option
    }
    return buildGroupTree(groups).map(toOption)
  }, [groups])

  /**
   * 数据层的 normalize 已经会把指向已删分组的脚本回退成 null,这里只是兜底:
   * groups 还没加载完(空数组)时原样透传,避免一次误判把 groupId 洗成 null 提交上去。
   */
  const selectedGroupId =
    groupId && groups.length > 0 && !groups.some((g) => g.id === groupId) ? null : groupId

  // 打开弹窗时展开"已选分组的祖先链":否则选中的值藏在收起的父级里,看不出它在哪一层
  useEffect(() => {
    if (!open) return
    setExpandedKeys(groupAncestorIds(groups, selectedGroupId))
  }, [open, selectedGroupId, groups])

  const handleGroupSearch = (value: string): void => {
    // 搜索态摊开全部有子级的分组:命中项若在收起的父级下,不展开就等于搜不到
    setExpandedKeys(value.trim() ? groupParentIds(groups) : groupAncestorIds(groups, selectedGroupId))
  }

  const nameCheck = validateScriptName(name)

  const handleOk = async (): Promise<void> => {
    if (submittingRef.current) return
    if (!nameCheck.ok) return void message.error(nameCheck.message)

    submittingRef.current = true
    setSubmitting(true)
    try {
      if (isCreate) {
        // 内容故意留空:创建后自动选中,到内容面板里写
        const created = await window.api.scripts.create({
          name,
          content: '',
          groupId: selectedGroupId,
          shellId
        })
        await reload()
        selectScript(created.id)
        requestContentFocus(created.id)
      } else if (isEdit) {
        await window.api.scripts.update(form.script.id, { name, groupId: selectedGroupId, shellId })
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

        <Form.Item label="分组" help="可留空,表示不归入任何分组;按层级展示,任意层级都能选">
          <TreeSelect
            value={selectedGroupId ?? undefined}
            allowClear
            placeholder="未分组"
            treeData={treeData}
            showSearch
            treeNodeFilterProp="name"
            onSearch={handleGroupSearch}
            treeExpandedKeys={expandedKeys}
            onTreeExpand={(keys) => setExpandedKeys(keys as string[])}
            onChange={(value) => setGroupId(value ?? null)}
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
