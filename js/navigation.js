// =================== PAGE NAVIGATION / ROUTER ===================
const pages = { calendar: '캘린더', timeblock: '타임블록', memo: '노트', journal: '감정일기', ledger: '가계부' };
const subtitles = {
  calendar: '하루를 한눈에 — 일정과 감정',
  timeblock: '하루를 블록 단위로 계획하세요',
  memo: '메모와 마인드맵을 한 곳에서',
  journal: '오늘의 감정을 솔직하게 기록하세요',
  ledger: '수입과 지출을 빠르게 기록하세요'
};
const pageIcons = {
  calendar: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  timeblock: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  memo: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  journal: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9.5" r="0.7" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="0.7" fill="currentColor" stroke="none"/></svg>',
  ledger: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'
};

function setHeaderIcon(page) {
  document.getElementById('header-icon').innerHTML = pageIcons[page] || '';
}
setHeaderIcon('calendar');

// Current route — single source of truth for which page is showing.
let currentPage = 'calendar';

// Central router. All page switching — sidebar clicks, programmatic jumps,
// hash restoration — funnels through here so behaviour stays consistent.
function navigateTo(page, opts) {
  opts = opts || {};
  if (!pages[page]) page = 'calendar';
  // Honour settings that hide a tab (e.g. ledger disabled)
  const navBtn = document.querySelector(`.sidebar .nav-btn[data-page="${page}"]`);
  if (navBtn && navBtn.style.display === 'none') page = 'calendar';

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
  if (page === 'timeblock') renderTimeBlocks();
  if (page === 'journal') { renderJournalDate(); renderJournalEditor(); renderJournalList(); showJournalDetail(); }
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
  btn.addEventListener('click', () => navigateTo(btn.dataset.page));
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
  if (pages[page] && page !== 'calendar') navigateTo(page, { updateHash: false });
}

// Wrap in arrow so the reference is resolved at click time — sync.js loads
// after navigation.js, so a bare reference to openSyncModal here would
// throw ReferenceError and abort the rest of this file.
document.getElementById('sync-btn').addEventListener('click', () => openSyncModal());

// Programmatic page navigation (used by ledger summary card on timeblock)
function goToLedger() {
  const btn = document.querySelector('.sidebar .nav-btn[data-page="ledger"]');
  if (btn && btn.style.display !== 'none') navigateTo('ledger');
}

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
