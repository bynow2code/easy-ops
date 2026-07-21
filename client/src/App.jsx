import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import ShellEditor from './components/ShellEditor'
import Markdown from './components/Markdown'
import './App.css'

// 把 release notes 多种输入格式（字符串 / 数组 / 对象）归一化成一段纯 markdown 文本。
// （electron-updater / GitHub API 的 releaseNotes 形态不固定，这里只做数据准备，
//  真正的 markdown 渲染交给 <Markdown> 组件。）
const normalizeReleaseNotes = (notes) => {
  if (!notes) return '';
  // 数组：多版本累计，逐项提取 notes 文本并拼接
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === 'string' ? n : (n && (n.notes || n.note || n.body)) || ''))
      .filter(Boolean)
      .join('\n\n');
  }
  // 对象：取 notes 字段
  if (typeof notes === 'object') {
    return notes.notes || notes.note || notes.body || '';
  }
  // 字符串：原样返回
  return String(notes);
};

// 路径用于界面展示时转义空格（如 ~/Library/Application\ Support/...），
// 与终端书写一致，避免长路径在含空格处被换行割裂，也方便直接复制到 shell 使用。
const escapePathForShell = (p) => (p || '').replace(/ /g, '\\ ');

// 运行中：旋转的绿色图标（替代原本的 "Running..." 文字），0.9s 匀速旋转
const RunningSpinner = () => (
  <svg className="running-spinner-icon" viewBox="0 0 24 24" width="14" height="14" aria-label="Running" role="img">
    <circle cx="12" cy="12" r="9" fill="none" stroke="#52c41a" strokeWidth="3"
      strokeLinecap="round" strokeDasharray="42 14" />
  </svg>
);

