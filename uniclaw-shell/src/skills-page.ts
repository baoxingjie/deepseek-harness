/**
 * uniclaw-shell 技能页面 — `/uniclaw/skills` 的静态 HTML（一期，与登录页同风格）。
 *
 * Look ported from the UniClaw app's SkillsPage: 推荐 / 技能市场 / 已安装 tabs,
 * category chips, a card grid with initial badges, upload, toggle and delete.
 * Talks only to this plugin's `/api/uniclaw/skills/*` routes.
 */

export const SKILLS_PAGE_HTML = /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>技能 · 元景 UniClaw</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    color-scheme: light dark;
    --bg: #f9fafb; --panel: #ffffff; --text: #111827; --muted: #6b7280;
    --border: #e5e7eb; --chip: #f3f4f6; --chip-active: #111827; --chip-active-text: #ffffff;
    --primary: #2563eb; --primary-hover: #1d4ed8; --danger: #dc2626;
    --card-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111827; --panel: #1f2937; --text: #f9fafb; --muted: #9ca3af;
      --border: #374151; --chip: #273244; --chip-active: #f9fafb; --chip-active-text: #111827;
      --primary: #3b82f6; --primary-hover: #2563eb; --danger: #f87171;
      --card-shadow: none;
    }
  }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); }
  a { color: var(--primary); text-decoration: none; }

  .page { max-width: 1200px; margin: 0 auto; padding: 28px 32px 64px; }
  .topbar { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
  .topbar h1 { font-size: 22px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
  .topbar .crumbs { font-size: 13px; color: var(--muted); }
  .topbar .spacer { flex: 1; }
  .search {
    display: flex; align-items: center; gap: 8px; min-width: 260px;
    border: 1px solid var(--border); border-radius: 8px; background: var(--panel); padding: 8px 12px;
  }
  .search input { border: none; outline: none; background: transparent; color: var(--text); font-size: 14px; flex: 1; }
  .btn {
    border: none; border-radius: 8px; padding: 9px 16px; font-size: 14px; cursor: pointer;
    background: var(--primary); color: #fff; white-space: nowrap;
  }
  .btn:hover { background: var(--primary-hover); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }
  .btn.ghost:hover { background: var(--chip); }

  .tabs { display: flex; gap: 22px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
  .tab {
    padding: 10px 2px 12px; font-size: 15px; color: var(--muted); cursor: pointer;
    border-bottom: 2px solid transparent; display: flex; align-items: center; gap: 6px;
  }
  .tab.active { color: var(--text); font-weight: 600; border-bottom-color: var(--text); }
  .tab .count {
    font-size: 12px; background: var(--chip); border-radius: 10px; padding: 1px 8px; color: var(--muted);
  }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
  .chip {
    font-size: 13px; padding: 6px 14px; border-radius: 8px; background: var(--chip);
    color: var(--text); cursor: pointer; border: none;
  }
  .chip.active { background: var(--chip-active); color: var(--chip-active-text); }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
    padding: 18px; display: flex; flex-direction: column; gap: 10px; box-shadow: var(--card-shadow);
    min-height: 170px;
  }
  .card-head { display: flex; align-items: flex-start; justify-content: space-between; }
  .badge {
    width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; font-size: 16px; flex-shrink: 0; letter-spacing: 0.5px;
  }
  .card h3 { font-size: 15px; font-weight: 600; word-break: break-all; }
  .card .desc {
    font-size: 13px; color: var(--muted); line-height: 1.55; flex: 1;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .card .foot { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--muted); }
  .iconbtn {
    width: 32px; height: 32px; border-radius: 9px; border: 1px solid var(--border); background: var(--panel);
    color: var(--text); font-size: 18px; line-height: 1; cursor: pointer;
  }
  .iconbtn:hover { background: var(--chip); }
  .iconbtn:disabled { opacity: 0.5; cursor: default; }
  .installed-mark { font-size: 12px; color: var(--muted); border: 1px solid var(--border); border-radius: 9px; padding: 6px 10px; }

  .switch { position: relative; width: 38px; height: 22px; flex-shrink: 0; cursor: pointer; }
  .switch input { display: none; }
  .switch .track { position: absolute; inset: 0; border-radius: 11px; background: var(--chip); transition: background .15s; }
  .switch input:checked + .track { background: var(--primary); }
  .switch .knob {
    position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
    background: #fff; transition: left .15s; box-shadow: 0 1px 2px rgba(0,0,0,.25);
  }
  .switch input:checked ~ .knob { left: 18px; }

  .empty { color: var(--muted); font-size: 14px; padding: 48px 0; text-align: center; grid-column: 1 / -1; }
  .toast {
    position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
    background: var(--text); color: var(--bg); border-radius: 10px; padding: 10px 18px; font-size: 14px;
    opacity: 0; pointer-events: none; transition: opacity .2s; max-width: 80vw; z-index: 30;
  }
  .toast.show { opacity: 1; }

  .modal-mask {
    position: fixed; inset: 0; background: rgba(0,0,0,.45); display: none;
    align-items: center; justify-content: center; z-index: 20;
  }
  .modal-mask.show { display: flex; }
  .modal {
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
    width: min(720px, 92vw); max-height: 80vh; display: flex; flex-direction: column;
  }
  .modal header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); font-weight: 600; }
  .modal pre { padding: 16px 18px; overflow: auto; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<div class="page">
  <div class="topbar">
    <h1>&#x2ba1; 技能</h1>
    <span class="crumbs"><a href="/">工作台</a> · <a href="/uniclaw">账号</a></span>
    <span class="spacer"></span>
    <label class="search">&#128269;<input id="search" placeholder="搜索技能"></label>
    <button class="btn" id="uploadBtn">&#8682; 上传技能</button>
    <input type="file" id="uploadInput" accept=".zip,.skill" hidden>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="recommended">推荐</div>
    <div class="tab" data-tab="market">技能市场</div>
    <div class="tab" data-tab="installed">已安装 <span class="count" id="installedCount">0</span></div>
  </div>

  <div class="chips" id="chips"></div>
  <div class="grid" id="grid"><div class="empty">加载中…</div></div>
</div>

<div class="toast" id="toast"></div>
<div class="modal-mask" id="modalMask">
  <div class="modal">
    <header><span id="modalTitle"></span><button class="iconbtn" id="modalClose">&#10005;</button></header>
    <pre id="modalBody"></pre>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id)
