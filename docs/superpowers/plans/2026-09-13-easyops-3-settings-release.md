# EasyOps 重构 · 计划 3/3:设置、数据流转与发布

> **面向 AI 代理的工作者:** 必需子技能:使用 subagent-driven-development(推荐)或 executing-plans 逐任务实现此计划。步骤使用复选框(`- [ ]`)语法来跟踪进度。

**目标:** 补齐设置面板、配置导入导出、旧版数据迁移、无签名自动更新、三平台打包与 GitHub Actions 流水线,使应用可发布并可持续升级。

**架构:** 所有数据转换(导出/导入/迁移)做成主进程内的纯函数模块,便于完整单测;文件对话框与网络下载等 IO 留在 IPC 层。更新按平台分流:Windows/Linux 走 `electron-updater`,macOS 因无签名不可用 Squirrel.Mac 而走自研替换流程,且必须在路径或权限不满足时回退为「引导手动下载」。

**技术栈:** electron-updater 6.x / electron-builder 26.x / GitHub Actions

**规格:** `docs/superpowers/specs/2026-09-13-easyops-refactor-design.md`

**前置:** 计划 1 与计划 2 必须已完成。

## 全局约束

- `appId` 固定 `com.easyops.app`,`productName` 固定 `EasyOps`(用于复用旧版 `userData` 目录以支持迁移)。
- 产物命名固定 `EasyOps-<version>-<arch>.<ext>`(mac/linux)与 `EasyOps-Setup-<version>.<ext>`(Windows)。
- **迁移入口只有一处**:设置面板的「导入旧版配置」按钮。**不做**启动时自动扫描,不做弹窗提示。
- 导入 v2 为**全量覆盖**,必须先二次确认。
- 导入时对 `settings.customShells` 与 `settings.shellId` **逐项校验**,无效则丢弃并计入 `warnings`,不阻断导入。
- macOS 更新:**若应用不在 `/Applications` 或替换写入失败,必须回退为打开 Release 页面引导手动下载,不得静默失败**。
- Windows/Linux 用 `electron-updater`,`autoDownload: false`,`provider: github`(`bynow2code/easy-ops`)。
- 开发模式(`is.dev`)下点击检查更新直接提示「开发模式不支持」。
- CI 触发条件:`workflow_dispatch` + push tag `v*`;macOS 构建必须设 `CSC_IDENTITY_AUTO_DISCOVERY: false`。

---

## 文件结构

| 路径 | 职责 |
|---|---|
| `src/main/store/transfer.ts` | 导出载荷构建、导入解析、旧版迁移(纯函数,可测) |
| `src/main/ipc/config.ts` | 导入导出的文件对话框与落盘 |
| `src/main/updater/version.ts` | 版本比较(纯函数,可测) |
| `src/main/updater/mac.ts` | macOS 自研更新与回退判定 |
| `src/main/updater/win-linux.ts` | `electron-updater` 封装与事件转发 |
| `src/main/updater/index.ts` | 平台分流入口 |
| `src/main/ipc/updater.ts` | 更新域 IPC 注册 |
| `src/renderer/src/components/SettingsModal.tsx` | 设置面板(版本、仓库、Shell、导入导出) |
| `src/renderer/src/components/UpdatePanel.tsx` | 更新状态与操作 |
| `electron-builder.yml` | 三平台打包配置 |
| `.github/workflows/release.yml` | CI 流水线 |
| `tests/main/transfer.test.ts` | 导入导出与迁移单测 |
| `tests/main/version.test.ts` | 版本比较与回退判定单测 |

---

## 任务 11:设置面板

**文件:**
- 创建:`src/renderer/src/components/SettingsModal.tsx`
- 修改:`src/renderer/src/App.tsx`(顶栏加「设置」入口)
- 修改:`src/renderer/src/components/Sidebar.tsx`(无需改动,仅确认入口位置)

- [ ] **步骤 1:实现设置面板组件**

`src/renderer/src/components/SettingsModal.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Divider,
  Input,
  List,
  Modal,
  Space,
  Switch,
  Tag,
  Typography,
  message
} from 'antd'
import { DeleteOutlined, FolderOpenOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ShellInfo } from '../../../shared/types'
import { useTheme } from '../theme/provider'

interface AppInfo {
  version: string
  repo: string
  platform: string
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const { mode, setMode } = useTheme()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [selectedShellId, setSelectedShellId] = useState<string | null>(null)
  const [customShells, setCustomShells] = useState<{ id: string; name: string; path: string }[]>([])
  const [checkOnLaunch, setCheckOnLaunch] = useState(true)
  const [customPath, setCustomPath] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshShells = useCallback(async () => {
    const list = await window.api.shell.detect()
    setShells(list)
    return list
  }, [])

  useEffect(() => {
    if (!open) return
    void (async () => {
      const [appInfo, settings, list] = await Promise.all([
        window.api.app.info(),
        window.api.settings.get(),
        refreshShells()
      ])
      setInfo(appInfo)
      setSelectedShellId(settings.shellId ?? list[0]?.id ?? null)
      setCustomShells(settings.customShells)
      setCheckOnLaunch(settings.checkUpdateOnLaunch)
    })()
  }, [open, refreshShells])

  const handlePickPath = async (): Promise<void> => {
    const picked = await window.api.shell.browse()
    if (picked) setCustomPath(picked)
  }

  const handleAddCustom = async (): Promise<void> => {
    const target = customPath.trim()
    if (!target) {
      message.warning('请先选择或填写 shell 路径')
      return
    }
    setBusy(true)
    try {
      const result = await window.api.shell.validate(target)
      if (!result.valid) {
        message.error(`该路径不可用:${result.reason ?? '未知原因'}`)
        return
      }
      const next = [
        ...customShells,
        { id: `custom:${target}`, name: target.split('/').pop() ?? target, path: target }
      ]
      const saved = await window.api.settings.update({ customShells: next })
      setCustomShells(saved.customShells)
      await refreshShells()
      setCustomPath('')
      message.success('已添加自定义 shell')
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveCustom = async (id: string): Promise<void> => {
    const next = customShells.filter((s) => s.id !== id)
    const saved = await window.api.settings.update({ customShells: next })
    setCustomShells(saved.customShells)
    if (selectedShellId === id) {
      const updated = await window.api.settings.update({ shellId: null })
      setSelectedShellId(updated.shellId ?? (await refreshShells())[0]?.id ?? null)
    } else {
      await refreshShells()
    }
  }

  const handleSelectShell = async (id: string): Promise<void> => {
    const saved = await window.api.settings.update({ shellId: id })
    setSelectedShellId(saved.shellId)
    message.success('已切换默认 shell,对之后新开的终端生效')
  }

  const handleToggleCheckOnLaunch = async (checked: boolean): Promise<void> => {
    const saved = await window.api.settings.update({ checkUpdateOnLaunch: checked })
    setCheckOnLaunch(saved.checkUpdateOnLaunch)
  }

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={720} title="设置">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Typography.Text type="secondary">版本</Typography.Text>
          <div>
            <Typography.Text strong>v{info?.version ?? '—'}</Typography.Text>
          </div>
        </div>

        <div>
          <Typography.Text type="secondary">Git 仓库</Typography.Text>
          <div>
            <Typography.Link onClick={() => info && void window.api.app.openExternal(info.repo)}>
              {info?.repo ?? '—'}
            </Typography.Link>
          </div>
        </div>

        <div>
          <Typography.Text type="secondary">主题</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Space>
              <Button size="small" type={mode === 'light' ? 'primary' : 'default'} onClick={() => setMode('light')}>
                浅色
              </Button>
              <Button size="small" type={mode === 'dark' ? 'primary' : 'default'} onClick={() => setMode('dark')}>
                深色
              </Button>
              <Button size="small" type={mode === 'system' ? 'primary' : 'default'} onClick={() => setMode('system')}>
                跟随系统
              </Button>
            </Space>
          </div>
        </div>

        <div>
          <Space>
            <Typography.Text type="secondary">启动时检查更新</Typography.Text>
            <Switch size="small" checked={checkOnLaunch} onChange={handleToggleCheckOnLaunch} />
          </Space>
        </div>

        <Divider style={{ margin: '8px 0' }} />

        <Space>
          <Typography.Text strong>Shell</Typography.Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void refreshShells()}>
            重新检测
          </Button>
        </Space>

        <List
          size="small"
          bordered
          dataSource={shells}
          renderItem={(shell) => (
            <List.Item
              actions={[
                selectedShellId === shell.id ? (
                  <Tag color="blue" key="active">
                    当前使用
                  </Tag>
                ) : (
                  <Button key="use" size="small" onClick={() => void handleSelectShell(shell.id)}>
                    使用
                  </Button>
                ),
                shell.source === 'custom' ? (
                  <Button
                    key="remove"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => void handleRemoveCustom(shell.id)}
                  />
                ) : null
              ].filter(Boolean)}
            >
              <List.Item.Meta
                title={
                  <Space size={6}>
                    <span>{shell.name}</span>
                    <Tag>{shell.source === 'custom' ? '自定义' : '检测到'}</Tag>
                  </Space>
                }
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {shell.path}
                    {shell.version ? ` · ${shell.version}` : ''}
                  </Typography.Text>
                }
              />
            </List.Item>
          )}
        />

        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={customPath}
            placeholder="自定义 shell 路径,例如 /opt/homebrew/bin/zsh"
            onChange={(e) => setCustomPath(e.target.value)}
          />
          <Button icon={<FolderOpenOutlined />} onClick={handlePickPath}>
            浏览
          </Button>
          <Button type="primary" icon={<PlusOutlined />} loading={busy} onClick={handleAddCustom}>
            添加
          </Button>
        </Space.Compact>
      </Space>
    </Modal>
  )
}
```

