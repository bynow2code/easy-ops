import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button, Segmented, Space, Typography } from 'antd'
import { CloseOutlined, FileTextOutlined, SettingOutlined } from '@ant-design/icons'
import {
  DEFAULT_DETAIL_SPLIT_RATIO,
  DEFAULT_MAIN_SPLIT_RATIO,
  clampSplitRatio,
  type ThemeMode
} from '../../shared/types'
import type { Script } from '../../shared/types'
import { ThemeProvider, useTheme } from './theme/provider'
import { Sidebar } from './components/Sidebar'
import { ScriptFormModal } from './components/ScriptFormModal'
import { GroupFormModal } from './components/GroupFormModal'
import { SettingsModal } from './components/SettingsModal'
import { ContentPanel } from './components/ContentPanel'
import { UnsavedDraftGuard } from './components/UnsavedDraftGuard'
import { Splitter } from './components/Splitter'
import { TerminalDock } from './components/TerminalDock'
import { useAppStore } from './store/useAppStore'

/** 牌子标记,与 build/icon.png 同源:青色提示符 + 白色光标块 */
function BrandMark(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M5 6.5 L11.5 12 L5 17.5"
        stroke="#4FD1E0"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="13.6" y="13.4" width="6.2" height="4" rx="1.3" fill="#FFFFFF" fillOpacity="0.92" />
    </svg>
  )
}

function TopBar({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const { mode, setMode } = useTheme()
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.app.info().then((info) => setVersion(info.version))
  }, [])

  return (
    <div
      className="app-topbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '0 14px',
        height: 46,
        flex: '0 0 auto'
      }}
    >
      <Space size={8} align="center">
        <BrandMark />
        <Typography.Text style={{ fontSize: 13, fontWeight: 500, color: 'var(--app-topbar-text)', letterSpacing: 0.2 }}>
          EasyOps
        </Typography.Text>
        {version ? (
          <span
            style={{
              fontSize: 11,
              lineHeight: '16px',
              padding: '1px 6px',
              borderRadius: 6,
              color: 'var(--app-topbar-muted)',
              border: '1px solid var(--app-topbar-control-border)'
            }}
          >
            v{version}
          </span>
        ) : null}
      </Space>

      <Space size={8}>
        <Segmented
          size="small"
          className="app-topbar-segmented"
          value={mode}
          onChange={(value) => setMode(value as ThemeMode)}
          options={[
            { label: '浅色', value: 'light' },
            { label: '深色', value: 'dark' },
            { label: '跟随系统', value: 'system' }
          ]}
        />
        <Button
          size="small"
          className="app-topbar-btn"
          icon={<SettingOutlined />}
          onClick={onOpenSettings}
        >
          设置
        </Button>
      </Space>
    </div>
  )
}

function ScriptDetail(): JSX.Element {
  const selectedScriptId = useAppStore((s) => s.selectedScriptId)
  const scripts = useAppStore((s) => s.scripts)
  const openTabs = useAppStore((s) => s.openTabs)
  const selectScript = useAppStore((s) => s.selectScript)
  const closeTab = useAppStore((s) => s.closeTab)

  const selected = scripts.find((s) => s.id === selectedScriptId) ?? null
  // 页签按打开顺序展示;脚本可能刚被删,reload 会收掉对应页签,这里再兜一层底
  const tabScripts = openTabs
    .map((id) => scripts.find((s) => s.id === id))
    .filter((s): s is Script => Boolean(s))

  if (tabScripts.length === 0 || !selected) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10
        }}
      >
        <FileTextOutlined style={{ fontSize: 26, opacity: 0.35 }} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          选择脚本后,在这里直接编辑它的内容
        </Typography.Text>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 6 }}>
      {/* 页签条:打开过的脚本排成一排,当前选中的是灰胶囊(参考 API 工具的编辑区页签) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          overflowX: 'auto',
          flex: '0 0 auto',
          minHeight: 0
        }}
      >
        {tabScripts.map((tab) => {
          const active = tab.id === selectedScriptId
          return (
            <div
              key={tab.id}
              className={active ? 'app-tab app-tab-active' : 'app-tab'}
              onClick={() => selectScript(tab.id)}
              title={tab.name}
            >
              <Typography.Text
                ellipsis
                style={{
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  maxWidth: 170
                }}
              >
                {tab.name}
              </Typography.Text>
              <span
                className="app-tab-close"
                role="button"
                tabIndex={0}
                aria-label={`关闭页签 ${tab.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    e.preventDefault()
                    closeTab(tab.id)
                  }
                }}
              >
                <CloseOutlined />
              </span>
            </div>
          )
        })}
      </div>
      {/* key 用脚本 id:切换脚本时重挂面板,CodeMirror 的 undo 历史等内部状态不跨脚本串 */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ContentPanel key={selected.id} script={selected} />
      </div>
    </div>
  )
}