const API = '/api/uniclaw/skills'
const PALETTE = ['#2563eb','#7c3aed','#ea580c','#16a34a','#dc2626','#0d9488','#d97706','#db2777','#4f46e5']

const state = {
  tab: 'recommended',
  category: 'all',
  search: '',
  recommended: null,   // items[]
  recCategories: [],
  market: null,        // items[]
  marketCategories: [],
  installed: [],       // InstalledSkill[]
  busy: new Set(),     // ids/names with an in-flight action
}

// ── helpers ──

async function api(path, opts) {
  const res = await fetch(API + path, opts)
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = body && body.detail
    if (detail && typeof detail === 'object' && detail.code === 'skill_conflict') {
      throw new Error('已存在同名技能「' + detail.name + '」，请先卸载后重试')
    }
    throw new Error(typeof detail === 'string' ? detail : ('请求失败: HTTP ' + res.status))
  }
  return body
}

let toastTimer = null
function toast(text) {
  $('toast').textContent = text
  $('toast').classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200)
}

function initials(name) {
  const segs = String(name || '?').split(/[^A-Za-z0-9]+/).filter(Boolean)
  let s
  if (segs.length >= 2) s = segs[0][0] + segs[1][0]
  else if (segs.length === 1) s = segs[0].slice(0, 2)
  else s = String(name).slice(0, 1)
  return s.toUpperCase()
}
function badgeColor(name) {
  let h = 0
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
function esc(text) {
  const div = document.createElement('div')
  div.textContent = text == null ? '' : String(text)
  return div.innerHTML
}
function matchesSearch(...fields) {
  const q = state.search.trim().toLowerCase()
  if (!q) return true
  return fields.some(f => String(f || '').toLowerCase().includes(q))
}

/** Installed lookup: meta.id → installed entry, plus dir-name lookup. */
function installedByMetaId(id) {
  return state.installed.find(s => s.meta && String(s.meta.id) === String(id))
}

// ── data loading ──

async function loadInstalled() {
  try {
    const data = await api('/installed')
    state.installed = data.skills || []
  } catch (e) { toast(e.message); state.installed = [] }
  $('installedCount').textContent = state.installed.length
}

async function ensureTabData() {
  if (state.tab === 'recommended' && state.recommended === null) {
    try {
      const [items, cats] = await Promise.all([api('/recommended/list'), api('/recommended/categories').catch(() => [])])
      state.recommended = normalizeList(items)
      state.recCategories = normalizeList(cats)
    } catch (e) { state.recommended = []; toast(e.message) }
  }
  if (state.tab === 'market' && state.market === null) {
    try {
      const [payload, cats] = await Promise.all([
        api('/market/list?category=all&page=1&page_size=100'),
        api('/market/categories').catch(() => []),
      ])
      state.market = normalizeList(payload && payload.list !== undefined ? payload.list : payload)
      state.marketCategories = normalizeList(cats)
    } catch (e) { state.market = []; toast(e.message) }
  }
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    for (const key of ['list', 'records', 'items']) {
      if (Array.isArray(payload[key])) return payload[key]
    }
  }
  return []
}