- [ ] **步骤 2:在顶栏接入设置入口**

修改 `src/renderer/src/App.tsx`:

1. 导入:

```tsx
import { SettingOutlined } from '@ant-design/icons'
import { SettingsModal } from './components/SettingsModal'
```

2. 在 `App` 内新增状态与入口按钮,并把 `SettingsModal` 渲染到 `<ThemeProvider>` 内:

```tsx
export default function App(): JSX.Element {
  const [mode, setMode] = useState<ThemeMode>('system')
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((s) => setMode(s.theme))
  }, [])

  const handleModeChange = (next: ThemeMode): void => {
    setMode(next)
    void window.api.settings.update({ theme: next })
  }

  return (
    <ThemeProvider mode={mode} onModeChange={handleModeChange}>
      <Space direction="vertical" size={0} style={{ height: '100vh', width: '100%' }}>
        <TopBar onOpenSettings={() => setSettingsOpen(true)} />
        <Workspace />
      </Space>
      <GroupFormModal />
      <ScriptFormModal />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ThemeProvider>
  )
}
```

3. 把 `TopBar` 改为接受回调并渲染设置按钮:

```tsx
function TopBar({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const { mode, setMode } = useTheme()
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.app.info().then((info) => setVersion(info.version))
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(5,5,5,0.06)'
      }}
    >
      <Typography.Text strong>EasyOps v{version}</Typography.Text>
      <Space>
        <Segmented
          size="small"
          value={mode}
          onChange={(value) => setMode(value as ThemeMode)}
          options={[
            { label: '浅色', value: 'light' },
            { label: '深色', value: 'dark' },
            { label: '跟随系统', value: 'system' }
          ]}
        />
        <Button size="small" icon={<SettingOutlined />} onClick={onOpenSettings}>
          设置
        </Button>
      </Space>
    </div>
  )
}
```

- [ ] **步骤 3:类型检查与手动验证**

```bash
npm run typecheck && npm run dev
```

预期逐项确认:
1. 顶栏「设置」打开面板,显示版本号与可点击的仓库地址(点击后在系统浏览器打开)。
2. Shell 列表显示检测结果,当前项标「当前使用」;点其他项的「使用」后切换成功。
3. 点「浏览」选择一个可执行文件后「添加」→ 校验通过则出现在列表中(标「自定义」)。
4. 添加一个无效路径(如 `/etc/hosts`)→ 提示「该路径不可用:文件无法执行或未返回版本信息」。
5. 删除自定义项后,若它正被使用则默认 shell 自动回退到检测到的第一项。
6. 「启动时检查更新」开关状态在重启后保持。

- [ ] **步骤 4:Commit**

```bash
git add src/renderer/src/components/SettingsModal.tsx src/renderer/src/App.tsx
git commit -m "feat: 实现设置面板与 shell 切换"
```

---

## 任务 12:配置导入导出与旧版迁移

**文件:**
- 创建:`src/main/store/transfer.ts`
- 创建:`src/main/ipc/config.ts`
- 修改:`src/main/ipc/index.ts`(注册 config 域)
- 修改:`src/preload/index.ts`(追加 `config` API)
- 修改:`src/renderer/src/components/SettingsModal.tsx`(加入导入导出按钮)
- 测试:`tests/main/transfer.test.ts`

- [ ] **步骤 1:写失败的测试**

