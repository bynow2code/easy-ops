import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button, Dropdown, Segmented, Space, Typography } from 'antd'
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
import { TabCloseGuard } from './components/TabCloseGuard'
import { Splitter } from './components/Splitter'
import { TerminalDock } from './components/TerminalDock'
import { useAppStore } from './store/useAppStore'
import { useUpdateDot } from './hooks/useUpdateDot'
import { useTabStripScroll } from './hooks/useTabStripScroll'

function TopBar({
  onOpenSettings,
  hasUpdate
}: {
  onOpenSettings: () => void
  hasUpdate: boolean
}): JSX.Element {
  const { mode, setMode } = useTheme()
  const [version, setVersion] = useState('')

  useEffect(() => {
    // 失败只有控制台留痕:版本徽标拿不到就隐藏,不阻塞界面
    window.api.app
      .info()
      .then((info) => setVersion(info.version))
      .catch((err) => console.error('[App] 应用信息读取失败:', err))
  }, [])

  // 方案 B:macOS 的 titleBarStyle: 'hidden' 会自动叠系统红绿灯在左上角,
  // 自绘红绿灯只在 Windows/Linux 出现;macOS 顶栏给系统灯让出空间。
  // 用 navigator.platform 同步判定,避免异步 info 造成首帧布局跳动
  const isMac = /Mac/i.test(navigator.platform)

  // 双击顶栏最大化:Windows 由原生 drag 区处理,macOS 走系统行为,Linux WM 多数不响应需自己补
  const handleTopbarDoubleClick = (): void => {
    if (navigator.platform.startsWith('Linux')) void window.api.win.toggleMaximize()
  }

  return (
    <div
      className="app-topbar"
      onDoubleClick={handleTopbarDoubleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '0 14px',
        paddingLeft: isMac ? 76 : 14,
        height: 46,
        flex: '0 0 auto'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {!isMac ? (
          <div className="app-traffic">
            <span
              className="t-close"
              role="button"
              aria-label="关闭窗口"
              tabIndex={0}
              onClick={() => void window.api.win.close()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void window.api.win.close()
                }
              }}
            >
              <i>✕</i>
            </span>
            <span
              className="t-min"
              role="button"
              aria-label="最小化窗口"
              tabIndex={0}
              onClick={() => void window.api.win.minimize()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void window.api.win.minimize()
                }
              }}
            >
              <i>−</i>
            </span>
            <span
              className="t-max"
              role="button"
              aria-label="最大化窗口"
              tabIndex={0}
              onClick={() => void window.api.win.toggleMaximize()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void window.api.win.toggleMaximize()
                }
              }}
            >
              <i>⤢</i>
            </span>
          </div>
        ) : null}
        <Space size={8} align="center">
          <Typography.Text style={{ fontSize: 13, fontWeight: 500, color: 'var(--app-topbar-text)', letterSpacing: 0.2 }}>
            EasyOps
          </Typography.Text>
          {version ? (
            <span
              style={{
                fontSize: 11,
                lineHeight: '16px',
                padding: '1px 8px',
                borderRadius: 999,
                color: 'var(--app-topbar-muted)',
                border: '1px solid var(--app-topbar-control-border)'
              }}
            >
              v{version}
            </span>
          ) : null}
        </Space>
      </div>

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
        {/* 有待知晓的更新时在按钮右上角点亮小圆点;颜色取主题强调色(--app-primary),
            深浅主题自动适配。wrapper 撑起定位锚点,圆点 pointer-events 关掉避免挡点击 */}
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <Button
            size="small"
            className="app-topbar-btn"
            icon={<SettingOutlined />}
            onClick={onOpenSettings}
          >
            设置
          </Button>
          {hasUpdate ? (
            <span
              role="img"
              aria-label="有可用更新"
              title="有可用更新"
              style={{
                position: 'absolute',
                top: -3,
                right: -3,
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--app-primary)',
                boxShadow: '0 0 0 2px var(--app-topbar-bg)',
                pointerEvents: 'none'
              }}
            />
          ) : null}
        </span>
      </Space>
    </div>
  )
}

