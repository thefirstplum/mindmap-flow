// =================== PAGE NAVIGATION ===================
const pages = { mindmap: '마인드맵', timeblock: '타임블록', memo: '메모', ledger: '가계부' };
const subtitles = {
  mindmap: '아이디어를 자유롭게 연결하세요',
  timeblock: '하루를 블록 단위로 계획하세요',
  memo: '생각을 자유롭게 기록하세요',
  ledger: '수입과 지출을 빠르게 기록하세요'
};
const pageIcons = {
  mindmap: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><line x1="9.5" y1="10.5" x2="5.5" y2="7.5"/><line x1="14.5" y1="10.5" x2="18.5" y2="7.5"/><line x1="9.5" y1="13.5" x2="5.5" y2="16.5"/><line x1="14.5" y1="13.5" x2="18.5" y2="16.5"/></svg>',
  timeblock: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  memo: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  ledger: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'
};

function setHeaderIcon(page) {
  document.getElementById('header-icon').innerHTML = pageIcons[page] || '';
}
setHeaderIcon('timeblock');

document.querySelectorAll('.sidebar .nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    document.querySelectorAll('.sidebar .nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    document.getElementById('page-title').textContent = pages[page];
    document.getElementById('page-subtitle').textContent = subtitles[page];
    setHeaderIcon(page);
    if (page === 'mindmap') resizeCanvas();
    if (page === 'timeblock') renderTimeBlocks();
    if (page === 'ledger') {
      renderLedger();
      // iOS Safari only opens the keyboard if focus happens SYNCHRONOUSLY
      // inside a user-gesture handler. setTimeout breaks that chain — so
      // focus directly here (the page is already display:flex by now).
      const amt = document.getElementById('ledger-amount');
      if (amt) {
        amt.focus();
        // Some iOS versions need a click to actually summon the keypad
        try { amt.click(); } catch {}
      }
    }
  });
});
document.getElementById('sync-btn').addEventListener('click', openSyncModal);