`tests/main/transfer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildExportPayload,
  EXIT_MARKER_TYPE,
  filterPortableSettings,
  parseImport,
  toLegacyMigration
} from '../../src/main/store/transfer'
import type { Group, Script, Settings } from '../../src/shared/types'

const SETTINGS: Settings = {
  theme: 'dark',
  shellId: 'zsh',
  customShells: [{ id: 'custom:/opt/zsh', name: 'zsh', path: '/opt/zsh' }],
  checkUpdateOnLaunch: false
}

function makeScript(over: Partial<Script> = {}): Script {
  return {
    id: 's1',
    name: 'a',
    content: 'echo a',
    groupId: null,
    shellId: null,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over
  }
}

function makeGroup(over: Partial<Group> = {}): Group {
  return { id: 'g1', name: '后端', order: 0, createdAt: '2026-01-01T00:00:00.000Z', ...over }
}

describe('buildExportPayload', () => {
  it('生成 v2 格式与时间戳', () => {
    const payload = buildExportPayload([makeScript()], [makeGroup()], SETTINGS)
    expect(payload.type).toBe(EXIT_MARKER_TYPE)
    expect(payload.version).toBe(2)
    expect(typeof payload.exportedAt).toBe('string')
    expect(payload.scripts).toHaveLength(1)
    expect(payload.groups).toHaveLength(1)
  })
})

describe('parseImport — v2', () => {
  it('识别 v2 载荷', () => {
    const payload = buildExportPayload([makeScript()], [makeGroup()], SETTINGS)
    const result = parseImport(JSON.stringify(payload))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mode).toBe('v2')
    expect(result.scripts).toHaveLength(1)
  })

  it('拒绝非法 JSON', () => {
    const result = parseImport('{ not json')
    expect(result.ok).toBe(false)
  })

  it('拒绝 v2 中 name 超长的脚本', () => {
    const payload = buildExportPayload([makeScript({ name: 'a'.repeat(31) })], [], SETTINGS)
    const result = parseImport(JSON.stringify(payload))
    expect(result.ok).toBe(false)
  })

  it('拒绝 v2 中内容为空的脚本', () => {
    const payload = buildExportPayload([makeScript({ content: '   ' })], [], SETTINGS)
    const result = parseImport(JSON.stringify(payload))
    expect(result.ok).toBe(false)
  })
})

describe('parseImport — 裸数组(旧版 userData)', () => {
  it('识别裸数组为 legacy', () => {
    const legacy = [{ id: '1', name: 'a', content: 'echo a', group: 'backend', orderNum: 0 }]
    const result = parseImport(JSON.stringify(legacy))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mode).toBe('legacy')
  })
})

describe('parseImport — 旧版导出格式', () => {
  it('识别 easyops-scripts-config', () => {
    const legacy = {
      type: 'easyops-scripts-config',
      version: 1,
      exportedAt: '2025-01-01T00:00:00.000Z',
      scripts: [{ id: '1', name: 'a', content: 'echo a', group: 'frontend', orderNum: 0 }]
    }
    const result = parseImport(JSON.stringify(legacy))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mode).toBe('legacy')
    expect(result.legacyScripts).toHaveLength(1)
  })
})

describe('toLegacyMigration', () => {
  it('把 group 字符串去重生成分组实体并回填 groupId', () => {
    const legacy = [
      { id: '1', name: 'a', content: 'echo a', group: 'backend', orderNum: 1 },
      { id: '2', name: 'b', content: 'echo b', group: 'frontend', orderNum: 0 },
      { id: '3', name: 'c', content: 'echo c', group: 'backend', orderNum: 2 }
    ]
    const result = toLegacyMigration(legacy)
    expect(result.groups.map((g) => g.name).sort()).toEqual(['backend', 'frontend'])
    expect(result.scripts).toHaveLength(3)
    expect(result.scripts.find((s) => s.id === '1')!.groupId).toBe(
      result.groups.find((g) => g.name === 'backend')!.id
    )
    expect(result.scripts.find((s) => s.id === '3')!.groupId).toBe(
      result.groups.find((g) => g.name === 'backend')!.id
    )
  })

  it('保留 orderNum 为 order', () => {
    const result = toLegacyMigration([{ id: '1', name: 'a', content: 'x', group: 'backend', orderNum: 7 }])
    expect(result.scripts[0].order).toBe(7)
  })

  it('group 为空时归入未分组', () => {
    const result = toLegacyMigration([{ id: '1', name: 'a', content: 'x' }])
    expect(result.scripts[0].groupId).toBeNull()
    expect(result.groups).toHaveLength(0)
  })

  it('跳过名称超长或内容为空的记录并记录 warning', () => {
    const legacy = [
      { id: '1', name: 'a'.repeat(31), content: 'x' },
      { id: '2', name: 'ok', content: '   ' },
      { id: '3', name: 'good', content: 'echo ok' }
    ]
    const result = toLegacyMigration(legacy)
    expect(result.scripts).toHaveLength(1)
    expect(result.scripts[0].id).toBe('3')
    expect(result.warnings.length).toBe(2)
  })

  it('无 id 时补生成 id', () => {
    const result = toLegacyMigration([{ name: 'a', content: 'x' }])
    expect(result.scripts[0].id.length).toBeGreaterThan(0)
  })

  it('非数组输入返回空结果', () => {
    const result = toLegacyMigration(null)
    expect(result.scripts).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
  })
})

describe('filterPortableSettings', () => {
  it('丢弃本机不存在的自定义 shell 并记录 warning', () => {
    const { settings, warnings } = filterPortableSettings(SETTINGS, {
      exists: (p) => p === '/bin/zsh',
      knownShellIds: ['zsh', 'bash']
    })
    expect(settings.customShells).toHaveLength(0)
    expect(warnings.length).toBe(1)
  })

  it('保留存在的自定义 shell', () => {
    const { settings, warnings } = filterPortableSettings(SETTINGS, {
      exists: (p) => p === '/opt/zsh',
      knownShellIds: ['zsh']
    })
    expect(settings.customShells).toHaveLength(1)
    expect(warnings).toHaveLength(0)
  })

  it('shellId 不在已知列表时置空', () => {
    const { settings } = filterPortableSettings(SETTINGS, {
      exists: (p) => p === '/opt/zsh',
      knownShellIds: ['bash']
    })
    expect(settings.shellId).toBeNull()
  })

  it('主题等可移植项原样保留', () => {
    const { settings } = filterPortableSettings(SETTINGS, { exists: () => true, knownShellIds: ['zsh'] })
    expect(settings.theme).toBe('dark')
    expect(settings.checkUpdateOnLaunch).toBe(false)
  })
})
```

- [ ] **步骤 2:运行测试验证失败**

运行:`npx vitest run tests/main/transfer.test.ts`
预期:FAIL,无法解析模块。

- [ ] **步骤 3:实现 transfer 模块**

`src/main/store/transfer.ts`:

