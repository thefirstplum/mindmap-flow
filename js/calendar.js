// =================== CALENDAR (timeblock + journal 통합 뷰) ===================
// 월 달력 그리드 + 선택일 상세(그날 타임블록 + 감정일기).
// 타임블록은 기존 모달(openTbModal/editTbBlock/saveTbBlock)을 재활용하고,
// 일기는 journalEntries를 직접 읽고 쓴다. 의존: timeblock.js, journal.js.

let calViewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSelectedKey = dateKey(new Date());

// 타임블록 색상명 → hex (tb-modal 팔레트와 동일)
const TB_COLOR_HEX = {
  yellow:'#b58900', orange:'#cb4b16', red:'#dc322f', rose:'#e11d48',
  magenta:'#d33682', purple:'#7c3aed', violet:'#6c71c4', sky:'#0284c7',
  blue:'#268bd2', cyan:'#2aa198', teal:'#0d9488', green:'#859900',
  brown:'#92400e', slate:'#475569'
};
const tbHex = c => TB_COLOR_HEX[c] || TB_COLOR_HEX.yellow;

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  const label = document.getElementById('calendar-month-label');
  if (label) label.textContent = `${calViewMonth.getFullYear()}년 ${calViewMonth.getMonth()+1}월`;

  const year = calViewMonth.getFullYear();
  const month = calViewMonth.getMonth();
  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const todayKey = dateKey(new Date());

  let cells = '';
  // 이전 달 꼬리
  for (let i = startDow - 1; i >= 0; i--) {
    cells += `<div class="cal-cell is-muted"><div class="cal-daynum">${prevMonthDays - i}</div></div>`;
  }
  // 이번 달
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const key = dateKey(date);
    const blocks = timeBlocks[key] || [];
    const journal = journalEntries[key];
    const dow = date.getDay();
    const cls = [
      'cal-cell',
      key === todayKey ? 'is-today' : '',
      key === calSelectedKey ? 'is-selected' : '',
      dow === 0 ? 'is-sun' : '',
      dow === 6 ? 'is-sat' : '',
    ].filter(Boolean).join(' ');

    let dots = '';
    if (blocks.length) {
      const shown = blocks.slice(0, 4);
      dots = `<div class="cal-dots">${
        shown.map(b => `<span class="cal-dot" style="background:${tbHex(b.color)}"></span>`).join('')
      }${blocks.length > 4 ? `<span class="cal-more">+${blocks.length-4}</span>` : ''}</div>`;
    }
    const mood = (journal && journal.mood) ? `<span class="cal-mood">${journal.mood}</span>` : '';

    cells += `<div class="${cls}" onclick="calSelectDay('${key}')">
      <div class="cal-cell-top"><div class="cal-daynum">${d}</div>${mood}</div>
      ${dots}
    </div>`;
  }
  // 다음 달 머리 (6주 채움)
  const total = startDow + daysInMonth;
  const trailing = (7 - (total % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    cells += `<div class="cal-cell is-muted"><div class="cal-daynum">${i}</div></div>`;
  }
  grid.innerHTML = cells;
}

function renderCalDetail() {
  const el = document.getElementById('calendar-detail-body');
  if (!el) return;
  const key = calSelectedKey;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m-1, d);
  const titleEl = document.getElementById('calendar-detail-title');
  if (titleEl) {
    const isToday = key === dateKey(new Date());
    titleEl.innerHTML = `${m}월 ${d}일 <span class="cal-detail-dow">${dayNames[date.getDay()]}요일</span>`
      + (isToday ? '<span class="cal-detail-today">오늘</span>' : '');
  }

  const blocks = (timeBlocks[key] || []).slice().sort((a,b) => a.start.localeCompare(b.start));
  const journal = journalEntries[key] || { mood:'', content:'' };

  // ── 타임블록 섹션 ──
  let tbHtml = `<div class="cal-sec-head"><span>⏱ 타임블록</span>
    <button class="cal-add-btn" onclick="calAddBlock()">+ 추가</button></div>`;
  if (blocks.length === 0) {
    tbHtml += `<div class="cal-empty-mini">계획된 블록이 없어요</div>`;
  } else {
    tbHtml += `<div class="cal-tb-list">` + blocks.map((b, i) => `
      <div class="cal-tb-item${b.done ? ' done' : ''}" style="border-left-color:${tbHex(b.color)}" onclick="calEditBlock(${i})">
        <button class="cal-tb-check" onclick="event.stopPropagation();calToggleBlock(${i})">${b.done ? '✓' : ''}</button>
        <span class="cal-tb-time">${b.start}~${b.end}</span>
        <span class="cal-tb-title">${escapeHtml(b.title)}</span>
      </div>`).join('') + `</div>`;
  }

  // ── 감정일기 섹션 ──
  let jHtml = `<div class="cal-sec-head"><span>📔 감정일기</span></div>`;
  jHtml += `<div class="cal-mood-row">` + MOODS.map(mo =>
    `<button class="cal-mood-btn${journal.mood === mo.e ? ' active' : ''}" onclick="calSetMood('${mo.e}')" title="${mo.l}">${mo.e}</button>`
  ).join('') + `</div>`;
  jHtml += `<textarea class="cal-journal-ta" id="cal-journal-ta" placeholder="오늘 하루를 기록해보세요..." oninput="calJournalInput()">${escapeHtml(journal.content || '')}</textarea>`;

  el.innerHTML = `<div class="cal-sec">${tbHtml}</div><div class="cal-sec">${jHtml}</div>`;
}

