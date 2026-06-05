// =================== CALENDAR (timeblock + journal 통합 뷰) ===================
// 월 달력 그리드 + 선택일 상세(그날 타임블록 + 감정일기).
// 타임블록은 기존 모달(openTbModal/editTbBlock/saveTbBlock)을 재활용하고,
// 일기는 journalEntries를 직접 읽고 쓴다. 의존: timeblock.js, journal.js.

let calViewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSelectedKey = dateKey(new Date());
let calWeekStart = _calStartOfWeek(new Date());  // 현재 주 일요일

// 타임블록 색상 → 이벤트 카드 컬러 클래스 매핑 (mockup 7색)
const TB_COLOR_HEX = {
  yellow:'#b58900', orange:'#cb4b16', red:'#dc322f', rose:'#e11d48',
  magenta:'#d33682', purple:'#7c3aed', violet:'#6c71c4', sky:'#0284c7',
  blue:'#268bd2', cyan:'#2aa198', teal:'#0d9488', green:'#859900',
  brown:'#92400e', slate:'#475569'
};
const tbHex = c => TB_COLOR_HEX[c] || TB_COLOR_HEX.yellow;
const TB_COLOR_CLASS = {
  yellow:'c-yellow', orange:'c-apricot', red:'c-coral', rose:'c-coral',
  magenta:'c-magenta', purple:'c-lavender', violet:'c-lavender', sky:'c-blue',
  blue:'c-blue', cyan:'c-blue', teal:'c-green', green:'c-green',
  brown:'c-apricot', slate:'c-lavender'
};
const tbColorClass = c => TB_COLOR_CLASS[c] || 'c-yellow';

// 주의 시작일 (일요일) 계산
function _calStartOfWeek(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay());
  r.setHours(0, 0, 0, 0);
  return r;
}
function _calAddDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

// 시각(HH:MM) → 분 (06:00 = 360)
function _timeToMin(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function renderCalendar() {
  _renderMiniCal();
  _renderWeekGrid();
  _renderSummary();
  _renderMobileCal();
}

// ===== 미니 월간 =====
function _renderMiniCal() {
  const grid = document.getElementById('mini-cal-grid');
  if (!grid) return;
  const title = document.getElementById('mini-cal-title');
  if (title) title.textContent = `${calViewMonth.getFullYear()}년 ${calViewMonth.getMonth()+1}월`;

  const year = calViewMonth.getFullYear();
  const month = calViewMonth.getMonth();
  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const todayKey = dateKey(new Date());

  const weekStartKey = dateKey(calWeekStart);
  const weekEndKey = dateKey(_calAddDays(calWeekStart, 6));
  const inWeek = k => k >= weekStartKey && k <= weekEndKey;

  let html = '';
  // 이전 달
  for (let i = startDow - 1; i >= 0; i--) {
    html += `<div class="mini-cal-cell other">${prevMonthDays - i}</div>`;
  }
  // 이번 달
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const key = dateKey(date);
    const has = (timeBlocks[key] || []).length > 0 || (journalEntries[key] && (journalEntries[key].mood || journalEntries[key].content));
    const cls = [
      'mini-cal-cell',
      key === todayKey ? 'today' : '',
      inWeek(key) ? 'in-week' : '',
      date.getDay() === 0 && inWeek(key) ? 'week-start' : '',
      date.getDay() === 6 && inWeek(key) ? 'week-end' : '',
      has ? 'has-event' : '',
    ].filter(Boolean).join(' ');
    html += `<div class="${cls}" onclick="calSelectDayMini('${key}')">${d}</div>`;
  }
  // 다음 달
  const total = startDow + daysInMonth;
  const trail = (7 - (total % 7)) % 7;
  for (let i = 1; i <= trail; i++) {
    html += `<div class="mini-cal-cell other">${i}</div>`;
  }
  grid.innerHTML = html;
}

