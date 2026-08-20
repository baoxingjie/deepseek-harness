/** The UniClaw 账号 settings page: the stored session, its plan, and logout. */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings shell's SlotMap merge into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AccountController, AccountState } from './account-store.ts'
import css from './AccountSection.module.css'

/** Registrant-private values the page reads from the apply closure. */
export interface AccountSectionInjected {
  controller: AccountController
  useSnapshot: SnapshotSelectorHook<AccountState>
}

export type AccountSectionProps = PropsRuntime<'settings.section'> & Partial<AccountSectionInjected>

/** Render the account page. */
export function AccountSection(props: AccountSectionProps): ReactNode {
  const { controller, useSnapshot } = props
  if (controller === undefined || useSnapshot === undefined) return null
  return <AccountSectionBody controller={controller} useSnapshot={useSnapshot} />
}

function AccountSectionBody({ controller, useSnapshot }: AccountSectionInjected): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  if (state.status === 'idle' || state.status === 'loading') return <div className={css.empty}>加载中…</div>
  if (state.status === 'error') return <div className={css.empty}>{state.error}</div>

  const session = state.session
  if (session === null || !session.loggedIn) {
    return <div className={css.empty}>未登录。重新加载页面即可回到登录界面。</div>
  }

  return (
    <div className={css.page}>
      <div className={css.row}>
        <div className={css.info}>
          <div className={css.label}>登录状态</div>
          <div className={css.hint}>凭据存在本机的 <code>~/.dsh/.credentials.yaml</code>，配置文件里只有引用</div>
        </div>
        <Pill active>已登录</Pill>
      </div>

      <div className={css.row}>
        <div className={css.info}>
          <div className={css.label}>套餐</div>
          <div className={css.hint}>模型目录随套餐刷新自动同步</div>
        </div>
        <span className={css.value}>{session.plan?.productName ?? '—'}</span>
      </div>

      <div className={css.row}>
        <div className={css.info}>
          <div className={css.label}>模型密钥</div>
          <div className={css.hint}>
            {session.appTokenConfigured
              ? '已下发，模型与 UniAI 工具集可用'
              : '账号暂无可用密钥，模型请求会失败；请先在 UniClaw 端开通套餐'}
          </div>
        </div>
        <Pill active={session.appTokenConfigured}>{session.appTokenConfigured ? '正常' : '缺失'}</Pill>
      </div>

      <div className={css.danger}>
        <div className={css.info}>
          <div className={css.label}>退出登录</div>
          <div className={css.hint}>
            清除本机凭据并清空 UniClaw 模型目录，带密钥的 MCP 服务器会一并断开；页面随后重新加载回到登录界面
          </div>
        </div>
        <Button disabled={state.signingOut} onClick={() => { void controller.signOut() }}>
          {state.signingOut ? '退出中…' : '退出登录'}
        </Button>
      </div>

      {state.error !== null && <div className={css.error}>{state.error}</div>}
    </div>
  )
}