// ── 네비게이션 ──
function calSelectDay(key) {
  calSelectedKey = key;
  renderCalendar();
  renderCalDetail();
  document.getElementById('calendar-page-root')?.classList.add('show-detail');
}
function calPrevMonth() { calViewMonth.setMonth(calViewMonth.getMonth() - 1); renderCalendar(); }
function calNextMonth() { calViewMonth.setMonth(calViewMonth.getMonth() + 1); renderCalendar(); }
function calGoToday() {
  const t = new Date();
  calViewMonth = new Date(t.getFullYear(), t.getMonth(), 1);
  calSelectedKey = dateKey(t);
  renderCalendar();
  renderCalDetail();
}
function calBackToGrid() {
  document.getElementById('calendar-page-root')?.classList.remove('show-detail');
}

// ── 타임블록 (기존 모달 재활용) ──
// 모달 저장 함수들은 전역 currentDate를 쓰므로 선택일로 동기화한다.
function _calSyncCurrentDate() {
  const [y, m, d] = calSelectedKey.split('-').map(Number);
  currentDate = new Date(y, m-1, d);
}
function calAddBlock() {
  _calSyncCurrentDate();
  const h = Math.min(22, Math.max(6, new Date().getHours()));
  openTbModal(h);
}
function calEditBlock(idx) {
  _calSyncCurrentDate();
  editTbBlock(calSelectedKey, idx);
}
function calToggleBlock(idx) {
  toggleTbDone(calSelectedKey, idx);  // renderTimeBlocks → _calRefreshHook
}

// ── 감정일기 (journalEntries 직접) ──
let _calJournalTimer = null;
function calSetMood(emoji) {
  const key = calSelectedKey;
  if (!journalEntries[key]) journalEntries[key] = { mood:'', content:'' };
  journalEntries[key].mood = journalEntries[key].mood === emoji ? '' : emoji;
  journalEntries[key].updatedAt = new Date().toISOString();
  if (!journalEntries[key].mood && !(journalEntries[key].content || '').trim()) delete journalEntries[key];
  save('journal_entries', journalEntries);
  if (typeof renderJournalList === 'function') renderJournalList();
  renderCalendar();
  renderCalDetail();
}
function calJournalInput() {
  clearTimeout(_calJournalTimer);
  _calJournalTimer = setTimeout(() => {
    const ta = document.getElementById('cal-journal-ta');
    if (!ta) return;
    const key = calSelectedKey;
    if (!journalEntries[key]) journalEntries[key] = { mood:'', content:'' };
    journalEntries[key].content = ta.value;
    journalEntries[key].updatedAt = new Date().toISOString();
    if (!journalEntries[key].mood && !journalEntries[key].content.trim()) delete journalEntries[key];
    save('journal_entries', journalEntries);
    if (typeof renderJournalList === 'function') renderJournalList();
    renderCalendar();  // 셀의 무드/표시 갱신 (textarea는 안 건드림)
  }, 600);
}

// timeblock.js가 블록을 저장/삭제하면 이 훅으로 캘린더를 갱신한다.
function _calRefreshHook() {
  const page = document.getElementById('page-calendar');
  if (!page || !page.classList.contains('active')) return;
  // 일기 입력 중이면 textarea를 다시 그리지 않도록 detail 갱신은 조건부
  const typingJournal = document.activeElement
    && document.activeElement.id === 'cal-journal-ta';
  renderCalendar();
  if (!typingJournal) renderCalDetail();
}

renderCalendar();
renderCalDetail();
