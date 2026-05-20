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

  // Keep the real array index alongside each block so edit/toggle hit the
  // right element even if the stored array isn't perfectly sorted.
  const blocks = (timeBlocks[key] || [])
    .map((b, origIdx) => ({ b, origIdx }))
    .sort((x, z) => x.b.start.localeCompare(z.b.start));
  const journal = journalEntries[key] || { mood:'', content:'' };

  // ── 요약 카드 ──
  let totalMin = 0;
  (timeBlocks[key] || []).forEach(b => {
    const dur = minutesFromTime(b.end) - minutesFromTime(b.start);
    if (dur > 0) totalMin += dur;
  });
  const blockCount = (timeBlocks[key] || []).length;
  const doneCount = (timeBlocks[key] || []).filter(b => b.done).length;
  const fmtDur = mm => mm >= 60 ? `${Math.floor(mm/60)}시간${mm%60 ? ' ' + (mm%60) + '분' : ''}` : `${mm}분`;
  let summaryHtml = '';
  if (blockCount > 0) {
    summaryHtml = `<div class="cal-summary">
      <div class="cal-summary-stat"><div class="v">${blockCount}</div><div class="l">블록</div></div>
      <div class="cal-summary-stat"><div class="v">${fmtDur(totalMin)}</div><div class="l">계획 시간</div></div>
      <div class="cal-summary-stat"><div class="v">${doneCount}/${blockCount}</div><div class="l">완료</div></div>
    </div>`;
  }

  // ── 타임블록 섹션 (투두 포함) ──
  let tbHtml = `<div class="cal-sec-head"><span>⏱ 타임블록</span>
    <button class="cal-add-btn" onclick="calAddBlock()">+ 상세 추가</button></div>`;
  if (blocks.length === 0) {
    tbHtml += `<div class="cal-empty-mini">계획된 블록이 없어요</div>`;
  } else {
    tbHtml += `<div class="cal-tb-list">` + blocks.map(({ b, origIdx }) => {
      const todos = b.todos || [];
      const todoDone = todos.filter(t => t.done).length;
      const todoHtml = todos.length
        ? `<div class="cal-tb-todos">` + todos.map((t, j) => `
            <div class="cal-tb-todo${t.done ? ' done' : ''}" onclick="event.stopPropagation();calToggleTodo(${origIdx},${j})">
              <span class="cal-tb-todo-check">${t.done ? '✓' : ''}</span>
              <span class="cal-tb-todo-text">${escapeHtml(t.text)}</span>
            </div>`).join('') + `</div>`
        : '';
      return `<div class="cal-tb-item${b.done ? ' done' : ''}" style="border-left-color:${tbHex(b.color)}">
        <div class="cal-tb-row" onclick="calEditBlock(${origIdx})">
          <button class="cal-tb-check" onclick="event.stopPropagation();calToggleBlock(${origIdx})">${b.done ? '✓' : ''}</button>
          <span class="cal-tb-time">${b.start}~${b.end}</span>
          <span class="cal-tb-title">${escapeHtml(b.title)}</span>
          ${todos.length ? `<span class="cal-tb-todo-badge">${todoDone}/${todos.length} ✓</span>` : ''}
        </div>
        ${todoHtml}
      </div>`;
    }).join('') + `</div>`;
  }
  // 빠른 추가 — 제목만 입력하면 바로 블록 생성
  tbHtml += `<div class="cal-quick-add">
    <input type="text" id="cal-quick-input" placeholder="제목 입력 후 Enter — 빠른 추가"
      onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault();calQuickAddBlock();}">
    <button onclick="calQuickAddBlock()">추가</button>
  </div>`;

  // ── 감정일기 섹션 ──
  let jHtml = `<div class="cal-sec-head"><span>📔 감정일기</span></div>`;
  jHtml += `<div class="cal-mood-row">` + MOODS.map(mo =>
    `<button class="cal-mood-btn${journal.mood === mo.e ? ' active' : ''}" onclick="calSetMood('${mo.e}')" title="${mo.l}">${mo.e}</button>`
  ).join('') + `</div>`;
  jHtml += `<textarea class="cal-journal-ta" id="cal-journal-ta" placeholder="오늘 하루를 기록해보세요..." oninput="calJournalInput()">${escapeHtml(journal.content || '')}</textarea>`;

  // ── 그날의 노트 ──
  let notesHtml = '';
  if (typeof getAllNotes === 'function') {
    const dayNotes = getAllNotes()
      .filter(n => dateKey(new Date(n.updatedAt || n.createdAt)) === key)
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    notesHtml = `<div class="cal-sec-head"><span><span class="mi mi-sm" style="vertical-align:-3px;margin-right:4px">edit_note</span>노트</span></div>`;
    if (dayNotes.length === 0) {
      notesHtml += `<div class="cal-empty-mini">이 날 작성한 노트가 없어요</div>`;
    } else {
      notesHtml += `<div class="cal-note-list">` + dayNotes.map(n =>
        `<div class="cal-note-item" onclick="calOpenNote('${n.type}', ${n.id})">
          <span class="cal-note-icon mi mi-sm">${n.type === 'mindmap' ? 'account_tree' : 'edit_note'}</span>
          <span class="cal-note-title">${escapeHtml(n.title) || '제목 없음'}</span>
        </div>`).join('') + `</div>`;
    }
  }

  el.innerHTML = summaryHtml
    + `<div class="cal-sec">${tbHtml}</div>`
    + `<div class="cal-sec">${jHtml}</div>`
    + (notesHtml ? `<div class="cal-sec">${notesHtml}</div>` : '');
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

