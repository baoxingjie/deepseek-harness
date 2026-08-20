/**
 * Account settings page store: the stored session as the host reports it,
 * plus the logout write.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { logout, readStatus, type UniClawStatus } from './api.ts'

/** Page snapshot. */
export interface AccountState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  session: UniClawStatus | null
  /** Whether the logout request is in flight. */
  signingOut: boolean
}

function initial(): AccountState {
  return { status: 'idle', error: null, session: null, signingOut: false }
}

/** The account page controller. */
export interface AccountController {
  store: SnapshotStore<AccountState>
  load: () => Promise<void>
  /**
   * Drop the session, then reload the page. The login gate is an onboarding
   * step that already completed for this session, and the coordinator does
   * not re-run a completed step — a reload is what puts the gate back.
   */
  signOut: () => Promise<void>
}

/** Build the account page controller. */
export function createAccountStore(reload: () => void): AccountController {
  const store = createSnapshotStore<AccountState>(initial())

  const load = async (): Promise<void> => {
    store.update((draft) => { draft.status = draft.status === 'ready' ? 'ready' : 'loading' })
    try {
      const session = await readStatus()
      store.update((draft) => { draft.session = session; draft.status = 'ready'; draft.error = null })
    } catch (error) {
      store.update((draft) => {
        draft.status = 'error'
        draft.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    store,
    load,
    signOut: async () => {
      store.update((draft) => { draft.signingOut = true; draft.error = null })
      try {
        await logout()
        reload()
      } catch (error) {
        store.update((draft) => {
          draft.signingOut = false
          draft.error = error instanceof Error ? error.message : String(error)
        })
      }
    },
  }
}
