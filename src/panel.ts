/**
 * Side panel UI script.
 *
 * Two screens:
 *  1. Home  — org status + log list (auto-connected, auto-refresh)
 *  2. Viewer — full log analysis (tabs: Execution, Issues, Data, …)
 *             with a Back button to return to Home
 */

import type { ParsedLog } from './parser/types';
import { renderSummaryHeader }  from './components/SummaryHeader';
import { renderTransactions, renderTransactionCard, TX_SCROLL_BATCH } from './renderer/TransactionRenderer';
import { renderIssues }         from './renderer/IssuesRenderer';
import { renderData }           from './renderer/DataRenderer';
import { renderAutomation }     from './renderer/AutomationRenderer';
import { renderCallouts }       from './renderer/CalloutsRenderer';
import { renderDebug }          from './renderer/DebugRenderer';
import { renderLimits }         from './renderer/LimitsRenderer';
import { renderRaw }            from './renderer/RawRenderer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgIdentity {
  userId: string; userName: string; displayName: string;
  instanceUrl: string; orgId: string;
}

interface SerializedLogEntry {
  id: string; sizeBytes: number; lastModified: string;
  status: string; operation: string; application: string;
  durationMs: number; location: string;
}

// ── State ─────────────────────────────────────────────────────────────────────

type Screen = 'home' | 'viewer';

let _screen:       Screen    = 'home';
let _connected     = false;
let _identity:     OrgIdentity | null = null;
let _logs:         SerializedLogEntry[] = [];
let _loading       = false;
let _logError:     string | null = null;
let _openingLogId: string | null = null;
let _searchQuery   = '';
let _currentLog:   ParsedLog | null = null;
let _refreshTimer:    ReturnType<typeof setInterval> | null = null;
let _txObserver:      IntersectionObserver | null = null;
let _viewerAbort:     AbortController | null = null;

// ── Boot ──────────────────────────────────────────────────────────────────────

