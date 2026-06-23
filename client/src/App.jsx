import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import ShellEditor from './components/ShellEditor'
import './App.css'

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
  const [batchOrderIds, setBatchOrderIds] = useState([])
  const [outputs, setOutputs] = useState({})
  const [systemInfo, setSystemInfo] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [activeDropGroup, setActiveDropGroup] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [maximizedScriptId, setMaximizedScriptId] = useState(null)
  const eventSourceRefs = useRef({})
  const outputRefs = useRef({})
  const maximizedOutputRef = useRef(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const outputsScrollRef = useRef(null)
  // 用于在执行时触发外层容器滚动到顶部（通过 useLayoutEffect 确保 DOM 提交后再滚动）
  const [scrollToTopKey, setScrollToTopKey] = useState(0)
  // 跟踪用户是否手动向上滚动（不在底部）
  const userScrolledUp = useRef({})
  // 每秒更新，用于刷新「多久前」显示
  const [now, setNow] = useState(Date.now())

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
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // 发送脚本执行完成的系统通知
  const sendCompletionNotification = (scriptName, exitCode, durationMs) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const dur = durationMs != null ? ` (${(durationMs / 1000).toFixed(1)}s)` : ''
    const emoji = exitCode === 0 ? '✅' : '❌'
    const status = exitCode === 0 ? 'Completed successfully' : `Failed (exit code: ${exitCode})`
    new Notification(`${emoji} ${scriptName}`, { body: `${status}${dur}` })
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

  // 监听用户滚动事件
  const handleOutputScroll = useCallback((id, e) => {
    const el = e.target
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10
    userScrolledUp.current[id] = !isAtBottom
  }, [])

  // 每当 outputs 变化后，如果用户没有手动向上滚动，自动滚动到最新内容
  useLayoutEffect(() => {
    Object.keys(outputs).forEach(id => {
      const out = outputs[id]
      if (out && out.live && !userScrolledUp.current[id]) {
        const el = outputRefs.current[id]
        if (el) {
          el.scrollTop = el.scrollHeight
        }
      }
    })
    // 大窗口也自动追踪最新内容
    if (maximizedScriptId) {
      const out = outputs[maximizedScriptId]
      if (out && out.live && !userScrolledUp.current[maximizedScriptId]) {
        const el = maximizedOutputRef.current
        if (el) {
          el.scrollTop = el.scrollHeight
        }
      }
    }
  }, [outputs, maximizedScriptId])

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

    const updated = allScripts.map((s, idx) => {
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
    } catch (error) {
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
    } catch (error) {
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

  const handleExecuteScript = (id) => {
    const script = scripts.find(s => s.id === id)
    if (!script) return

    // 仅当该脚本自身正在执行时（单独或批量中）才阻止
    if (executingIds[id] || (executingBatch && batchOrderIds.includes(id))) return

    setExecutingIds(prev => ({ ...prev, [id]: true }))
    const timestamp = Date.now()
    setOutputs(prev => ({ ...prev, [id]: { output: '', error: '', exitCode: null, live: true, timestamp } }))

    // 重置用户滚动状态，允许自动跟随
    userScrolledUp.current[id] = false

    // 触发外层 Execution Outputs 容器滚动到顶部
    setScrollToTopKey(k => k + 1)

    const es = new EventSource(`/api/scripts/${id}/execute-stream`)
    eventSourceRefs.current[id] = es

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === 'start') {
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
          return { ...prev, [id]: { ...curr, exitCode: data.exitCode, live: false, timestamp: curr?.timestamp, durationMs: data.durationMs } }
        })
        setExecutingIds(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
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

  const handleBatchExecute = () => {
    if (selectedIds.length === 0) {
      alert('Please select at least one script')
      return
    }
    if (executingBatch) return

    // 捕获当前选中的脚本 ID 列表，保持顺序
    const batchIds = [...selectedIds]
    setBatchOrderIds(batchIds)
    setExecutingBatch(true)

    // 重置所有 batch 脚本的滚动状态，允许自动跟随
    batchIds.forEach(id => {
      userScrolledUp.current[id] = false
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
    // 追踪每个脚本的执行结果，用于 done 时汇总通知
    const batchResults = {}

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      const scriptId = data.scriptId || currentId

      if (data.type === 'start') {
        currentId = data.scriptId
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
          setOutputs(prev => {
            const curr = prev[scriptId]
            if (curr && !curr.live) return prev
            return { ...prev, [scriptId]: { ...curr, exitCode: data.exitCode, live: false, timestamp: curr?.timestamp, durationMs: data.durationMs } }
          })
          // 记录每个脚本的结果
          batchResults[scriptId] = { exitCode: data.exitCode, durationMs: data.durationMs }
        }
      } else if (data.type === 'done') {
        setExecutingBatch(false)
        setBatchOrderIds([])
        es.close()
        delete eventSourceRefs.current['__batch__']
        // 批量执行完成，发送汇总通知
        if ('Notification' in window && Notification.permission === 'granted') {
          const results = Object.values(batchResults)
          const succeeded = results.filter(r => r.exitCode === 0).length
          const failed = results.length - succeeded
          const totalDur = results.reduce((sum, r) => sum + (r.durationMs || 0), 0)
          const durStr = totalDur > 0 ? ` (total ${(totalDur / 1000).toFixed(1)}s)` : ''
          new Notification(`📦 Batch execution completed`, {
            body: `${succeeded} succeeded, ${failed} failed${durStr}`
          })
        }
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
      setBatchOrderIds([])
      es.close()
      delete eventSourceRefs.current['__batch__']
    }
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    )
  }

  const formatDate = (dateStr) => {
    const date = new Date(dateStr)
    return date.toLocaleString()
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
    const totalSeconds = Math.floor(ms / 1000)
    if (totalSeconds < 60) return `${totalSeconds}s`
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

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-left">
          <h1>Script Manager</h1>
          <div className="header-actions">
            <button
              onClick={handleBatchExecute}
              disabled={selectedIds.length === 0 || executingBatch}
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
        </div>
        <div className="header-right">
          {systemInfo && (
            <div className="system-info">
              <div className="info-row">
                <span className="info-badge">
                  {systemInfo.shell.type === 'bash' ? 'BASH' : systemInfo.shell.type.toUpperCase()}
                </span>
                <span className="info-path">{systemInfo.shell.fullPath || systemInfo.shell.command}</span>
              </div>
              {systemInfo.shell.version && (
                <div className="info-row">
                  <span className="info-version">{systemInfo.shell.version}</span>
                </div>
              )}
            </div>
          )}
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
                        const statusLabel = isLive ? 'Running' : (out && out.exitCode !== null ? `Exit ${out.exitCode}` : 'Idle')
                        const isDragging = draggingId === script.id
                        const isDragOver = dragOverId === script.id && draggingId && draggingId !== script.id
                        const isRunning = executingIds[script.id] || (executingBatch && batchOrderIds.includes(script.id))
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
                                onChange={() => toggleSelect(script.id)}
                              />
                            </td>
                            <td className="name-col">
                              <div className="script-name">{script.name}</div>
                            </td>
                            <td>
                              <span className={`status-badge ${isLive ? 'running' : (out && out.exitCode === 0 ? 'success' : (out ? 'error' : ''))}`}>
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
          <h2 className="outputs-title">Execution Outputs</h2>
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
                // 批量执行期间按 batch 顺序排序
                if (executingBatch && batchOrderIds.length > 0) {
                  const aIdx = batchOrderIds.indexOf(a.id)
                  const bIdx = batchOrderIds.indexOf(b.id)
                  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
                  if (aIdx !== -1) return -1
                  if (bIdx !== -1) return 1
                }
                const aOut = outputs[a.id]
                const bOut = outputs[b.id]
                return (bOut.timestamp || 0) - (aOut.timestamp || 0)
              }).map(script => {
                const output = outputs[script.id]
                return (
                  <div key={script.id} className="output-panel">
                    <div className="output-header">
                      <div className="output-header-left">
                        <span className={`group-badge ${script.group === 'frontend' ? 'frontend' : ''}`}>
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
                        <span className={`exit-code ${output.exitCode === 0 ? 'success' : (output.exitCode !== null ? 'error' : '')}`}>
                          {output.live ? 'Running...' : (output.exitCode !== null ? `Exit: ${output.exitCode}` : 'Pending')}
                        </span>
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
                            // 关闭并清理该脚本的 EventSource
                            if (eventSourceRefs.current[script.id]) {
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
                        <pre className="output-content">{output.output || 'Waiting for output...'}</pre>
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

      {showAddForm && (
        <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
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
        <div className="modal-overlay" onClick={() => setEditingScript(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
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
                  <span className={`group-badge ${script.group === 'frontend' ? 'frontend' : ''}`}>
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
                  <span className={`exit-code ${output.exitCode === 0 ? 'success' : (output.exitCode !== null ? 'error' : '')}`}>
                    {output.live ? 'Running...' : (output.exitCode !== null ? `Exit: ${output.exitCode}` : 'Pending')}
                  </span>
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
                  <pre className="maximized-output-content">{output.output || 'Waiting for output...'}</pre>
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