// 미니월간 셀 클릭 → 그 주를 메인 뷰로
function calSelectDayMini(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  calSelectedKey = key;
  calWeekStart = _calStartOfWeek(date);
  renderCalendar();
}

// ===== 메인 주간 그리드 =====
function _renderWeekGrid() {
  const grid = document.getElementById('week-grid');
  if (!grid) return;
  const range = document.getElementById('week-range');
  const end = _calAddDays(calWeekStart, 6);
  if (range) {
    const fmt = d => `${(d.getMonth()+1).toString().padStart(2,'0')}월 ${d.getDate().toString().padStart(2,'0')}일`;
    range.textContent = `${fmt(calWeekStart)} — ${end.getDate().toString().padStart(2,'0')}일`;
  }

  const todayKey = dateKey(new Date());
  const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

  // 헤더
  let header = '<div class="wdh-cell wdh-time-spacer"></div>';
  for (let i = 0; i < 7; i++) {
    const d = _calAddDays(calWeekStart, i);
    const k = dateKey(d);
    const cls = [
      'wdh-cell',
      k === todayKey ? 'today' : '',
      i === 0 ? 'sun' : '',
      i === 6 ? 'sat' : '',
    ].filter(Boolean).join(' ');
    header += `<div class="${cls}">
      <div class="wdh-day-num">${d.getDate().toString().padStart(2,'0')}</div>
      <div class="wdh-day-name">${dows[i]}</div>
    </div>`;
  }

  // 시간 컬럼 (06:00 - 22:00, 17 슬롯, 60px/h)
  const START_H = 6, END_H = 22;
  let timeCol = '<div class="time-col">';
  for (let h = START_H; h <= END_H; h++) {
    timeCol += `<div class="time-slot">${h.toString().padStart(2,'0')}:00</div>`;
  }
  timeCol += '</div>';

  // 7개 day 컬럼
  let dayCols = '';
  for (let i = 0; i < 7; i++) {
    const date = _calAddDays(calWeekStart, i);
    const k = dateKey(date);
    const isToday = k === todayKey;
    const cls = [
      'day-col',
      isToday ? 'today' : '',
      (i === 0 || i === 6) ? 'weekend' : '',
    ].filter(Boolean).join(' ');
    let inner = '';
    for (let h = START_H; h <= END_H; h++) inner += '<div class="hour-line"></div>';

    // 캘린더 모드 — 'mine'(timeBlock) vs 'google'(gcal events). 같은 그리드 분기.
    const calMode = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'mine';
    if (calMode === 'google') {
      // Google 일정 — 이 날짜 안의 이벤트 그리기
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
      const dayEnd   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
      const evList = _gcalEventsInRange(dayStart, dayEnd);
      for (const ev of evList) {
        if (window.gcal.eventIsAllDay(ev)) {
          // 종일 이벤트는 상단 컬럼 가장 위 작은 chip로 (간단)
          inner += `<div class="event-card gcal-allday" style="top:0;height:22px;background:${window.gcal.eventColor(ev)}26;border-left:3px solid ${window.gcal.eventColor(ev)};" onclick="event.stopPropagation();openGCalEditor('${ev._calendarId}','${ev.id}')">
            <div class="ev-title">📅 ${_escapeHtml(ev.summary || '제목 없음')}</div>
          </div>`;
          continue;
        }
        const evStart = window.gcal.eventStart(ev);
        const evEnd = window.gcal.eventEnd(ev);
        const startMin = evStart.getHours() * 60 + evStart.getMinutes();
        const endMin = evEnd.getHours() * 60 + evEnd.getMinutes();
        const top = (startMin - START_H * 60) + 4;
        const height = Math.max(28, endMin - startMin - 4);
        if (top < -30 || top > (END_H - START_H + 1) * 60) continue;
        const bg = window.gcal.eventColor(ev);
        const startLabel = `${String(evStart.getHours()).padStart(2,'0')}:${String(evStart.getMinutes()).padStart(2,'0')}`;
        const endLabel   = `${String(evEnd.getHours()).padStart(2,'0')}:${String(evEnd.getMinutes()).padStart(2,'0')}`;
        inner += `<div class="event-card gcal-event" style="top:${top}px;height:${height}px;background:${bg}26;border-left:3px solid ${bg};color:var(--text);" onclick="event.stopPropagation();openGCalEditor('${ev._calendarId}','${ev.id}')">
          <div class="ev-title">${_escapeHtml(ev.summary || '제목 없음')}</div>
          <div class="ev-time">${startLabel} — ${endLabel}</div>
        </div>`;
      }
    } else {
      // 우리 타임블록
      const blocks = timeBlocks[k] || [];
      for (const b of blocks) {
        const startMin = _timeToMin(b.start);
        const endMin = _timeToMin(b.end);
        const top = (startMin - START_H * 60) + 4;  // padding 보정
        const height = Math.max(28, endMin - startMin - 4);
        if (top < 0 || top > (END_H - START_H + 1) * 60) continue;
        const colorClass = tbColorClass(b.color);
        inner += `<div class="event-card ${colorClass}" style="top:${top}px;height:${height}px;" onclick="event.stopPropagation();calEditBlockKey('${k}', ${blocks.indexOf(b)})">
          <div class="ev-title">${_escapeHtml(b.title || '제목 없음')}</div>
          <div class="ev-time">${b.start} — ${b.end}</div>
        </div>`;
      }
    }

    // 현재 시각 marker (오늘만)
    if (isToday) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (nowMin >= START_H * 60 && nowMin <= END_H * 60) {
        const top = nowMin - START_H * 60;
        inner += `<div class="now-pill" style="top:${top}px;">${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}</div>`;
        inner += `<div class="now-line" style="top:${top}px;"></div>`;
      }
    }
    dayCols += `<div class="${cls}" data-day-key="${k}" data-start-h="${START_H}" onclick="calGridEmptyClick(event)">${inner}</div>`;
  }

  grid.innerHTML = `
    <div class="week-day-header">${header}</div>
    <div class="week-body">${timeCol}${dayCols}</div>
  `;
}

