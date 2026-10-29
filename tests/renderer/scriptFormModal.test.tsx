import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Group, Script, ShellInfo } from '../../src/shared/types'

// CodeMirror 是重量级且与本用例关注的「Shell 字段」无关,用受控 textarea 替身隔离
vi.mock('../../src/renderer/src/components/ScriptEditor', () => ({
  ScriptEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element => (
    <textarea data-testid="editor" value={value} onChange={(e) => onChange(e.target.value)} />
  )
}))

import { ScriptFormModal } from '../../src/renderer/src/components/ScriptFormModal'
import { useAppStore } from '../../src/renderer/src/store/useAppStore'
import { ThemeProvider } from '../../src/renderer/src/theme/provider'
import { installJsdomShims } from './jsdomShims'

const zsh: ShellInfo = { id: 'zsh', name: 'zsh', path: '/bin/zsh', args: ['-i'], source: 'detected' }
const bash: ShellInfo = { id: 'bash', name: 'bash', path: '/bin/bash', args: ['-i'], source: 'detected' }

const script = (shellId: string | null): Script => ({
  id: 's1',
  name: '构建',
  content: 'echo build',
  groupId: null,
  shellId,
  order: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

interface ApiMock {
  shell: { detect: ReturnType<typeof vi.fn> }
  settings: { get: ReturnType<typeof vi.fn> }
  scripts: {
    list: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    reorder: ReturnType<typeof vi.fn>
  }
  groups: { list: ReturnType<typeof vi.fn> }
}

function setupApi(): ApiMock {
  const api: ApiMock = {
    shell: { detect: vi.fn(async () => [zsh, bash]) },
    settings: {
      get: vi.fn(async () => ({
        theme: 'light',
        shellId: 'bash',
        customShells: [],
        checkUpdateOnLaunch: true
      }))
    },
    scripts: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => script(null)),
      update: vi.fn(async () => script(null)),
      remove: vi.fn(async () => undefined),
      reorder: vi.fn(async () => undefined)
    },
    groups: { list: vi.fn(async () => []) }
  }
  ;(window as unknown as { api: ApiMock }).api = api
  return api
}

function renderModal(): void {
  render(
    <ThemeProvider mode="light" onModeChange={() => undefined}>
      <ScriptFormModal />
    </ThemeProvider>
  )
}

/** 打开 Shell 下拉:antd 的 Select 靠 mouseDown 展开,且弹窗内还有「分组」下拉,需按 label 定位 */
async function openShellSelect(): Promise<void> {
  const item = (await screen.findByText('Shell')).closest('.ant-form-item')
  if (!item) throw new Error('未找到 Shell 表单项')
  const selector = item.querySelector('.ant-select-selector')
  if (!selector) throw new Error('未找到 Shell 下拉')
  fireEvent.mouseDown(selector)
}

/** antd 会在两个中文字符间插入空格,可访问名实际是「保 存」 */
function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: /^保\s?存$/ })
}

const group = (
  id: string,
  name: string,
  order: number,
  parentId: string | null = null
): Group => ({ id, name, order, parentId, createdAt: '2026-01-01T00:00:00.000Z' })

/** 打开「分组」下拉树(弹窗里还有 Shell 下拉,必须按表单项定位) */
async function openGroupSelect(): Promise<void> {
  const item = (await screen.findByText('分组')).closest('.ant-form-item')
  if (!item) throw new Error('未找到分组表单项')
  const selector = item.querySelector('.ant-select-selector')
  if (!selector) throw new Error('未找到分组下拉')
  fireEvent.mouseDown(selector)
  await screen.findByRole('tree')
}

/** 弹层里当前可见的节点名(顺序即渲染顺序=树的前序) */
function treeTitles(): string[] {
  return [...document.querySelectorAll('.ant-select-tree-title')].map((n) => n.textContent ?? '')
}

/** 点某个节点的展开箭头(节点名在同层内唯一时才用得上) */
function expandNode(name: string): void {
  const row = [...document.querySelectorAll('.ant-select-tree-treenode')].find(
    (n) => n.textContent === name
  )
  const switcher = row?.querySelector('.ant-select-tree-switcher')
  if (!switcher) throw new Error(`未找到「${name}」的展开箭头`)
  fireEvent.click(switcher as HTMLElement)
}

beforeEach(() => {
  installJsdomShims()
  useAppStore.setState({ form: { type: 'none' }, scripts: [], groups: [] })
})

afterEach(() => {
  cleanup()
})

