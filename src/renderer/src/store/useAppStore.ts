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
  openForm: (form: NameFormState) => void
  closeForm: () => void
  setSearch: (value: string) => void
  setContentDraft: (scriptId: string, value: string) => void
  clearContentDraft: (scriptId: string) => void
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
    const [scripts, groups] = await Promise.all([window.api.scripts.list(), window.api.groups.list()])
    const { selectedScriptId: selected, openTabs, contentDrafts } = get()
    // 页签先过滤掉已删除的脚本,选中失效时落到第一个剩余页签(与 closeTab 的落点语义一致)
    const remainingTabs = openTabs.filter((id) => scripts.some((s) => s.id === id))
    const selectedValid = selected && scripts.some((s) => s.id === selected)
    // 被删脚本的草稿与页签一起作废,不留孤儿条目
    const nextDrafts: Record<string, string> = {}
    for (const [id, value] of Object.entries(contentDrafts)) {
      if (scripts.some((s) => s.id === id)) nextDrafts[id] = value
    }
    set({
      scripts,
      groups,
      loading: false,
      selectedScriptId: selectedValid ? selected : (remainingTabs[0] ?? null),
      openTabs: remainingTabs,
      contentDrafts: nextDrafts
    })
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

  requestContentFocus(scriptId) {
    set({ contentFocusRequest: scriptId })
  },

  clearContentFocus() {
    set({ contentFocusRequest: null })
  }
}))
