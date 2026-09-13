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
  reload: () => Promise<void>
  selectScript: (id: string | null) => void
  openForm: (form: NameFormState) => void
  closeForm: () => void
  setSearch: (value: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  scripts: [],
  groups: [],
  selectedScriptId: null,
  form: { type: 'none' },
  loading: false,
  search: '',

  async reload() {
    set({ loading: true })
    const [scripts, groups] = await Promise.all([window.api.scripts.list(), window.api.groups.list()])
    const selected = get().selectedScriptId
    set({
      scripts,
      groups,
      loading: false,
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
  }
}))
