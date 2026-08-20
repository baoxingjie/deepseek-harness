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

  .mcp-head { display: flex; align-items: center; justify-content: space-between; margin: 36px 0 14px; }
  .mcp-head h2 { font-size: 17px; font-weight: 600; }
  .mcp-row {
    display: flex; align-items: center; gap: 14px; background: var(--panel);
    border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 10px;
  }
  .mcp-row .info { flex: 1; min-width: 0; }
  .mcp-row .title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
  .mcp-row .sub { font-size: 12px; color: var(--muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { font-size: 11px; padding: 2px 8px; border-radius: 6px; background: var(--chip); color: var(--muted); }
  .tag.ok { color: #16a34a; }
  .tag.warn { color: #d97706; }

  .form-body { padding: 16px 18px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
  .form-body label.f { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
  .form-body input[type=text] {
    width: 100%; border: 1px solid var(--border); border-radius: 8px; background: var(--bg);
    color: var(--text); padding: 9px 12px; font-size: 14px; outline: none;
  }
  .form-body input[type=text]:focus { border-color: var(--primary); }
  .seg { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; width: max-content; }
  .seg button { border: none; background: var(--panel); color: var(--muted); padding: 8px 26px; font-size: 14px; cursor: pointer; }
  .seg button.active { background: var(--chip); color: var(--text); font-weight: 600; }
  .kv-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .kv-row input { flex: 1; }
  .form-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 18px; border-top: 1px solid var(--border); }
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

  <div id="mcpSection" style="display:none">
    <div class="mcp-head">
      <h2>MCP 服务器</h2>
      <button class="btn ghost" id="mcpAddBtn">+ 添加 MCP 服务器</button>
    </div>
    <div id="mcpList"></div>
  </div>
</div>

<div class="toast" id="toast"></div>
<div class="modal-mask" id="modalMask">
  <div class="modal">
    <header><span id="modalTitle"></span><button class="iconbtn" id="modalClose">&#10005;</button></header>
    <pre id="modalBody"></pre>
  </div>
</div>

<div class="modal-mask" id="mcpFormMask">
  <div class="modal">
    <header><span id="mcpFormTitle">添加 MCP 服务器</span><button class="iconbtn" id="mcpFormClose">&#10005;</button></header>
    <div class="form-body">
      <div>
        <label class="f">类型</label>
        <div class="seg">
          <button type="button" id="segHttp" class="active">HTTP</button>
          <button type="button" id="segStdio">Stdio</button>
        </div>
      </div>
      <div>
        <label class="f">名称</label>
        <input type="text" id="mcpName" placeholder="例如 context7（字母/数字/下划线/连字符）">
      </div>
      <div id="httpFields">
        <label class="f">地址</label>
        <input type="text" id="mcpUrl" placeholder="https://example.com/mcp">
        <div style="margin-top:14px">
          <label class="f">请求头</label>
          <div id="headerRows"></div>
          <button type="button" class="btn ghost" id="addHeaderBtn" style="padding:5px 12px;font-size:13px">+ Add</button>
        </div>
      </div>
      <div id="stdioFields" style="display:none">
        <label class="f">命令</label>
        <input type="text" id="mcpCommand" placeholder="npx">
        <div style="margin-top:14px">
          <label class="f">参数（空格分隔）</label>
          <input type="text" id="mcpArgs" placeholder="-y @modelcontextprotocol/server-github">
        </div>
        <div style="margin-top:14px">
          <label class="f">环境变量</label>
          <div id="envRows"></div>
          <button type="button" class="btn ghost" id="addEnvBtn" style="padding:5px 12px;font-size:13px">+ Add</button>
        </div>
      </div>
    </div>
    <div class="form-foot">
      <button class="btn ghost" id="mcpFormCancel">取消</button>
      <button class="btn" id="mcpFormSave">保存并应用</button>
    </div>
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
  mcp: null,           // MCP servers (builtin + custom)
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
      + (s.builtin ? '' : '<button class="iconbtn del-btn" data-dir="' + esc(s.dir) + '" title="卸载" ' + (busy ? 'disabled' : '') + '>&#128465;</button>')
      + '</div>'
    const sourceLabel = { market: '技能市场', recommended: '推荐', upload: '上传', local: '本地', builtin: '内置' }[s.source] || s.source
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
  $('mcpSection').style.display = state.tab === 'installed' ? '' : 'none'
  if (state.tab === 'installed') renderMcp()
}

// ── MCP servers (builtin + custom) ──

async function loadMcp() {
  try {
    const data = await fetch('/api/uniclaw/mcp').then(r => r.json())
    state.mcp = (data && data.servers) || []
  } catch (e) { state.mcp = [] }
}

function mcpStatusTag(s) {
  if (!s.enabled) return '<span class="tag">已停用</span>'
  if (s.requiresLogin) return '<span class="tag warn">待登录</span>'
  if (s.mounted) return '<span class="tag ok">已挂载</span>'
  return '<span class="tag warn">未挂载</span>'
}

function renderMcp() {
  const list = $('mcpList')
  if (!state.mcp) { list.innerHTML = '<div class="empty">加载中…</div>'; return }
  let html = ''
  for (const s of state.mcp) {
    const busy = state.busy.has('mcp:' + s.id)
    html += '<div class="mcp-row">'
      + '<div class="badge" style="width:38px;height:38px;font-size:14px;background:' + badgeColor(s.name) + '">' + esc(initials(s.name)) + '</div>'
      + '<div class="info"><div class="title">' + esc(s.name)
      + ' <span class="tag">' + (s.transport === 'stdio' ? 'Stdio' : 'HTTP') + '</span>'
      + (s.builtin ? ' <span class="tag">内置</span>' : '')
      + ' ' + mcpStatusTag(s) + '</div>'
      + '<div class="sub">' + esc(s.note || '') + '</div></div>'
      + (s.builtin ? '' : '<button class="iconbtn mcp-edit" data-id="' + esc(s.id) + '" title="编辑">&#9998;</button>'
        + '<button class="iconbtn mcp-del" data-id="' + esc(s.id) + '" title="删除">&#128465;</button>')
      + '<label class="switch"><input type="checkbox" class="mcp-toggle" data-id="' + esc(s.id) + '"'
      + (s.enabled ? ' checked' : '') + (busy ? ' disabled' : '') + '><span class="track"></span><span class="knob"></span></label>'
      + '</div>'
  }
  list.innerHTML = html || '<div class="empty">暂无 MCP 服务器</div>'
  for (const el of list.querySelectorAll('.mcp-toggle')) {
    el.onchange = () => toggleMcp(el.dataset.id, el.checked)
  }
  for (const el of list.querySelectorAll('.mcp-del')) {
    el.onclick = () => deleteMcp(el.dataset.id)
  }
  for (const el of list.querySelectorAll('.mcp-edit')) {
    el.onclick = () => openMcpForm(state.mcp.find(s => s.id === el.dataset.id))
  }
}

async function toggleMcp(id, enabled) {
  state.busy.add('mcp:' + id)
  try {
    const res = await fetch('/api/uniclaw/mcp/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }) })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || '操作失败')
    toast(enabled ? '已启用，正在连接…' : '已停用')
  } catch (e) { toast(e.message) }
  finally { state.busy.delete('mcp:' + id); setTimeout(async () => { await loadMcp(); renderMcp() }, 800) }
}

async function deleteMcp(id) {
  const s = state.mcp.find(x => x.id === id)
  if (!confirm('确定删除 MCP 服务器「' + (s ? s.name : id) + '」吗？')) return
  try {
    const res = await fetch('/api/uniclaw/mcp/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || '删除失败')
    toast('已删除')
  } catch (e) { toast(e.message) }
  await loadMcp(); renderMcp()
}

// ── MCP add/edit form ──

let mcpFormId = ''
let mcpFormTransport = 'streamable-http'

function kvRow(container, key, value) {
  const row = document.createElement('div')
  row.className = 'kv-row'
  row.innerHTML = '<input type="text" class="kv-k" placeholder="Key"><input type="text" class="kv-v" placeholder="Value">'
    + '<button type="button" class="iconbtn" title="移除">&#10005;</button>'
  row.querySelector('.kv-k').value = key || ''
  row.querySelector('.kv-v').value = value || ''
  row.querySelector('button').onclick = () => row.remove()
  container.appendChild(row)
}

function readKvRows(container) {
  const out = {}
  for (const row of container.querySelectorAll('.kv-row')) {
    const k = row.querySelector('.kv-k').value.trim()
    const v = row.querySelector('.kv-v').value
    if (k) out[k] = v
  }
  return out
}

function setMcpTransport(t) {
  mcpFormTransport = t
  $('segHttp').classList.toggle('active', t === 'streamable-http')
  $('segStdio').classList.toggle('active', t === 'stdio')
  $('httpFields').style.display = t === 'streamable-http' ? '' : 'none'
  $('stdioFields').style.display = t === 'stdio' ? '' : 'none'
}

function openMcpForm(entry) {
  mcpFormId = entry ? entry.id : ''
  $('mcpFormTitle').textContent = entry ? '编辑 MCP 服务器' : '添加 MCP 服务器'
  $('mcpName').value = entry ? entry.name : ''
  $('mcpUrl').value = (entry && entry.url) || ''
  $('mcpCommand').value = (entry && entry.command) || ''
  $('mcpArgs').value = (entry && entry.args) || ''
  $('headerRows').innerHTML = ''
  $('envRows').innerHTML = ''
  for (const [k, v] of Object.entries((entry && entry.headers) || {})) kvRow($('headerRows'), k, v)
  for (const [k, v] of Object.entries((entry && entry.env) || {})) kvRow($('envRows'), k, v)
  setMcpTransport(entry ? entry.transport : 'streamable-http')
  $('mcpFormMask').classList.add('show')
}

$('segHttp').onclick = () => setMcpTransport('streamable-http')
$('segStdio').onclick = () => setMcpTransport('stdio')
$('addHeaderBtn').onclick = () => kvRow($('headerRows'))
$('addEnvBtn').onclick = () => kvRow($('envRows'))
$('mcpAddBtn').onclick = () => openMcpForm(null)
$('mcpFormClose').onclick = $('mcpFormCancel').onclick = () => $('mcpFormMask').classList.remove('show')
$('mcpFormMask').onclick = (e) => { if (e.target === $('mcpFormMask')) $('mcpFormMask').classList.remove('show') }

$('mcpFormSave').onclick = async function () {
  const payload = {
    id: mcpFormId,
    name: $('mcpName').value.trim(),
    transport: mcpFormTransport,
    url: $('mcpUrl').value.trim(),
    headers: readKvRows($('headerRows')),
    command: $('mcpCommand').value.trim(),
    args: $('mcpArgs').value.trim(),
    env: readKvRows($('envRows')),
  }
  try {
    const res = await fetch('/api/uniclaw/mcp/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || '保存失败')
    $('mcpFormMask').classList.remove('show')
    toast('已保存，正在连接…')
    setTimeout(async () => { await loadMcp(); renderMcp() }, 800)
    await loadMcp(); renderMcp()
  } catch (e) { toast(e.message) }
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
    if (state.tab === 'installed') await loadMcp()
    render()
  }
}

;(async function boot() {
  await Promise.all([loadInstalled(), loadMcp()])
  await ensureTabData()
  render()
})()
</script>
</body>
</html>
`
