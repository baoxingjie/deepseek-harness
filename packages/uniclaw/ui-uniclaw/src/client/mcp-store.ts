/**
 * MCP settings page store. The host owns every fact — the enable overrides and
 * custom entries on disk, and which bridges are actually mounted — so each
 * mutation writes through a route and the page re-reads rather than predicting
 * the outcome locally.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { deleteMcp, listMcp, saveMcp, toggleMcp, type McpDraft, type McpServerView } from './api.ts'

/**
 * A mount reconciles asynchronously after its write returns, so the page
 * re-reads once more after this delay to show the settled `mounted` state.
 */
const REMOUNT_SETTLE_MS = 900

/** Page snapshot. */
export interface McpState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; per-write failures land in {@link notice}. */
  error: string | null
  /** Transient result of the last write, shown as a status line. */
  notice: string | null
  servers: McpServerView[]
  /** Server ids with a write in flight; their controls are disabled. */
  busy: string[]
  /** The row being edited, or a blank draft for a new server; null = closed. */
  editing: McpDraft | null
}

const BLANK: McpDraft = {
  id: '', name: '', transport: 'streamable-http', url: '', headers: {}, command: '', args: '', env: {},
}

function initial(): McpState {
  return { status: 'idle', error: null, notice: null, servers: [], busy: [], editing: null }
}

/** Message text of a rejected write. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The MCP page controller: one snapshot store plus the writes that refresh it. */
export interface McpController {
  store: SnapshotStore<McpState>
  /** Read every server; the page's only load path. */
  load: () => Promise<void>
  /** Re-read only if the page already loaded once. */
  refreshIfLoaded: () => void
  toggle: (id: string, enabled: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
  save: (draft: McpDraft) => Promise<void>
  /** Open the editor on an existing row, or on a blank draft when omitted. */
  edit: (server?: McpServerView) => void
  closeEditor: () => void
  dismissNotice: () => void
}

/** Build the MCP page controller. */
export function createMcpStore(): McpController {
  const store = createSnapshotStore<McpState>(initial())

  const load = async (): Promise<void> => {
    store.update((draft) => { draft.status = draft.status === 'ready' ? 'ready' : 'loading' })
    try {
      const { servers } = await listMcp()
      store.update((draft) => {
        draft.servers = servers
        draft.status = 'ready'
        draft.error = null
      })
    } catch (error) {
      store.update((draft) => {
        draft.status = 'error'
        draft.error = messageOf(error)
      })
    }
  }

  /** Run one write with its row marked busy, then re-read now and once settled. */
  const write = async (id: string, notice: string, action: () => Promise<unknown>): Promise<void> => {
    store.update((draft) => { draft.busy = [...draft.busy, id]; draft.notice = null })
    try {
      await action()
      store.update((draft) => { draft.notice = notice })
      await load()
      // The bridge finishes connecting after the route returns; a second read
      // replaces the in-between state with the settled one.
      setTimeout(() => { void load() }, REMOUNT_SETTLE_MS)
    } catch (error) {
      store.update((draft) => { draft.notice = messageOf(error) })
    } finally {
      store.update((draft) => { draft.busy = draft.busy.filter(entry => entry !== id) })
    }
  }

  return {
    store,
    load,
    refreshIfLoaded: () => {
      if (store.getSnapshot().status !== 'idle') void load()
    },
    toggle: (id, enabled) => write(id, enabled ? '已启用，正在连接…' : '已停用', () => toggleMcp(id, enabled)),
    remove: id => write(id, '已删除', () => deleteMcp(id)),
    save: async (draft) => {
      await write(draft.id || 'new', '已保存，正在连接…', () => saveMcp(draft))
      if (store.getSnapshot().status !== 'error') store.update((state) => { state.editing = null })
    },
    edit: (server) => {
      store.update((draft) => {
        draft.editing = server === undefined ? { ...BLANK } : {
          id: server.id,
          name: server.name,
          transport: server.transport,
          url: server.url ?? '',
          headers: { ...server.headers },
          command: server.command ?? '',
          args: server.args ?? '',
          env: { ...server.env },
        }
      })
    },
    closeEditor: () => { store.update((draft) => { draft.editing = null }) },
    dismissNotice: () => { store.update((draft) => { draft.notice = null }) },
  }
}