// 빈 영역(시간 셀) 클릭 → 클릭 위치의 시간으로 새 타임블록 / Google 일정 추가
function calGridEmptyClick(ev) {
  if (ev.target.closest('.event-card')) return; // 카드 자체 클릭은 무시
  const col = ev.currentTarget;
  const rect = col.getBoundingClientRect();
  const startH = parseInt(col.dataset.startH || '6', 10);
  const y = ev.clientY - rect.top;
  // 60px / hour 기준 → 30분 단위 스냅
  const min = Math.max(0, Math.round(y / 30) * 30);
  const totalMin = startH * 60 + min;
  const h = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  calSelectedKey = col.dataset.dayKey;
  _calSyncCurrentDate();

  // Google 모드 → Google 이벤트 추가 모달
  const calMode = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'mine';
  if (calMode === 'google') {
    if (typeof openGCalNewEvent === 'function') {
      openGCalNewEvent(calSelectedKey, h, mm);
    }
    return;
  }

  // 내 일정 (타임블록) 모달
  if (typeof openTbModal === 'function') openTbModal(h);
  // 시작·종료 시각을 좀 더 정확하게 채워준다 (모달 이미 열린 뒤)
  setTimeout(() => {
    const s = document.getElementById('tb-start');
    const e = document.getElementById('tb-end');
    if (s) s.value = `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    if (e) {
      const endTotal = totalMin + 60;
      const eh = Math.min(23, Math.floor(endTotal / 60));
      const em = endTotal % 60;
      e.value = `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
    }
    document.getElementById('tb-title')?.focus();
  }, 30);
}