function boot(): void {
  render();
  attachGlobalListeners();

  // Listen for org status pushed from service worker
  chrome.runtime.onMessage.addListener((msg: Record<string, unknown>) => {
    if (msg.type === 'orgStatus') {
      _connected = !!msg.connected;
      _identity  = (msg.identity as OrgIdentity) ?? null;
      if (_screen === 'home') renderBody();
      if (_connected) { void fetchLogs(); startAutoRefresh(); }
    }
  });

  // Ask service worker for current status
  chrome.runtime.sendMessage({ type: 'getStatus' }, (res: { connected: boolean; identity: OrgIdentity | null }) => {
    if (chrome.runtime.lastError) return;
    _connected = res.connected;
    _identity  = res.identity;
    renderBody();
    if (_connected) { void fetchLogs(); startAutoRefresh(); }
  });
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function render(): void {
  document.getElementById('app')!.innerHTML = /* html */`
    <header class="home-header">
      <div class="header-lens-wrap">
        <svg class="header-lens-icon" viewBox="0 0 24 24" fill="none">
          <circle cx="10" cy="10" r="6.5" stroke="currentColor" stroke-width="1.6"/>
          <circle cx="10" cy="10" r="2.5" fill="currentColor" opacity="0.5"/>
          <line x1="15.2" y1="15.2" x2="21.5" y2="21.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="header-text-wrap">
        <span class="header-title">APEX</span>
        <span class="header-title header-title-accent">LOG LENS</span>
      </div>
      <div style="display:flex;gap:4px;margin-left:auto">
        <button class="btn btn-ghost btn-sm" id="btn-popout" style="display:none" title="Open in new tab">⤢</button>
        <button class="btn btn-ghost btn-sm" id="btn-back" style="display:none">← Back</button>
      </div>
    </header>
    <div id="panel-body"></div>
  `;
  renderBody();
}

function renderBody(): void {
  const body = document.getElementById('panel-body');
  if (!body) return;
  if (_screen === 'viewer' && _currentLog) {
    body.innerHTML = renderViewerScreen(_currentLog);
    setupViewer(_currentLog);
    document.getElementById('btn-back')!.style.display = '';
    document.getElementById('btn-popout')!.style.display = '';
  } else {
    _screen = 'home';
    body.innerHTML = renderHomeScreen();
    document.getElementById('btn-back')!.style.display = 'none';
    document.getElementById('btn-popout')!.style.display = 'none';
  }
}

// ── Home screen ───────────────────────────────────────────────────────────────

function renderHomeScreen(): string {
  if (!_connected) return renderDisconnected();
  return renderConnected();
}

function renderDisconnected(): string {
  return /* html */`
    <div class="connect-screen">
      <svg viewBox="0 0 48 48" fill="none" class="connect-cloud-icon">
        <path d="M36 20.12A12 12 0 1 0 20.49 34H36a8 8 0 0 0 0-16z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
        <line x1="24" y1="38" x2="24" y2="44" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="18" y1="44" x2="30" y2="44" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p class="connect-tagline">Open your Salesforce org in this tab to connect automatically.</p>
    </div>`;
}

function renderConnected(): string {
  const orgLabel = _identity?.displayName ?? _identity?.userName ?? 'Connected';
  const domain   = _identity?.instanceUrl
    ? new URL(_identity.instanceUrl).hostname.replace(/\.my\.salesforce\.com$/, '').replace(/\.$/, '')
    : '';

  const filtered = _logs.filter(l => {
    if (!_searchQuery) return true;
    const q = _searchQuery.toLowerCase();
    return l.operation.toLowerCase().includes(q) || l.application.toLowerCase().includes(q);
  });

  const listContent = _loading
    ? `<div class="list-loading"><div class="spinner"></div><span>Fetching logs…</span></div>`
    : _logError
    ? `<div class="list-error">⚠ ${escHtml(_logError)}</div>`
    : _logs.length === 0
    ? `<div class="list-empty"><span class="empty-icon">📋</span><p>No logs yet.<br>Run some Apex, then refresh.</p></div>`
    : filtered.length === 0
    ? `<div class="list-empty"><span class="empty-icon">🔍</span><p>No logs match.</p></div>`
    : filtered.map(renderLogItem).join('');

  const limitsBtn = _logs.length === 0 && !_loading && !_logError
    ? `<button class="btn btn-ghost btn-sm" id="btn-view-org-limits" style="margin:12px auto;display:flex;gap:6px;align-items:center">
         📊 View Org Limits
       </button>`
    : '';

  return /* html */`
    <div class="org-bar">
      <div class="org-info">
        <span class="org-dot"></span>
        <div class="org-text">
          <span class="org-name">${escHtml(orgLabel)}</span>
          ${domain ? `<span class="org-domain">${escHtml(domain)}</span>` : ''}
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" id="btn-disconnect" title="Disconnect">⏻</button>
    </div>
    <div class="log-toolbar">
      <input type="text" id="log-search" class="log-search" placeholder="Search logs…" value="${escHtml(_searchQuery)}"/>
      <button class="btn btn-ghost btn-icon-only" id="btn-refresh" title="Refresh" ${_loading ? 'disabled' : ''}>
        <span class="${_loading ? 'spin' : ''}">↻</span>
      </button>
    </div>
    <div class="log-list" id="log-list">${listContent}</div>
    ${limitsBtn}
    <div class="footer-note">Auto-refreshes every 30 s</div>`;
}

function renderLogItem(log: SerializedLogEntry): string {
  const isOpening = _openingLogId === log.id;
  const time      = relativeTime(new Date(log.lastModified));
  const size      = formatBytes(log.sizeBytes);
  const op        = log.operation.replace(/^Execute\s+/i, '').slice(0, 30) || log.application;
  const dot       = log.status === 'Success' ? 'dot-ok' : log.status === 'Skipped' ? 'dot-warn' : 'dot-err';

  return /* html */`
    <div class="log-item ${isOpening ? 'log-item-opening' : ''}"
         data-log-id="${escHtml(log.id)}" data-size="${log.sizeBytes}" role="button" tabindex="0">
      <span class="log-status-dot ${dot}"></span>
      <div class="log-item-body">
        <span class="log-op">${escHtml(op)}</span>
        <span class="log-meta">${escHtml(time)} · ${escHtml(size)} · ${log.durationMs}ms</span>
      </div>
      ${isOpening
        ? `<span class="log-open-spinner"><div class="spinner spinner-sm"></div></span>`
        : `<span class="log-chevron">›</span>`}
    </div>`;
}

// ── Viewer screen ─────────────────────────────────────────────────────────────

function renderViewerScreen(log: ParsedLog): string {
  const callCount  = log.transactions.flatMap(t => t.callouts).length;
  const dbgCount   = [...new Set(
    log.transactions.flatMap(t => t.debugStatements).map(d => `${d.lineNumber}-${d.message}`)
  )].length;

  const tabs = [
    { id: 'flow',       label: 'Execution',  icon: '⚡', badge: null,                    error: log.summary.errorCount > 0 },
    { id: 'issues',     label: 'Issues',     icon: '🚨', badge: log.summary.errorCount,  error: log.summary.errorCount > 0 },
    { id: 'data',       label: 'Data',       icon: '🗄', badge: null,                    error: false },
    { id: 'automation', label: 'Automation', icon: '⚙', badge: null,                    error: false },
    { id: 'limits',     label: 'Limits',     icon: '📊', badge: null,                    error: log.governorLimits.hasCritical },
    { id: 'callouts',   label: 'Callouts',   icon: '🌐', badge: callCount || null,       error: false },
    { id: 'debug',      label: 'Debug',      icon: '🐛', badge: dbgCount || null,        error: false },
    { id: 'raw',        label: 'Raw',        icon: '📄', badge: null,                    error: false },
  ];

  const tabBtns = tabs.map((t, i) => /* html */`
    <button class="tab-btn ${i === 0 ? 'active' : ''} ${t.error ? 'tab-has-errors' : ''}"
            data-tab="${t.id}" role="tab" aria-selected="${i === 0}">
      <span class="tab-icon">${t.icon}</span>
      <span class="tab-label">${t.label}</span>
      ${t.badge ? `<span class="tab-badge ${t.error ? 'tab-badge-error' : ''}">${t.badge}</span>` : ''}
    </button>`).join('');

  const tabPanes = tabs.map((t, i) => /* html */`
    <div id="tab-${t.id}" class="tab-pane ${i === 0 ? 'active' : 'hidden'}"></div>`).join('');

  return /* html */`
    <div class="sflog-app viewer-screen">
      <div id="summary-header"></div>
      <div class="tab-bar" role="tablist">${tabBtns}</div>
      <div class="tab-content">${tabPanes}</div>
    </div>`;
}

function setupViewer(log: ParsedLog): void {
  document.getElementById('summary-header')!.innerHTML = renderSummaryHeader(log);

  const renders: Record<string, () => string> = {
    flow:       () => renderTransactions(log),
    issues:     () => renderIssues(log),
    data:       () => renderData(log),
    automation: () => renderAutomation(log),
    limits:     () => renderLimits(log, !!_identity, _identity?.displayName ?? null),
    callouts:   () => renderCallouts(log),
    debug:      () => renderDebug(log),
    raw:        () => renderRaw(log),
  };

  const rendered = new Set<string>();
  function renderTab(id: string): void {
    if (rendered.has(id)) return;
    rendered.add(id);
    const el = document.getElementById(`tab-${id}`);
    if (el && renders[id]) el.innerHTML = renders[id]();
    if (id === 'flow') setupTxLazyLoad(log);
    if (id === 'limits' && _identity) fetchAndRenderOrgLimits();
  }

  // Auto-jump to issues if errors present
  const firstTab = log.summary.errorCount > 0 ? 'issues' : 'flow';
  renderTab(firstTab);
  switchTab(firstTab);

  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset['tab']!;
      renderTab(tab);
      switchTab(tab);
      if (tab === 'flow') setupTxLazyLoad(log);
    });
  });
}

