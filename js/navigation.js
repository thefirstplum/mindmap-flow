// =================== PAGE NAVIGATION / ROUTER ===================
const pages = { memo: '노트', calendar: '캘린더', ledger: '가계부' };
const subtitles = {
  memo: '메모와 마인드맵을 한 곳에서',
  calendar: '하루를 한눈에 — 일정·할 일·감정',
  ledger: '수입과 지출을 빠르게 기록하세요'
};
const pageIcons = {
  memo: '<span class="mi mi-sm">edit_note</span>',
  calendar: '<span class="mi mi-sm">calendar_month</span>',
  ledger: '<span class="mi mi-sm">account_balance_wallet</span>'
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
  // Refresh the sidebar tag tree so its active-row highlight matches the
  // page we just switched to (highlight only shows on the notes view).
  if (typeof renderMemoList === 'function') renderMemoList();

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

// The sidebar is always the expanded panel now (it hosts the calendar link +
// tag tree, Bear-style) — the `expanded` class is hardcoded in the HTML.
