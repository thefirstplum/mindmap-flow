// =================== PAGE NAVIGATION / ROUTER ===================
// 루틴 제거 (2026-06-05 사장님 결정)
const pages = { memo: '노트', mindmap: '마인드맵', calendar: '캘린더', ledger: '가계부', journal: '감정일기' };

// Header primary pill (mockup: + 새 노트 / + 노드 / + 일정 …)
const headerActions = {
  memo:     { label: '새 메모',     fn: () => (typeof createMemo === 'function' && createMemo()) },
  mindmap:  { label: '새 마인드맵', fn: () => (typeof createMindmap === 'function' && createMindmap()) },
  calendar: { label: '일정',        fn: () => {
    // 캘린더 페이지 헤더 + 버튼 — 모드별 분기
    const m = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'all';
    const gE = (typeof window.gcal !== 'undefined') && window.gcal.enabled;
    if (m === 'google' && gE) {
      // 현재 선택일 + 다음 정각 시간으로
      const k = (typeof calSelectedKey !== 'undefined') ? calSelectedKey : null;
      const now = new Date();
      const h = Math.min(22, Math.max(7, now.getHours() + 1));
      if (k && typeof openGCalNewEvent === 'function') { openGCalNewEvent(k, h, 0); return; }
    }
    if (m === 'all' && gE) {
      // 헤더에서 클릭 — 좌표 없으니 중앙 popup
      const x = window.innerWidth / 2;
      const y = window.innerHeight / 3;
      const now = new Date();
      const h = Math.min(22, Math.max(7, now.getHours() + 1));
      const totalMin = h * 60;
      if (typeof _openCalQuickPicker === 'function') { _openCalQuickPicker(x, y, h, 0, totalMin); return; }
    }
    if (typeof openTbModal === 'function') openTbModal('add');
  } },
  journal:  { label: '오늘',        fn: () => (typeof journalGoToday === 'function' && journalGoToday()) },
  ledger:   { label: '추가',        fn: () => { const a = document.getElementById('ledger-amount'); if (a) a.focus(); } },
};

// Header search-pill placeholder per page
const headerSearchPlaceholder = {
  memo:     '메모, 태그, 액션 검색…',
  mindmap:  '마인드맵 검색…',
  calendar: '일정 검색…',
  journal:  '일기 검색…',
  ledger:   '거래 검색…',
};

function applyHeaderForPage(page) {
  const pill = document.getElementById('header-action-pill');
  const label = document.getElementById('header-action-label');
  const ph = document.getElementById('header-search-placeholder');
  const a = headerActions[page];
  if (pill && label) {
    if (a) { pill.style.display = ''; label.textContent = a.label; }
    else { pill.style.display = 'none'; }
  }
  if (ph) ph.textContent = headerSearchPlaceholder[page] || '검색…';
}
window.headerPrimaryAction = function() {
  const a = headerActions[currentPage];
  if (a && typeof a.fn === 'function') a.fn();
};
// 태그 드로어 — 노트/마인드맵 페이지에서 우측 햄버거 클릭 시
window.toggleTagDrawer = function() {
  const drawer = document.getElementById('tag-drawer');
  const overlay = document.getElementById('tag-drawer-overlay');
  if (!drawer) return;
  const open = drawer.classList.contains('show');
  if (open) { closeTagDrawer(); return; }
  // 사이드바의 태그 트리(#memo-tag-bar)를 드로어로 미러
  const src = document.getElementById('memo-tag-bar');
  const body = document.getElementById('tag-drawer-body');
  if (src && body) {
    body.innerHTML = '';
    const clone = src.cloneNode(true);
    clone.removeAttribute('id'); // 중복 방지
    body.appendChild(clone);
  }
  overlay?.classList.add('show');
  drawer.classList.add('show');
  // 클릭 후 자동 닫기 (한 번만 등록)
  if (!body.__tagDrawerHandlerAttached) {
    body.addEventListener('click', (e) => {
      if (e.target.closest('.tag-row, .tag-tree-header')) {
        setTimeout(closeTagDrawer, 120);
      }
    });
    body.__tagDrawerHandlerAttached = true;
  }
};
window.closeTagDrawer = function() {
  document.getElementById('tag-drawer')?.classList.remove('show');
  document.getElementById('tag-drawer-overlay')?.classList.remove('show');
};