export function ScriptDetail(): JSX.Element {
  const selectedScriptId = useAppStore((s) => s.selectedScriptId)
  const scripts = useAppStore((s) => s.scripts)
  const openTabs = useAppStore((s) => s.openTabs)
  const contentDrafts = useAppStore((s) => s.contentDrafts)
  const selectScript = useAppStore((s) => s.selectScript)
  // 页签关闭统一走 requestTabClose:干净页签直接关,带未保存草稿的由 TabCloseGuard 弹确认
  const requestTabClose = useAppStore((s) => s.requestTabClose)

  const selected = scripts.find((s) => s.id === selectedScriptId) ?? null
  // 页签按打开顺序展示;脚本可能刚被删,reload 会收掉对应页签,这里再兜一层底
  const tabScripts = openTabs
    .map((id) => scripts.find((s) => s.id === id))
    .filter((s): s is Script => Boolean(s))

  // 页签条滚动态:滚轮横滚接管 + 两端渐隐的显隐(依赖页签数量变化校正)
  const { stripRef, canScrollLeft, canScrollRight } = useTabStripScroll(tabScripts.length)

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* 页签条:打开过的脚本排成一排,当前选中的是灰胶囊(参考 API 工具的编辑区页签)。
          外层 wrap 提供渐隐定位锚点;条本身横向可滚(滚轮接管),滚动条隐藏,
          两端渐隐提示对应方向还有页签 */}
      <div style={{ position: 'relative', flex: '0 0 auto', minWidth: 0 }}>
        <div
          ref={stripRef}
          className="app-tabstrip"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            // 页签可压缩(flex-shrink,下限 min(146px, max-content) 见 .app-tab,文字区保底约 8 个中文字,
            // 且短页签不被下限撑宽);压到下限仍放不下时才真正溢出 —— 滚轮横滚,滚动条隐藏
            overflowX: 'auto',
            minHeight: 0
          }}
        >
        {tabScripts.map((tab) => {
          const active = tab.id === selectedScriptId
          // 未保存判定与 UnsavedDraftGuard 同口径:草稿存在且不等于已存内容
          // (改了又改回原样的不算未保存,不亮点)
          const draft = contentDrafts[tab.id]
          const isDirty = draft !== undefined && draft !== tab.content
          // 右键菜单的置灰条件:该侧已经没有页签(用 openTabs 取位,页签数与它一致)
          const tabIndex = openTabs.indexOf(tab.id)
          return (
            <Dropdown
              key={tab.id}
              trigger={['contextMenu']}
              menu={{
                items: [
                  {
                    key: 'close-all',
                    label: '关闭全部',
                    onClick: () => requestTabClose([...openTabs])
                  },
                  {
                    key: 'close-left',
                    label: '关闭左边',
                    disabled: tabIndex === 0,
                    onClick: () => requestTabClose(openTabs.slice(0, tabIndex))
                  },
                  {
                    key: 'close-right',
                    label: '关闭右边',
                    disabled: tabIndex === openTabs.length - 1,
                    onClick: () => requestTabClose(openTabs.slice(tabIndex + 1))
                  }
                ]
              }}
            >
              <div
                className={active ? 'app-tab app-tab-active' : 'app-tab'}
                onClick={() => selectScript(tab.id)}
                // 键盘可达:纯 onClick 的 div 键盘用户无法切换页签
                role="tab"
                aria-selected={active}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    selectScript(tab.id)
                  }
                }}
                title={tab.name}
              >
              <Typography.Text
                ellipsis
                style={{
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  // minWidth 0 让文字区可随页签压缩(否则 flex 项最小宽度取内容宽),
                  // maxWidth 170 仍限制页签少时的单签宽度
                  minWidth: 0,
                  maxWidth: 170
                }}
              >
                {tab.name}
              </Typography.Text>
              {/* 右侧槽位 16×16:未保存点与关闭符叠放同一位置 —— 平时有未保存改动显示橙点,
                  悬停/键盘聚焦时点让位给关闭符(与 API 工具页签同款交互,tab 宽度不跳动) */}
              <span className="app-tab-slot">
                {isDirty ? (
                  <span className="app-tab-dirty" role="img" aria-label={`未保存 ${tab.name}`} />
                ) : null}
                <span
                  className="app-tab-close"
                  role="button"
                  tabIndex={0}
                  aria-label={`关闭页签 ${tab.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    requestTabClose([tab.id])
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      e.preventDefault()
                      requestTabClose([tab.id])
                    }
                  }}
                >
                  <CloseOutlined />
                </span>
              </span>
              </div>
            </Dropdown>
          )
        })}
        </div>
        {/* 两端渐隐:对应方向还有页签时显示,滚到头自动消失(纯提示,不挡点击) */}
        {canScrollLeft ? <div className="app-tabstrip-fade app-tabstrip-fade-left" /> : null}
        {canScrollRight ? <div className="app-tabstrip-fade app-tabstrip-fade-right" /> : null}
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
  // 已落盘的基线快照「main|detail」:与 Sidebar 折叠态的 lastWrittenRef 同款守卫,
  // 避免 loaded 翻 true 触发 effect 时把从未被用户动过的比例幂等回写一次盘
  const lastWrittenRef = useRef<string | null>(null)

  useEffect(() => {
    // 读失败按默认布局处理,不阻塞工作区渲染(与 Sidebar 折叠态读失败的降级策略一致)
    window.api.settings
      .get()
      .then((s) => {
        setMainRatio(s.mainSplitRatio)
        setDetailRatio(s.detailSplitRatio)
        lastWrittenRef.current = `${s.mainSplitRatio}|${s.detailSplitRatio}`
        setLoaded(true)
      })
      .catch((err) => {
        console.error('[App] 设置读取失败,使用默认布局:', err)
        lastWrittenRef.current = `${DEFAULT_MAIN_SPLIT_RATIO}|${DEFAULT_DETAIL_SPLIT_RATIO}`
        setLoaded(true)
      })
  }, [])

  // 比例落盘防抖 300ms:拖动过程中不必每帧写一次设置,
  // 松手(或键盘微调暂停)后自然会写一次。加载完成前不回写,免得把默认值盖上去。
  // 写失败静默降级:布局留在内存,下次拖动或重启自然重试(与折叠态写回同一策略,仅 console 留痕)
  useEffect(() => {
    if (!loaded) return
    const snapshot = `${mainRatio}|${detailRatio}`
    if (snapshot === lastWrittenRef.current) return
    const timer = setTimeout(() => {
      window.api.settings
        .update({ mainSplitRatio: mainRatio, detailSplitRatio: detailRatio })
        .then(() => {
          lastWrittenRef.current = snapshot
        })
        .catch((err) => {
          console.error('[App] 布局比例写盘失败:', err)
        })
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
          {/* 顶部 padding 与下方 gap 对齐(8/8):页签条上下留白对称,编辑器更早露出 */}
          <div
            className="app-panel"
            style={{ flex: 1, padding: '8px 14px 14px', overflow: 'hidden', minHeight: 0 }}
          >
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
  // 设置按钮小圆点:有 available/downloaded 更新事件时点亮
  const [hasUpdate, dismissUpdateDot] = useUpdateDot()

  useEffect(() => {
    // 失败只有控制台留痕:主题回落默认的 system
    window.api.settings
      .get()
      .then((s) => setMode(s.theme))
      .catch((err) => console.error('[App] 主题设置读取失败:', err))
  }, [])

  const handleModeChange = (next: ThemeMode): void => {
    setMode(next)
    void window.api.settings.update({ theme: next })
  }

  // 打开设置即视为「已知晓更新」:更新面板就在设置里,圆点的提醒使命完成
  const handleOpenSettings = (): void => {
    setSettingsOpen(true)
    dismissUpdateDot()
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
        <TopBar onOpenSettings={handleOpenSettings} hasUpdate={hasUpdate} />
        <Workspace />
      </div>
      <GroupFormModal />
      <ScriptFormModal />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <UnsavedDraftGuard />
      {/* 页签关闭确认:有未保存草稿的页签关闭时弹 VS Code 风格确认框 */}
      <TabCloseGuard />
    </ThemeProvider>
  )
}