function switchTab(tab: string): void {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = (btn as HTMLElement).dataset['tab'] === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    const active = pane.id === `tab-${tab}`;
    pane.classList.toggle('hidden', !active);
    pane.classList.toggle('active', active);
  });
}

// ── Lazy loading (same pattern as VS Code webview) ────────────────────────────

function setupTxLazyLoad(log: ParsedLog): void {
  _txObserver?.disconnect();
  const sentinel = document.getElementById('tx-sentinel') as HTMLElement | null;
  if (!sentinel) return;

  _txObserver = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    const next  = parseInt(sentinel.dataset['next'] ?? '20', 10);
    const batch = log.transactions.slice(next, next + TX_SCROLL_BATCH);
    if (batch.length === 0) { _txObserver?.disconnect(); sentinel.remove(); return; }

    const list = document.getElementById('tx-list');
    if (!list) return;
    batch.forEach((tx, i) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = renderTransactionCard(tx, next + i + 1);
      if (wrap.firstElementChild) list.appendChild(wrap.firstElementChild);
    });
    sentinel.dataset['next'] = String(next + batch.length);
    if (next + batch.length >= log.transactions.length) { _txObserver?.disconnect(); sentinel.remove(); }
  }, { rootMargin: '400px' });

  _txObserver.observe(sentinel);
}

// ── Event delegation ──────────────────────────────────────────────────────────