window.openCommandPalette = window.openCommandPalette || (function() {
  // ⌘K 명령 팔레트 진입점이 다른 파일에 있을 수 있으니 fallback
  return function() {
    if (typeof openCmdK === 'function') openCmdK();
    else if (typeof toggleCommandPalette === 'function') toggleCommandPalette();
    else document.getElementById('memo-search')?.focus();
  };
})();

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
  // 모바일 하단 탭바 active 상태 동기화
  document.querySelectorAll('.m-tab-btn[data-page]').forEach(b =>
    b.classList.toggle('active', b.dataset.page === page));
  // memo·mindmap은 같은 DOM(#page-memo)를 공유 — 필터·헤더만 분기
  const domPage = (page === 'mindmap') ? 'memo' : page;
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === 'page-' + domPage));
  document.getElementById('page-title').textContent = pages[page];
  currentPage = page;
  applyHeaderForPage(page);
  // body에 페이지별 클래스 — 헤더 우측 햄버거(태그 드로어) 노출 조건 등
  Object.keys(pages).forEach(p => document.body.classList.remove('page-' + p));
  document.body.classList.add('page-' + page);

  // memo/mindmap 분리: 페이지 진입 시 노트 타입 필터 강제
  if (page === 'mindmap') {
    if (typeof noteTypeFilter !== 'undefined' && noteTypeFilter !== 'mindmap') {
      noteTypeFilter = 'mindmap';
      try { localStorage.setItem('mindflow_note_type_filter', JSON.stringify('mindmap')); } catch {}
    }
  } else if (page === 'memo') {
    if (typeof noteTypeFilter !== 'undefined' && noteTypeFilter === 'mindmap') {
      noteTypeFilter = 'memo';
      try { localStorage.setItem('mindflow_note_type_filter', JSON.stringify('memo')); } catch {}
    }
  }

  if (page === 'calendar') {
    renderCalendar();
    renderCalDetail();
    // 'google' 또는 '전체' 모드면 보이는 주 일정 자동 fetch
    if (typeof window.gcal !== 'undefined' && window.gcal.enabled
        && (window.gcal.mode === 'google' || window.gcal.mode === 'all')) {
      if (typeof refreshGCalEventsForVisibleWeek === 'function') refreshGCalEventsForVisibleWeek();
    }
    // 토글 UI 활성 표시 복원
    if (typeof window.gcal !== 'undefined') {
      const mode = window.gcal.mode;
      document.querySelectorAll('.cal-mode-seg button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
    }
  }
  if (page === 'memo' || page === 'mindmap') {
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

// 모바일 하단 탭바 클릭 → 페이지 전환
document.querySelectorAll('.m-tab-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    navigateTo(btn.dataset.page);
  });
});

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

// =================== KEYBOARD SHORTCUTS ===================
// Power-user shortcuts. Standardize on Cmd (macOS) / Ctrl (others) via metaKey||ctrlKey.
// Input-context guards prevent shortcuts from breaking text input.
document.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  const ae = document.activeElement;
  const inInput = ae && (
    ae.tagName === 'INPUT' ||
    ae.tagName === 'TEXTAREA' ||
    ae.isContentEditable ||
    (ae.closest && ae.closest('.cm-editor'))
  );

  // ⌘K — 명령 팔레트 (어디서든)
  if (meta && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (typeof openCmdPalette === 'function') openCmdPalette();
    return;
  }
  // ⌘N — 새 메모 (어디서든)
  if (meta && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    if (typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
    if (typeof createMemo === 'function') createMemo();
    return;
  }
  // ⌘F — 메모 검색 포커스
  if (meta && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    const search = document.getElementById('memo-search');
    if (search) {
      e.preventDefault();
      if (typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
      search.focus();
      search.select();
      return;
    }
  }
  // 아래는 입력 중이 아닐 때만
  if (inInput) return;

  // ↑/↓ — 메모 목록 순회 (메모 페이지에서만)
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && currentPage === 'memo') {
    if (typeof navigateMemoList === 'function') {
      e.preventDefault();
      navigateMemoList(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
  }
  // ⌘P — 현재 메모 핀 토글
  if (meta && (e.key === 'p' || e.key === 'P')) {
    if (typeof activeMemoId !== 'undefined' && activeMemoId != null && currentPage === 'memo') {
      e.preventDefault();
      togglePinNote('memo', activeMemoId);
      return;
    }
  }
  // ⌘⌫ — 현재 메모 삭제
  if (meta && (e.key === 'Backspace' || e.key === 'Delete')) {
    if (typeof activeMemoId !== 'undefined' && activeMemoId != null && currentPage === 'memo') {
      e.preventDefault();
      deleteMemo(activeMemoId);
      return;
    }
  }
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
