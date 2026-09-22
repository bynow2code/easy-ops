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
  closeAllTabs: () => void
  closeTabsToLeft: (id: string) => void
  closeTabsToRight: (id: string) => void
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

  // 右键菜单「关闭全部」:连选中一起清,详情区回空态
  closeAllTabs() {
    set({ openTabs: [], selectedScriptId: null })
  },

  // 右键菜单「关闭左边」:保留被点页签及其右侧;选中被波及时落到被点页签
  closeTabsToLeft(id) {
    const { openTabs, selectedScriptId } = get()
    const idx = openTabs.indexOf(id)
    if (idx <= 0) return
    const next = openTabs.slice(idx)
    set({
      openTabs: next,
      selectedScriptId:
        selectedScriptId !== null && next.includes(selectedScriptId) ? selectedScriptId : id
    })
  },

  // 右键菜单「关闭右边」:保留被点页签及其左侧,选中落点同款
  closeTabsToRight(id) {
    const { openTabs, selectedScriptId } = get()
    const idx = openTabs.indexOf(id)
    if (idx === -1 || idx >= openTabs.length - 1) return
    const next = openTabs.slice(0, idx + 1)
    set({
      openTabs: next,
      selectedScriptId:
        selectedScriptId !== null && next.includes(selectedScriptId) ? selectedScriptId : id
    })
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
