import { create } from 'zustand'
import type { Group, Script } from '../../../shared/types'

export type NameFormState =
  | { type: 'none' }
  | { type: 'group-create' }
  | { type: 'group-edit'; group: Group }
  | { type: 'script-create'; groupId: string | null }
  | { type: 'script-edit'; script: Script }

interface AppState {
  scripts: Script[]
  groups: Group[]
  selectedScriptId: string | null
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
  form: { type: 'none' },
  loading: false,
  search: '',
  contentDrafts: {},
  contentFocusRequest: null,

  async reload() {
    set({ loading: true })
    const [scripts, groups] = await Promise.all([window.api.scripts.list(), window.api.groups.list()])
    const selected = get().selectedScriptId
    set({
      scripts,
      groups,
      loading: false,
      // 脚本被删掉时,它没保存的草稿也一起作废
      selectedScriptId: selected && scripts.some((s) => s.id === selected) ? selected : null
    })
  },

  selectScript(id) {
    set({ selectedScriptId: id })
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