function Workspace(): JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const [mainRatio, setMainRatio] = useState(DEFAULT_MAIN_SPLIT_RATIO)
  const [detailRatio, setDetailRatio] = useState(DEFAULT_DETAIL_SPLIT_RATIO)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void window.api.settings.get().then((s) => {
      setMainRatio(s.mainSplitRatio)
      setDetailRatio(s.detailSplitRatio)
      setLoaded(true)
    })
  }, [])

  // 比例落盘防抖 300ms:拖动过程中不必每帧写一次设置,
  // 松手(或键盘微调暂停)后自然会写一次。加载完成前不回写,免得把默认值盖上去。
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      void window.api.settings.update({ mainSplitRatio: mainRatio, detailSplitRatio: detailRatio })
    }, 300)
    return () => clearTimeout(timer)
  }, [loaded, mainRatio, detailRatio])

  /** 指针位置 → 百分比(相对容器的内容盒) */
  const ratioFrom = (ref: RefObject<HTMLElement>, clientPos: number, horizontal: boolean): number => {
    const el = ref.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const size = horizontal ? rect.height : rect.width
    const offset = horizontal ? clientPos - rect.top : clientPos - rect.left
    if (size <= 0) return 0
    return clampSplitRatio((offset / size) * 100, 50)
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, padding: 8 }}>
      {/* 内层 flex 行:ref 挂在这里,换算比例时拿到的正是内容区(不含外层 padding) */}
      <div ref={rowRef} style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }}>
        {/* 左半:上脚本列表 / 下脚本详情 */}
        <div
          ref={leftRef}
          style={{
            flex: `0 0 ${mainRatio}%`,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0
          }}
        >
          <div
            className="app-panel"
            style={{ flex: `0 0 ${detailRatio}%`, minHeight: 0, padding: 12, overflow: 'hidden' }}
          >
            <Sidebar />
          </div>
          <Splitter
            orientation="horizontal"
            label="调整脚本列表与详情的高度"
            onDrag={(clientY) => setDetailRatio(ratioFrom(leftRef, clientY, true))}
            onNudge={(delta) => setDetailRatio((r) => clampSplitRatio(r + delta, DEFAULT_DETAIL_SPLIT_RATIO))}
            onReset={() => setDetailRatio(DEFAULT_DETAIL_SPLIT_RATIO)}
          />
          <div className="app-panel" style={{ flex: 1, padding: 14, overflow: 'hidden', minHeight: 0 }}>
            <ScriptDetail />
          </div>
        </div>

        <Splitter
          orientation="vertical"
          label="调整脚本区与终端区的宽度"
          onDrag={(clientX) => setMainRatio(ratioFrom(rowRef, clientX, false))}
          onNudge={(delta) => setMainRatio((r) => clampSplitRatio(r + delta, DEFAULT_MAIN_SPLIT_RATIO))}
          onReset={() => setMainRatio(DEFAULT_MAIN_SPLIT_RATIO)}
        />

        {/* 右半:终端列表 */}
        <div
          className="app-panel"
          style={{ flex: 1, minWidth: 0, minHeight: 0, padding: 10, overflow: 'hidden' }}
        >
          <TerminalDock />
        </div>
      </div>
    </div>
  )
}

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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          width: '100%',
          background: 'var(--app-layout-bg)'
        }}
      >
        <TopBar onOpenSettings={() => setSettingsOpen(true)} />
        <Workspace />
      </div>
      <GroupFormModal />
      <ScriptFormModal />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <UnsavedDraftGuard />
    </ThemeProvider>
  )
}