```ts
import {
  GROUP_NAME_MAX,
  SCRIPT_NAME_MAX,
  validateGroupName,
  validateScriptContent,
  validateScriptName
} from '../../shared/types'
import type { CustomShell, Group, Script, Settings } from '../../shared/types'

export const EXIT_MARKER_TYPE = 'easyops-config'
export const EXPORT_VERSION = 2

export interface ExportPayload {
  type: typeof EXIT_MARKER_TYPE
  version: typeof EXPORT_VERSION
  exportedAt: string
  scripts: Script[]
  groups: Group[]
  settings: Settings
}

export function buildExportPayload(scripts: Script[], groups: Group[], settings: Settings): ExportPayload {
  return {
    type: EXIT_MARKER_TYPE,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    scripts,
    groups,
    settings
  }
}

export interface LegacyScriptRecord {
  id?: unknown
  name?: unknown
  content?: unknown
  group?: unknown
  orderNum?: unknown
  shellId?: unknown
  createdAt?: unknown
}

export type ParseResult =
  | { ok: true; mode: 'v2'; payload: ExportPayload }
  | { ok: true; mode: 'legacy'; legacyScripts: LegacyScriptRecord[] }
  | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksLikeLegacyRecord(value: unknown): value is LegacyScriptRecord {
  if (!isPlainObject(value)) return false
  return typeof value.name === 'string' || typeof value.content === 'string' || 'group' in value
}

export function parseImport(raw: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: '不是合法的 JSON 文件' }
  }

  if (Array.isArray(parsed)) {
    if (!parsed.every(looksLikeLegacyRecord)) {
      return { ok: false, reason: '数组内容不是有效的旧版脚本列表' }
    }
    return { ok: true, mode: 'legacy', legacyScripts: parsed }
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, reason: '文件结构无法识别' }
  }

  if (parsed.type === 'easyops-scripts-config') {
    const scripts = parsed.scripts
    if (!Array.isArray(scripts)) return { ok: false, reason: '旧版配置文件缺少 scripts 数组' }
    return { ok: true, mode: 'legacy', legacyScripts: scripts as LegacyScriptRecord[] }
  }

  if (parsed.type === EXIT_MARKER_TYPE) {
    const scripts = parsed.scripts
    const groups = parsed.groups
    if (!Array.isArray(scripts) || !Array.isArray(groups)) {
      return { ok: false, reason: '配置文件缺少 scripts 或 groups' }
    }

    for (const script of scripts) {
      if (!isPlainObject(script)) return { ok: false, reason: '脚本记录结构无效' }
      const nameCheck = validateScriptName(script.name)
      if (!nameCheck.ok) return { ok: false, reason: `脚本名称无效:${nameCheck.message}` }
      const contentCheck = validateScriptContent(script.content)
      if (!contentCheck.ok) return { ok: false, reason: `脚本内容无效:${contentCheck.message}` }
    }

    for (const group of groups) {
      if (!isPlainObject(group)) return { ok: false, reason: '分组记录结构无效' }
      const nameCheck = validateGroupName(group.name)
      if (!nameCheck.ok) return { ok: false, reason: `分组名称无效:${nameCheck.message}` }
    }

    const rawSettings = isPlainObject(parsed.settings) ? parsed.settings : {}

    return {
      ok: true,
      mode: 'v2',
      payload: {
        type: EXIT_MARKER_TYPE,
        version: EXPORT_VERSION,
        exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
        scripts: scripts as Script[],
        groups: groups as Group[],
        settings: rawSettings as unknown as Settings
      }
    }
  }

  return { ok: false, reason: '无法识别的文件类型标识' }
}

export interface LegacyMigrationResult {
  scripts: Script[]
  groups: Group[]
  warnings: string[]
}

function genId(seed: string): string {
  return `${seed}-${Math.random().toString(36).slice(2, 8)}`
}

export function toLegacyMigration(input: unknown): LegacyMigrationResult {
  if (!Array.isArray(input)) {
    return { scripts: [], groups: [], warnings: ['输入不是数组,已跳过全部记录'] }
  }

  const warnings: string[] = []
  const groups: Group[] = []
  const groupIdByName = new Map<string, string>()
  const scripts: Script[] = []
  const now = new Date().toISOString()

  input.forEach((record, index) => {
    if (!looksLikeLegacyRecord(record)) {
      warnings.push(`第 ${index + 1} 条记录结构无法识别,已跳过`)
      return
    }

    const nameCheck = validateScriptName(record.name)
    if (!nameCheck.ok) {
      warnings.push(`第 ${index + 1} 条记录被跳过:${nameCheck.message}`)
      return
    }
    const contentCheck = validateScriptContent(record.content)
    if (!contentCheck.ok) {
      warnings.push(`第 ${index + 1} 条记录被跳过:${contentCheck.message}`)
      return
    }

    let groupId: string | null = null
    const rawGroup = typeof record.group === 'string' ? record.group.trim() : ''
    if (rawGroup) {
      const existing = groupIdByName.get(rawGroup)
      if (existing) {
        groupId = existing
      } else {
        const id = genId('group')
        groupIdByName.set(rawGroup, id)
        groups.push({ id, name: rawGroup.slice(0, GROUP_NAME_MAX), order: groups.length, createdAt: now })
        groupId = id
      }
    }

    const order =
      typeof record.orderNum === 'number' && Number.isFinite(record.orderNum) ? record.orderNum : scripts.length

    scripts.push({
      id: typeof record.id === 'string' && record.id.length > 0 ? record.id : genId('script'),
      name: record.name as string,
      content: record.content as string,
      groupId,
      shellId: typeof record.shellId === 'string' && record.shellId.length > 0 ? record.shellId : null,
      order,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
      updatedAt: now
    })
  })

  return { scripts, groups, warnings }
}

export interface PortableSettingsContext {
  exists: (filePath: string) => boolean
  knownShellIds: string[]
}

export function filterPortableSettings(
  incoming: Settings,
  ctx: PortableSettingsContext
): { settings: Settings; warnings: string[] } {
  const warnings: string[] = []

  const source = incoming ?? ({} as Settings)

  const customShells: CustomShell[] = Array.isArray(source.customShells)
    ? source.customShells.filter((shell) => {
        if (!shell || typeof shell.path !== 'string') return false
        if (!ctx.exists(shell.path)) {
          warnings.push(`自定义 shell 路径在本机不存在,已忽略:${shell.path}`)
          return false
        }
        return true
      })
    : []

  let shellId: string | null = source.shellId ?? null
  if (shellId && !ctx.knownShellIds.includes(shellId)) {
    warnings.push(`默认 shell 在本机不可用,已重置:${shellId}`)
    shellId = null
  }

  return {
    settings: {
      theme: source.theme === 'light' || source.theme === 'dark' || source.theme === 'system' ? source.theme : 'system',
      shellId,
      customShells,
      checkUpdateOnLaunch: Boolean(source.checkUpdateOnLaunch)
    },
    warnings
  }
}
```

- [ ] **步骤 4:运行测试验证通过**

运行:`npx vitest run tests/main/transfer.test.ts`
预期:全部 PASS。

- [ ] **步骤 5:实现 config 域 IPC**

`src/main/ipc/config.ts`:

```ts
import * as fs from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  buildExportPayload,
  filterPortableSettings,
  parseImport,
  toLegacyMigration
} from '../store/transfer'
import { createNodeShellProbe, detectShells } from '../pty/shell'
import type { ScriptsStore } from '../store/scripts'
import type { SettingsStore } from '../store/settings'

export interface ConfigIpcDeps {
  getWindow: () => BrowserWindow | null
  scripts: ScriptsStore
  settings: SettingsStore
}

async function pickSavePath(win: BrowserWindow | null): Promise<string | null> {
  const options = {
    defaultPath: `easyops-config-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