// Google 일정 — 한 날짜 안의 이벤트만 필터
function _gcalEventsInRange(dayStart, dayEnd) {
  if (typeof window.gcal === 'undefined') return [];
  const events = window.gcal.events || {};
  const out = [];
  for (const key in events) {
    const ev = events[key];
    const s = window.gcal.eventStart(ev);
    const e = window.gcal.eventEnd(ev);
    // 이 날짜 안에 겹침이라도 있으면 포함
    if (e >= dayStart && s <= dayEnd) out.push(ev);
  }
  return out;
}

// 캘린더 모드 변경 — 토글 클릭 핸들러
function setCalendarModeAndRefresh(mode) {
  if (typeof window.gcal === 'undefined') return;
  // 토글 활성 표시
  document.querySelectorAll('.cal-mode-seg button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  window.gcal.setMode(mode);
  if (mode === 'google') {
    if (!window.gcal.enabled) {
      toast('먼저 동기화 모달에서 Google Calendar 연동을 켜주세요', 'info');
      return;
    }
    // 현재 주의 이벤트 fetch
    refreshGCalEventsForVisibleWeek();
  } else {
    renderCalendar();
  }
}

// 보이는 주의 Google 이벤트 fetch + 다시 렌더
async function refreshGCalEventsForVisibleWeek() {
  if (typeof window.gcal === 'undefined' || !window.gcal.enabled) {
    renderCalendar();
    return;
  }
  try {
    const start = new Date(calWeekStart);
    start.setHours(0, 0, 0, 0);
    const end = _calAddDays(calWeekStart, 7);
    end.setHours(23, 59, 59);
    await window.gcal.fetchEvents(start, end);
  } catch (e) {
    console.warn('[GCal] week fetch failed:', e);
    if (e.status === 401 || e.status === 403) {
      toast('Google 인증이 만료됐어요. 동기화 버튼을 눌러주세요', 'error');
    } else {
      toast('Google 일정 가져오기 실패', 'error');
    }
  }
  renderCalendar();
}
window.refreshGCalEventsForVisibleWeek = refreshGCalEventsForVisibleWeek;
window.setCalendarModeAndRefresh = setCalendarModeAndRefresh;

function _escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function calEditBlockKey(key, idx) {
  calSelectedKey = key;
  currentDate = new Date(key);
  editTbBlock(key, idx);
}

// 주 네비게이션 (Google 모드면 새 주 이벤트 자동 fetch)
function calPrevWeek() {
  calWeekStart = _calAddDays(calWeekStart, -7);
  renderCalendar();
  if (typeof window.gcal !== 'undefined' && window.gcal.enabled && window.gcal.mode === 'google') {
    refreshGCalEventsForVisibleWeek();
  }
}
function calNextWeek() {
  calWeekStart = _calAddDays(calWeekStart, 7);
  renderCalendar();
  if (typeof window.gcal !== 'undefined' && window.gcal.enabled && window.gcal.mode === 'google') {
    refreshGCalEventsForVisibleWeek();
  }
}

// ===== 요약 카드 + 선택일 감정일기 =====
function _renderSummary() {
  const el = document.getElementById('cal-summary-card');
  if (!el) return;
  let totalBlocks = 0, totalMin = 0, doneCount = 0;
  for (let i = 0; i < 7; i++) {
    const k = dateKey(_calAddDays(calWeekStart, i));
    const blocks = timeBlocks[k] || [];
    totalBlocks += blocks.length;
    for (const b of blocks) {
      const d = _timeToMin(b.end) - _timeToMin(b.start);
      if (d > 0) totalMin += d;
      if (b.done) doneCount++;
    }
  }
  const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
  el.innerHTML = `
    <div class="summary-row"><span class="lbl">이번 주 블록</span><span class="val">${totalBlocks}</span></div>
    <div class="summary-row"><span class="lbl">완료</span><span class="val accent">${doneCount} / ${totalBlocks}</span></div>
    <div class="summary-row"><span class="lbl">계획 시간</span><span class="val">${hh}h ${mm}m</span></div>
  `;
  _renderDayJournal();  // cal-side 하단 감정일기 패널
}

// 선택일 감정일기 패널 (cal-side 안 — 데스크탑)
function _renderDayJournal() {
  const host = document.getElementById('cal-day-journal');
  if (!host) return;
  const key = calSelectedKey;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m-1, d);
  const dows = ['일','월','화','수','목','금','토'];
  const journal = (typeof journalEntries !== 'undefined' && journalEntries[key]) || { mood:'', content:'' };
  const moodList = (typeof MOODS !== 'undefined') ? MOODS
    : [{e:'😊',l:'좋음'},{e:'🙂',l:'괜찮음'},{e:'😐',l:'보통'},{e:'😟',l:'별로'},{e:'😢',l:'안좋음'}];
  const moodHtml = moodList.map(mo =>
    `<button class="cal-mood-btn${journal.mood===mo.e?' active':''}" onclick="calSetMood('${mo.e}')" title="${mo.l}">${mo.e}</button>`
  ).join('');
  host.innerHTML = `
    <div class="cal-side-sec-title cal-side-sec-title-with-date">
      <span>📔 감정일기</span>
      <span class="cal-side-day">${m}/${d} ${dows[date.getDay()]}</span>
    </div>
    <div class="cal-mood-row">${moodHtml}</div>
    <textarea class="cal-journal-ta" id="cal-journal-ta" placeholder="오늘 하루를 기록해보세요..." oninput="calJournalInput()">${_escapeHtml(journal.content || '')}</textarea>
  `;
}

