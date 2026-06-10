import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import './App.css'

function App() {
  const [scripts, setScripts] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newScript, setNewScript] = useState({ name: '', content: '', group: 'backend' })
  const [editingScript, setEditingScript] = useState(null)
  const [executingId, setExecutingId] = useState(null)
  const [executingBatch, setExecutingBatch] = useState(false)
  const [outputs, setOutputs] = useState({})
  const [systemInfo, setSystemInfo] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [activeDropGroup, setActiveDropGroup] = useState(null)
  const eventSourceRef = useRef(null)
  const outputRefs = useRef({})
  const containerRef = useRef(null)

  useEffect(() => {
    fetchScripts()
    fetchSystemInfo()
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    // 对正在执行的脚本，自动滚动单个输出框到底部
    Object.keys(outputs).forEach(id => {
      const el = outputRefs.current[id]
      if (el && outputs[id]?.live) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight
        })
      }
    })
    // 右侧面板总容器始终滚动到底部（最新输出在最下面）
    if (containerRef.current) {
      requestAnimationFrame(() => {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
      })
    }
  }, [outputs])

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
    try {
      await axios.post('/api/scripts', newScript)
      setNewScript({ name: '', content: '' })
      setShowAddForm(false)
      fetchScripts()
    } catch (error) {
      console.error('Error adding script:', error)
      alert('Failed to add script')
    }
  }

  const handleDeleteScript = async (id) => {
    if (!confirm('Are you sure you want to delete this script?')) return
    try {
      await axios.delete(`/api/scripts/${id}`)
      setScripts(scripts.filter(s => s.id !== id))
      setSelectedIds(selectedIds.filter(sid => sid !== id))
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
      alert('Failed to update script')
    }
  }

  const handleExecuteScript = (id) => {
    const script = scripts.find(s => s.id === id)
    if (!script) return

    if (executingId === id || executingBatch) return

    setExecutingId(id)
    const timestamp = Date.now()
    setOutputs(prev => ({ ...prev, [id]: { output: '', error: '', exitCode: null, live: true, timestamp } }))

    const es = new EventSource(`/api/scripts/${id}/execute-stream`)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === 'start') {
        setOutputs(prev => ({
          ...prev,
          [id]: { output: '', error: '', exitCode: null, live: true, timestamp }
        }))
      } else if (data.type === 'stdout') {
        setOutputs(prev => {
          const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
          return { ...prev, [id]: { ...curr, output: curr.output + data.content } }
        })
      } else if (data.type === 'stderr') {
        setOutputs(prev => {
          const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
          return { ...prev, [id]: { ...curr, output: curr.output + data.content } }
        })
      } else if (data.type === 'error') {
        setOutputs(prev => {
          const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
          return { ...prev, [id]: { ...curr, error: curr.error + data.message + '\n', exitCode: data.exitCode || -1 } }
        })
      } else if (data.type === 'close') {
        setOutputs(prev => {
          const curr = prev[id]
          return { ...prev, [id]: { ...curr, exitCode: data.exitCode, live: false, timestamp: curr?.timestamp } }
        })
        setExecutingId(null)
        es.close()
      }
    }

    es.onerror = (err) => {
      console.error('EventSource error:', err)
      setOutputs(prev => {
        const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
        return { ...prev, [id]: { ...curr, live: false } }
      })
      setExecutingId(null)
      es.close()
    }
  }

  const handleBatchExecute = () => {
    if (selectedIds.length === 0) {
      alert('Please select at least one script')
      return
    }
    if (executingId || executingBatch) return

    setExecutingBatch(true)

    // 为每个选中的脚本分配唯一时间戳（按选择顺序递减，保持展示顺序）
    const batchTimestamp = Date.now()
    const initialOutputs = {}
    selectedIds.forEach((id, index) => {
      initialOutputs[id] = { output: '', error: '', exitCode: null, live: true, timestamp: batchTimestamp - index }
    })
    setOutputs(prev => ({ ...prev, ...initialOutputs }))

    const ids = selectedIds.join(',')
    const es = new EventSource(`/api/scripts/batch-execute-stream?ids=${ids}`)
    eventSourceRef.current = es

    let currentId = null
    // 为每个脚本记录各自的启动时间戳
    const scriptTimestamps = { ...initialOutputs }

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      const scriptId = data.scriptId || currentId

      if (data.type === 'start') {
        currentId = data.scriptId
        setOutputs(prev => ({
          ...prev,
          [scriptId]: { output: '', error: '', exitCode: null, live: true, timestamp: scriptTimestamps[scriptId]?.timestamp || batchTimestamp }
        }))
      } else if (data.type === 'stdout') {
        if (scriptId) {
          setOutputs(prev => {
            const curr = prev[scriptId] || { output: '', error: '', exitCode: null, live: true }
            return { ...prev, [scriptId]: { ...curr, output: curr.output + data.content } }
          })
        }
      } else if (data.type === 'stderr') {
        if (scriptId) {
          setOutputs(prev => {
            const curr = prev[scriptId] || { output: '', error: '', exitCode: null, live: true }
            return { ...prev, [scriptId]: { ...curr, output: curr.output + data.content } }
          })
        }
      } else if (data.type === 'error') {
        if (scriptId) {
          setOutputs(prev => {
            const curr = prev[scriptId] || { output: '', error: '', exitCode: null, live: true }
            return { ...prev, [scriptId]: { ...curr, error: curr.error + data.message + '\n', exitCode: data.exitCode || -1 } }
          })
        }
      } else if (data.type === 'close') {
        if (scriptId) {
          setOutputs(prev => {
            const curr = prev[scriptId]
            return { ...prev, [scriptId]: { ...curr, exitCode: data.exitCode, live: false, timestamp: curr?.timestamp } }
          })
        }
      } else if (data.type === 'done') {
        setExecutingBatch(false)
        es.close()
      }
    }

    es.onerror = (err) => {
      console.error('EventSource error:', err)
      setExecutingBatch(false)
      es.close()
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

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-left">
          <h1>Script Manager</h1>
          <div className="header-actions">
            <button
              onClick={handleBatchExecute}
              disabled={selectedIds.length === 0 || executingBatch || executingId}
              className="btn btn-primary btn-batch"
            >
              {executingBatch ? 'Executing...' : `Execute Selected (${selectedIds.length})`}
            </button>
            <button
              onClick={() => setShowAddForm(true)}
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
                <span className="info-path">{systemInfo.shell.fullPath || systemInfo.shell.command} {systemInfo.shell.args.join(' ')}</span>
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
                        return (
                          <tr
                            key={script.id}
                            className={`${selectedIds.includes(script.id) ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, script.id)}
                            onDragOver={(e) => handleDragOver(e, script.id)}
                            onDragLeave={handleDragLeave}
                            onDragEnd={handleDragEnd}
                            onDrop={(e) => handleDrop(e, script.id, groupName)}
                          >
                            <td className="drag-col">
                              <span className="drag-handle" title="Drag to reorder / change group">⋮⋮</span>
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
                              <button
                                onClick={() => handleExecuteScript(script.id)}
                                disabled={executingId === script.id || executingBatch}
                                className="btn btn-execute"
                              >
                                {executingId === script.id ? 'Running...' : 'Execute'}
                              </button>
                              <button
                                onClick={() => handleEditScript(script)}
                                className="btn btn-edit"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteScript(script.id)}
                                className="btn btn-delete"
                              >
                                Delete
                              </button>
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
          <div className="outputs-container" ref={containerRef}>
            {Object.keys(outputs).length === 0 ? (
              <div className="empty-output">
                <p>No execution output yet.</p>
                <p>Execute a script to see output here.</p>
              </div>
            ) : (
              scripts.filter(s => outputs[s.id]).sort((a, b) => {
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
                      </div>
                      <div className="output-header-right">
                        <span className={`exit-code ${output.exitCode === 0 ? 'success' : (output.exitCode !== null ? 'error' : '')}`}>
                          {output.live ? 'Running...' : (output.exitCode !== null ? `Exit: ${output.exitCode}` : 'Pending')}
                        </span>
                        <button
                          onClick={() => setOutputs(prev => {
                            const newOutputs = { ...prev }
                            delete newOutputs[script.id]
                            return newOutputs
                          })}
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
                        style={{ maxHeight: '200px', minHeight: '60px', overflowY: 'auto', overflowX: 'hidden' }}
                      >
                        <pre className="output-content">{output.output || 'Waiting for output...'}</pre>
                      </div>
                    </div>
                    {output.error && (
                      <div className="output-section error">
                        <div className="output-section-label">Error</div>
                        <div className="output-content-wrapper" style={{ maxHeight: '200px', minHeight: '60px', overflowY: 'auto', overflowX: 'hidden' }}>
                          <pre className="output-content">{output.error}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {showAddForm && (
        <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>Add New Script</h2>
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
                <label>Script Name</label>
                <input
                  type="text"
                  value={newScript.name}
                  onChange={e => setNewScript(prev => ({ ...prev, name: e.target.value }))}
                  required
                  placeholder="Enter script name"
                />
              </div>
              <div className="form-group">
                <label>Script Content (Shell)</label>
                <textarea
                  value={newScript.content}
                  onChange={e => setNewScript(prev => ({ ...prev, content: e.target.value }))}
                  required
                  placeholder="Enter shell script content..."
                  rows={8}
                />
              </div>
              <div className="form-actions">
                <button type="button" onClick={() => setShowAddForm(false)} className="btn btn-cancel">
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
                <label>Script Name</label>
                <input
                  type="text"
                  value={editingScript.name}
                  onChange={e => setEditingScript(prev => ({ ...prev, name: e.target.value }))}
                  required
                  placeholder="Enter script name"
                />
              </div>
              <div className="form-group">
                <label>Script Content (Shell)</label>
                <textarea
                  value={editingScript.content}
                  onChange={e => setEditingScript(prev => ({ ...prev, content: e.target.value }))}
                  required
                  placeholder="Enter shell script content..."
                  rows={8}
                />
              </div>
              <div className="form-actions">
                <button type="button" onClick={() => setEditingScript(null)} className="btn btn-cancel">
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
    </div>
  )
}

export default App