describe('脚本弹窗的 Shell 字段', () => {
  it('未打开表单时弹窗骨架也保持挂载,不让挂载开销落进弹窗动画', () => {
    setupApi()
    useAppStore.setState({ form: { type: 'none' } })

    renderModal()

    // 常驻的弹窗在关闭态不渲染可见内容,但表单子树已经在位
    expect(document.querySelector('.ant-modal-wrap[style*="display: none"]')).toBeTruthy()
    expect(screen.getByPlaceholderText('例如:启动本地服务')).toBeTruthy()
  })

  it('编辑脚本时回填该脚本已指定的 shell', async () => {
    setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script('zsh') } })

    renderModal()

    await waitFor(() => expect(screen.getByTitle('zsh · /bin/zsh')).toBeTruthy())
  })

  it('新建脚本时默认「跟随全局」', async () => {
    setupApi()
    useAppStore.setState({ form: { type: 'script-create', groupId: null } })

    renderModal()

    await waitFor(() => expect(screen.getByTitle('跟随全局')).toBeTruthy())
  })

  it('保存时把当前选择的 shell 一并提交', async () => {
    const api = setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script('zsh') } })

    renderModal()
    await openShellSelect()
    fireEvent.click(await screen.findByTitle('bash · /bin/bash'))
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(api.scripts.update).toHaveBeenCalledWith('s1', expect.objectContaining({ shellId: 'bash' }))
    )
  })

  it('新建时不填内容,提交空串表示先建后写', async () => {
    const api = setupApi()
    useAppStore.setState({ form: { type: 'script-create', groupId: null } })

    renderModal()
    await waitFor(() => expect(screen.getByTitle('跟随全局')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('例如:启动本地服务'), {
      target: { value: '部署' }
    })
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(api.scripts.create).toHaveBeenCalledWith({
        name: '部署',
        content: '',
        groupId: null,
        shellId: null
      })
    )
  })

  it('打开弹窗只探测一次可用 shell,编辑过程中的重渲染不会重复请求', async () => {
    const api = setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script('zsh') } })

    renderModal()
    await waitFor(() => expect(screen.getByTitle('zsh · /bin/zsh')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('例如:启动本地服务'), { target: { value: '构建 v2' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(api.scripts.update).toHaveBeenCalled())
    expect(api.shell.detect).toHaveBeenCalledTimes(1)
  })

  it('脚本指定的 shell 已不存在时,仍原样显示且保存不丢失', async () => {
    const api = setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script('custom:/opt/gone') } })

    renderModal()

    await waitFor(() => expect(screen.getByTitle('custom:/opt/gone(已不可用)')).toBeTruthy())
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(api.scripts.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ shellId: 'custom:/opt/gone' })
      )
    )
  })
})

describe('脚本弹窗的分组树', () => {
  // 后端服务 > 部署,前端 > 构建:两个父分组各自带一个子分组
  const nested: Group[] = [
    group('g-be', '后端服务', 0),
    group('g-be-dep', '部署', 0, 'g-be'),
    group('g-fe', '前端', 1),
    group('g-fe-build', '构建', 0, 'g-fe')
  ]

  it('编辑已归入子分组的脚本时,弹层按层级展示并把父分组展开', async () => {
    setupApi()
    useAppStore.setState({
      form: { type: 'script-edit', script: { ...script(null), groupId: 'g-be-dep' } },
      groups: nested
    })

    renderModal()
    await waitFor(() => expect(document.querySelector('.ant-select-selection-item')?.textContent).toBe('部署'))
    await openGroupSelect()

    // 父分组与子分组同时在屏:说明展开链是「已选分组的祖先」而不是全树摊开
    await waitFor(() => expect(treeTitles()).toEqual(['后端服务', '部署', '前端']))
    const childRow = [...document.querySelectorAll('.ant-select-tree-treenode')].find(
      (n) => n.textContent === '部署'
    )
    // 子分组比父分组多一级缩进 —— 层级是被渲染出来的,不是靠名字排序伪装的
    expect(childRow?.querySelectorAll('.ant-select-tree-indent-unit').length).toBe(1)
  })

  it('父分组自身也能被选为脚本归属', async () => {
    const api = setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script(null) }, groups: nested })

    renderModal()
    await waitFor(() => expect(screen.getByTitle('跟随全局')).toBeTruthy())
    await openGroupSelect()
    fireEvent.click(await screen.findByText('后端服务'))
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(api.scripts.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ groupId: 'g-be' })
      )
    )
  })

  it('同名但不同父级的分组互不串位', async () => {
    // 两个「部署」:靠 id 而不是名字区分,选错了就会写进另一个父分组
    const twins: Group[] = [
      group('g-be', '后端服务', 0),
      group('g-be-dep', '部署', 0, 'g-be'),
      group('g-fe', '前端', 1),
      group('g-fe-dep', '部署', 0, 'g-fe')
    ]
    const api = setupApi()
    useAppStore.setState({
      form: { type: 'script-edit', script: { ...script(null), groupId: 'g-be-dep' } },
      groups: twins
    })

    renderModal()
    await openGroupSelect()
    await waitFor(() => expect(treeTitles()).toEqual(['后端服务', '部署', '前端']))
    expandNode('前端')
    await waitFor(() => expect(treeTitles()).toEqual(['后端服务', '部署', '前端', '部署']))

    // 末尾那个「部署」属于前端(树是前序渲染,前端的子级排在最后)。
    // 选中回调挂在 node-content-wrapper 上,点外层 treenode 不会冒泡到它 —— 必须点进一层
    const rows = [...document.querySelectorAll('.ant-select-tree-node-content-wrapper')]
    fireEvent.click(rows[rows.length - 1] as HTMLElement)
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(api.scripts.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ groupId: 'g-fe-dep' })
      )
    )
  })

  it('搜索时只保留命中项及其父路径', async () => {
    setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script(null) }, groups: nested })

    renderModal()
    await waitFor(() => expect(screen.getByTitle('跟随全局')).toBeTruthy())
    await openGroupSelect()

    const item = screen.getByText('分组').closest('.ant-form-item') as HTMLElement
    const input = item.querySelector('.ant-select-selection-search-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '部署' } })

    // 命中项「部署」保留,它的父分组「后端服务」作为路径保留;另一个分支整个隐藏
    await waitFor(() => expect(treeTitles()).toEqual(['后端服务', '部署']))
  })
})