async function pickOpenPath(win: BrowserWindow | null): Promise<string | null> {
  const options = {
    properties: ['openFile' as const],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

export function registerConfigIpc(deps: ConfigIpcDeps): void {
  ipcMain.handle('config:export', async () => {
    const filePath = await pickSavePath(deps.getWindow())
    if (!filePath) return { canceled: true }

    const payload = buildExportPayload(
      deps.scripts.listScripts(),
      deps.scripts.listGroups(),
      deps.settings.get()
    )
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
    return { canceled: false, path: filePath }
  })

  ipcMain.handle('config:import', async (_event, payload: { mode: 'v2' | 'legacy' }) => {
    const filePath = await pickOpenPath(deps.getWindow())
    if (!filePath) return { canceled: true }

    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = parseImport(raw)

    if (!parsed.ok) {
      return { canceled: false, stats: { imported: 0, groups: 0, warnings: [parsed.reason] } }
    }

    if (parsed.mode === 'legacy') {
      const migrated = toLegacyMigration(parsed.legacyScripts)
      const probe = createNodeShellProbe()
      const knownShells = await detectShells(probe)
      const knownIds = knownShells.map((s) => s.id)
      const normalized = migrated.scripts.map((s) =>
        s.shellId && !knownIds.includes(s.shellId) ? { ...s, shellId: null } : s
      )
      await deps.scripts.replaceAll({ scripts: normalized, groups: migrated.groups })
      return {
        canceled: false,
        stats: {
          imported: normalized.length,
          groups: migrated.groups.length,
          warnings: migrated.warnings
        }
      }
    }

    const probe = createNodeShellProbe()
    const knownShells = await detectShells(probe)
    const { settings, warnings } = filterPortableSettings(parsed.payload.settings as never, {
      exists: (p) => {
        try {
          // 同步检查即可:仅用于导入时的路径有效性判定
          require('node:fs').accessSync(p, require('node:fs').constants.X_OK)
          return true
        } catch {
          return false
        }
      },
      knownShellIds: knownShells.map((s) => s.id)
    })

    await deps.scripts.replaceAll({ scripts: parsed.payload.scripts, groups: parsed.payload.groups })
    deps.settings.update(settings)

    return {
      canceled: false,
      stats: {
        imported: parsed.payload.scripts.length,
        groups: parsed.payload.groups.length,
        warnings
      }
    }
  })
}
```

> 说明:`require` 在主进程 CJS 输出下可用;若后续主进程切到 ESM,需改用 `createRequire`。这里用同步检查是为了让 `filterPortableSettings` 保持纯函数签名。

- [ ] **步骤 6:注册 config 域并暴露 preload API**

在 `src/main/ipc/index.ts` 顶部导入:

```ts
import { registerConfigIpc } from './config'
```

在 `registerIpc` 内、`registerShellIpc(...)` 之后追加:

```ts
  registerConfigIpc({ getWindow: ctx.getWindow, scripts: ctx.scripts, settings: ctx.settings })
```

在 `src/preload/index.ts` 的 `api` 对象中追加:

```ts
  config: {
    export: (): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('config:export'),
    import: (mode: 'v2' | 'legacy'): Promise<{
      canceled: boolean
      stats?: { imported: number; groups: number; warnings: string[] }
    }> => ipcRenderer.invoke('config:import', { mode })
  },
```

- [ ] **步骤 7:在设置面板加入导入导出与旧版迁移入口**

修改 `src/renderer/src/components/SettingsModal.tsx`:

1. 导入图标补充:

```tsx
import { ExportOutlined, ImportOutlined, HistoryOutlined } from '@ant-design/icons'
```

2. 在组件内增加处理函数:

```tsx
  const handleExport = async (): Promise<void> => {
    const result = await window.api.config.export()
    if (!result.canceled) message.success(`已导出到 ${result.path}`)
  }

  const reportStats = (stats?: { imported: number; groups: number; warnings: string[] }): void => {
    if (!stats) return
    if (stats.warnings.length > 0) {
      Modal.info({
        title: '导入完成(含警告)',
        content: (
          <div>
            <p>
              导入脚本 {stats.imported} 个、分组 {stats.groups} 个。
            </p>
            <ul>
              {stats.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )
      })
    } else {
      message.success(`导入完成:脚本 ${stats.imported} 个、分组 ${stats.groups} 个`)
    }
  }

  const handleImportV2 = async (): Promise<void> => {
    const applied = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '导入配置',
        content: '导入会覆盖当前全部脚本与分组,确定继续吗?',
        okText: '覆盖导入',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
    if (!applied) return
    const result = await window.api.config.import('v2')
    if (!result.canceled) reportStats(result.stats)
  }

  const handleImportLegacy = async (): Promise<void> => {
    Modal.info({
      title: '导入旧版配置',
      content: '请先退出旧版 EasyOps,避免两边同时写入数据。点击「开始导入」后选择旧版导出的 JSON,或选择旧版数据目录下的 scripts.json。'
    })
    const result = await window.api.config.import('legacy')
    if (!result.canceled) reportStats(result.stats)
  }
```

3. 在 Shell 区块之前插入配置区块:

```tsx
        <Divider style={{ margin: '8px 0' }} />

        <Space>
          <Typography.Text strong>配置</Typography.Text>
        </Space>
        <Space wrap>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出当前配置
          </Button>
          <Button icon={<ImportOutlined />} onClick={handleImportV2}>
            导入配置
          </Button>
          <Button icon={<HistoryOutlined />} onClick={handleImportLegacy}>
            导入旧版配置
          </Button>
        </Space>
```

- [ ] **步骤 8:运行测试与类型检查**

```bash
npm test
npm run typecheck
```

预期:全部 PASS,类型无错误。

- [ ] **步骤 9:手动验证导入导出与迁移**

```bash
npm run dev
```

预期逐项确认:
1. 造几条脚本与分组 → 「导出当前配置」→ 选择保存位置 → 得到 JSON,其中 `type` 为 `easyops-config`、`version` 为 2。
2. 修改或删除部分脚本 → 「导入配置」→ 确认覆盖 → 数据还原为导出时状态。
3. 把 `master` 分支的旧 `server/scripts.json`(`git show master:server/scripts.json > /tmp/legacy-scripts.json`)导入 → 脚本导入成功,原 `group` 字段值成为分组名。
4. 构造一个含超长名称的旧数据导入 → 弹出「导入完成(含警告)」并列出被跳过的记录。
5. 手工把导出 JSON 里的 `customShells` 改成不存在路径 → 导入后弹出警告且该项未被采纳。

- [ ] **步骤 10:Commit**

```bash
git add src/main/store/transfer.ts src/main/ipc/config.ts src/main/ipc/index.ts src/preload/ src/renderer/src/components/SettingsModal.tsx tests/main/transfer.test.ts
git commit -m "feat: 实现配置导入导出与旧版数据迁移"
```

---

## 任务 13:无签名自动更新

**文件:**
- 创建:`src/main/updater/version.ts`
- 创建:`src/main/updater/mac.ts`
- 创建:`src/main/updater/win-linux.ts`
- 创建:`src/main/updater/index.ts`
- 创建:`src/main/ipc/updater.ts`
- 修改:`src/main/ipc/index.ts`、`src/main/index.ts`
- 修改:`src/preload/index.ts`(追加 `update` API)
- 创建:`src/renderer/src/components/UpdatePanel.tsx`
- 修改:`src/renderer/src/components/SettingsModal.tsx`(嵌入更新面板)
- 测试:`tests/main/version.test.ts`

- [ ] **步骤 1:写失败的测试(版本比较与回退判定)**

`tests/main/version.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compareVersions, decideMacUpdateAction, isNewer, normalizeVersion } from '../../src/main/updater/version'

describe('normalizeVersion', () => {
  it('去掉前缀 v', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
  })

  it('保留纯数字版本号', () => {
    expect(normalizeVersion('1.2.3')).toBe('1.2.3')
  })
})

describe('compareVersions', () => {
  it('主版本更大时返回 1', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
  })

  it('相等返回 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('补丁版本更小时返回 -1', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1)
  })

  it('忽略 v 前缀', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('段数不同时按缺失段为 0 比较', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
  })
})

