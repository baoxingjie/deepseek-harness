/**
 * UniClaw login, as the first onboarding step. It owns the gate: while no
 * session is stored the workbench stays behind this surface, and the step
 * completes itself the moment one exists — so a returning user never sees it.
 *
 * The markup mirrors the standalone /uniclaw page (itself a port of UniClaw's
 * LoginPage), so the gate keeps the product's own login look rather than the
 * settings design system: composite input groups, a bare logo header, and a
 * full-width primary button.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings shell's SlotMap merge into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { LoginController, LoginState } from './login-store.ts'
import css from './LoginOnboarding.module.css'

/** Registration-side dependencies of {@link LoginOnboarding}. */
export interface LoginOnboardingInjected {
  hooks: {
    /** Login form and session state. */
    login: SnapshotStore<LoginState>
  }
  controller: LoginController
}

/** Coordinator owner props plus this step's injected face. */
export type LoginOnboardingProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<LoginOnboardingInjected>

/**
 * Render the login gate until a session exists.
 * @param props - settings-shell owner state and login dependencies.
 * @returns the login surface, or null while the step decides or is finished.
 */
export function LoginOnboarding(props: LoginOnboardingProps): ReactNode {
  const { complete, openSection, controller, useLogin } = props
  const state = useLogin(snapshot => snapshot)
  const finished = useRef(false)
  const finish = useCallback((): void => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])

  useEffect(() => {
    if (state.status === 'idle') void controller.check()
  }, [controller, state.status])

  useEffect(() => {
    if (state.status === 'done') finish()
  }, [finish, state.status])

  // Deciding and finished both render nothing: the shell paints no chrome of
  // its own, so a returning user sees the workbench with no flash of a gate.
  if (state.status !== 'required' && state.status !== 'keyless') return null

  return (
    <OnboardingSurface>
      <div className={css.card}>
        <div className={css.header}>
          <img className={css.logo} src="/uniclaw/brand-logo.png" alt="元景 UniClaw" />
        </div>
        {state.status === 'keyless'
          ? <KeylessNotice controller={controller} openSection={openSection} />
          : <LoginForm state={state} controller={controller} />}
      </div>
    </OnboardingSurface>
  )
}

function LoginForm({ state, controller }: { state: LoginState; controller: LoginController }): ReactNode {
  const canSend = controller.canSendCode(state)
  const canSubmit = controller.phoneValid(state.phone) && state.smsCode.length === 6 && !state.submitting

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) void controller.submit() }}>
      <div className={css.status}>登录后自动同步你的套餐模型与 UniAI 工具集</div>

      <div className={css.field}>
        <div className={css.group}>
          <span className={css.addon}>+86</span>
          <input
            type="tel"
            className={css.input}
            value={state.phone}
            placeholder="请输入手机号"
            maxLength={11}
            autoComplete="tel"
            onChange={(e) => { controller.setPhone(e.target.value) }}
          />
        </div>
      </div>

      <div className={css.field}>
        <div className={css.group}>
          <input
            type="text"
            className={css.input}
            value={state.captchaCode}
            placeholder="请输入图形验证码"
            onChange={(e) => { controller.setCaptchaCode(e.target.value) }}
          />
          <div
            className={css.captcha}
            title="点击刷新"
            role="button"
            tabIndex={0}
            onClick={() => { void controller.refreshCaptcha() }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') void controller.refreshCaptcha() }}
          >
            {state.captcha === null
              ? <span className={css.captchaLoading}>加载中...</span>
              : <img src={state.captcha.b64s} alt="图形验证码" />}
          </div>
        </div>
      </div>

      <div className={css.field}>
        <div className={css.group}>
          <input
            type="text"
            className={css.input}
            value={state.smsCode}
            placeholder="请输入短信验证码"
            maxLength={6}
            autoComplete="one-time-code"
            onChange={(e) => { controller.setSmsCode(e.target.value) }}
          />
          <button
            type="button"
            className={css.sendBtn}
            disabled={!canSend}
            onClick={() => { void controller.sendCode() }}
          >
            {state.countdown > 0 ? `${String(state.countdown)}s后重发` : '发送验证码'}
          </button>
        </div>
      </div>

      {state.error !== null && <div className={css.error}>{state.error}</div>}

      <button type="submit" className={css.submit} disabled={!canSubmit}>
        {state.submitting ? '登录中...' : '登录'}
      </button>
    </form>
  )
}

function KeylessNotice(props: {
  controller: LoginController
  openSection: (id: string) => void
}): ReactNode {
  return (
    <>
      <div className={css.noticeTitle}>登录成功，但账号暂无可用密钥</div>
      <div className={css.status}>
        这个手机号没有生效中的 UniClaw 套餐，网关没有下发模型密钥。
        进入工作台后模型请求会因缺少凭据而失败，先在 UniClaw 端开通套餐，再回到设置里刷新。
      </div>
      <div className={css.actions}>
        <button
          type="button"
          className={css.submit}
          onClick={() => { props.controller.acknowledgeKeyless(); props.openSection('uniclaw-account') }}
        >
          查看账号状态
        </button>
        <button type="button" className={css.secondary} onClick={props.controller.acknowledgeKeyless}>
          先进工作台
        </button>
      </div>
    </>
  )
}