// ── rendering ──

function renderChips() {
  const chips = $('chips')
  if (state.tab === 'installed') { chips.innerHTML = ''; return }
  const cats = state.tab === 'recommended' ? state.recCategories : state.marketCategories
  let html = '<button class="chip' + (state.category === 'all' ? ' active' : '') + '" data-cat="all">全部</button>'
  for (const c of cats) {
    const id = esc(c.id != null ? c.id : c.name)
    html += '<button class="chip' + (state.category === String(c.id != null ? c.id : c.name) ? ' active' : '') + '" data-cat="' + id + '">' + esc(c.name) + '</button>'
  }
  chips.innerHTML = html
  for (const el of chips.querySelectorAll('.chip')) {
    el.onclick = () => { state.category = el.dataset.cat; render() }
  }
}

function cardShell(title, desc, footLeft, action) {
  return '<div class="card">'
    + '<div class="card-head">'
    + '<div style="display:flex;gap:12px;align-items:center;min-width:0">'
    + '<div class="badge" style="background:' + badgeColor(title) + '">' + esc(initials(title)) + '</div>'
    + '<h3>' + esc(title) + '</h3></div>'
    + action
    + '</div>'
    + '<div class="desc">' + esc(desc) + '</div>'
    + '<div class="foot"><span>' + esc(footLeft) + '</span></div>'
    + '</div>'
}

function renderCatalogCards(items, kind) {
  let html = ''
  for (const item of items) {
    const id = String(item.id != null ? item.id : item.name)
    const catId = String(item.category_id != null ? item.category_id : (item.category != null ? item.category : ''))
    if (state.category !== 'all' && catId !== state.category && String(item.category || '') !== state.category) continue
    if (!matchesSearch(item.name, item.description, item.provider)) continue
    const installed = installedByMetaId(id)
    const busy = state.busy.has(kind + ':' + id)
    const action = installed
      ? '<span class="installed-mark">已安装</span>'
      : '<button class="iconbtn install-btn" data-kind="' + kind + '" data-id="' + esc(id) + '" ' + (busy ? 'disabled' : '') + ' title="安装">' + (busy ? '…' : '+') + '</button>'
    html += cardShell(item.name || id, item.description || '', item.provider || '', action)
  }
  return html || '<div class="empty">没有匹配的技能</div>'
}

function renderInstalledCards() {
  let html = ''
  for (const s of state.installed) {
    if (!matchesSearch(s.name, s.description, s.dir)) continue
    const busy = state.busy.has('installed:' + s.dir)
    const displayName = (s.meta && s.meta.displayName) ? s.meta.displayName : s.name
    const action = '<div style="display:flex;gap:8px;align-items:center">'
      + '<label class="switch" title="' + (s.enabled ? '停用' : '启用') + '">'
      + '<input type="checkbox" class="toggle-box" data-dir="' + esc(s.dir) + '"' + (s.enabled ? ' checked' : '') + (busy ? ' disabled' : '') + '>'
      + '<span class="track"></span><span class="knob"></span></label>'
      + '<button class="iconbtn view-btn" data-dir="' + esc(s.dir) + '" title="查看 SKILL.md">&#128196;</button>'
      + '<button class="iconbtn del-btn" data-dir="' + esc(s.dir) + '" title="卸载" ' + (busy ? 'disabled' : '') + '>&#128465;</button>'
      + '</div>'
    const sourceLabel = { market: '技能市场', recommended: '推荐', upload: '上传', local: '本地' }[s.source] || s.source
    html += cardShell(displayName, s.description, sourceLabel + ' · ' + s.dir + (s.enabled ? '' : ' · 已停用'), action)
  }
  return html || '<div class="empty">还没有安装技能 — 到「推荐」或「技能市场」里挑一个，或上传 .zip/.skill 包</div>'
}