describe('分组树弹层的间距', () => {
  /**
   * vitest 默认不处理 CSS(本仓库 vitest.config.ts 无 css 配置),所以尺寸只能从
   * theme.css 源码里读 —— getComputedStyle 在 jsdom 里拿不到任何真实值。
   */
  function themeCss(): string {
    const candidates = [
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/src/theme/theme.css'),
      join(process.cwd(), 'src/renderer/src/theme/theme.css')
    ]
    for (const p of candidates) {
      try {
        return readFileSync(p, 'utf8')
      } catch {
        /* 试下一个 */
      }
    }
    throw new Error('找不到 theme.css,尝试过: ' + candidates.join(' | '))
  }

  /** 取某个选择器块里的数值属性(0 层花括号,足够用) */
  function cssProp(selector: string, prop: string): number {
    const css = themeCss()
    const start = css.indexOf(`${selector} {`)
    if (start === -1) throw new Error(`theme.css 里找不到选择器 ${selector}`)
    const block = css.slice(start, css.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '')
    const match = block.match(new RegExp(`[\\s;{]${prop}:\\s*(-?[\\d.]+)(?:px)?\\s*[;}]`))
    if (!match) throw new Error(`选择器 ${selector} 里找不到 ${prop}(需为具体数值)`)
    return parseFloat(match[1])
  }

  it('弹层根上挂专属类名,否则下面两条尺寸规则是死代码', async () => {
    setupApi()
    useAppStore.setState({ form: { type: 'script-edit', script: script(null) }, groups: [group('g1', 'PMS', 0)] })

    renderModal()
    await waitFor(() => expect(screen.getByTitle('跟随全局')).toBeTruthy())
    await openGroupSelect()

    expect(document.querySelector('.app-group-picker-popup')).toBeTruthy()
  })

  it('箭头槽与缩进都收紧了(antd 默认两者都是 24px)', () => {
    const base = '.app-group-picker-popup .ant-select-tree'
    // 箭头槽:窄到大约一个箭头 + 一点留白;右边距贴近 0,否则又白空一截
    expect(cssProp(`${base} .ant-select-tree-switcher`, 'width')).toBeLessThanOrEqual(16)
    expect(cssProp(`${base} .ant-select-tree-switcher`, 'margin-inline-end')).toBeLessThanOrEqual(4)
    // 悬停底色的 ::before 也必须跟着收,否则溢出到名字上
    expect(cssProp(`${base} .ant-select-tree-switcher::before`, 'width')).toBeLessThanOrEqual(16)
    // 每级缩进:仍要能看出层级,但不必是 24px 的一整格
    expect(cssProp(`${base} .ant-select-tree-indent-unit`, 'width')).toBeLessThanOrEqual(14)
  })
})