function attachGlobalListeners(): void {
  document.addEventListener('click', e => {
    const t = e.target as HTMLElement;

    if (t.closest('#btn-back')) {
      _screen = 'home';
      _currentLog = null;
      renderBody();
      return;
    }

    if (t.closest('#btn-popout') && _currentLog) {
      openLogInNewTab(_currentLog);
      return;
    }

    if (t.closest('#btn-view-org-limits')) {
      showOrgLimitsScreen();
      return;
    }

    if (t.closest('#btn-disconnect')) {
      chrome.runtime.sendMessage({ type: 'disconnect' });
      _connected = false; _identity = null; _logs = [];
      stopAutoRefresh();
      renderBody();
      return;
    }

    if (t.closest('#btn-refresh')) {
      void fetchLogs();
      return;
    }

    if (t.closest('#org-refresh-btn')) {
      const loading = document.getElementById('org-loading');
      const content = document.getElementById('org-content');
      if (loading) loading.style.display = '';
      if (content) { content.style.display = 'none'; content.innerHTML = ''; }
      fetchAndRenderOrgLimits();
      return;
    }

    // Log item click
    const logItem = t.closest<HTMLElement>('.log-item');
    if (logItem?.dataset['logId']) {
      _openingLogId = logItem.dataset['logId'];
      renderBody();
      chrome.runtime.sendMessage(
        { type: 'fetchLog', logId: logItem.dataset['logId'], sizeBytes: parseInt(logItem.dataset['size'] ?? '0', 10) },
        (res: { ok?: boolean; parsedLog?: ParsedLog; error?: string }) => {
          _openingLogId = null;
          if (res?.ok && res.parsedLog) {
            _currentLog = res.parsedLog;
            _screen     = 'viewer';
          } else {
            _logError = res?.error ?? 'Failed to open log';
          }
          renderBody();
          if (_screen === 'viewer') attachViewerListeners();
        }
      );
      return;
    }

    // Code quality card toggle
    const cqHeader = t.closest('[data-toggle-cq]') as HTMLElement | null;
    if (cqHeader) {
      cqHeader.closest('.cq-card')?.classList.toggle('cq-expanded');
      return;
    }

    // Viewer interactions
    handleViewerClick(e);
  });

  document.addEventListener('input', e => {
    if ((e.target as HTMLElement).id === 'log-search') {
      _searchQuery = ((e.target as HTMLInputElement).value ?? '').trim();
      renderBody();
    }
  });
}

function attachViewerListeners(): void {
  // Abort previous listener set to prevent accumulation across log opens
  _viewerAbort?.abort();
  _viewerAbort = new AbortController();
  const { signal } = _viewerAbort;

  // Phase pill expand/collapse
  document.addEventListener('click', e => {
    const pill = (e.target as HTMLElement).closest('.phase-pill') as HTMLElement | null;
    if (!pill) return;
    e.stopPropagation();
    const detail = document.getElementById(`phase-detail-${pill.dataset['phaseId']}`);
    if (detail) {
      const opening = !detail.classList.contains('pd-open');
      detail.classList.toggle('pd-open', opening);
      pill.classList.toggle('active', opening);
    }
  }, { signal });

  // Transaction card collapse
  document.addEventListener('click', e => {
    const header = (e.target as HTMLElement).closest('.tx-header') as HTMLElement | null;
    if (header) header.closest('.tx-card')?.classList.toggle('collapsed');
  }, { signal });

  // Flowchart / tree toggle
  document.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('.fc-toggle-btn') as HTMLElement | null;
    if (!btn) return;
    const view = btn.dataset['view'];
    document.querySelectorAll('.fc-toggle-btn').forEach(b => b.classList.remove('fc-toggle-active'));
    btn.classList.add('fc-toggle-active');
    const tree = document.getElementById('fc-tree-view');
    const flow = document.getElementById('fc-flow-view');
    if (tree) tree.style.display = view === 'flow' ? 'none' : '';
    if (flow) flow.style.display = view === 'flow' ? '' : 'none';
  }, { signal });

  // Search
  document.addEventListener('input', e => {
    const input = e.target as HTMLElement;
    if (input.id !== 'tx-search') return;
    const q = (input as HTMLInputElement).value.toLowerCase().trim();
    document.querySelectorAll<HTMLElement>('.tx-card').forEach(card => {
      card.classList.toggle('tx-hidden', !(!q || (card.dataset['searchText'] ?? '').toLowerCase().includes(q)));
    });
  }, { signal });
}

