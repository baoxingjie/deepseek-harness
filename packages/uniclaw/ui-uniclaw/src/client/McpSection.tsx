/**
 * The UniClaw MCP settings page: every builtin and custom MCP server, its
 * live mount state, and the editor for custom entries.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings shell's SlotMap merge into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { McpController, McpState } from './mcp-store.ts'
import type { McpDraft, McpServerView } from './api.ts'
import css from './McpSection.module.css'

/** Registrant-private values the page reads from the apply closure. */
export interface McpSectionInjected {
  controller: McpController
  useSnapshot: SnapshotSelectorHook<McpState>
}

export type McpSectionProps = PropsRuntime<'settings.section'> & Partial<McpSectionInjected>

/** Status text for one server row. */
function statusOf(server: McpServerView): { text: string; tone: 'ok' | 'wait' | 'off' } {
  if (!server.enabled) return { text: '已停用', tone: 'off' }
  if (server.requiresLogin) return { text: '待登录', tone: 'wait' }
  return server.mounted ? { text: '已挂载', tone: 'ok' } : { text: '未挂载', tone: 'wait' }
}

/** One editable key/value table (HTTP headers, or stdio env vars). */
function KeyValueRows(props: {
  rows: Record<string, string>
  onChange: (next: Record<string, string>) => void
}): ReactNode {
  const entries = Object.entries(props.rows)
  const replace = (index: number, key: string, value: string): void => {
    const next = entries.map((entry, i) => i === index ? [key, value] as const : entry)
    props.onChange(Object.fromEntries(next.filter(([k]) => k !== '')))
  }
  return (
    <>
      {entries.map(([key, value], index) => (
        <div key={index} className={css.kvRow}>
          <Input value={key} placeholder="Key" onChange={(e) => { replace(index, e.target.value, value) }} />
          <Input value={value} placeholder="Value" onChange={(e) => { replace(index, key, e.target.value) }} />
          <Button
            size="sm"
            aria-label="移除"
            onClick={() => { props.onChange(Object.fromEntries(entries.filter((_, i) => i !== index))) }}
          >
            ✕
          </Button>
        </div>
      ))}
      <div>
        <Button size="sm" onClick={() => { props.onChange({ ...props.rows, '': '' }) }}>+ 添加</Button>
      </div>
    </>
  )
}

/** The add/edit dialog for one custom server. */
function McpEditor(props: {
  draft: McpDraft
  busy: boolean
  onSave: (draft: McpDraft) => void
  onClose: () => void
}): ReactNode {
  const [draft, setDraft] = useState(props.draft)
  const http = draft.transport === 'streamable-http'
  const patch = (fields: Partial<McpDraft>): void => { setDraft(current => ({ ...current, ...fields })) }
  return (
    <Modal
      open
      onClose={props.onClose}
      title={props.draft.id === '' ? '添加 MCP 服务器' : '编辑 MCP 服务器'}
      closeLabel="关闭"
      footer={(
        <div className={css.formFoot}>
          <Button onClick={props.onClose}>取消</Button>
          <Button variant="primary" disabled={props.busy} onClick={() => { props.onSave(draft) }}>
            {props.busy ? '保存中…' : '保存并应用'}
          </Button>
        </div>
      )}
    >
      <div className={css.form}>
        <div className={css.field}>
          <span className={css.label}>类型</span>
          <div className={css.seg}>
            <button
              type="button"
              className={[css.segButton, http ? css.segButtonActive : ''].join(' ')}
              onClick={() => { patch({ transport: 'streamable-http' }) }}
            >
              HTTP
            </button>
            <button
              type="button"
              className={[css.segButton, http ? '' : css.segButtonActive].join(' ')}
              onClick={() => { patch({ transport: 'stdio' }) }}
            >
              Stdio
            </button>
          </div>
        </div>
        <div className={css.field}>
          <span className={css.label}>名称（模型侧工具命名空间）</span>
          <Input
            value={draft.name}
            placeholder="例如 context7（字母/数字/下划线/连字符）"
            onChange={(e) => { patch({ name: e.target.value }) }}
          />
        </div>
        {http ? (
          <>
            <div className={css.field}>
              <span className={css.label}>地址</span>
              <Input value={draft.url} placeholder="https://example.com/mcp" onChange={(e) => { patch({ url: e.target.value }) }} />
            </div>
            <div className={css.field}>
              <span className={css.label}>请求头</span>
              <KeyValueRows rows={draft.headers} onChange={(headers) => { patch({ headers }) }} />
            </div>
          </>
        ) : (
          <>
            <div className={css.field}>
              <span className={css.label}>命令</span>
              <Input value={draft.command} placeholder="npx" onChange={(e) => { patch({ command: e.target.value }) }} />
            </div>
            <div className={css.field}>
              <span className={css.label}>参数（空格分隔）</span>
              <Input
                value={draft.args}
                placeholder="-y @modelcontextprotocol/server-github"
                onChange={(e) => { patch({ args: e.target.value }) }}
              />
            </div>
            <div className={css.field}>
              <span className={css.label}>环境变量</span>
              <KeyValueRows rows={draft.env} onChange={(env) => { patch({ env }) }} />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/** Render the MCP servers page. */
export function McpSection(props: McpSectionProps): ReactNode {
  const { controller, useSnapshot } = props
  if (controller === undefined || useSnapshot === undefined) return null
  return <McpSectionBody controller={controller} useSnapshot={useSnapshot} />
}

function McpSectionBody({ controller, useSnapshot }: McpSectionInjected): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  if (state.status === 'loading') return <div className={css.empty}>加载中…</div>
  if (state.status === 'error') return <div className={css.empty}>{state.error}</div>

  return (
    <div className={css.page}>
      <div className={css.head}>
        <span className={css.blurb}>
          启用的服务器会把它的工具注册成 <code>mcp__服务器名__工具名</code>，对话里模型可直接调用。
        </span>
        <Button variant="primary" onClick={() => { controller.edit() }}>+ 添加</Button>
      </div>

      {state.notice !== null && (
        <div className={css.notice}>
          <span>{state.notice}</span>
          <Button size="sm" onClick={controller.dismissNotice}>知道了</Button>
        </div>
      )}

      <div className={css.list}>
        {state.servers.map((server) => {
          const status = statusOf(server)
          const busy = state.busy.includes(server.id)
          return (
            <div key={server.id} className={css.row}>
              <div className={css.info}>
                <div className={css.title}>
                  {server.name}
                  <Pill>{server.transport === 'stdio' ? 'Stdio' : 'HTTP'}</Pill>
                  {server.builtin && <Pill>内置</Pill>}
                  <Pill active={status.tone === 'ok'}>{status.text}</Pill>
                </div>
                <div className={css.sub}>{server.note}</div>
              </div>
              <div className={css.actions}>
                {!server.builtin && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => { controller.edit(server) }}>编辑</Button>
                    <Button size="sm" disabled={busy} onClick={() => { void controller.remove(server.id) }}>删除</Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant={server.enabled ? 'primary' : 'ghost'}
                  disabled={busy}
                  onClick={() => { void controller.toggle(server.id, !server.enabled) }}
                >
                  {server.enabled ? '已启用' : '已停用'}
                </Button>
              </div>
            </div>
          )
        })}
        {state.servers.length === 0 && <div className={css.empty}>暂无 MCP 服务器</div>}
      </div>

      {state.editing !== null && (
        <McpEditor
          key={state.editing.id}
          draft={state.editing}
          busy={state.busy.length > 0}
          onSave={(draft) => { void controller.save(draft) }}
          onClose={controller.closeEditor}
        />
      )}
    </div>
  )
}
