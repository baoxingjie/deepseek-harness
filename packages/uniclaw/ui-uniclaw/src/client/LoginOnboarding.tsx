/**
 * UniClaw login, as the first onboarding step. It owns the gate: while no
 * session is stored the workbench stays behind this surface, and the step
 * completes itself the moment one exists — so a returning user never sees it.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'
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
        {state.status === 'keyless'
          ? <KeylessNotice state={state} controller={controller} openSection={openSection} />
          : <LoginForm state={state} controller={controller} />}
      </div>
    </OnboardingSurface>
  )
}

function LoginForm({ state, controller }: { state: LoginState; controller: LoginController }): ReactNode {
  const canSend = controller.canSendCode(state)
  const canSubmit = /^1\d{10}$/.test(state.phone) && state.smsCode.length === 6 && !state.submitting

  return (
    <>
      <div className={css.brand}>
        <img className={css.logo} src="/uniclaw/brand-logo.png" alt="" />
        <span className={css.title}>登录元景 UniClaw</span>
        <span className={css.subtitle}>登录后自动同步你的套餐模型与 UniAI 工具集</span>
      </div>

      <form
        className={css.form}
        onSubmit={(e) => { e.preventDefault(); if (canSubmit) void controller.submit() }}
      >
        <Input
          value={state.phone}
          placeholder="手机号"
          inputMode="numeric"
          autoComplete="tel"
          onChange={(e) => { controller.setPhone(e.target.value) }}
        />
        <div className={css.row}>
          <Input
            value={state.captchaCode}
            placeholder="图形验证码"
            onChange={(e) => { controller.setCaptchaCode(e.target.value) }}
          />
          <div
            className={css.captchaBox}
            title="点击刷新"
            role="button"
            tabIndex={0}
            onClick={() => { void controller.refreshCaptcha() }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') void controller.refreshCaptcha() }}
          >
            {state.captcha === null
              ? <span className={css.captchaHint}>加载中…</span>
              : <img src={state.captcha.b64s} alt="图形验证码" />}
          </div>
        </div>
        <div className={css.row}>
          <Input
            value={state.smsCode}
            placeholder="短信验证码"
            inputMode="numeric"
            autoComplete="one-time-code"
            onChange={(e) => { controller.setSmsCode(e.target.value) }}
          />
          <Button disabled={!canSend} onClick={() => { void controller.sendCode() }}>
            {state.countdown > 0 ? `${String(state.countdown)}s 后重发` : '发送验证码'}
          </Button>
        </div>

        {state.error !== null && <div className={css.error}>{state.error}</div>}

        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {state.submitting ? '登录中…' : '登录'}
        </Button>
      </form>
    </>
  )
}

function KeylessNotice(props: {
  state: LoginState
  controller: LoginController
  openSection: (id: string) => void
}): ReactNode {
  return (
    <>
      <div className={css.brand}>
        <span className={css.title}>登录成功，但账号暂无可用密钥</span>
        <span className={css.subtitle}>
          这个手机号没有生效中的 UniClaw 套餐，网关没有下发模型密钥。
          进入工作台后模型请求会因缺少凭据而失败，先在 UniClaw 端开通套餐，再回到设置里刷新。
        </span>
      </div>
      <div className={css.actions}>
        <Button
          variant="primary"
          onClick={() => { props.controller.acknowledgeKeyless(); props.openSection('uniclaw-skills') }}
        >
          打开设置
        </Button>
        <Button onClick={props.controller.acknowledgeKeyless}>先进工作台</Button>
      </div>
    </>
  )
}