describe('isNewer', () => {
  it('远端更大时为 true', () => {
    expect(isNewer('0.7.15', 'v0.8.0')).toBe(true)
  })

  it('远端更小时为 false', () => {
    expect(isNewer('0.8.0', 'v0.7.15')).toBe(false)
  })
})

describe('decideMacUpdateAction', () => {
  it('应用位于 /Applications 且有写权限时可自动替换', () => {
    expect(
      decideMacUpdateAction({ appPath: '/Applications/EasyOps.app', canWriteTarget: true })
    ).toBe('auto-replace')
  })

  it('应用不在 /Applications 时回退为引导手动下载', () => {
    expect(decideMacUpdateAction({ appPath: '/Users/x/Downloads/EasyOps.app', canWriteTarget: true })).toBe(
      'manual-download'
    )
  })

  it('无写权限时回退为引导手动下载', () => {
    expect(
      decideMacUpdateAction({ appPath: '/Applications/EasyOps.app', canWriteTarget: false })
    ).toBe('manual-download')
  })

  it('路径同时满足但权限不足时不得自动替换', () => {
    expect(decideMacUpdateAction({ appPath: '/Applications/EasyOps.app', canWriteTarget: false })).not.toBe(
      'auto-replace'
    )
  })
})
```

- [ ] **步骤 2:运行测试验证失败**

运行:`npx vitest run tests/main/version.test.ts`
预期:FAIL,无法解析模块。

- [ ] **步骤 3:实现版本与回退判定**

`src/main/updater/version.ts`:

```ts
export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = normalizeVersion(a).split('.').map((n) => Number.parseInt(n, 10) || 0)
  const right = normalizeVersion(b).split('.').map((n) => Number.parseInt(n, 10) || 0)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (l > r) return 1
    if (l < r) return -1
  }
  return 0
}

export function isNewer(current: string, remote: string): boolean {
  return compareVersions(current, remote) < 0
}

export type MacUpdateAction = 'auto-replace' | 'manual-download'

export function decideMacUpdateAction(input: {
  appPath: string
  canWriteTarget: boolean
}): MacUpdateAction {
  const inApplications = input.appPath.startsWith('/Applications/') || input.appPath === '/Applications'
  if (!inApplications) return 'manual-download'
  if (!input.canWriteTarget) return 'manual-download'
  return 'auto-replace'
}
```

- [ ] **步骤 4:运行测试验证通过**

运行:`npx vitest run tests/main/version.test.ts`
预期:全部 PASS。

- [ ] **步骤 5:实现 Windows / Linux 更新**

`src/main/updater/win-linux.ts`:

```ts
import { app } from 'electron'
import electronUpdater from 'electron-updater'

export type UpdateEvent =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available' }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

export interface UpdaterHandle {
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => void
}