// 블록 안의 투두 항목 체크 토글
function calToggleTodo(blockIdx, todoIdx) {
  const blocks = timeBlocks[calSelectedKey];
  const todo = blocks && blocks[blockIdx] && (blocks[blockIdx].todos || [])[todoIdx];
  if (!todo) return;
  todo.done = !todo.done;
  save('tb_blocks', timeBlocks);
  updateTbMeta(calSelectedKey);
  if (typeof renderTimeBlocks === 'function') renderTimeBlocks();
  renderCalDetail();
}

// 빠른 추가 — 제목만으로 블록 생성 (시작 시각은 자동 배치)
function calQuickAddBlock() {
  const input = document.getElementById('cal-quick-input');
  if (!input) return;
  const title = input.value.trim();
  if (!title) { toast('제목을 입력하세요'); return; }
  const key = calSelectedKey;
  if (!timeBlocks[key]) timeBlocks[key] = [];
  // 시작 시각: 마지막 블록의 끝, 없으면 현재 시각(06~22시로 클램프)
  let startMin;
  if (timeBlocks[key].length) {
    startMin = Math.min(23 * 60, Math.max(...timeBlocks[key].map(b => minutesFromTime(b.end))));
  } else {
    startMin = Math.min(22, Math.max(6, new Date().getHours())) * 60;
  }
  const endMin = Math.min(23 * 60 + 59, startMin + 60);
  const prefix = extractTbPrefix(title);
  const color = prefix ? getColorForPrefix(prefix) : 'yellow';
  timeBlocks[key].push({
    title, start: minsToTime(startMin), end: minsToTime(endMin),
    desc: '', color, done: false, todos: []
  });
  timeBlocks[key].sort((a, b) => a.start.localeCompare(b.start));
  save('tb_blocks', timeBlocks);
  updateTbMeta(key);
  input.value = '';
  if (typeof renderTimeBlocks === 'function') renderTimeBlocks();
  if (typeof renderTimeblockList === 'function') renderTimeblockList();
  renderCalendar();
  renderCalDetail();
  // 연속 추가가 편하도록 입력칸 다시 포커스
  setTimeout(() => { const i = document.getElementById('cal-quick-input'); if (i) i.focus(); }, 30);
}

// 상세 화면의 노트 항목 → 노트 페이지로 이동해 해당 노트 열기
function calOpenNote(type, id) {
  if (typeof navigateTo === 'function') navigateTo('memo');
  if (typeof selectNote === 'function') selectNote(type, id);
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
