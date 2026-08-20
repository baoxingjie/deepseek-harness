/**
 * Skills settings page store: the installed list plus the two catalogs
 * (UniClaw recommended, and the skill market). Catalogs load lazily on first
 * visit to their tab and are then cached for the page's lifetime; the
 * installed list re-reads after every install, toggle, or removal, because
 * the host's on-disk state is the only fact source.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  deleteSkill, installSkill, listInstalled, listMarket, listRecommended, readSkill, toggleSkill, uploadSkill,
  type CatalogCategory, type CatalogSkillView, type InstalledSkillView,
} from './api.ts'

/** Which list the page is showing. */
export type SkillsTab = 'recommended' | 'market' | 'installed'

/** One lazily loaded catalog. */
export interface CatalogState {
  /** `null` until its tab is first opened. */
  items: CatalogSkillView[] | null
  categories: CatalogCategory[]
}

/** Page snapshot. */
export interface SkillsState {
  tab: SkillsTab
  /** Selected category chip id, or `all`. */
  category: string
  search: string
  installed: InstalledSkillView[]
  recommended: CatalogState
  market: CatalogState
  /** Whether the installed list has been read at least once. */
  loaded: boolean
  /** Transient result of the last write. */
  notice: string | null
  /** Catalog ids and installed dirs with a write in flight. */
  busy: string[]
  /** The SKILL.md currently open in the viewer. */
  viewing: { name: string; content: string } | null
}

function initial(): SkillsState {
  return {
    tab: 'recommended',
    category: 'all',
    search: '',
    installed: [],
    recommended: { items: null, categories: [] },
    market: { items: null, categories: [] },
    loaded: false,
    notice: null,
    busy: [],
    viewing: null,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The skills page controller: one snapshot store plus the writes that refresh it. */
export interface SkillsController {
  store: SnapshotStore<SkillsState>
  /** Read the installed list and, when needed, the active tab's catalog. */
  load: () => Promise<void>
  setTab: (tab: SkillsTab) => void
  setCategory: (category: string) => void
  setSearch: (search: string) => void
  install: (source: 'recommended' | 'market', id: string) => Promise<void>
  toggle: (dir: string, enabled: boolean) => Promise<void>
  remove: (dir: string) => Promise<void>
  upload: (file: File) => Promise<void>
  view: (dir: string) => Promise<void>
  closeViewer: () => void
  dismissNotice: () => void
}

/** Build the skills page controller. */
export function createSkillsStore(): SkillsController {
  const store = createSnapshotStore<SkillsState>(initial())

  const loadInstalled = async (): Promise<void> => {
    try {
      const { skills } = await listInstalled()
      store.update((draft) => { draft.installed = skills; draft.loaded = true })
    } catch (error) {
      store.update((draft) => { draft.notice = messageOf(error); draft.loaded = true })
    }
  }

  /** Fetch the active tab's catalog the first time that tab is opened. */
  const loadCatalog = async (): Promise<void> => {
    const { tab } = store.getSnapshot()
    if (tab === 'installed') return
    if (store.getSnapshot()[tab].items !== null) return
    try {
      const { items, categories } = tab === 'recommended' ? await listRecommended() : await listMarket()
      store.update((draft) => { draft[tab] = { items, categories } })
    } catch (error) {
      store.update((draft) => {
        draft[tab] = { items: [], categories: [] }
        draft.notice = messageOf(error)
      })
    }
  }

  const load = async (): Promise<void> => {
    await Promise.all([loadInstalled(), loadCatalog()])
  }

  /** Run one write with its row marked busy, then re-read the installed list. */
  const write = async (id: string, notice: string, action: () => Promise<unknown>): Promise<void> => {
    store.update((draft) => { draft.busy = [...draft.busy, id]; draft.notice = null })
    try {
      await action()
      store.update((draft) => { draft.notice = notice })
      await loadInstalled()
    } catch (error) {
      store.update((draft) => { draft.notice = messageOf(error) })
    } finally {
      store.update((draft) => { draft.busy = draft.busy.filter(entry => entry !== id) })
    }
  }

  return {
    store,
    load,
    setTab: (tab) => {
      store.update((draft) => { draft.tab = tab; draft.category = 'all' })
      void loadCatalog()
    },
    setCategory: (category) => { store.update((draft) => { draft.category = category }) },
    setSearch: (search) => { store.update((draft) => { draft.search = search }) },
    install: (source, id) => write(id, '已安装', () => installSkill(source, id)),
    toggle: (dir, enabled) => write(dir, enabled ? '已启用' : '已停用', () => toggleSkill(dir, enabled)),
    remove: dir => write(dir, '已卸载', () => deleteSkill(dir)),
    upload: file => write(file.name, '已上传并安装', () => uploadSkill(file)),
    view: async (dir) => {
      try {
        const { content } = await readSkill(dir)
        store.update((draft) => { draft.viewing = { name: dir, content } })
      } catch (error) {
        store.update((draft) => { draft.notice = messageOf(error) })
      }
    },
    closeViewer: () => { store.update((draft) => { draft.viewing = null }) },
    dismissNotice: () => { store.update((draft) => { draft.notice = null }) },
  }
}