function render() {
  renderChips()
  const grid = $('grid')
  if (state.tab === 'recommended') grid.innerHTML = state.recommended === null ? '<div class="empty">加载中…</div>' : renderCatalogCards(state.recommended, 'recommended')
  else if (state.tab === 'market') grid.innerHTML = state.market === null ? '<div class="empty">加载中…</div>' : renderCatalogCards(state.market, 'market')
  else grid.innerHTML = renderInstalledCards()
  bindGridEvents()
}

function bindGridEvents() {
  for (const el of $('grid').querySelectorAll('.install-btn')) {
    el.onclick = () => install(el.dataset.kind, el.dataset.id)
  }
  for (const el of $('grid').querySelectorAll('.toggle-box')) {
    el.onchange = () => toggle(el.dataset.dir, el.checked)
  }
  for (const el of $('grid').querySelectorAll('.del-btn')) {
    el.onclick = () => removeSkill(el.dataset.dir)
  }
  for (const el of $('grid').querySelectorAll('.view-btn')) {
    el.onclick = () => viewSkill(el.dataset.dir)
  }
}

// ── actions ──

async function install(kind, id) {
  const key = kind + ':' + id
  state.busy.add(key); render()
  try {
    let result
    if (kind === 'recommended') {
      result = await api('/recommended/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    } else {
      const item = (state.market || []).find(s => String(s.id) === String(id))
      if (!item) throw new Error('技能不存在')
      result = await api('/market/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: String(item.id), name: item.name, download_url: item.download_url,
          provider: item.provider, category: item.category, icon_url: item.icon_url, clawhub_url: item.clawhub_url,
        }),
      })
    }
    toast('已安装「' + result.name + '」— 对话中即可通过 skill 工具使用')
    await loadInstalled()
  } catch (e) { toast(e.message) }
  finally { state.busy.delete(key); render() }
}

async function toggle(dir, enabled) {
  const key = 'installed:' + dir
  state.busy.add(key)
  try {
    await api('/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: dir, enabled }) })
    toast(enabled ? '已启用「' + dir + '」' : '已停用「' + dir + '」')
  } catch (e) { toast(e.message) }
  finally { state.busy.delete(key); await loadInstalled(); render() }
}

async function removeSkill(dir) {
  if (!confirm('确定卸载技能「' + dir + '」吗？技能文件将被删除。')) return
  const key = 'installed:' + dir
  state.busy.add(key); render()
  try {
    await api('/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: dir }) })
    toast('已卸载「' + dir + '」')
  } catch (e) { toast(e.message) }
  finally { state.busy.delete(key); await loadInstalled(); render() }
}

async function viewSkill(dir) {
  try {
    const data = await api('/content?name=' + encodeURIComponent(dir))
    $('modalTitle').textContent = dir + ' / SKILL.md'
    $('modalBody').textContent = data.content
    $('modalMask').classList.add('show')
  } catch (e) { toast(e.message) }
}

$('modalClose').onclick = () => $('modalMask').classList.remove('show')
$('modalMask').onclick = (e) => { if (e.target === $('modalMask')) $('modalMask').classList.remove('show') }

$('uploadBtn').onclick = () => $('uploadInput').click()
$('uploadInput').onchange = async function () {
  const file = this.files && this.files[0]
  this.value = ''
  if (!file) return
  toast('正在上传「' + file.name + '」…')
  try {
    const res = await fetch(API + '/upload?filename=' + encodeURIComponent(file.name), { method: 'POST', body: file })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const detail = body && body.detail
      if (detail && typeof detail === 'object' && detail.code === 'skill_conflict') throw new Error('已存在同名技能「' + detail.name + '」')
      throw new Error(typeof detail === 'string' ? detail : ('上传失败: HTTP ' + res.status))
    }
    toast('已安装「' + body.name + '」— 对话中即可通过 skill 工具使用')
    await loadInstalled()
    state.tab = 'installed'
    syncTabs()
    render()
  } catch (e) { toast(e.message) }
}

$('search').oninput = function () { state.search = this.value; render() }

function syncTabs() {
  for (const el of document.querySelectorAll('.tab')) {
    el.classList.toggle('active', el.dataset.tab === state.tab)
  }
}
for (const el of document.querySelectorAll('.tab')) {
  el.onclick = async () => {
    state.tab = el.dataset.tab
    state.category = 'all'
    syncTabs()
    render()
    await ensureTabData()
    render()
  }
}

;(async function boot() {
  await loadInstalled()
  await ensureTabData()
  render()
})()
</script>
</body>
</html>
`