function handleViewerClick(e: MouseEvent): void {
  // Jump to line (no-op in Chrome — kept for future integration)
  const lineEl = (e.target as HTMLElement).closest('[data-line]') as HTMLElement | null;
  if (lineEl?.dataset['line']) {
    // Could open the raw tab or highlight
  }
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchLogs(): Promise<void> {
  _loading = true; _logError = null;
  if (_screen === 'home') renderBody();

  chrome.runtime.sendMessage({ type: 'fetchLogs' }, (res: { logs?: SerializedLogEntry[]; error?: string }) => {
    _loading = false;
    if (res?.logs)  { _logs = res.logs; }
    else            { _logError = res?.error ?? 'Failed to fetch logs'; }
    if (_screen === 'home') renderBody();
  });
}

function openLogInNewTab(log: ParsedLog): void {
  const logName = log.filePath.split('/').pop() ?? 'Apex Log';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escHtml(logName)}</title>
  <link rel="stylesheet" href="${chrome.runtime.getURL('styles/panel.css')}"/>
  <link rel="stylesheet" href="${chrome.runtime.getURL('styles/viewer.css')}"/>
</head>
<body>
  <div class="sflog-app" style="padding:16px;max-width:1200px;margin:0 auto">
    ${renderSummaryHeader(log)}
    <div class="tab-content" style="margin-top:16px">${renderTransactions(log)}</div>
  </div>
</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

function showOrgLimitsScreen(): void {
  const body = document.getElementById('panel-body');
  if (!body) return;
  body.innerHTML = /* html */`
    <div style="display:flex;flex-direction:column;height:100%">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" id="btn-limits-back">← Back</button>
        <span style="font-size:11px;font-weight:600;letter-spacing:0.08em;color:var(--fg-muted);text-transform:uppercase">Org Governor Limits</span>
      </div>
      <div style="flex:1;overflow-y:auto;padding:12px 14px">
        <div id="org-loading" class="org-loading" style="padding:24px 0;text-align:center;color:var(--fg-muted);font-size:12px">
          <div class="spinner" style="margin:0 auto 8px"></div>
          Loading org limits…
        </div>
        <div id="org-content" style="display:none"></div>
      </div>
    </div>`;

  document.getElementById('btn-limits-back')?.addEventListener('click', () => renderBody());
  fetchAndRenderOrgLimits();
}

function fetchAndRenderOrgLimits(): void {
  chrome.runtime.sendMessage({ type: 'fetchOrgLimits' }, (res: { limits?: { key: string; displayName: string; max: number; remaining: number; used: number; percentUsed: number; severity: string }[]; error?: string }) => {
    const loading = document.getElementById('org-loading');
    const content = document.getElementById('org-content');
    if (!loading || !content) return;
    loading.style.display = 'none';
    content.style.display = '';

    if (chrome.runtime.lastError || !res) {
      content.innerHTML = `<div class="list-error">⚠ ${escHtml(chrome.runtime.lastError?.message ?? 'No response from service worker')}</div>`;
      return;
    }
    if (res.error) {
      content.innerHTML = `<div class="list-error">⚠ ${escHtml(res.error)}</div>`;
      return;
    }
    const limits = res.limits ?? [];
    if (limits.length === 0) {
      content.innerHTML = `<p style="color:var(--fg-muted);font-size:12px;padding:8px 0">No limit data returned.</p>`;
      return;
    }
    content.innerHTML = `<div class="limits-grid">${limits.map(l => `
      <div class="limit-card limit-${l.severity}">
        <div class="limit-header">
          <span class="limit-icon">${l.severity === 'critical' ? '🚨' : l.severity === 'warning' ? '⚠' : '✅'}</span>
          <span class="limit-name">${escHtml(l.displayName)}</span>
        </div>
        <div class="limit-bar-track">
          <div class="limit-bar-fill limit-${l.severity}-fill" style="width:${Math.min(l.percentUsed, 100)}%"></div>
        </div>
        <div class="limit-footer">
          <span class="limit-used">${l.used.toLocaleString()} / ${l.max.toLocaleString()}</span>
          <span class="limit-percent">${l.percentUsed}%</span>
        </div>
      </div>`).join('')}</div>`;
  });
}

function startAutoRefresh(): void {
  stopAutoRefresh();
  _refreshTimer = setInterval(() => { if (_screen === 'home' && _connected) void fetchLogs(); }, 30_000);
}

function stopAutoRefresh(): void {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024*1024) return `${(b/1024).toFixed(0)}KB`;
  return `${(b/1024/1024).toFixed(1)}MB`;
}
function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s/60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

// ── Entry ─────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
