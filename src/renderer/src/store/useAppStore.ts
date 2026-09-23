import { create } from 'zustand'
import type { Group, Script } from '../../../shared/types'

export type NameFormState =
  | { type: 'none' }
  | { type: 'group-create'; parentId: string | null }
  | { type: 'group-edit'; group: Group }
  | { type: 'script-create'; groupId: string | null }
  | { type: 'script-edit'; script: Script }

interface AppState {
  scripts: Script[]
  groups: Group[]
  selectedScriptId: string | null
  /**
   * 详情区页签条里打开过的脚本 id,按打开顺序排。
   * 选中(点击/执行/编辑)一个脚本就开一个页签;手动关闭才移除。
   */
  openTabs: string[]
  form: NameFormState
  loading: boolean
  search: string
  /**
   * 内容面板的未保存草稿,按脚本 id 存:切到别的脚本再切回来,没保存的改动还在。
   * 保存成功或脚本被删时清掉对应条目。
   */
  contentDrafts: Record<string, string>
  /** 新建脚本后想让内容面板聚焦一次的脚本 id;面板聚焦完自己清掉 */
  contentFocusRequest: string | null
  reload: () => Promise<void>
  selectScript: (id: string | null) => void
  closeTab: (id: string) => void
  /**
   * 页签关闭请求:页签 X / 右键菜单发起,由 App 层常驻的 TabCloseGuard 接管
   * (带未保存草稿时逐个弹确认)。null = 无进行中的请求;每次请求换新对象,guard 据此触发。
   */
  tabCloseRequest: { ids: string[] } | null
  /**
   * 「Always discard unsaved changes when closing a tab」的会话级开关:
   * 只存内存,重启回到默认的逐次弹窗(产品决策,不落盘)。
   */
  alwaysDiscardTabClose: boolean
  requestTabClose: (ids: string[]) => void
  clearTabCloseRequest: () => void
  setAlwaysDiscardTabClose: (value: boolean) => void
  /**
   * 保存某脚本的内容草稿:IPC 更新 + reload;保存往返期间继续输入的内容按未保存增量保留。
   * 没有草稿或草稿等于已存内容时空操作。错误原样上抛,由调用方负责提示。
   * 内容面板 Cmd/Ctrl+S 与页签关闭确认共用这一个保存入口。
   */
  saveScriptContent: (scriptId: string) => Promise<void>
  openForm: (form: NameFormState) => void
  closeForm: () => void
  setSearch: (value: string) => void
  setContentDraft: (scriptId: string, value: string) => void
  clearContentDraft: (scriptId: string) => void
  /** 清空全部草稿:导入配置整体覆盖脚本后调用,旧草稿留着会被误当成「未保存改动」覆盖导入内容 */
  clearAllContentDrafts: () => void
  requestContentFocus: (scriptId: string) => void
  clearContentFocus: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  scripts: [],
  groups: [],
  selectedScriptId: null,
  openTabs: [],
  form: { type: 'none' },
  loading: false,
  search: '',
  contentDrafts: {},
  contentFocusRequest: null,
  tabCloseRequest: null,
  alwaysDiscardTabClose: false,

  async reload() {
    set({ loading: true })
    try {
      const [scripts, groups] = await Promise.all([window.api.scripts.list(), window.api.groups.list()])
      const { selectedScriptId: selected, openTabs, contentDrafts } = get()
      // 页签先过滤掉已删除的脚本
      const remainingTabs = openTabs.filter((id) => scripts.some((s) => s.id === id))
      const selectedValid = selected && scripts.some((s) => s.id === selected)
      // 选中失效时的落点与 closeTab 同语义:被移除页签的位置上,右邻优先、无则靠左邻
      const removedIdx = openTabs.indexOf(selected ?? '')
      const fallback = remainingTabs[Math.min(removedIdx, remainingTabs.length - 1)] ?? null
      // 被删脚本的草稿与页签一起作废,不留孤儿条目
      const nextDrafts: Record<string, string> = {}
      for (const [id, value] of Object.entries(contentDrafts)) {
        if (scripts.some((s) => s.id === id)) nextDrafts[id] = value
      }
      set({
        scripts,
        groups,
        loading: false,
        selectedScriptId: selectedValid ? selected : fallback,
        openTabs: remainingTabs,
        contentDrafts: nextDrafts
      })
    } catch (err) {
      // IPC 失败也要解除 loading,否则列表永远空转;错误就地打印,
      // 调用方(Sidebar 的 void reload())没有 await,这里不抛才能避免 unhandled rejection
      set({ loading: false })
      console.error('[useAppStore] reload 失败:', err)
    }
  },

  selectScript(id) {
    // 选中即打开页签:点击列表、执行、编辑都会走到这里,详情区随之出现对应页签
    set((state) => ({
      selectedScriptId: id,
      openTabs: id && !state.openTabs.includes(id) ? [...state.openTabs, id] : state.openTabs
    }))
  },

  closeTab(id) {
    const { openTabs, selectedScriptId } = get()
    const idx = openTabs.indexOf(id)
    if (idx === -1) return
    const next = openTabs.filter((t) => t !== id)
    set({
      openTabs: next,
      // 关掉的是当前页签时,优先落到同位置的下一个,没有则靠右邻,再没有就清空选中
      selectedScriptId:
        selectedScriptId === id ? (next[Math.min(idx, next.length - 1)] ?? null) : selectedScriptId
    })
  },

  // 页签关闭的唯一入口:X 按钮与右键菜单都把「要关的 id 列表」交过来,
  // 由 App 层的 TabCloseGuard 接管(干净页签直接关,脏页签逐个弹确认)。
  // 传空列表或不存在的 id 都是空操作。
  requestTabClose(ids) {
    const { openTabs } = get()
    const valid = ids.filter((id) => openTabs.includes(id))
    if (valid.length === 0) return
    set({ tabCloseRequest: { ids: valid } })
  },

  clearTabCloseRequest() {
    set({ tabCloseRequest: null })
  },

  setAlwaysDiscardTabClose(value) {
    set({ alwaysDiscardTabClose: value })
  },

  async saveScriptContent(scriptId) {
    const { contentDrafts, scripts } = get()
    const draft = contentDrafts[scriptId]
    const script = scripts.find((s) => s.id === scriptId)
    if (script === undefined || draft === undefined || draft === script.content) return
    // 记住本次保存的值:保存走 IPC 往返,期间用户可能继续输入(草稿已变)。
    // 只有草稿仍等于保存值时才清除,否则保留 —— 让飞行期间的输入作为未保存增量继续存在。
    const savedValue = draft
    await window.api.scripts.update(scriptId, { content: savedValue })
    await get().reload()
    const latestDraft = get().contentDrafts[scriptId]
    if (latestDraft === undefined || latestDraft === savedValue) get().clearContentDraft(scriptId)
  },

  openForm(form) {
    set({ form })
  },

  closeForm() {
    set({ form: { type: 'none' } })
  },

  setSearch(value) {
    set({ search: value })
  },

  setContentDraft(scriptId, value) {
    set({ contentDrafts: { ...get().contentDrafts, [scriptId]: value } })
  },

  clearContentDraft(scriptId) {
    const next = { ...get().contentDrafts }
    delete next[scriptId]
    set({ contentDrafts: next })
  },

  clearAllContentDrafts() {
    set({ contentDrafts: {} })
  },

  requestContentFocus(scriptId) {
    set({ contentFocusRequest: scriptId })
  },

  clearContentFocus() {
    set({ contentFocusRequest: null })
  }
}))
