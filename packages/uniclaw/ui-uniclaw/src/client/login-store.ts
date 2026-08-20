/**
 * Login onboarding store. The host owns the session — it stores the
 * credentials, materializes the model catalog, and mounts the key-bearing MCP
 * servers as part of answering `smsLogin` — so this holds only what the form
 * needs: the current captcha, the resend countdown, and the outcome.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { fetchCaptcha, readStatus, sendLoginCode, smsLogin, type Captcha } from './api.ts'

/** Seconds before a texted code can be requested again. */
const RESEND_SECONDS = 60

/** Login step snapshot. */
export interface LoginState {
  /**
   * `idle` before the first status read; `checking` during it. `required`
   * shows the form, `done` hands the step off, and `keyless` reports a login
   * that carried no model key — the one outcome the user must acknowledge.
   */
  status: 'idle' | 'checking' | 'required' | 'keyless' | 'done'
  phone: string
  captchaCode: string
  smsCode: string
  captcha: Captcha | null
  /** Seconds left before the code can be resent; 0 when it can. */
  countdown: number
  /** Whether a login request is in flight. */
  submitting: boolean
  /** Form-level failure text. */
  error: string | null
  /** Plan name from the stored session, shown after a completed login. */
  planName: string | null
}

function initial(): LoginState {
  return {
    status: 'idle',
    phone: '',
    captchaCode: '',
    smsCode: '',
    captcha: null,
    countdown: 0,
    submitting: false,
    error: null,
    planName: null,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The login step controller. */
export interface LoginController {
  store: SnapshotStore<LoginState>
  /** Read the stored login state; decides whether the step shows at all. */
  check: () => Promise<void>
  /** Load (or reload) the captcha challenge. */
  refreshCaptcha: () => Promise<void>
  setPhone: (phone: string) => void
  setCaptchaCode: (code: string) => void
  setSmsCode: (code: string) => void
  /** Request a texted login code, starting the resend countdown on success. */
  sendCode: () => Promise<void>
  /** Exchange the texted code for a session. */
  submit: () => Promise<void>
  /** Leave the keyless notice; the session stands, models will not work. */
  acknowledgeKeyless: () => void
  /** Whether the phone number is a plausible mainland mobile number. */
  canSendCode: (state: LoginState) => boolean
}

/** Build the login step controller. */
export function createLoginStore(): LoginController {
  const store = createSnapshotStore<LoginState>(initial())
  let timer: ReturnType<typeof setInterval> | undefined

  const startCountdown = (): void => {
    if (timer !== undefined) clearInterval(timer)
    store.update((draft) => { draft.countdown = RESEND_SECONDS })
    timer = setInterval(() => {
      const left = store.getSnapshot().countdown - 1
      store.update((draft) => { draft.countdown = Math.max(0, left) })
      if (left <= 0 && timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }, 1000)
  }

  const refreshCaptcha = async (): Promise<void> => {
    try {
      const captcha = await fetchCaptcha()
      store.update((draft) => { draft.captcha = captcha; draft.captchaCode = '' })
    } catch (error) {
      store.update((draft) => { draft.captcha = null; draft.error = messageOf(error) })
    }
  }

  return {
    store,
    check: async () => {
      store.update((draft) => { draft.status = 'checking' })
      try {
        const status = await readStatus()
        if (status.loggedIn) {
          store.update((draft) => {
            draft.status = 'done'
            draft.planName = status.plan?.productName ?? null
          })
          return
        }
      } catch {
        // An unreachable status route means an unknown session, and the form
        // is the only way forward — show it rather than blocking on the error.
      }
      store.update((draft) => { draft.status = 'required' })
      void refreshCaptcha()
    },
    refreshCaptcha,
    setPhone: (phone) => {
      store.update((draft) => { draft.phone = phone.replace(/\D/g, '').slice(0, 11) })
    },
    setCaptchaCode: (code) => { store.update((draft) => { draft.captchaCode = code }) },
    setSmsCode: (code) => {
      store.update((draft) => { draft.smsCode = code.replace(/\D/g, '').slice(0, 6) })
    },
    sendCode: async () => {
      const { phone, captchaCode, captcha } = store.getSnapshot()
      store.update((draft) => { draft.error = null })
      try {
        await sendLoginCode(phone, captchaCode.trim(), captcha?.captchaId ?? '')
        startCountdown()
      } catch (error) {
        store.update((draft) => { draft.error = messageOf(error) })
        // A spent challenge cannot be retried; issue a fresh one either way.
        void refreshCaptcha()
      }
    },
    submit: async () => {
      const { phone, smsCode } = store.getSnapshot()
      store.update((draft) => { draft.submitting = true; draft.error = null })
      try {
        const { hasKey } = await smsLogin(phone, smsCode)
        const status = await readStatus().catch(() => null)
        store.update((draft) => {
          draft.status = hasKey ? 'done' : 'keyless'
          draft.planName = status?.plan?.productName ?? null
        })
      } catch (error) {
        const message = messageOf(error)
        store.update((draft) => { draft.error = message })
        if (message.includes('验证码失效')) {
          store.update((draft) => { draft.smsCode = '' })
          void refreshCaptcha()
        }
      } finally {
        store.update((draft) => { draft.submitting = false })
      }
    },
    acknowledgeKeyless: () => { store.update((draft) => { draft.status = 'done' }) },
    canSendCode: state => /^1\d{10}$/.test(state.phone) && state.captchaCode.trim() !== '' && state.countdown === 0,
  }
}