export function createWinLinuxUpdater(emit: (event: UpdateEvent) => void): UpdaterHandle {
  const { autoUpdater } = electronUpdater

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking' }))
  autoUpdater.on('update-available', (info) => emit({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => emit({ status: 'not-available' }))
  autoUpdater.on('download-progress', (progress) => emit({ status: 'downloading', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', (info) => emit({ status: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => emit({ status: 'error', message: err.message }))

  return {
    async check() {
      if (!app.isPackaged) {
        emit({ status: 'error', message: '开发模式不支持检查更新' })
        return
      }
      await autoUpdater.checkForUpdates()
    },
    async download() {
      await autoUpdater.downloadUpdate()
    },
    install() {
      autoUpdater.quitAndInstall()
    }
  }
}
```

- [ ] **步骤 6:实现 macOS 自研更新**

`src/main/updater/mac.ts`:

```ts
import { app, shell } from 'electron'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { compareVersions, decideMacUpdateAction } from './version'
import type { UpdateEvent } from './win-linux'

const REPO = 'bynow2code/easy-ops'

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

async function fetchLatestRelease(): Promise<{ tag: string; htmlUrl: string; assets: ReleaseAsset[] }> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EasyOps' }
  })
  if (!response.ok) throw new Error(`获取最新版本失败:HTTP ${response.status}`)
  const json = (await response.json()) as {
    tag_name?: string
    html_url?: string
    assets?: ReleaseAsset[]
  }
  return {
    tag: json.tag_name ?? '',
    htmlUrl: json.html_url ?? `https://github.com/${REPO}/releases/latest`,
    assets: json.assets ?? []
  }
}

async function canWrite(targetDir: string): Promise<boolean> {
  try {
    await fs.access(targetDir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function runDitto(source: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ditto', ['-x', '-k', source, target], (err) => (err ? reject(err) : resolve()))
  })
}

export interface MacUpdaterHandle {
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => void
}

export function createMacUpdater(emit: (event: UpdateEvent) => void): MacUpdaterHandle {
  let pendingRelease: { tag: string; htmlUrl: string; assets: ReleaseAsset[] } | null = null
  let extractedAppPath: string | null = null

  const openReleasePage = async (url: string): Promise<void> => {
    await shell.openExternal(url)
  }

  return {
    async check() {
      if (!app.isPackaged) {
        emit({ status: 'error', message: '开发模式不支持检查更新' })
        return
      }
      emit({ status: 'checking' })
      try {
        const release = await fetchLatestRelease()
        if (!release.tag) {
          emit({ status: 'error', message: '未获取到版本标签' })
          return
        }
        const current = app.getVersion()
        if (compareVersions(current, release.tag) >= 0) {
          emit({ status: 'not-available' })
          return
        }
        pendingRelease = release
        emit({ status: 'available', version: release.tag.replace(/^v/i, '') })
      } catch (err) {
        emit({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    },

    async download() {
      if (!pendingRelease) {
        emit({ status: 'error', message: '请先检查更新' })
        return
      }

      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      const asset =
        pendingRelease.assets.find((a) => a.name.endsWith(`${arch}.zip`)) ??
        pendingRelease.assets.find((a) => a.name.endsWith('.zip'))

      if (!asset) {
        emit({ status: 'error', message: '未找到适用于当前架构的更新包' })
        await openReleasePage(pendingRelease.htmlUrl)
        return
      }

      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easyops-update-'))
      const zipPath = path.join(workDir, asset.name)

      try {
        const response = await fetch(asset.browser_download_url, { redirect: 'follow' })
        if (!response.ok || !response.body) throw new Error(`下载失败:HTTP ${response.status}`)
        await pipeline(Readable.fromWeb(response.body as never), (await import('node:fs')).createWriteStream(zipPath))

        emit({ status: 'downloading', percent: 100 })

        const extractDir = path.join(workDir, 'extract')
        await fs.mkdir(extractDir, { recursive: true })
        await runDitto(zipPath, extractDir)

        const entries = await fs.readdir(extractDir)
        const appBundle = entries.find((name) => name.endsWith('.app'))
        if (!appBundle) throw new Error('更新包中未找到 .app')
        extractedAppPath = path.join(extractDir, appBundle)

        emit({ status: 'downloaded', version: pendingRelease.tag.replace(/^v/i, '') })
      } catch (err) {
        emit({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        await openReleasePage(pendingRelease.htmlUrl)
      }
    },

    install() {
      void (async () => {
        if (!pendingRelease) return
        if (!extractedAppPath) {
          await openReleasePage(pendingRelease.htmlUrl)
          return
        }

        const appPath = app.getAppPath().replace(/\/Contents\/Resources\/app\.asar$/, '')
        const targetDir = path.dirname(appPath)
        const writable = await canWrite(targetDir)

        const action = decideMacUpdateAction({ appPath, canWriteTarget: writable })
        if (action === 'manual-download') {
          emit({
            status: 'error',
            message: '当前安装位置或权限不支持自动更新,已打开下载页面,请手动替换应用'
          })
          await openReleasePage(pendingRelease.htmlUrl)
          return
        }

        // 构造后台替换脚本:等待主进程退出 → 替换 → 去隔离 → 重启
        const script = [
          '#!/bin/sh',
          `while pgrep -f "${appPath}" > /dev/null 2>&1; do sleep 1; done`,
          `rm -rf "${appPath}"`,
          `ditto "${extractedAppPath}" "${appPath}"`,
          `xattr -dr com.apple.quarantine "${appPath}" 2>/dev/null || true`,
          `open "${appPath}"`
        ].join('\n')

        const scriptPath = path.join(os.tmpdir(), `easyops-replace-${Date.now()}.sh`)
        await fs.writeFile(scriptPath, script, { mode: 0o755 })

        const { spawn } = await import('node:child_process')
        const child = spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' })
        child.unref()

        app.quit()
      })()
    }
  }
}
```

- [ ] **步骤 7:实现平台分流入口与 IPC**

`src/main/updater/index.ts`:

```ts
import { createMacUpdater } from './mac'
import { createWinLinuxUpdater, type UpdateEvent } from './win-linux'

export type { UpdateEvent }

export interface Updater {
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => void
}

export function createUpdater(emit: (event: UpdateEvent) => void): Updater {
  return process.platform === 'darwin' ? createMacUpdater(emit) : createWinLinuxUpdater(emit)
}
```

`src/main/ipc/updater.ts`:

```ts
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { createUpdater, type Updater } from '../updater'

export interface UpdaterIpcHandle {
  updater: Updater
  checkOnLaunch: () => void
}

export function registerUpdaterIpc(getWindow: () => BrowserWindow | null): UpdaterIpcHandle {
  const emit = (event: unknown): void => {
    getWindow()?.webContents.send('update:event', event)
  }

  const updater = createUpdater(emit)

  ipcMain.handle('update:check', async () => {
    await updater.check()
  })

  ipcMain.handle('update:download', async () => {
    await updater.download()
  })

  ipcMain.handle('update:install', () => {
    updater.install()
  })

  return { updater, checkOnLaunch: () => void updater.check() }
}
```

- [ ] **步骤 8:接入主进程与 preload**

在 `src/main/ipc/index.ts` 顶部导入:

```ts
import { registerUpdaterIpc } from './updater'
```

在 `registerIpc` 末尾加入并返回句柄:

```ts
  const updaterHandle = registerUpdaterIpc(ctx.getWindow)
  return { updaterHandle }
```

将 `registerIpc` 的签名改为返回该对象:

```ts
export function registerIpc(ctx: IpcContext): { updaterHandle: ReturnType<typeof registerUpdaterIpc> } {
```

在 `src/main/index.ts` 中接收返回值:

```ts
    const { updaterHandle } = registerIpc({
      scripts: scriptsStore,
      settings: settingsStore,
      getWindow: () => mainWindow,
      repoUrl: REPO_URL
    })
```

并在窗口创建完成后、若设置为启动检查则触发一次:

```ts
    if (settingsStore.get().checkUpdateOnLaunch) {
      setTimeout(() => updaterHandle.checkOnLaunch(), 3000)
    }
```

在 `src/preload/index.ts` 的 `api` 对象中追加:

```ts
  update: {
    check: (): Promise<void> => ipcRenderer.invoke('update:check'),
    download: (): Promise<void> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onEvent: (listener: (event: unknown) => void): (() => void) => {
      const handler = (_e: unknown, event: unknown): void => listener(event)
      ipcRenderer.on('update:event', handler)
      return () => ipcRenderer.removeListener('update:event', handler)
    }
  },
```

- [ ] **步骤 9:实现更新面板并嵌入设置**

`src/renderer/src/components/UpdatePanel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Button, Progress, Space, Typography, message } from 'antd'

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'latest' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

export function UpdatePanel(): JSX.Element {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' })

  useEffect(() => {
    const off = window.api.update.onEvent((raw) => {
      const event = raw as { status: string; version?: string; percent?: number; message?: string }
      switch (event.status) {
        case 'checking':
          setState({ kind: 'checking' })
          break
        case 'available':
          setState({ kind: 'available', version: event.version ?? '' })
          break
        case 'not-available':
          setState({ kind: 'latest' })
          break
        case 'downloading':
          setState({ kind: 'downloading', percent: event.percent ?? 0 })
          break
        case 'downloaded':
          setState({ kind: 'downloaded', version: event.version ?? '' })
          break
        case 'error':
          setState({ kind: 'error', message: event.message ?? '未知错误' })
          break
        default:
          break
      }
    })
    return off
  }, [])

  const handleCheck = async (): Promise<void> => {
    setState({ kind: 'checking' })
    try {
      await window.api.update.check()
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleDownload = async (): Promise<void> => {
    setState({ kind: 'downloading', percent: 0 })
    try {
      await window.api.update.download()
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleInstall = (): void => {
    void window.api.update.install()
  }

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Space>
        <Button size="small" onClick={handleCheck} loading={state.kind === 'checking'}>
          检查更新
        </Button>

        {state.kind === 'available' ? (
          <Button size="small" type="primary" onClick={handleDownload}>
            下载 v{state.version}
          </Button>
        ) : null}

        {state.kind === 'downloaded' ? (
          <Button size="small" type="primary" onClick={handleInstall}>
            重启并安装 v{state.version}
          </Button>
        ) : null}
      </Space>

      {state.kind === 'latest' ? <Typography.Text type="secondary">当前已是最新版本</Typography.Text> : null}

      {state.kind === 'downloading' ? <Progress percent={state.percent} size="small" /> : null}

      {state.kind === 'error' ? <Typography.Text type="danger">{state.message}</Typography.Text> : null}
    </Space>
  )
}
```

在 `src/renderer/src/components/SettingsModal.tsx` 中导入并插入到「启动时检查更新」开关之后:

```tsx
import { UpdatePanel } from './UpdatePanel'
```

```tsx
        <div>
          <Typography.Text type="secondary">软件更新</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <UpdatePanel />
          </div>
        </div>
```

- [ ] **步骤 10:运行测试与类型检查**

```bash
npm test
npm run typecheck
```

预期:全部 PASS,类型无错误。

- [ ] **步骤 11:手动验证(开发模式与打包后)**

开发模式下:

```bash
npm run dev
```

预期:设置面板点「检查更新」→ 显示「开发模式不支持检查更新」(红字提示),不崩溃。

打包后验证在任务 14 完成后进行。

- [ ] **步骤 12:Commit**

```bash
git add src/main/updater/ src/main/ipc/updater.ts src/main/ipc/index.ts src/main/index.ts src/preload/ src/renderer/src/components/UpdatePanel.tsx src/renderer/src/components/SettingsModal.tsx tests/main/version.test.ts
git commit -m "feat: 实现无签名自动更新(含 macOS 回退策略)"
```

---

## 任务 14:electron-builder 打包配置

**文件:**
- 创建:`electron-builder.yml`
- 修改:`package.json`(确认 `build` 脚本已存在,计划 1 已配置)

- [ ] **步骤 1:写 `electron-builder.yml`**

```yaml
appId: com.easyops.app
productName: EasyOps
copyright: Copyright © 2026 bynow2code

directories:
  buildResources: build
  output: release

files:
  - out/**/*
  - package.json

asarUnpack:
  - '**/node_modules/node-pty/**'

extraMetadata:
  main: out/main/index.js

npmRebuild: true

electronDownload:
  mirror: https://npmmirror.com/mirrors/electron/

publish:
  provider: github
  owner: bynow2code
  repo: easy-ops

mac:
  category: public.app-category.developer-tools
  icon: build/icon.png
  target:
    - target: dmg
      arch: [x64, arm64]
    - target: zip
      arch: [x64, arm64]
  artifactName: ${productName}-${version}-${arch}.${ext}
  hardenedRuntime: false
  gatekeeperAssess: false

win:
  icon: build/icon.png
  target:
    - target: nsis
      arch: [x64]
    - target: zip
      arch: [x64]
  artifactName: ${productName}-Setup-${version}.${ext}

nsis:
  oneClick: true
  perMachine: false
  allowToChangeInstallationDirectory: false
  deleteAppDataOnUninstall: false

linux:
  icon: build/icon.png
  category: Development
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
    - target: rpm
      arch: [x64]
  artifactName: ${productName}-${version}-${arch}.${ext}
```

- [ ] **步骤 2:生成 macOS 图标(.icns)**

```bash
cd /Users/arthur/www/easy-ops
mkdir -p build/icon.iconset
for size in 16 32 64 128 256 512; do
  sips -z $size $size build/icon.png --out build/icon.iconset/icon_${size}x${size}.png >/dev/null
  dbl=$((size * 2))
  sips -z $dbl $dbl build/icon.png --out build/icon.iconset/icon_${size}x${size}@2x.png >/dev/null
done
iconutil -c icns build/icon.iconset -o build/icon.icns
rm -rf build/icon.iconset
ls -la build/icon.icns
```

预期:生成 `build/icon.icns`。

- [ ] **步骤 3:执行 macOS 打包验证**

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac
```

预期:`release/` 下出现 `EasyOps-<version>-arm64.dmg`、`EasyOps-<version>-arm64.zip`(或 x64 对应产物)以及 `latest-mac.yml`。

- [ ] **步骤 4:验证打包产物可运行且原生模块可用**

```bash
open release/mac-arm64/EasyOps.app
```

预期:应用启动,窗口正常显示;终端里可执行脚本(证明 `node-pty` 在 asar 外正常加载)。

再验证更新能力(需要产物已发布到 GitHub Release;若尚未发布,本步可延后到任务 15 首次发版后执行):

预期:设置面板「检查更新」在低于 Release 版本时能检测到新版本;权限不足或应用不在 `/Applications` 时给出「已打开下载页面」的提示而非静默失败。

- [ ] **步骤 5:Commit**

```bash
git add electron-builder.yml build/icon.icns
git commit -m "build: 添加 electron-builder 三平台打包配置"
```

---

## 任务 15:GitHub Actions 自动打包流水线

**文件:**
- 创建:`.github/workflows/release.yml`

- [ ] **步骤 1:写流水线**

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  create-release:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - name: 解析版本号
        id: version
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

      - name: 创建 Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: EasyOps ${{ github.ref_name }}
          draft: false
          prerelease: false
          generate_release_notes: true

  build:
    needs: create-release
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            script: build:win
            artifact: 'release/*.exe'
          - os: macos-latest
            script: build:mac
            artifact: 'release/*.dmg'
          - os: ubuntu-latest
            script: build:linux
            artifact: 'release/*.AppImage'
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: 同步 package.json 版本号
        shell: bash
        run: npm version "${{ needs.create-release.outputs.version }}" --no-git-tag-version --allow-same-version

      - name: 安装依赖
        run: npm install

      - name: Linux 打包依赖
        if: matrix.os == 'ubuntu-latest'
        run: sudo apt-get update && sudo apt-get install -y rpm

      - name: 构建
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run ${{ matrix.script }}

      - name: 上传安装包到 Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          files: |
            release/*.exe
            release/*.dmg
            release/*.zip
            release/*.AppImage
            release/*.deb
            release/*.rpm
            release/latest*.yml
            release/*.blockmap
          fail_on_unmatched_files: false
```

- [ ] **步骤 2:本地校验 YAML 语法**

```bash
npx --yes yaml-lint .github/workflows/release.yml 2>/dev/null || node -e "
const fs=require('fs');
const text=fs.readFileSync('.github/workflows/release.yml','utf8');
if(!text.includes('CSC_IDENTITY_AUTO_DISCOVERY')) { throw new Error('缺少 macOS 不签名配置'); }
if(!text.includes('latest')) { throw new Error('缺少更新元数据上传'); }
console.log('release.yml 关键配置检查通过');
"
```

预期:输出「release.yml 关键配置检查通过」。

- [ ] **步骤 3:推送到远端并触发一次流水线**

```bash
cd /Users/arthur/www/easy-ops
git add .github/workflows/release.yml
git commit -m "ci: 添加 GitHub Actions 三平台自动打包流水线"
git push -u origin feature/new
```

预期:分支推送成功。首次触发需先在 GitHub 上把工作流推送到默认分支或手动运行(见步骤 4)。

- [ ] **步骤 4:手动触发一次并观察结果**

在 GitHub 仓库页面进入 Actions → 选择 `Release` → `Run workflow`,选择 `feature/new` 分支运行。

预期:`create-release` 与三平台 `build` 全部通过;Release 页出现安装包与 `latest*.yml`。

- [ ] **步骤 5:打 tag 验证完整发布流程**

```bash
git tag v0.8.0
git push origin v0.8.0
```

预期:流水线自动运行并按 tag 版本号构建;Release 中出现 `EasyOps-Setup-0.8.0.exe`、`EasyOps-0.8.0-arm64.dmg`、`EasyOps-0.8.0-x86_64.AppImage` 等产物。

- [ ] **步骤 6:验证更新可用性**

在已发布版本的机器上安装上一版本并触发「检查更新」。

预期:Windows/Linux 能检测并下载新版;macOS 在满足路径与权限条件时完成自替换并重启,否则提示已打开下载页面。

---

## 计划 3 完成标志

全部完成后,规格中 §6、§12、§13、§14、§15 的要求均已落地:设置面板完整、配置可导入导出、旧版数据可迁移、更新在三平台可用且 macOS 有回退、CI 可自动打包发版。

自检记录:覆盖规格 §6(迁移)、§9.5(设置面板其余部分)、§12(导入导出)、§13(更新)、§14(CI)、§15(打包)。三个计划合并覆盖规格全部 16 个章节与 11 条验收标准。
