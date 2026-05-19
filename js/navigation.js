// =================== PAGE NAVIGATION / ROUTER ===================
const pages = { memo: '노트', calendar: '캘린더', ledger: '가계부' };
const subtitles = {
  memo: '메모와 마인드맵을 한 곳에서',
  calendar: '하루를 한눈에 — 일정·할 일·감정',
  ledger: '수입과 지출을 빠르게 기록하세요'
};
const pageIcons = {
  memo: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  calendar: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  ledger: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'
};

function setHeaderIcon(page) {
  document.getElementById('header-icon').innerHTML = pageIcons[page] || '';
}
setHeaderIcon('memo');

// Current route — single source of truth for which page is showing.
let currentPage = 'memo';

// Central router. All page switching — sidebar clicks, programmatic jumps,
// hash restoration — funnels through here so behaviour stays consistent.
function navigateTo(page, opts) {
  opts = opts || {};
  if (!pages[page]) page = 'memo';
  // Honour settings that hide a tab (e.g. ledger disabled)
  const navBtn = document.querySelector(`.sidebar .nav-btn[data-page="${page}"]`);
  if (navBtn && navBtn.style.display === 'none') page = 'memo';

  document.querySelectorAll('.sidebar .nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === 'page-' + page));
  document.getElementById('page-title').textContent = pages[page];
  document.getElementById('page-subtitle').textContent = subtitles[page];
  setHeaderIcon(page);
  currentPage = page;

  if (page === 'calendar') { renderCalendar(); renderCalDetail(); }
  if (page === 'memo') {
    // The notes page hosts the mindmap canvas — if a mindmap note is open,
    // its canvas needs a resize once this page becomes visible.
    if (typeof resizeCanvas === 'function') requestAnimationFrame(resizeCanvas);
  }
  if (page === 'ledger') {
    renderLedger();
    // iOS Safari only opens the keyboard if focus happens SYNCHRONOUSLY
    // inside a user-gesture handler. setTimeout breaks that chain — so
    // focus directly here (the page is already display:flex by now).
    const amt = document.getElementById('ledger-amount');
    if (amt) {
      amt.focus();
      try { amt.click(); } catch {}
    }
  }

  // Keep the URL hash in sync so a reload restores the same page.
  // replaceState (not pushState) — we don't want every tab switch in history.
  if (opts.updateHash !== false) {
    const h = '#' + page;
    if (location.hash !== h) {
      try { history.replaceState(null, '', h); } catch {}
    }
  }
}

document.querySelectorAll('.sidebar .nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    navigateTo(btn.dataset.page);
    closeMobileSidebar();
  });
});

// React to manual hash edits / external links. replaceState above does NOT
// fire hashchange, so this only runs for genuine user-driven changes.
window.addEventListener('hashchange', () => {
  const page = location.hash.slice(1);
  if (pages[page] && page !== currentPage) navigateTo(page, { updateHash: false });
});

// Restore the route from the URL hash on first load. Deferred until all
// renderers exist — called from main.js after every module has loaded.
function initRoute() {
  const page = location.hash.slice(1);
  if (pages[page] && page !== 'memo') navigateTo(page, { updateHash: false });
}

// Wrap in arrow so the reference is resolved at click time — sync.js loads
// after navigation.js, so a bare reference to openSyncModal here would
// throw ReferenceError and abort the rest of this file.
document.getElementById('sync-btn').addEventListener('click', () => {
  openSyncModal();
  closeMobileSidebar();
});

// Programmatic page navigation (used by ledger summary card on timeblock)
function goToLedger() {
  const btn = document.querySelector('.sidebar .nav-btn[data-page="ledger"]');
  if (btn && btn.style.display !== 'none') navigateTo('ledger');
}

// =================== MOBILE SIDEBAR DRAWER ===================
// On mobile the sidebar is a slide-in drawer (no bottom tab bar). It's driven
// purely by the `drawer-open` class on <body> — CSS handles the rest.
function openMobileSidebar() { document.body.classList.add('drawer-open'); }
function closeMobileSidebar() { document.body.classList.remove('drawer-open'); }
function toggleMobileSidebar() { document.body.classList.toggle('drawer-open'); }
// Esc closes the drawer
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMobileSidebar();
});

// =================== BEAR-STYLE SIDEBAR (expand / collapse) ===================
// Desktop: the sidebar can be a wide labelled panel (Bear-style) or a thin
// icon rail. State persists. On mobile the sidebar is a bottom tab bar — the
// "expanded" class is harmless there (desktop-only CSS scopes the styling).
function applySidebarState() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  const collapsed = load('sidebar_collapsed', false);
  sb.classList.toggle('expanded', !collapsed);
  const toggle = document.getElementById('sidebar-toggle');
  if (toggle) {
    toggle.setAttribute('aria-label', collapsed ? '사이드바 펼치기' : '사이드바 접기');
  }
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  const nowExpanded = sb.classList.toggle('expanded');
  save('sidebar_collapsed', !nowExpanded);
  const toggle = document.getElementById('sidebar-toggle');
  if (toggle) {
    toggle.setAttribute('aria-label', nowExpanded ? '사이드바 접기' : '사이드바 펼치기');
  }
  // The mindmap canvas sizes itself to the available width — re-fit it
  // once the width transition has settled.
  if (typeof resizeCanvas === 'function') setTimeout(resizeCanvas, 200);
}

// Apply persisted state before first paint (this script is deferred, so it
// runs after HTML parse but before the page is painted → no flash).
applySidebarState();