// ===== 모바일 1일 뷰 =====
function _renderMobileCal() {
  const el = document.getElementById('cal-mobile');
  if (!el) return;
  const todayKey = dateKey(new Date());
  const dows = ['일','월','화','수','목','금','토'];

  // 7일 슬라이더
  let slider = '<div class="mob-week-slider">';
  for (let i = 0; i < 7; i++) {
    const d = _calAddDays(calWeekStart, i);
    const k = dateKey(d);
    const has = (timeBlocks[k] || []).length > 0;
    const cls = [
      'mob-day',
      k === calSelectedKey ? 'active' : '',
      i === 0 ? 'sun' : '',
      i === 6 ? 'sat' : '',
      has ? 'has-event' : '',
    ].filter(Boolean).join(' ');
    slider += `<button class="${cls}" onclick="calSelectDay('${k}')">
      <span class="dow">${dows[i]}</span>
      <span class="num">${d.getDate()}</span>
    </button>`;
  }
  slider += '</div>';

  // 선택일 정보
  const [y, m, dd] = calSelectedKey.split('-').map(Number);
  const date = new Date(y, m-1, dd);
  const dowName = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'][date.getDay()];
  const blocks = timeBlocks[calSelectedKey] || [];
  let total = 0, done = 0;
  for (const b of blocks) {
    const d = _timeToMin(b.end) - _timeToMin(b.start);
    if (d > 0) total += d;
    if (b.done) done++;
  }
  const head = `
    <div class="mob-day-head">
      <div class="mob-day-big">${m}월 ${dd}일 ${dowName}</div>
      <div class="mob-day-stat">
        <span class="pill accent">${blocks.length} 블록</span>
        ${blocks.length > 0 ? `<span class="pill">${done}/${blocks.length} 완료</span>` : ''}
        ${total > 0 ? `<span class="pill">${Math.floor(total/60)}h ${total%60}m</span>` : ''}
      </div>
    </div>
  `;

  // 1일 시간표
  const START_H = 7, END_H = 22;
  let timeCol = '<div class="time-col">';
  for (let h = START_H; h <= END_H; h++) {
    timeCol += `<div class="time-slot">${h.toString().padStart(2,'0')}</div>`;
  }
  timeCol += '</div>';
  let dayCol = `<div class="day-col" data-day-key="${calSelectedKey}" data-start-h="${START_H}" onclick="calGridEmptyClick(event)">`;
  for (let h = START_H; h <= END_H; h++) dayCol += '<div class="hour-line"></div>';
  for (const b of blocks) {
    const startMin = _timeToMin(b.start);
    const endMin = _timeToMin(b.end);
    const top = (startMin - START_H * 60) + 4;
    const height = Math.max(28, endMin - startMin - 4);
    if (top < 0) continue;
    dayCol += `<div class="event-card ${tbColorClass(b.color)}" style="top:${top}px;height:${height}px;" onclick="event.stopPropagation();calEditBlockKey('${calSelectedKey}', ${blocks.indexOf(b)})">
      <div class="ev-title">${_escapeHtml(b.title || '제목 없음')}</div>
      <div class="ev-time">${b.start} — ${b.end}</div>
    </div>`;
  }
  // 현재시각 (오늘만)
  if (calSelectedKey === todayKey) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin >= START_H * 60 && nowMin <= END_H * 60) {
      const top = nowMin - START_H * 60;
      dayCol += `<div class="now-pill" style="top:${top}px;">${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}</div>`;
      dayCol += `<div class="now-line" style="top:${top}px;"></div>`;
    }
  }
  dayCol += '</div>';

  // 모바일 — 선택일 감정일기
  const journal = (typeof journalEntries !== 'undefined' && journalEntries[calSelectedKey]) || { mood:'', content:'' };
  const moodList = (typeof MOODS !== 'undefined') ? MOODS
    : [{e:'😊',l:'좋음'},{e:'🙂',l:'괜찮음'},{e:'😐',l:'보통'},{e:'😟',l:'별로'},{e:'😢',l:'안좋음'}];
  const moodHtml = moodList.map(mo =>
    `<button class="cal-mood-btn${journal.mood===mo.e?' active':''}" onclick="calSetMood('${mo.e}')" title="${mo.l}">${mo.e}</button>`
  ).join('');
  const journalSection = `
    <div class="mob-journal-sec">
      <div class="mob-journal-head">📔 감정일기</div>
      <div class="cal-mood-row">${moodHtml}</div>
      <textarea class="cal-journal-ta" id="cal-journal-ta" placeholder="오늘 하루를 기록해보세요..." oninput="calJournalInput()">${_escapeHtml(journal.content || '')}</textarea>
    </div>
  `;

  el.innerHTML = `
    <div class="mob-cal-month-row">
      <div class="mob-cal-month">${y}년 ${m}월</div>
    </div>
    ${slider}
    ${head}
    <div class="mob-timeline">${timeCol}${dayCol}</div>
    ${journalSection}
  `;
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
    notesHtml = `<div class="cal-sec-head"><span><span class="mi mi-sm" style="vertical-align:-3px;margin-right:4px">edit_note</span>이 날 수정한 노트</span></div>`;
    if (dayNotes.length === 0) {
      notesHtml += `<div class="cal-empty-mini">이 날 작성·수정한 노트가 없어요</div>`;
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

// ── 네비게이션 ── (주간 시간표용 업데이트)
function calSelectDay(key) {
  calSelectedKey = key;
  // 선택일이 현재 주에 없으면 주도 이동
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const ws = _calStartOfWeek(date);
  if (dateKey(ws) !== dateKey(calWeekStart)) calWeekStart = ws;
  renderCalendar();
}
function calPrevMonth() { calViewMonth.setMonth(calViewMonth.getMonth() - 1); _renderMiniCal(); }
function calNextMonth() { calViewMonth.setMonth(calViewMonth.getMonth() + 1); _renderMiniCal(); }
function calGoToday() {
  const t = new Date();
  calViewMonth = new Date(t.getFullYear(), t.getMonth(), 1);
  calSelectedKey = dateKey(t);
  calWeekStart = _calStartOfWeek(t);
  renderCalendar();
}
function calBackToGrid() {
  // 주간 뷰에선 별도 동작 없음 (호환용 stub)
}
function renderCalDetail() { /* 주간 뷰로 통합됨 — 호환용 stub */ }

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
