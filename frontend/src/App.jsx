import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import './App.css'

function App() {
  const [scripts, setScripts] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newScript, setNewScript] = useState({ name: '', content: '' })
  const [editingScript, setEditingScript] = useState(null)
  const [executingId, setExecutingId] = useState(null)
  const [executingBatch, setExecutingBatch] = useState(false)
  const [outputs, setOutputs] = useState({})
  const [systemInfo, setSystemInfo] = useState(null)
  const eventSourceRef = useRef(null)

  useEffect(() => {
    fetchScripts()
    fetchSystemInfo()
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

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

  const handleUpdateScript = async (e) => {
    e.preventDefault()
    if (!editingScript) return

    try {
      await axios.put(`/api/scripts/${editingScript.id}`, {
        name: editingScript.name,
        content: editingScript.content
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
    setOutputs(prev => ({ ...prev, [id]: { output: '', error: '', exitCode: null, live: true } }))

    const es = new EventSource(`/api/scripts/${id}/execute-stream`)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === 'start') {
        setOutputs(prev => ({
          ...prev,
          [id]: { output: '', error: '', exitCode: null, live: true }
        }))
      } else if (data.type === 'stdout') {
        setOutputs(prev => {
          const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
          return { ...prev, [id]: { ...curr, output: curr.output + data.content } }
        })
      } else if (data.type === 'stderr') {
        setOutputs(prev => {
          const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
          return { ...prev, [id]: { ...curr, error: curr.error + data.content } }
        })
      } else if (data.type === 'error') {
        setOutputs(prev => {
          const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
          return { ...prev, [id]: { ...curr, error: curr.error + data.message + '\n', exitCode: data.exitCode || -1 } }
        })
      } else if (data.type === 'close') {
        setOutputs(prev => {
          const curr = prev[id] || { output: '', error: '', exitCode: null, live: true }
          return { ...prev, [id]: { ...curr, exitCode: data.exitCode, live: false } }
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

    // 为每个选中的脚本初始化输出
    const initialOutputs = {}
    selectedIds.forEach(id => {
      initialOutputs[id] = { output: '', error: '', exitCode: null, live: true }
    })
    setOutputs(prev => ({ ...prev, ...initialOutputs }))

    const ids = selectedIds.join(',')
    const es = new EventSource(`/api/scripts/batch-execute-stream?ids=${ids}`)
    eventSourceRef.current = es

    let currentId = null

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      const scriptId = data.scriptId || currentId

      if (data.type === 'start') {
        currentId = data.scriptId
        setOutputs(prev => ({
          ...prev,
          [scriptId]: { output: '', error: '', exitCode: null, live: true }
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
            return { ...prev, [scriptId]: { ...curr, error: curr.error + data.content } }
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
            const curr = prev[scriptId] || { output: '', error: '', exitCode: null, live: true }
            return { ...prev, [scriptId]: { ...curr, exitCode: data.exitCode, live: false } }
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

  const toggleSelectAll = () => {
    if (selectedIds.length === scripts.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(scripts.map(s => s.id))
    }
  }

  const formatDate = (dateStr) => {
    const date = new Date(dateStr)
    return date.toLocaleString()
  }

  return (
    <div className="app-container">
      <header className="header">
        <div>
          <h1>Script Manager</h1>
          {systemInfo && (
            <div className="system-info">
              <div className="info-row">
                <span className="info-badge">
                  {systemInfo.shell.type === 'bash' ? '🐚' : '💻'} {systemInfo.shell.type.toUpperCase()}
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
      </header>

      {scripts.length === 0 ? (
        <div className="empty-state">
          <p>No scripts found. Click "Add Script" to create your first script.</p>
        </div>
      ) : (
        <div className="scripts-container">
          <table className="scripts-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === scripts.length && scripts.length > 0}
                    onChange={toggleSelectAll}
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
                return (
                  <tr key={script.id} className={selectedIds.includes(script.id) ? 'selected' : ''}>
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
      )}

      {Object.keys(outputs).length > 0 && (
        <div className="outputs-container">
          <h2>Execution Outputs</h2>
          {scripts.filter(s => outputs[s.id]).map(script => {
            const output = outputs[script.id]
            return (
              <div key={script.id} className="output-panel">
                <div className="output-header">
                  <span className="output-name">{script.name} {output.live && <span className="live-dot"></span>}</span>
                  <span className={`exit-code ${output.exitCode === 0 ? 'success' : (output.exitCode !== null ? 'error' : '')}`}>
                    {output.live ? 'Running...' : (output.exitCode !== null ? `Exit: ${output.exitCode}` : 'Starting...')}
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
                {output.output && (
                  <div className="output-section">
                    <h3>Output</h3>
                    <pre className="output-content">{output.output}</pre>
                  </div>
                )}
                {output.error && (
                  <div className="output-section error">
                    <h3>Error</h3>
                    <pre className="output-content">{output.error}</pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAddForm && (
        <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>Add New Script</h2>
            <form onSubmit={handleAddScript}>
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
