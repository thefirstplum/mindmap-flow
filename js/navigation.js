// =================== PAGE NAVIGATION / ROUTER ===================
const pages = { memo: '노트', calendar: '캘린더', routine: '루틴', ledger: '가계부' };
const subtitles = {
  memo: '메모와 마인드맵을 한 곳에서',
  calendar: '하루를 한눈에 — 일정·할 일·감정',
  routine: '오늘의 루틴 체크 + 시간별 알림',
  ledger: '수입과 지출을 빠르게 기록하세요'
};
const pageIcons = {
  memo: '<span class="mi mi-sm">edit_note</span>',
  calendar: '<span class="mi mi-sm">calendar_month</span>',
  routine: '<span class="mi mi-sm">fitness_center</span>',
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
  if (page === 'routine' && typeof renderRoutinePage === 'function') renderRoutinePage();
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

// =================== HISTORY-BASED BACK BUTTON ===================
// Android Chrome PWA's hardware back button + iOS standalone (no edge-swipe)
// otherwise just closes the app. We keep a single "sentinel" history entry —
// the first back press pops it; we intercept, close the topmost UI layer
// (action sheet → modal → theme picker → drawer → memo editor), and re-push
// the sentinel so subsequent backs can close more layers.
function _historyHasSentinel() {
  try { return history.state?.mf === 'sentinel'; } catch { return false; }
}
function _pushSentinel() {
  if (!_historyHasSentinel()) {
    try { history.pushState({ mf: 'sentinel' }, ''); } catch {}
  }
}
_pushSentinel();

function _closeTopLayer() {
  // Order = visual stacking (topmost first)
  const sheet = document.querySelector('.action-sheet.show');
  if (sheet) {
    sheet.classList.remove('show');
    document.querySelectorAll('.action-sheet-overlay.show').forEach(o => o.classList.remove('show'));
    return true;
  }
  const modal = document.querySelector('.modal-overlay.show');
  if (modal) {
    modal.classList.remove('show');
    return true;
  }
  const tp = document.getElementById('theme-picker-popup');
  if (tp && tp.classList.contains('show')) {
    if (typeof closeThemePicker === 'function') closeThemePicker();
    else tp.classList.remove('show');
    return true;
  }
  if (document.body.classList.contains('drawer-open')) {
    closeMobileSidebar();
    return true;
  }
  // Mobile: memo editor or mindmap canvas open → back to list
  const memoPage = document.getElementById('memo-page');
  if (memoPage && memoPage.classList.contains('show-editor') && window.innerWidth <= 768) {
    if (typeof backToList === 'function') backToList();
    return true;
  }
  return false;
}

window.addEventListener('popstate', () => {
  if (_closeTopLayer()) {
    // Re-push sentinel so user can keep pressing back to close more layers
    _pushSentinel();
  }
  // else: nothing to close — let the back propagate (PWA closes / browser back)
});

// =================== MOBILE MODAL DRAG-TO-DISMISS ===================
// Bottom-sheet modals show a grabber (.modal::before) and users instinctively
// swipe down to close — but the grabber was decorative. Wire actual gesture.
(function attachModalDragDismiss() {
  let dragging = false, modal = null, startY = 0, startTime = 0;
  function onStart(e) {
    if (window.innerWidth > 768) return; // bottom-sheet behaviour only on mobile
    const t = e.touches && e.touches[0];
    if (!t) return;
    const m = e.target.closest('.modal-overlay.show .modal');
    if (!m) return;
    // Don't intercept if touch starts inside an interactive input
    if (e.target.closest('input, textarea, select, button, [contenteditable="true"], .cm-editor')) return;
    // Only grab if the modal's own scroll is at the top — otherwise let it scroll
    if (m.scrollTop > 4) return;
    dragging = true; modal = m;
    startY = t.clientY; startTime = Date.now();
    modal.style.transition = 'none';
  }
  function onMove(e) {
    if (!dragging || !modal) return;
    const t = e.touches[0];
    const dy = t.clientY - startY;
    if (dy < 0) return; // upward = no-op
    modal.style.transform = `translateY(${dy}px)`;
    if (e.cancelable) e.preventDefault();
  }
  function onEnd(e) {
    if (!dragging || !modal) return;
    const t = (e.changedTouches && e.changedTouches[0]) || e;
    const dy = Math.max(0, (t.clientY || 0) - startY);
    const dt = Math.max(1, Date.now() - startTime);
    const vel = dy / dt; // px/ms
    const shouldClose = dy > 80 || vel > 0.4;
    modal.style.transition = 'transform 0.24s cubic-bezier(0.32,0.72,0.16,1)';
    if (shouldClose) {
      const overlay = modal.closest('.modal-overlay');
      modal.style.transform = 'translateY(100%)';
      setTimeout(() => {
        if (modal) modal.style.transform = '';
        if (overlay) overlay.classList.remove('show');
      }, 240);
    } else {
      modal.style.transform = '';
    }
    dragging = false; modal = null;
  }
  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
  document.addEventListener('touchcancel', onEnd);
})();