// 自动贴底开关图标：向下箭头指向底部；开启时蓝色高亮，关闭时灰色
const AutoFollowIcon = ({ on }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
    <path d="M12 4 V18 M6 12 L12 18 L18 12"
      fill="none"
      stroke={on ? '#1890ff' : '#bbb'}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function App() {
  const [scripts, setScripts] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newScript, setNewScript] = useState({ name: '', content: '', group: 'backend' })
  const [editingScript, setEditingScript] = useState(null)
  const [formErrors, setFormErrors] = useState({})
  const [editErrors, setEditErrors] = useState({})
  const [executingIds, setExecutingIds] = useState({})
  const [executingBatch, setExecutingBatch] = useState(false)
  const [batchRunningIds, setBatchRunningIds] = useState({})  // 批量执行中尚未结束的脚本 id -> true
  const [outputs, setOutputs] = useState({})
  const [runIds, setRunIds] = useState({})  // scriptId -> 执行 runId，用于「强制中断」
  const [systemInfo, setSystemInfo] = useState(null)
  // App Info 弹窗内「可切换 Shell 列表」状态：全部已探测 Shell / 当前生效 Shell 的 id / 正在切换的 id
  const [shellList, setShellList] = useState([])
  const [currentShellId, setCurrentShellId] = useState(null)
  const [switchingShellId, setSwitchingShellId] = useState(null)
  const [newShellPath, setNewShellPath] = useState('')   // 用户手填的自定义 bash 路径
  const [addingShell, setAddingShell] = useState(false)  // 添加中（禁用按钮）
  const [addShellError, setAddShellError] = useState('') // 添加失败提示（如「不是 bash，不能添加」）
  const [removingShellId, setRemovingShellId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [activeDropGroup, setActiveDropGroup] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [maximizedScriptId, setMaximizedScriptId] = useState(null)
  const eventSourceRefs = useRef({})
  const outputRefs = useRef({})
  const outputPanelRefs = useRef({})
  const maximizedOutputRef = useRef(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const outputsScrollRef = useRef(null)
  // 记录批量执行中已被用户关闭的脚本 id：对应后端事件将被忽略，避免「关闭后又重新出现」
  const closedBatchIds = useRef(new Set())
  // 用于在执行时触发外层容器滚动到顶部（通过 useLayoutEffect 确保 DOM 提交后再滚动）
  const [scrollToTopKey, setScrollToTopKey] = useState(0)
  // 当前被「定位」的脚本 id：点击 Locate 时让对应输出面板的 BE/FE 徽标绿色闪烁，作为显眼提示
  const [locatingId, setLocatingId] = useState(null)
  // 每秒更新，用于刷新「多久前」显示
  const [now, setNow] = useState(Date.now())
  // 每个输出面板「自动贴底」开关状态：{ [scriptId]: boolean }，缺省（undefined）视为 true（默认自动贴底）
  const [autoFollowMap, setAutoFollowMap] = useState({})
  const autoFollowRef = useRef(autoFollowMap)
  autoFollowRef.current = autoFollowMap
  // 缺省（未设置）视为开启自动贴底
  const isAutoFollow = (id) => autoFollowRef.current[id] !== false

  // ==================== 自动跟随：ResizeObserver ====================
  // 规则：正在运行（live）的脚本始终贴底；其它状态（已完成等）在重排/重渲染时
  // 还原之前的滚动位置（由 handleOutputScroll 记录到 scrollPositions）。
  // 小窗（output-content-wrapper）与放大窗（maximized-output-wrapper）统一适用。
  // 用单个 ResizeObserver 观察各输出内容元素，内容变高时贴底，相比「layout 阶段设置 + rAF 补一次」
  // 只在内容真正变高时触发、且无时序竞争，更可靠。
  // 将滚动容器贴底：同步设置一次，再用两帧补丁兜底。
  // 原因：内容增长时，滚动条可能在本帧「刚出现」，导致内容被重新折行、scrollHeight 再变大，
  // 此时单次 scrollTop = scrollHeight 会被浏览器钳制到旧最大值，从而「差一点点没贴底」。
  // 运行中的面板：通过 autoFollowMap（每个输出面板一个小开关）控制是否自动贴底；
  // 缺省（未设置）视为开启——即输出窗口默认自动贴底。用户手动上滑时关闭，
  // 回到底部或点击开关再开启；脚本重新执行时重置为开启（关闭后重新打开仍默认贴底）。
  // 判定「用户上滑」不靠标记程序滚动（易与频繁自动贴底相互干扰），而靠滚动方向：
  // 程序贴底只会让 scrollTop 变大（向下），用户上滑会让 scrollTop 变小（向上），据此精确区分。
  // 记录每个容器上一次的 scrollTop，用于判断滚动方向
  const lastScrollTop = useRef(new WeakMap())
  // 贴底：同步一次 + 两帧补丁兜底；若该面板已关闭自动贴底（id 提供时），则跳过。
  const pinToBottom = useCallback((el, id) => {
    if (!el || !el.isConnected) return
    const doPin = () => {
      if (id != null && autoFollowRef.current[id] === false) return
      if (el.isConnected) {
        el.scrollTop = el.scrollHeight
        lastScrollTop.current.set(el, el.scrollTop)
      }
    }
    doPin()
    requestAnimationFrame(() => {
      doPin()
      requestAnimationFrame(doPin)
    })
  }, [])
  const outputsRef = useRef(outputs)
  outputsRef.current = outputs
  const maximizedScriptIdRef = useRef(maximizedScriptId)
  maximizedScriptIdRef.current = maximizedScriptId
  const contentEls = useRef(new Map())        // scriptId -> 被观察的内容元素（小面板）
  const contentToId = useRef(new WeakMap())    // 内容元素 -> scriptId
  const followObserver = useRef(null)
  const maximizedContentRef = useRef(null)     // 放大窗当前内容元素
  const prevMaximizedContentRef = useRef(null)

  const ensureObserver = useCallback(() => {
    if (!followObserver.current) {
      followObserver.current = new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          const id = contentToId.current.get(entry.target)
          if (id == null) return
          const out = outputsRef.current[id]
          // 该脚本同时可能存在于「小面板」与「放大窗」两个滚动容器，
          // 需贴底的是当前可见的那个（放大窗打开时优先放大窗）。
          const isMax = maximizedScriptIdRef.current === id
          const el = (isMax && maximizedOutputRef.current) ? maximizedOutputRef.current : outputRefs.current[id]
          // 正在运行且自动贴底开启：始终贴底（小窗/放大窗统一）
          if (out && out.live && autoFollowRef.current[id] !== false && el && el.isConnected) {
            pinToBottom(el, id)
          }
        })
      })
    }
    return followObserver.current
  }, [pinToBottom])

  const observeContent = useCallback((id, el) => {
    if (!id || !el) return
    contentEls.current.set(id, el)
    contentToId.current.set(el, id)
    ensureObserver().observe(el)
  }, [ensureObserver])

  const unobserveContent = useCallback((id) => {
    const el = contentEls.current.get(id)
    if (el) followObserver.current?.unobserve(el)
    contentEls.current.delete(id)
  }, [])

  // 每个输出面板的内容 <pre> 用「稳定」ref 回调注册/注销观察，避免每次渲染重复 observe
  const contentRefCallbacks = useRef(new Map())
  const getContentRef = useCallback((id) => {
    if (!contentRefCallbacks.current.has(id)) {
      contentRefCallbacks.current.set(id, (el) => {
        if (el) observeContent(id, el)
        else unobserveContent(id)
      })
    }
    return contentRefCallbacks.current.get(id)
  }, [observeContent, unobserveContent])

  // 组件卸载时断开 observer
  useEffect(() => () => followObserver.current?.disconnect(), [])

  // ==================== 自动更新相关状态 ====================
  const [appVersion, setAppVersion] = useState('')
  const [appInfo, setAppInfo] = useState(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [showInfoModal, setShowInfoModal] = useState(false)
  // idle | checking | available | not-available | downloading | downloaded | error
  const [updateState, setUpdateState] = useState('idle')
  const [updateInfo, setUpdateInfo] = useState({ version: '', releaseNotes: '' })
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateError, setUpdateError] = useState('')

  // 使用 callback ref 绑定滚动监听，确保 DOM 挂载时 100% 就绪
  const setOutputsScrollRef = useCallback((el) => {
    // 清理旧元素上的监听器
    if (outputsScrollRef.current) {
      outputsScrollRef.current.removeEventListener('scroll', outputsScrollRef._handler)
    }
    outputsScrollRef.current = el
    if (!el) return
    const handleScroll = () => {
      setShowScrollTop(el.scrollTop > 80)
    }
    outputsScrollRef._handler = handleScroll
    el.addEventListener('scroll', handleScroll, { passive: true })
    // 初始检查一次
    handleScroll()
  }, [])

  // ==================== 系统通知 ====================

  // 请求通知权限（Electron 内 Web Notification API 对应系统原生通知）
  // 发送脚本执行完成的系统通知
  // Electron 环境走原生 Notification API（preload 注入），浏览器环境降级为 Web Notification
  const sendCompletionNotification = (scriptName, exitCode, durationMs, remaining) => {
    let durStr = ''
    if (durationMs != null) {
      const ms = Math.max(0, durationMs)
      if (ms < 1000) durStr = ` (${ms}ms)`
      else if (ms < 60000) durStr = ` (${(ms / 1000).toFixed(1)}s)`
      else {
        const s = Math.floor(ms / 1000)
        const m = Math.floor(s / 60)
        durStr = s % 60 > 0 ? ` (${m}m ${s % 60}s)` : ` (${m}m)`
      }
    }
    const emoji = exitCode === 0 ? '✅' : '❌'
    const status = exitCode === 0 ? 'Completed successfully' : `Failed (exit code: ${exitCode})`
    const remainStr = remaining != null ? ` — ${remaining} remaining` : ''
    const title = `${emoji} ${scriptName}`
    const body = `${status}${durStr}${remainStr}`

    if (window.electronAPI?.showNotification) {
      window.electronAPI.showNotification(title, body, remaining == null)
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/logo.png' })
    }
  }

  useEffect(() => {
    fetchScripts()
    fetchSystemInfo()
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(timer)
      Object.values(eventSourceRefs.current).forEach(es => es.close())
    }
  }, [])

  // ==================== 自动更新：获取版本号 + 订阅主进程事件 ====================
  useEffect(() => {
    if (window.electronAPI?.getAppInfo) {
      window.electronAPI.getAppInfo()
        .then(info => {
          setAppVersion(info.version)
          setAppInfo(info)
        })
        .catch(() => {})
    }
    if (!window.electronAPI?.onUpdateEvent) return
    const unsub = window.electronAPI.onUpdateEvent((data) => {
      switch (data.type) {
        case 'checking':
          setUpdateState('checking')
          setUpdateError('')
          break
        case 'available':
          setUpdateState('available')
          setUpdateInfo({ version: data.version, releaseNotes: data.releaseNotes || '' })
          break
        case 'not-available':
          setUpdateState('not-available')
          break
        case 'downloading': {
          const pct = data.percent || 0
          // 下载中：进度封顶 99%，等 update-downloaded 事件确认完成后再显示 100%，
          // 避免 GitHub→S3 重定向导致 total 变化，进度从 100% "倒退" 产生"下载了两次"的错觉
          setUpdateState('downloading')
          setUpdateProgress(Math.min(pct, 99))
          break
        }
        case 'downloaded':
          setUpdateState('downloaded')
          setUpdateProgress(100)
          setUpdateInfo(prev => ({ ...prev, version: data.version || prev.version }))
          break
        case 'error':
          setUpdateState('error')
          setUpdateError(data.message || '未知错误')
          break
        default:
          break
      }
    })
    return unsub
  }, [])

  // 记录每个输出容器当前的滚动位置，重排/重渲染后用于还原（仅对「非运行」状态有意义），
  // 避免滚动条被重置到起始位置。运行中的面板由 pinToBottom 始终贴底，无需记录。
  const scrollPositions = useRef({})

  // 监听用户滚动事件（依据滚动方向精确区分「用户上滑」与「程序自动贴底」）：
  //  - 记录当前滚动位置，供重排/重渲染后还原；
  //  - 回到底部：恢复自动贴底（开启该面板开关）；
  //  - 相对上次明显向上滑动（scrollTop 变小）：关闭自动贴底（用户想查看历史输出）。
  // 程序自动贴底只会使 scrollTop 变大（向下），不会触发「上滑」判定，故无需额外标记。
  const handleOutputScroll = useCallback((id, e) => {
    const el = e.target
    const curr = el.scrollTop
    const prev = lastScrollTop.current.has(el) ? lastScrollTop.current.get(el) : curr
    lastScrollTop.current.set(el, curr)
    scrollPositions.current[id] = curr
    const isAtBottom = el.scrollHeight - curr - el.clientHeight < 20
    if (isAtBottom) {
      // 回到底部：恢复自动贴底
      if (autoFollowRef.current[id] === false) setAutoFollowMap(prev => ({ ...prev, [id]: true }))
    } else if (curr < prev - 2) {
      // 明显向上滑动（留 2px 容差抵消抖动）→ 用户想查看历史输出，关闭自动贴底
      if (autoFollowRef.current[id] !== false) setAutoFollowMap(prev => ({ ...prev, [id]: false }))
    }
  }, [])

  // 每当 outputs 变化后：
  //  - 正在运行的面板：始终 pinToBottom 贴底（含两帧补丁兜底）；
  //  - 其它面板（已完成等）：还原重排前记录的滚动位置，避免滚动条归零。
  // 持续的内容增长由 ResizeObserver 负责贴底。
  useLayoutEffect(() => {
    const restore = (id, el) => {
      const out = outputs[id]
      if (out && out.live && autoFollowRef.current[id] !== false) {
        pinToBottom(el, id)
      } else {
        // 非运行中，或运行中但已关闭自动贴底：还原之前位置
        const saved = scrollPositions.current[id]
        if (typeof saved === 'number') el.scrollTop = saved
      }
    }
    Object.keys(outputs).forEach(id => {
      const el = outputRefs.current[id]
      if (el) restore(id, el)
    })
    // 放大窗：立即贴底，并让 ResizeObserver 跟踪正确的内容元素
    if (maximizedScriptId && maximizedOutputRef.current && maximizedContentRef.current) {
      restore(maximizedScriptId, maximizedOutputRef.current)
      contentToId.current.set(maximizedContentRef.current, maximizedScriptId)
      ensureObserver().observe(maximizedContentRef.current)
    }
    // 放大窗关闭 / 切换时，取消对旧内容元素的观察，避免泄漏与误触发
    if (prevMaximizedContentRef.current && prevMaximizedContentRef.current !== maximizedContentRef.current) {
      followObserver.current?.unobserve(prevMaximizedContentRef.current)
    }
    prevMaximizedContentRef.current = maximizedContentRef.current
  }, [outputs, maximizedScriptId, ensureObserver])

  // 监听 ESC 键关闭最大化窗口
  useEffect(() => {
    if (!maximizedScriptId) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMaximizedScriptId(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [maximizedScriptId])

  // 监听 ESC 键关闭 Add / Edit Script 弹窗
  useEffect(() => {
    if (!showAddForm && !editingScript) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showAddForm) {
          setShowAddForm(false)
          setFormErrors({})
        }
        if (editingScript) {
          setEditingScript(null)
          setEditErrors({})
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showAddForm, editingScript])

  // 监听 ESC 键关闭 App Info 弹窗
  useEffect(() => {
    if (!showInfoModal) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowInfoModal(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showInfoModal])

  // 当执行触发时，将外层 Execution Outputs 容器滚动到顶部
  // useLayoutEffect 在 DOM 提交后、浏览器绘制前执行，避免竞态条件
  useLayoutEffect(() => {
    if (scrollToTopKey > 0 && outputsScrollRef.current) {
      outputsScrollRef.current.scrollTop = 0
    }
  }, [scrollToTopKey])

  const fetchScripts = async () => {
    try {
      const response = await axios.get('/api/scripts')
      setScripts(response.data)
    } catch (error) {
      console.error('Error fetching scripts:', error)
    }
  }

  const fetchSystemInfo = async () => {
    try {
      const response = await axios.get('/api/system-info')
      setSystemInfo(response.data)
    } catch (error) {
      console.error('Error fetching system info:', error)
    }
  }

  // 拉取本机所有受支持 Shell 及当前生效项，供 App Info 弹窗展示与一键切换
  const fetchShells = async () => {
    try {
      const response = await axios.get('/api/shells')
      setShellList(response.data.shells || [])
      setCurrentShellId(response.data.selectedId || (response.data.current && response.data.current.id) || null)
    } catch (error) {
      console.error('Error fetching shells:', error)
    }
  }

  // 一键切换生效 Shell：POST 持久化，成功后刷新列表与 systemInfo（使「Shell」行同步）
  const handleSwitchShell = async (id) => {
    if (id === currentShellId) return
    setSwitchingShellId(id)
    try {
      const response = await axios.post('/api/shells/select', { id })
      setShellList(response.data.shells || [])
      setCurrentShellId(response.data.selectedId || id)
      // 同步更新 systemInfo.shell，让弹窗顶部「Shell」行立刻反映新选择
      setSystemInfo(prev => prev ? { ...prev, shell: response.data.current } : prev)
    } catch (error) {
      console.error('Error switching shell:', error)
      // 切换失败：重新拉取，丢弃脏状态
      fetchShells()
    } finally {
      setSwitchingShellId(null)
    }
  }

  // 添加用户自定义 bash 路径：后端校验是否为可用 bash；不是则回显原因（不添加）。
  const handleAddShell = async () => {
    const p = newShellPath.trim()
    if (!p) {
      setAddShellError('Please enter the path to a bash executable')
      return
    }
    setAddingShell(true)
    setAddShellError('')
    try {
      const response = await axios.post('/api/shells/add', { path: p })
      setShellList(response.data.shells || [])
      setCurrentShellId(response.data.selectedId || (response.data.current && response.data.current.id) || null)
      setNewShellPath('') // 成功后清空输入
    } catch (error) {
      // 后端返回的原因（如「该路径不是 bash…」「文件不存在」）
      const msg = (error.response && error.response.data && error.response.data.error) || 'Failed to add. Please check the path.'
      setAddShellError(msg)
    } finally {
      setAddingShell(false)
    }
  }

  // 通过原生文件对话框选择 bash 可执行文件（仅 Electron 环境可用）
  const canBrowseShell = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.openExecutableDialog
  const handleBrowseShell = async () => {
    if (!canBrowseShell) return
    try {
      const res = await window.electronAPI.openExecutableDialog()
      // res: { canceled:true } | { canceled:false, path } | undefined
      if (res && !res.canceled && res.path) {
        setNewShellPath(res.path)
        if (addShellError) setAddShellError('')
      }
    } catch (e) {
      console.error('打开文件选择对话框失败:', e)
    }
  }

  // 移除用户自定义添加的 bash 路径
  const handleRemoveShell = async (id) => {
    setRemovingShellId(id)
    try {
      const response = await axios.post('/api/shells/remove', { id })
      setShellList(response.data.shells || [])
      setCurrentShellId(response.data.selectedId || (response.data.current && response.data.current.id) || null)
      setSystemInfo(prev => prev ? { ...prev, shell: response.data.current } : prev)
    } catch (error) {
      console.error('Error removing shell:', error)
      fetchShells()
    } finally {
      setRemovingShellId(null)
    }
  }

  const handleAddScript = async (e) => {
    e.preventDefault()
    const errors = {}
    if (!newScript.name.trim()) {
      errors.name = 'Please enter a script name'
    }
    if (!newScript.content.trim()) {
      errors.content = 'Please enter script content'
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }
    setFormErrors({})
    try {
      await axios.post('/api/scripts', newScript)
      setNewScript({ name: '', content: '', group: 'backend' })
      setShowAddForm(false)
      fetchScripts()
    } catch (error) {
      console.error('Error adding script:', error)
      setFormErrors({ submit: 'Failed to add script, please try again' })
    }
  }

  const scrollToOutput = (id) => {
    const panel = outputPanelRefs.current[id]
    if (!panel) return

    panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // 定位时让对应输出面板的 BE/FE 徽标绿色闪烁（与运行时一致），约 3s 后自动停止
    setLocatingId(id)
    setTimeout(() => {
      setLocatingId(prev => (prev === id ? null : prev))
    }, 3000)
  }

  const handleDeleteScript = (id) => {
    setDeleteConfirmId(id)
  }

  const confirmDeleteScript = async () => {
    const id = deleteConfirmId
    if (!id) return
    setDeleteConfirmId(null)
    try {
      await axios.delete(`/api/scripts/${id}`)
      setScripts(prev => prev.filter(s => s.id !== id))
      setSelectedIds(prev => prev.filter(sid => sid !== id))
      setOutputs(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch (error) {
      console.error('Error deleting script:', error)
      alert('Failed to delete script')
    }
  }

  const handleEditScript = (script) => {
    setEditingScript({ ...script })
  }

  const handleDragStart = (e, id) => {
    setDraggingId(id)
    const dt = e.nativeEvent.dataTransfer
    dt.effectAllowed = 'move'
    dt.setData('text/plain', id)
  }

  const handleDragOver = (e, id) => {
    e.preventDefault()
    e.nativeEvent.dataTransfer.dropEffect = 'move'
    if (dragOverId !== id) {
      setDragOverId(id)
    }
  }

  const handleDragLeave = () => {}

  const handleDragEnd = () => {
    setDraggingId(null)
    setDragOverId(null)
    setActiveDropGroup(null)
  }

  // 拖入分组空白区域（空分组或表外）
  const handleDragOverGroup = (e, group) => {
    e.preventDefault()
    e.nativeEvent.dataTransfer.dropEffect = 'move'
    setActiveDropGroup(group)
  }

  const handleDropToGroup = async (e, targetGroup) => {
    e.preventDefault()
    const draggedId = draggingId || e.nativeEvent.dataTransfer.getData('text/plain')
    setDraggingId(null)
    setDragOverId(null)
    setActiveDropGroup(null)

    if (!draggedId) return

    const allScripts = [...scripts]
    const fromIndex = allScripts.findIndex(s => s.id === draggedId)
    if (fromIndex === -1) return

    const newOrder = allScripts.map(s => s.id)
    newOrder.splice(fromIndex, 1)

    // 根据鼠标 Y 坐标判断插入到开头还是末尾
    const rect = e.currentTarget.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    if (e.clientY < midY) {
      newOrder.unshift(draggedId) // 插入到开头
    } else {
      newOrder.push(draggedId) // 插入到末尾
    }

    const groups = {}
    const dragged = allScripts[fromIndex]
    if (dragged.group !== targetGroup) {
      groups[draggedId] = targetGroup
    }

    const updated = allScripts.map((s) => {
      if (s.id === draggedId) return { ...s, group: targetGroup }
      return s
    })
    const reordered = newOrder.map((id, idx) => {
      const s = updated.find(s => s.id === id)
      return s ? { ...s, orderNum: idx } : null
    }).filter(Boolean)
    setScripts(reordered)

    try {
      await axios.post('/api/scripts/reorder', { order: newOrder, groups: Object.keys(groups).length ? groups : undefined })
    } catch {
      alert('Failed to save order')
      fetchScripts()
    }
  }

  // 拖放到具体行：排序 + 可能切换分组
  const handleDrop = async (e, targetId, targetGroup) => {
    e.preventDefault()
    e.stopPropagation()
    const draggedId = draggingId || e.nativeEvent.dataTransfer.getData('text/plain')
    setDraggingId(null)
    setDragOverId(null)
    setActiveDropGroup(null)

    if (!draggedId || String(draggedId) === String(targetId)) return

    const allScripts = [...scripts]
    const fromIndex = allScripts.findIndex(s => s.id === draggedId)
    const toIndex = allScripts.findIndex(s => s.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return

    const newOrder = allScripts.map(s => s.id)
    newOrder.splice(fromIndex, 1)
    newOrder.splice(toIndex, 0, draggedId)

    const groups = {}
    const dragged = allScripts[fromIndex]
    if (dragged.group !== targetGroup) {
      groups[draggedId] = targetGroup
    }

    const updated = allScripts.map(s => {
      if (s.id === draggedId) return { ...s, group: groups[draggedId] || s.group }
      return s
    })
    const reordered = newOrder.map((id, idx) => {
      const s = updated.find(s => s.id === id)
      return s ? { ...s, orderNum: idx } : null
    }).filter(Boolean)
    setScripts(reordered)

    try {
      await axios.post('/api/scripts/reorder', { order: newOrder, groups: Object.keys(groups).length ? groups : undefined })
    } catch {
      alert('Failed to save order')
      fetchScripts()
    }
  }

  const handleUpdateScript = async (e) => {
    e.preventDefault()
    if (!editingScript) return
    const errors = {}
    if (!editingScript.name.trim()) {
      errors.name = 'Please enter a script name'
    }
    if (!editingScript.content.trim()) {
      errors.content = 'Please enter script content'
    }
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors)
      return
    }
    setEditErrors({})

    try {
      await axios.put(`/api/scripts/${editingScript.id}`, {
        name: editingScript.name,
        content: editingScript.content,
        group: editingScript.group
      })
      setEditingScript(null)
      fetchScripts()
    } catch (error) {
      console.error('Error updating script:', error)
      setEditErrors({ submit: 'Failed to update script, please try again' })
    }
  }

  // 关闭所有 Execution Outputs
  const handleCloseAllOutputs = () => {
    // 关闭所有活跃的 EventSource
    Object.keys(eventSourceRefs.current).forEach(key => {
      eventSourceRefs.current[key]?.close()
      delete eventSourceRefs.current[key]
    })
    // 清空所有输出
    setOutputs({})
    setExecutingIds({})
    setRunIds({})
    setExecutingBatch(false)
    setBatchRunningIds({})
    outputPanelRefs.current = {}
  }

  const handleExecuteScript = (id) => {
    const script = scripts.find(s => s.id === id)
    if (!script) return

    // 无可用 Shell：不发起 SSE，直接给出友好提示（避免后端报错观感与无谓请求）
    if (systemInfo && !systemInfo.shell?.command) {
      setOutputs(prev => ({
        ...prev,
        [id]: { output: '', error: '未检测到可用 Shell（需 WSL 或 Git Bash）。脚本无法执行。\n', exitCode: -1, live: false, timestamp: Date.now() }
      }))
      return
    }

    // 仅当该脚本自身正在执行时（单独执行，或仍在批量运行中）才阻止
    if (executingIds[id] || batchRunningIds[id]) return

    setExecutingIds(prev => ({ ...prev, [id]: true }))
    const timestamp = Date.now()
    // 记录该输出窗口是否「已经存在」（关闭重开后会从 outputs 中移除，视为首次出现）
    const hadOutput = !!outputs[id]
    setOutputs(prev => ({ ...prev, [id]: { output: '', error: '', exitCode: null, live: true, timestamp } }))
    // 仅当输出窗口是「首次出现」时才把自动贴底重置为开启；
    // 若窗口已存在（用户可能手动关过自动贴底），则保留用户当前设置，不在每次执行时强制重新开启
    if (!hadOutput) {
      setAutoFollowMap(prev => ({ ...prev, [id]: true }))
    }

    // 触发外层 Execution Outputs 容器滚动到顶部
    setScrollToTopKey(k => k + 1)

    const es = new EventSource(`/api/scripts/${id}/execute-stream`)
    eventSourceRefs.current[id] = es

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === 'start') {
        if (data.runId) setRunIds(prev => ({ ...prev, [id]: data.runId }))
        setOutputs(prev => {
          const curr = prev[id]
          if (curr && !curr.live) return prev
          return { ...prev, [id]: { output: '', error: '', exitCode: null, live: true, timestamp } }
        })
      } else if (data.type === 'stdout') {
        setOutputs(prev => {
          const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
          if (!curr.live) return prev
          return { ...prev, [id]: { ...curr, output: curr.output + data.content } }
        })
      } else if (data.type === 'stderr') {
        setOutputs(prev => {
          const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
          if (!curr.live) return prev
          return { ...prev, [id]: { ...curr, output: curr.output + data.content } }
        })
      } else if (data.type === 'error') {
        setOutputs(prev => {
          const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
          if (!curr.live) return prev
          return { ...prev, [id]: { ...curr, error: curr.error + data.message + '\n', exitCode: data.exitCode || -1 } }
        })
      } else if (data.type === 'close') {
        setOutputs(prev => {
          const curr = prev[id]
          if (curr && !curr.live) return prev
          return { ...prev, [id]: { ...curr, exitCode: data.exitCode, terminated: !!data.terminated, live: false, timestamp: curr?.timestamp, durationMs: data.durationMs } }
        })
        setExecutingIds(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setRunIds(prev => { const n = { ...prev }; delete n[id]; return n })
        es.close()
        delete eventSourceRefs.current[id]
        // 发送系统通知
        sendCompletionNotification(script.name, data.exitCode, data.durationMs)
      }
    }

    es.onerror = (err) => {
      console.error('EventSource error:', err)
      setOutputs(prev => {
        const curr = prev[id]
        if (curr && !curr.live) return prev
        return { ...prev, [id]: { ...(curr || { output: '', error: '', exitCode: null, live: true }), live: false } }
      })
      setExecutingIds(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      es.close()
      delete eventSourceRefs.current[id]
    }
  }

  // 强制中断某次执行：调用后端 /api/execute/:runId/stop 整组杀死进程
  const handleStopExecution = async (runId) => {
    if (!runId) return
    try {
      await axios.post(`/api/execute/${runId}/stop`)
    } catch (e) {
      console.error('Stop execution failed:', e)
    }
  }

  // 中断所有正在执行的脚本
  const handleStopAll = () => {
    Object.keys(outputs).forEach(id => {
      if (outputs[id]?.live && runIds[id]) {
        handleStopExecution(runIds[id])
      }
    })
  }

  const handleBatchExecute = () => {
    if (selectedIds.length === 0) {
      alert('Please select at least one script')
      return
    }
    if (executingBatch) return

    // 无可用 Shell：批量执行同样直接提示，不发起 SSE
    if (systemInfo && !systemInfo.shell?.command) {
      const now = Date.now()
      setOutputs(prev => {
        const next = { ...prev }
        selectedIds.forEach(id => {
          next[id] = { output: '', error: '未检测到可用 Shell（需 WSL 或 Git Bash）。脚本无法执行。\n', exitCode: -1, live: false, timestamp: now }
        })
        return next
      })
      return
    }

    // 捕获当前选中的脚本 ID 列表，保持顺序
    const batchIds = [...selectedIds]
    // 清空上一批次可能遗留的「已关闭脚本」记录，避免误忽略本批次事件
    closedBatchIds.current.clear()
    setExecutingBatch(true)
    // 记录本次批量中正在运行的脚本，脚本结束即从该集合移除，
    // 使其「Execute」按钮即时可点击，不必等整批跑完
    setBatchRunningIds(Object.fromEntries(batchIds.map(id => [id, true])))
    // 仅当某输出窗口是「首次出现」时才把它重置为自动贴底开启；
    // 已存在的窗口（用户可能手动关过自动贴底）保留当前设置，不在每次批量执行时强制重新开启
    setAutoFollowMap(prev => {
      const next = { ...prev }
      batchIds.forEach(id => { if (!outputs[id]) next[id] = true })
      return next
    })

    // 触发外层 Execution Outputs 容器滚动到顶部
    setScrollToTopKey(k => k + 1)

    // 为每个 batch 脚本初始化输出（按 batch 顺序分配递减时间戳以保持排序）
    const batchTimestamp = Date.now()
    const initialOutputs = {}
    batchIds.forEach((id, index) => {
      initialOutputs[id] = { output: '', error: '', exitCode: null, live: true, timestamp: batchTimestamp - index }
    })
    setOutputs(prev => ({ ...prev, ...initialOutputs }))

    const ids = batchIds.join(',')
    const es = new EventSource(`/api/scripts/batch-execute-stream?ids=${ids}`)
    eventSourceRefs.current['__batch__'] = es

    let currentId = null
    const scriptTimestamps = { ...initialOutputs }
    let finishedCount = 0

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      // 批量执行中已被用户关闭的脚本：忽略其后端推送事件，避免关闭后面板重新出现
      if (data.scriptId && closedBatchIds.current.has(data.scriptId)) return
      const scriptId = data.scriptId || currentId

      if (data.type === 'start') {
        currentId = data.scriptId
        if (data.runId) {
          // 每个脚本现在都有各自独立的 runId，直接登记即可（用于单独 Stop / 单独关面板）
          setRunIds(prev => ({ ...prev, [scriptId]: data.runId }))
        }
        if (scriptId) {
          setOutputs(prev => {
            const curr = prev[scriptId]
            if (curr && !curr.live) return prev
            return { ...prev, [scriptId]: { output: '', error: '', exitCode: null, live: true, timestamp: scriptTimestamps[scriptId]?.timestamp || batchTimestamp } }
          })
        }
      } else if (data.type === 'stdout') {
        if (scriptId) {
          setOutputs(prev => {
            const curr = prev[scriptId] || { output: '', error: '', exitCode: null, live: true }
            if (!curr.live) return prev
            return { ...prev, [scriptId]: { ...curr, output: curr.output + data.content } }
          })
        }
      } else if (data.type === 'stderr') {
        if (scriptId) {
          setOutputs(prev => {
            const curr = prev[scriptId] || { output: '', error: '', exitCode: null, live: true }
            if (!curr.live) return prev
            return { ...prev, [scriptId]: { ...curr, output: curr.output + data.content } }
          })
        }
      } else if (data.type === 'error') {
        if (scriptId) {
          setOutputs(prev => {
            const curr = prev[scriptId] || { output: '', error: '', exitCode: null, live: true }
            if (!curr.live) return prev
            return { ...prev, [scriptId]: { ...curr, error: curr.error + data.message + '\n', exitCode: data.exitCode || -1 } }
          })
        }
      } else if (data.type === 'close') {
        if (scriptId) {
          setRunIds(prev => { const n = { ...prev }; delete n[scriptId]; return n })
          setBatchRunningIds(prev => { const n = { ...prev }; delete n[scriptId]; return n })
          setOutputs(prev => {
            const curr = prev[scriptId]
            if (curr && !curr.live) return prev
            return { ...prev, [scriptId]: { ...curr, exitCode: data.exitCode, terminated: !!data.terminated, live: false, timestamp: curr?.timestamp, durationMs: data.durationMs } }
          })
          // 记录完成数，并立即发送完成通知
          finishedCount++
          const remaining = batchIds.length - finishedCount
          const s = scripts.find(s => s.id === scriptId)
          if (s) {
            sendCompletionNotification(s.name, data.exitCode, data.durationMs, remaining)
          }
        }
      } else if (data.type === 'done') {
        setExecutingBatch(false)
        setBatchRunningIds({})
        // 批量结束：清掉本批次所有脚本登记的 runId（每个脚本独立 runId，故按 batchIds 逐个删除）
        setRunIds(prev => {
          const n = { ...prev }
          batchIds.forEach(id => { delete n[id] })
          return n
        })
        // 清空「已关闭批量脚本」记录，为下一批次腾出干净状态
        closedBatchIds.current.clear()
        es.close()
        delete eventSourceRefs.current['__batch__']
      }
    }

    es.onerror = (err) => {
      console.error('EventSource error:', err)
      setOutputs(prev => {
        const next = { ...prev }
        let changed = false
        Object.keys(next).forEach(key => {
          if (next[key] && next[key].live) {
            next[key] = { ...next[key], live: false }
            changed = true
          }
        })
        return changed ? next : prev
      })
      setExecutingBatch(false)
      setBatchRunningIds({})
      // 批量出错中断：同样按 batchIds 清掉本批次所有 runId
      setRunIds(prev => {
        const n = { ...prev }
        batchIds.forEach(id => { delete n[id] })
        return n
      })
      es.close()
      delete eventSourceRefs.current['__batch__']
    }
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    )
  }

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return ''
    const diff = now - timestamp
    if (diff < 0) return '0s ago'
    const totalSeconds = Math.floor(diff / 1000)
    if (totalSeconds < 60) return `${totalSeconds}s ago`
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const parts = []
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)
    return parts.join(' ') + ' ago'
  }

  const formatDuration = (durationMs) => {
    if (durationMs == null) return ''
    const ms = Math.max(0, durationMs)
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (totalSeconds < 3600) {
      if (seconds > 0) return `${minutes}m ${seconds}s`
      return `${minutes}m`
    }
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    if (seconds > 0) return `${hours}h ${remainingMinutes}m ${seconds}s`
    if (remainingMinutes > 0) return `${hours}h ${remainingMinutes}m`
    return `${hours}h`
  }

  // ==================== 自动更新：交互处理 ====================
  const handleCheckUpdates = () => {
    setShowUpdateModal(true)
    setUpdateError('')
    if (updateState !== 'downloaded') setUpdateState('checking')
    if (window.electronAPI?.checkForUpdates) {
      window.electronAPI.checkForUpdates().catch(() => {
        setUpdateState('error')
        setUpdateError('Running in dev mode. Auto-update only works in packaged builds.')
      })
    }
  }

  // 用户在弹窗里确认更新后，开始下载
  const handleDownloadUpdate = () => {
    if (updateState === 'downloading') return // 防止重复点击
    setUpdateProgress(0)
    setUpdateState('downloading')
    if (window.electronAPI?.downloadUpdate) window.electronAPI.downloadUpdate()
  }

  const handleStartUpdate = () => {
    if (window.electronAPI?.startUpdate) {
      window.electronAPI.startUpdate().catch((err) => {
        console.error('startUpdate failed:', err)
        setUpdateError('Failed to restart. Please close and reopen the app manually.')
        setUpdateState('error')
      })
    }
  }

  return (
    <div className="app-container">
      {/* 无可用 Shell：醒目横幅提示，而非让用户在点运行后才看到 cryptic 报错 */}
      {systemInfo != null && !(systemInfo.shell && systemInfo.shell.command) && (
        <div
          style={{
            background: '#fff3cd',
            color: '#7a5b00',
            borderBottom: '1px solid #ffe69c',
            padding: '10px 18px',
            fontSize: '13px',
            lineHeight: 1.5
          }}
        >
          ⚠️ 未检测到 <b>WSL</b> 或 <b>Git Bash</b>：脚本执行功能不可用。请在 Windows 上安装
          WSL（<code>wsl --install</code>）或 Git Bash 后重启应用。
        </div>
      )}
      <header className="header">
        <h1>Script Manager</h1>

        {/* 工具栏：按钮在左，检查更新 + App Info 图标在右 */}
        <div className="toolbar-row">
          <div className="toolbar-left">
            <button
              onClick={handleBatchExecute}
              disabled={selectedIds.length === 0 || executingBatch || selectedIds.some(id => executingIds[id] || batchRunningIds[id])}
              className="btn btn-primary btn-batch"
            >
              {executingBatch ? 'Executing...' : `Execute Selected (${selectedIds.length})`}
            </button>
            <button
              onClick={() => {
                setFormErrors({})
                setShowAddForm(true)
              }}
              className="btn btn-success"
            >
              Add Script
            </button>
          </div>

          <div className="toolbar-right">
            <button
              className="tool-icon-btn"
              onClick={handleCheckUpdates}
              title="Check for updates"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
              {updateState === 'downloaded' && <span className="update-badge">!</span>}
            </button>
            <button
              className="tool-icon-btn"
              onClick={() => { setShowInfoModal(true); fetchShells(); }}
              title="App info"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            </button>
          </div>
        </div>
      </header>

      <div className="main-layout">
        {/* 左侧：脚本列表，分上下两组：后端脚本在上，前端脚本在下 */}
        <div className="left-panel">
          {(() => {
            const backendScripts = scripts.filter(s => s.group === 'backend').sort((a, b) => (a.orderNum || 0) - (b.orderNum || 0))
            const frontendScripts = scripts.filter(s => s.group === 'frontend').sort((a, b) => (a.orderNum || 0) - (b.orderNum || 0))
            const hasBackend = backendScripts.length > 0
            const hasFrontend = frontendScripts.length > 0
            const hasAny = hasBackend || hasFrontend

            if (!hasAny) {
              return (
                <div className="empty-state">
                  <p>No scripts found. Click "Add Script" to create your first script.</p>
                </div>
              )
            }

            const renderTable = (groupName, scripts) => (
              <div
                className={`script-group ${activeDropGroup === groupName ? 'drop-active' : ''}`}
                onDragOver={(e) => handleDragOverGroup(e, groupName)}
                onDrop={(e) => handleDropToGroup(e, groupName)}
              >
                <div className="group-header">
                  <h3 className="group-title">{groupName === 'backend' ? 'Backend Scripts' : 'Frontend Scripts'}</h3>
                  <span className="group-count">{scripts.length}</span>
                </div>
                <div className="group-table">
                  <table className="scripts-table">
                    <thead>
                      <tr>
                        <th className="drag-col"></th>
                        <th className="checkbox-col">
                          <input
                            type="checkbox"
                            checked={scripts.every(s => selectedIds.includes(s.id)) && scripts.length > 0}
                            disabled={scripts.some(s => executingIds[s.id] || batchRunningIds[s.id])}
                            onChange={() => {
                              const allIds = scripts.map(s => s.id)
                              const allSelected = allIds.every(id => selectedIds.includes(id))
                              if (allSelected) {
                                setSelectedIds(selectedIds.filter(id => !allIds.includes(id)))
                              } else {
                                const newSelected = [...new Set([...selectedIds, ...allIds])]
                                setSelectedIds(newSelected)
                              }
                            }}
                          />
                        </th>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scripts.map(script => {
                        const out = outputs[script.id]
                        const isLive = out && out.live
                        const isStopped = out && out.terminated
                        const statusLabel = isLive ? 'Running' : (isStopped ? 'Stopped' : (out && out.exitCode !== null ? `Exit ${out.exitCode}` : 'Idle'))
                        const isDragging = draggingId === script.id
                        const isDragOver = dragOverId === script.id && draggingId && draggingId !== script.id
                        const isRunning = executingIds[script.id] || batchRunningIds[script.id]
                        return (
                          <tr
                            key={script.id}
                            className={`${selectedIds.includes(script.id) ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                            onDragOver={(e) => handleDragOver(e, script.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, script.id, groupName)}
                          >
                            <td className="drag-col">
                              <span
                                className="drag-handle"
                                title="Drag to reorder / change group"
                                draggable
                                onDragStart={(e) => handleDragStart(e, script.id)}
                                onDragEnd={handleDragEnd}
                              >⋮⋮</span>
                            </td>
                            <td className="checkbox-col">
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(script.id)}
                                disabled={isRunning}
                                onChange={() => toggleSelect(script.id)}
                              />
                            </td>
                            <td className="name-col">
                              <div className="script-name">{script.name}</div>
                            </td>
                            <td>
                              <span className={`status-badge ${isLive ? 'running' : (isStopped ? 'stopped' : (out && out.exitCode === 0 ? 'success' : (out ? 'error' : '')))}`}>
                                {statusLabel}
                              </span>
                            </td>
                            <td className="actions-col">
                              <div className="actions-inner">
                                <button
                                  onClick={() => handleExecuteScript(script.id)}
                                  disabled={isRunning}
                                  className="btn btn-execute"
                                >
                                  Execute
                                </button>
                                <button
                                  onClick={() => handleEditScript(script)}
                                  disabled={isRunning}
                                  className="btn btn-edit"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteScript(script.id)}
                                  disabled={isRunning}
                                  className="btn btn-delete"
                                >
                                  Delete
                                </button>
                                <button
                                  onClick={() => scrollToOutput(script.id)}
                                  disabled={!outputs[script.id]}
                                  className="btn btn-locate"
                                  title="Locate output"
                                >
                                  Locate
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )

            return (
              <div className="scripts-container">
                {renderTable('backend', backendScripts)}
                {renderTable('frontend', frontendScripts)}
              </div>
            )
          })()}
        </div>

        {/* 右侧：Execution Outputs */}
        <div className="right-panel">
          <div className="outputs-header">
            <h2 className="outputs-title">Execution Outputs</h2>
          {Object.keys(outputs).length > 0 && (
            <>
              {Object.values(outputs).some(o => o.live) && (
                <button className="btn-stop-all" onClick={handleStopAll} title="Force stop all running executions">
                  Stop all
                </button>
              )}
              <button className="btn-close-all" onClick={handleCloseAllOutputs} title="Close all outputs">
                Close all
              </button>
            </>
          )}
          </div>
          <div
            className="outputs-container"
            ref={setOutputsScrollRef}
          >
            {Object.keys(outputs).length === 0 ? (
              <div className="empty-output">
                <p>No execution output yet.</p>
                <p>Execute a script to see output here.</p>
              </div>
            ) : (
              scripts.filter(s => outputs[s.id]).sort((a, b) => {
                const aOut = outputs[a.id]
                const bOut = outputs[b.id]
                // 按时间戳倒序：最新执行的脚本输出排在最前（顶部）。
                // 批量脚本在启动时已按批次顺序赋递减时间戳，彼此间仍保持批次顺序，
                // 而中途单独执行的脚本会拿到更新的时间戳，自然排到顶部。
                return (bOut.timestamp || 0) - (aOut.timestamp || 0)
              }).map(script => {
                const output = outputs[script.id]
                const isRunning = executingIds[script.id] || batchRunningIds[script.id]
                return (
                  <div key={script.id} className="output-panel" ref={el => { outputPanelRefs.current[script.id] = el }}>
                    <div className="output-header">
                      <div className="output-header-left">
                        <span className={`group-badge ${script.group === 'frontend' ? 'frontend' : ''} ${locatingId === script.id ? 'running' : ''}`}>
                          {script.group === 'frontend' ? 'FE' : 'BE'}
                        </span>
                        <span className="output-name">{script.name}</span>
                        {output.live && <span className="live-dot"></span>}
                        {output.timestamp && (
                          <span className="output-meta">
                            {formatDuration(output.live ? (now - output.timestamp) : output.durationMs)}
                          </span>
                        )}
                        {!output.live && output.timestamp && (
                          <span className="output-meta">
                            {formatTimeAgo(output.timestamp)}
                          </span>
                        )}
                      </div>
                      <div className="output-header-right">
                        {output.live ? (
                          <span className="running-spinner" title="Running...">
                            <RunningSpinner />
                          </span>
                        ) : (
                          <span className={`exit-code ${output.terminated ? 'stopped' : (output.exitCode === 0 ? 'success' : (output.exitCode !== null ? 'error' : ''))}`}>
                            {output.terminated ? 'Stopped' : (output.exitCode !== null ? `Exit: ${output.exitCode}` : 'Pending')}
                          </span>
                        )}
                        <button
                          className={`btn-autofollow ${isAutoFollow(script.id) ? 'on' : 'off'}`}
                          title={isAutoFollow(script.id) ? 'Auto-scroll: On (click to disable)' : 'Auto-scroll: Off (click to enable)'}
                          onClick={() => {
                            const next = !isAutoFollow(script.id)
                            setAutoFollowMap(prev => ({ ...prev, [script.id]: next }))
                            if (next) {
                              // 同步更新 ref，避免 pinToBottom 的 autoFollow 检查读到旧值而跳过贴底
                              autoFollowRef.current = { ...autoFollowRef.current, [script.id]: true }
                              const el = outputRefs.current[script.id]
                              if (el) pinToBottom(el, script.id)
                            }
                          }}
                        >
                          <AutoFollowIcon on={isAutoFollow(script.id)} />
                        </button>
                        <button
                          onClick={() => output.live
                            ? (runIds[script.id] && handleStopExecution(runIds[script.id]))
                            : handleExecuteScript(script.id)}
                          disabled={!output.live && isRunning}
                          className={output.live ? 'btn btn-stop' : 'btn btn-rerun'}
                          title={output.live ? 'Force stop execution' : 'Re-execute'}
                        >
                          {output.live ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                              <rect x="6" y="6" width="12" height="12" rx="2" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                              <polyline points="23 4 23 10 17 10" />
                              <polyline points="1 20 1 14 7 14" />
                              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => setMaximizedScriptId(script.id)}
                          className="btn btn-maximize"
                          title="Maximize output"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                            <polyline points="15 3 21 3 21 9" />
                            <polyline points="9 21 3 21 3 15" />
                            <line x1="21" y1="3" x2="14" y2="10" />
                            <line x1="3" y1="21" x2="10" y2="14" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            // 关闭该脚本的输出面板。
                            // 若正处于批量执行中（共享 EventSource `__batch__` 不能关，否则会误杀同批其它脚本），
                            // 则改为调用 stop 接口只杀「这一个脚本」的进程树；
                            // 否则（单次执行）直接关闭它独立的 ES，后端 req.on('close') 会负责杀整组进程。
                            const rid = runIds[script.id]
                            const isBatchRunning = !!eventSourceRefs.current['__batch__'] && batchRunningIds[script.id]
                            setRunIds(prev => { const n = { ...prev }; delete n[script.id]; return n })
                            if (isBatchRunning && rid) {
                              // 标记该脚本已关闭，忽略其后端回推事件（否则关闭后面板会重新出现）
                              closedBatchIds.current.add(script.id)
                              handleStopExecution(rid)
                            } else if (eventSourceRefs.current[script.id]) {
                              eventSourceRefs.current[script.id].close()
                              delete eventSourceRefs.current[script.id]
                            }
                            setExecutingIds(prev => {
                              const next = { ...prev }
                              delete next[script.id]
                              return next
                            })
                            setOutputs(prev => {
                              const newOutputs = { ...prev }
                              delete newOutputs[script.id]
                              return newOutputs
                            })
                            delete outputPanelRefs.current[script.id]
                          }}
                          className="btn btn-close"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                    <div className="output-section">
                      <div
                        className="output-content-wrapper"
                        ref={el => { outputRefs.current[script.id] = el }}
                        onScroll={(e) => handleOutputScroll(script.id, e)}
                      >
                        <pre className="output-content" ref={getContentRef(script.id)}>{output.output || 'Waiting for output...'}</pre>
                      </div>
                    </div>
                    {output.error && (
                      <div className="output-section error">
                        <div className="output-section-label">Error</div>
                        <div className="output-content-wrapper">
                          <pre className="output-content">{output.error}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
            {showScrollTop && (
              <button
                className="scroll-top-btn"
                onClick={() => {
                  if (outputsScrollRef.current) {
                    outputsScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' })
                  }
                }}
                title="Back to top"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {deleteConfirmId !== null && (
        <div className="modal-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="modal-content modal-confirm" onClick={e => e.stopPropagation()}>
            <h2>Confirm Deletion</h2>
            <p style={{ marginBottom: 16, color: '#666' }}>
              Are you sure you want to delete this script? This action cannot be undone.
            </p>
            <div className="form-actions">
              <button type="button" onClick={() => setDeleteConfirmId(null)} className="btn btn-cancel">
                Cancel
              </button>
              <button type="button" onClick={confirmDeleteScript} className="btn btn-delete">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpdateModal && (
        <div className="modal-overlay">
          <div className="modal-content update-modal">
            <h2>Check for Updates</h2>
            <div className="update-body">
              {updateState === 'idle' && <p>Click below to check for the latest version.</p>}
              {updateState === 'checking' && <p>Checking for updates…</p>}
              {updateState === 'not-available' && <p>You're on the latest version (v{appVersion}).</p>}
              {updateState === 'available' && (
                <div>
                  <p>A new version <strong>v{updateInfo.version}</strong> is available.</p>
                  {(() => {
                    const text = normalizeReleaseNotes(updateInfo.releaseNotes);
                    return text ? (
                      <Markdown content={text} className="update-notes" maxLength={2000} />
                    ) : null;
                  })()}
                  <p className="update-hint">Do you want to download and install this update?</p>
                </div>
              )}
              {updateState === 'downloading' && (
                <div>
                  <p>Downloading update: {updateProgress}%</p>
                  <div className="update-progress-bar">
                    <div className="update-progress-fill" style={{ width: `${updateProgress}%` }} />
                  </div>
                </div>
              )}
              {updateState === 'downloaded' && (
                <div>
                  <p>Update downloaded (v{updateInfo.version}).</p>
                  <p className="update-hint">Restart the app to apply the update.</p>
                </div>
              )}
              {updateState === 'error' && (
                <div>
                  <p className="update-error-text">Update check failed:</p>
                  <pre className="update-notes">{updateError}</pre>
                </div>
              )}
            </div>
            <div className="form-actions">
              {updateState === 'downloaded' ? (
                <>
                  <button className="btn btn-cancel" onClick={() => setShowUpdateModal(false)}>Later</button>
                  <button className="btn btn-primary" onClick={handleStartUpdate}>Restart &amp; Update</button>
                </>
              ) : updateState === 'available' ? (
                <>
                  <button className="btn btn-cancel" onClick={() => setShowUpdateModal(false)}>Later</button>
                  <button className="btn btn-primary" onClick={handleDownloadUpdate}>Download &amp; Update</button>
                </>
              ) : (
                <button className="btn btn-cancel" onClick={() => setShowUpdateModal(false)}>Close</button>
              )}
            </div>
          </div>
        </div>
      )}

      {showInfoModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>App Info</h2>
            <div className="info-body">
              <div className="info-row">
                <label>Version</label>
                <div className="info-value">v{appVersion}</div>
              </div>
              {systemInfo && (
                <>
                  <div className="info-row">
                    <label>Server Port</label>
                    <div className="info-value">
                      {systemInfo.port}
                      <button
                        className="btn btn-copy"
                        onClick={() => navigator.clipboard.writeText(String(systemInfo.port))}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="info-row">
                    <label>Shell</label>
                    <div className="info-value">
                      {systemInfo.shell?.type?.toUpperCase() || 'Unknown'}
                      {systemInfo.shell?.version && (
                        <span className="info-sub">{systemInfo.shell.version}</span>
                      )}
                    </div>
                    {(systemInfo.shell?.fullPath || systemInfo.shell?.command) && (
                      <div className="info-path">
                        <span className="info-path-text">{systemInfo.shell.fullPath || systemInfo.shell.command}</span>
                        <button
                          className="btn btn-copy"
                          onClick={() => navigator.clipboard.writeText(systemInfo.shell.fullPath || systemInfo.shell.command)}
                        >
                          Copy
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="info-row">
                    <label>Shells</label>
                    <div className="shell-list">
                      {shellList.length === 0 && (
                        <span className="info-sub">Detecting available shells…</span>
                      )}
                      {shellList.map(s => {
                        const isCurrent = s.id === currentShellId
                        return (
                          <div key={s.id} className={`shell-item ${isCurrent ? 'current' : ''}`}>
                            <div className="shell-item-main">
                              <span className="shell-item-name">{s.name}</span>
                              {s.version && <span className="shell-item-meta">{s.version}</span>}
                            </div>
                            <span className="shell-item-path">{s.fullPath || s.command}</span>
                            <div className="shell-item-actions">
                              <button
                                className={`btn-shell-switch ${isCurrent ? 'on' : ''}`}
                                disabled={isCurrent || switchingShellId === s.id}
                                onClick={() => handleSwitchShell(s.id)}
                                title={isCurrent ? 'Currently active' : `Run scripts with ${s.name}`}
                              >
                                {isCurrent ? 'Active' : (switchingShellId === s.id ? 'Switching…' : 'Use')}
                              </button>
                              {s.custom && (
                                <button
                                  className="btn-shell-remove"
                                  disabled={removingShellId === s.id}
                                  onClick={() => handleRemoveShell(s.id)}
                                  title="Remove this custom path"
                                >
                                  {removingShellId === s.id ? '…' : 'Remove'}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      {/* 手动添加自定义 bash 路径：有些 bash 装在非标准路径，自动探测扫不到 */}
                      <div className="shell-add">
                        <input
                          type="text"
                          className="shell-add-input"
                          placeholder="Add a bash path, e.g. C:\\tools\\git\\bin\\bash.exe or /opt/homebrew/bin/bash"
                          value={newShellPath}
                          onChange={(e) => { setNewShellPath(e.target.value); if (addShellError) setAddShellError('') }}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !addingShell) handleAddShell() }}
                          disabled={addingShell}
                        />
                        {canBrowseShell && (
                          <button
                            type="button"
                            className="btn-shell-browse"
                            onClick={handleBrowseShell}
                            disabled={addingShell}
                          title="Select a bash executable from the system"
                        >
                          Browse…
                          </button>
                        )}
                        <button
                          className="btn-shell-add"
                          disabled={addingShell || !newShellPath.trim()}
                          onClick={handleAddShell}
                        >
                          {addingShell ? 'Checking…' : 'Add'}
                        </button>
                      </div>
                      {addShellError && (
                        <div className="shell-add-error">{addShellError}</div>
                      )}
                    </div>
                  </div>
                </>
              )}
              {appInfo && (
                <>
                  <div className="info-row">
                    <label>Scripts Config</label>
                    <div className="info-path">
                      <span className="info-path-text">{escapePathForShell(appInfo.scriptsConfigPath)}</span>
                      <button
                        className="btn btn-copy"
                        onClick={() => navigator.clipboard.writeText(appInfo.scriptsConfigPath)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="info-row">
                    <label>Log File</label>
                    <div className="info-path">
                      <span className="info-path-text">{escapePathForShell(appInfo.logFilePath)}</span>
                      <button
                        className="btn btn-copy"
                        onClick={() => navigator.clipboard.writeText(appInfo.logFilePath)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </>
              )}
              {!window.electronAPI && (
                <p className="info-hint">Config &amp; log paths are only available in the Electron app.</p>
              )}
            </div>
            <div className="form-actions">
              <button className="btn btn-cancel" onClick={() => setShowInfoModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Add New Script</h2>
            {formErrors.submit && <div className="form-error-banner">{formErrors.submit}</div>}
            <form onSubmit={handleAddScript}>
              <div className="form-group">
                <label>Group</label>
                <select
                  value={newScript.group}
                  onChange={e => setNewScript(prev => ({ ...prev, group: e.target.value }))}
                >
                  <option value="backend">Backend</option>
                  <option value="frontend">Frontend</option>
                </select>
              </div>
              <div className="form-group">
                <label>Script Name <span className="required-mark">*</span></label>
                <input
                  type="text"
                  value={newScript.name}
                  onChange={e => {
                    setNewScript(prev => ({ ...prev, name: e.target.value }))
                    if (formErrors.name) setFormErrors(prev => ({ ...prev, name: undefined }))
                  }}
                  placeholder="Enter script name"
                  className={formErrors.name ? 'input-error' : ''}
                />
                {formErrors.name && <span className="field-error">{formErrors.name}</span>}
              </div>
              <div className="form-group">
                <label>Script Content (Shell) <span className="required-mark">*</span></label>
                <div className={`shell-editor-wrapper ${formErrors.content ? 'editor-error' : ''}`}>
                  <ShellEditor
                    value={newScript.content}
                    onChange={val => {
                      setNewScript(prev => ({ ...prev, content: val }))
                      if (formErrors.content) setFormErrors(prev => ({ ...prev, content: undefined }))
                    }}
                  />
                </div>
                {formErrors.content && <span className="field-error">{formErrors.content}</span>}
              </div>
              <div className="form-actions">
                <button type="button" onClick={() => { setShowAddForm(false); setFormErrors({}) }} className="btn btn-cancel">
                  Cancel
                </button>
                <button type="submit" className="btn btn-success">
                  Add Script
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingScript && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Edit Script</h2>
            {editErrors.submit && <div className="form-error-banner">{editErrors.submit}</div>}
            <form onSubmit={handleUpdateScript}>
              <div className="form-group">
                <label>Group</label>
                <select
                  value={editingScript.group || 'backend'}
                  onChange={e => setEditingScript(prev => ({ ...prev, group: e.target.value }))}
                >
                  <option value="backend">Backend</option>
                  <option value="frontend">Frontend</option>
                </select>
              </div>
              <div className="form-group">
                <label>Script Name <span className="required-mark">*</span></label>
                <input
                  type="text"
                  value={editingScript.name}
                  onChange={e => {
                    setEditingScript(prev => ({ ...prev, name: e.target.value }))
                    if (editErrors.name) setEditErrors(prev => ({ ...prev, name: undefined }))
                  }}
                  placeholder="Enter script name"
                  className={editErrors.name ? 'input-error' : ''}
                />
                {editErrors.name && <span className="field-error">{editErrors.name}</span>}
              </div>
              <div className="form-group">
                <label>Script Content (Shell) <span className="required-mark">*</span></label>
                <div className={`shell-editor-wrapper ${editErrors.content ? 'editor-error' : ''}`}>
                  <ShellEditor
                    value={editingScript.content}
                    onChange={val => {
                      setEditingScript(prev => ({ ...prev, content: val }))
                      if (editErrors.content) setEditErrors(prev => ({ ...prev, content: undefined }))
                    }}
                  />
                </div>
                {editErrors.content && <span className="field-error">{editErrors.content}</span>}
              </div>
              <div className="form-actions">
                <button type="button" onClick={() => { setEditingScript(null); setEditErrors({}) }} className="btn btn-cancel">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {maximizedScriptId && (() => {
        const script = scripts.find(s => s.id === maximizedScriptId)
        const output = outputs[maximizedScriptId]
        if (!script || !output) return null
        return (
          <div className="modal-overlay" onClick={() => setMaximizedScriptId(null)}>
            <div className="modal-content modal-maximized" onClick={e => e.stopPropagation()}>
              <div className="maximized-header">
                <div className="maximized-header-left">
                  <span className={`group-badge ${script.group === 'frontend' ? 'frontend' : ''} ${locatingId === script.id ? 'running' : ''}`}>
                    {script.group === 'frontend' ? 'FE' : 'BE'}
                  </span>
                  <span className="maximized-name">{script.name}</span>
                  {output.live && <span className="live-dot"></span>}
                  {output.timestamp && (
                    <span className="output-meta">
                      {formatDuration(output.live ? (now - output.timestamp) : output.durationMs)}
                    </span>
                  )}
                  {!output.live && output.timestamp && (
                    <span className="output-meta">
                      {formatTimeAgo(output.timestamp)}
                    </span>
                  )}
                </div>
                <div className="maximized-header-right">
                  {output.live ? (
                    <span className="running-spinner" title="Running...">
                      <RunningSpinner />
                    </span>
                  ) : (
                    <span className={`exit-code ${output.terminated ? 'stopped' : (output.exitCode === 0 ? 'success' : (output.exitCode !== null ? 'error' : ''))}`}>
                      {output.terminated ? 'Stopped' : (output.exitCode !== null ? `Exit: ${output.exitCode}` : 'Pending')}
                    </span>
                  )}
                  <button
                    className={`btn-autofollow ${isAutoFollow(maximizedScriptId) ? 'on' : 'off'}`}
                    title={isAutoFollow(maximizedScriptId) ? 'Auto-scroll: On (click to disable)' : 'Auto-scroll: Off (click to enable)'}
                    onClick={() => {
                      const next = !isAutoFollow(maximizedScriptId)
                      setAutoFollowMap(prev => ({ ...prev, [maximizedScriptId]: next }))
                      if (next) {
                        // 同步更新 ref，避免 pinToBottom 的 autoFollow 检查读到旧值而跳过贴底
                        autoFollowRef.current = { ...autoFollowRef.current, [maximizedScriptId]: true }
                        const el = maximizedOutputRef.current
                        if (el) pinToBottom(el, maximizedScriptId)
                      }
                    }}
                  >
                    <AutoFollowIcon on={isAutoFollow(maximizedScriptId)} />
                  </button>
                  <button
                    onClick={() => output.live
                      ? (runIds[maximizedScriptId] && handleStopExecution(runIds[maximizedScriptId]))
                      : handleExecuteScript(maximizedScriptId)}
                    disabled={!output.live && (executingIds[maximizedScriptId] || batchRunningIds[maximizedScriptId])}
                    className={output.live ? 'btn btn-stop' : 'btn btn-rerun'}
                    title={output.live ? 'Force stop execution' : 'Re-execute'}
                  >
                    {output.live ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => setMaximizedScriptId(null)}
                    className="btn btn-close"
                    title="Close"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="maximized-body">
                <div
                  className="maximized-output-wrapper"
                  ref={maximizedOutputRef}
                  onScroll={(e) => handleOutputScroll(maximizedScriptId, e)}
                >
                  <pre className="maximized-output-content" ref={maximizedContentRef}>{output.output || 'Waiting for output...'}</pre>
                </div>
                {output.error && (
                  <div className="maximized-error-section">
                    <div className="output-section-label">Error</div>
                    <pre className="maximized-output-content error">{output.error}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default App