/**
 * The UniClaw 技能 settings page: the recommended catalog, the skill market,
 * and what is installed — install, switch, remove, upload, and read SKILL.md.
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings shell's SlotMap merge into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SkillsController, SkillsState, SkillsTab } from './skills-store.ts'
import type { CatalogSkillView, InstalledSkillView } from './api.ts'
import css from './SkillsSection.module.css'

/** Registrant-private values the page reads from the apply closure. */
export interface SkillsSectionInjected {
  controller: SkillsController
  useSnapshot: SnapshotSelectorHook<SkillsState>
}

export type SkillsSectionProps = PropsRuntime<'settings.section'> & Partial<SkillsSectionInjected>

const TABS: { id: SkillsTab; label: string }[] = [
  { id: 'recommended', label: '推荐' },
  { id: 'market', label: '技能市场' },
  { id: 'installed', label: '已安装' },
]

/** Whether any of `fields` contains the search text. */
function matches(search: string, ...fields: (string | undefined)[]): boolean {
  const query = search.trim().toLowerCase()
  if (query === '') return true
  return fields.some(field => (field ?? '').toLowerCase().includes(query))
}

/** Render the skills page. */
export function SkillsSection(props: SkillsSectionProps): ReactNode {
  const { controller, useSnapshot } = props
  if (controller === undefined || useSnapshot === undefined) return null
  return <SkillsSectionBody controller={controller} useSnapshot={useSnapshot} />
}

function SkillsSectionBody({ controller, useSnapshot }: SkillsSectionInjected): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!state.loaded) void controller.load()
  }, [controller, state.loaded])

  const catalog = state.tab === 'installed' ? null : state[state.tab]
  /** Catalog ids already installed, matched through each install record's source id. */
  const installedIds = new Set(state.installed.map(skill => skill.meta?.id).filter(id => id !== undefined))

  return (
    <div className={css.page}>
      <div className={css.toolbar}>
        <Input
          className={css.search ?? ''}
          value={state.search}
          placeholder="搜索技能"
          onChange={(e) => { controller.setSearch(e.target.value) }}
        />
        <Button variant="primary" onClick={() => fileInput.current?.click()}>上传技能</Button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,.skill"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file !== undefined) void controller.upload(file)
            e.target.value = ''
          }}
        />
      </div>

      <div className={css.tabs}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={[css.tab, state.tab === tab.id ? css.tabActive : ''].join(' ')}
            onClick={() => { controller.setTab(tab.id) }}
          >
            {tab.label}
            {tab.id === 'installed' && <Pill>{String(state.installed.length)}</Pill>}
          </button>
        ))}
      </div>

      {state.notice !== null && (
        <div className={css.notice}>
          <span>{state.notice}</span>
          <Button size="sm" onClick={controller.dismissNotice}>知道了</Button>
        </div>
      )}

      {catalog !== null && catalog.categories.length > 0 && (
        <div className={css.chips}>
          <Pill active={state.category === 'all'} onClick={() => { controller.setCategory('all') }}>全部</Pill>
          {catalog.categories.map(category => (
            <Pill
              key={category.id}
              active={state.category === category.id}
              onClick={() => { controller.setCategory(category.id) }}
            >
              {category.name}
            </Pill>
          ))}
        </div>
      )}

      <div className={css.grid}>
        {state.tab === 'installed'
          ? <InstalledCards state={state} controller={controller} />
          : <CatalogCards state={state} controller={controller} installedIds={installedIds} />}
      </div>

      {state.viewing !== null && (
        <Modal open onClose={controller.closeViewer} title={state.viewing.name} closeLabel="关闭">
          <div className={css.viewer}>{state.viewing.content}</div>
        </Modal>
      )}
    </div>
  )
}

function CatalogCards(props: {
  state: SkillsState
  controller: SkillsController
  installedIds: Set<string>
}): ReactNode {
  const { state, controller, installedIds } = props
  const source = state.tab === 'installed' ? 'recommended' : state.tab
  const catalog = state.tab === 'installed' ? null : state[state.tab]
  if (catalog === null || catalog.items === null) return <div className={css.empty}>加载中…</div>

  const visible = catalog.items.filter((item: CatalogSkillView) =>
    (state.category === 'all' || item.categoryId === state.category)
    && matches(state.search, item.name, item.description, item.provider))
  if (visible.length === 0) return <div className={css.empty}>没有匹配的技能</div>

  return (
    <>
      {visible.map(item => (
        <div key={item.id} className={css.card}>
          <div className={css.cardHead}>
            <span className={css.cardTitle}>{item.name}</span>
            <div className={css.cardActions}>
              {installedIds.has(item.id)
                ? <Pill>已安装</Pill>
                : (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={state.busy.includes(item.id)}
                    onClick={() => { void controller.install(source, item.id) }}
                  >
                    {state.busy.includes(item.id) ? '安装中…' : '安装'}
                  </Button>
                )}
            </div>
          </div>
          <div className={css.desc}>{item.description}</div>
          <div className={css.foot}><span>{item.provider}</span></div>
        </div>
      ))}
    </>
  )
}

function InstalledCards(props: { state: SkillsState; controller: SkillsController }): ReactNode {
  const { state, controller } = props
  const visible = state.installed.filter((skill: InstalledSkillView) =>
    matches(state.search, skill.name, skill.description, skill.dir))
  if (visible.length === 0) return <div className={css.empty}>还没有安装技能</div>

  return (
    <>
      {visible.map((skill) => {
        const busy = state.busy.includes(skill.dir)
        return (
          <div key={`${skill.source}:${skill.dir}`} className={css.card}>
            <div className={css.cardHead}>
              <span className={css.cardTitle}>{skill.meta?.displayName ?? skill.name}</span>
              <div className={css.cardActions}>
                <Button
                  size="sm"
                  variant={skill.enabled ? 'primary' : 'ghost'}
                  disabled={busy}
                  onClick={() => { void controller.toggle(skill.dir, !skill.enabled) }}
                >
                  {skill.enabled ? '已启用' : '已停用'}
                </Button>
              </div>
            </div>
            <div className={css.desc}>{skill.description}</div>
            <div className={css.foot}>
              <span>{skill.builtin === true ? '内置' : skill.source} · {skill.name}</span>
              <div className={css.cardActions}>
                <Button size="sm" onClick={() => { void controller.view(skill.dir) }}>查看</Button>
                {skill.builtin !== true && (
                  <Button size="sm" disabled={busy} onClick={() => { void controller.remove(skill.dir) }}>卸载</Button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
