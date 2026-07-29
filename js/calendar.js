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
  _noteDayCache = null;   // 렌더 시작 시 한 번만 다시 만든다
  _renderMiniCal();
  _renderWeekGrid();
  _renderSummary();
  _renderMobileCal();
}

// ===== 날짜별 노트 흔적 =====
// 캘린더를 "일정 관리"가 아니라 "시간 위에 흔적을 놓는" 화면으로 쓰기 위한 인덱스.
// 일정이 없는 날에도 그날 무엇을 남겼는지 드러난다.
// 기준은 수정일(updatedAt) — 오래된 메모를 오늘 고치면 오늘 흔적으로 잡힌다.
let _noteDayCache = null;
function _notesByDay() {
  // renderCalendar가 하위 렌더 4개를 연달아 부르므로 그 사이엔 재사용한다.
  if (_noteDayCache) return _noteDayCache;
  const map = new Map();
  if (typeof getAllNotes === 'function') {
    for (const n of getAllNotes()) {
      const iso = n.updatedAt || n.createdAt;
      if (!iso) continue;
      const d = new Date(iso);
      if (isNaN(d)) continue;
      const k = dateKey(d);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(n);
    }
  }
  _noteDayCache = map;
  return map;
}
function _notesOnDay(key) { return _notesByDay().get(key) || []; }

// 그날 남긴 노트 목록 마크업. 데스크톱 사이드 패널과 모바일 1일 뷰가
// 같은 것을 쓴다 — 한쪽에만 있으면 화면 크기에 따라 정보가 사라진다.
function _dayNotesCard(key) {
  const list = _notesOnDay(key);
  if (!list.length) return '';
  const rows = list.slice()
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .map(n => {
      const t = new Date(n.updatedAt || n.createdAt);
      const hh = isNaN(t) ? '' : `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`;
      return `<div class="day-note-row" onclick="openNote('${n.type}', ${n.id})">
        <span class="mi mi-sm day-note-icon">${n.type === 'mindmap' ? 'account_tree' : 'edit_note'}</span>
        <span class="day-note-title">${_escapeHtml(n.title) || '제목 없음'}</span>
        <span class="day-note-time">${hh}</span>
      </div>`;
    }).join('');
  return `<div class="day-notes-card">
    <div class="day-notes-head">이날 남긴 흔적 ${list.length}</div>
    ${rows}
  </div>`;
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
    const hasTb = (timeBlocks[key] || []).length > 0;
    const hasJournal = (journalEntries[key] && (journalEntries[key].mood || journalEntries[key].content));
    const hasGCal = _gcalHasEventsOnDay(date);
    const hasNote = _notesOnDay(key).length > 0;
    const has = hasTb || hasJournal || hasGCal;
    const cls = [
      'mini-cal-cell',
      key === todayKey ? 'today' : '',
      inWeek(key) ? 'in-week' : '',
      date.getDay() === 0 && inWeek(key) ? 'week-start' : '',
      date.getDay() === 6 && inWeek(key) ? 'week-end' : '',
      has ? 'has-event' : '',
      // 일정 점과 구분되는 별도 표식 — 그날 메모를 남겼다는 뜻
      hasNote ? 'has-note' : '',
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

    // 캘린더 모드 — 'all'(둘 다) | 'mine'(timeBlock만) | 'google'(gcal만)
    // 사장님: 영역 분할 말고 합쳐서. 아이콘으로 구분.
    const calMode = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'all';
    const showMine = (calMode === 'all' || calMode === 'mine');
    const showGoogle = (calMode === 'all' || calMode === 'google');

    // 우리 타임블록 — event_note 아이콘
    if (showMine) {
      const blocks = timeBlocks[k] || [];
      for (const b of blocks) {
        const startMin = _timeToMin(b.start);
        const endMin = _timeToMin(b.end);
        const top = (startMin - START_H * 60) + 4;  // padding 보정
        const height = Math.max(28, endMin - startMin - 4);
        if (top < 0 || top > (END_H - START_H + 1) * 60) continue;
        const colorClass = tbColorClass(b.color);
        inner += `<div class="event-card ${colorClass}" style="top:${top}px;height:${height}px;" onclick="event.stopPropagation();calEditBlockKey('${k}', ${blocks.indexOf(b)})">
          <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-mine">event_note</span>${_escapeHtml(b.title || '제목 없음')}</div>
          <div class="ev-time">${b.start} — ${b.end}</div>
        </div>`;
      }
    }

    // Google 일정 — event 아이콘 (G 표시)
    if (showGoogle && typeof window.gcal !== 'undefined') {
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
      const dayEnd   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
      const evList = _gcalEventsInRange(dayStart, dayEnd);
      let alldayTop = 0;
      for (const ev of evList) {
        if (window.gcal.eventIsAllDay(ev)) {
          inner += `<div class="event-card gcal-allday" style="top:${alldayTop}px;height:20px;background:${window.gcal.eventColor(ev)}26;border-left:3px solid ${window.gcal.eventColor(ev)};" onclick="event.stopPropagation();openGCalEditor('${ev._calendarId}','${ev.id}')">
            <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-gcal">event</span>${_escapeHtml(ev.summary || '제목 없음')}</div>
          </div>`;
          alldayTop += 22;
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
          <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-gcal">event</span>${_escapeHtml(ev.summary || '제목 없음')}</div>
          <div class="ev-time">${startLabel} — ${endLabel}</div>
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
  if (ev.target.closest('.cal-quick-picker')) return; // popup 자체 클릭 무시
  const col = ev.currentTarget;
  const rect = col.getBoundingClientRect();
  const startH = parseInt(col.dataset.startH || '6', 10);
  const y = ev.clientY - rect.top;
  const min = Math.max(0, Math.round(y / 30) * 30);
  const totalMin = startH * 60 + min;
  const h = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  calSelectedKey = col.dataset.dayKey;
  _calSyncCurrentDate();

  const calMode = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'all';
  const gEnabled = (typeof window.gcal !== 'undefined') && window.gcal.enabled;

  // 'all' 모드 + Google 연동 켜짐 → 작은 popup으로 선택 (UI/UX 최적화)
  if (calMode === 'all' && gEnabled) {
    _openCalQuickPicker(ev.clientX, ev.clientY, h, mm, totalMin);
    return;
  }

  // 'google' 모드 → Google 일정 바로
  if (calMode === 'google' && gEnabled) {
    if (typeof openGCalNewEvent === 'function') openGCalNewEvent(calSelectedKey, h, mm);
    return;
  }

  // 'mine' 또는 Google 미연동 → timeBlock 바로
  _openTbModalAt(h, mm, totalMin);
}

// 빠른 선택 popup — 'all' 모드에서 클릭 위치에 작은 카드 두 개
function _openCalQuickPicker(clientX, clientY, h, mm, totalMin) {
  document.getElementById('cal-quick-picker')?.remove();
  const writeCal = (typeof window.gcal !== 'undefined') && window.gcal.writeId
    ? (window.gcal.calendars.find(c => c.id === window.gcal.writeId) || {}).summary
    : '';
  const pop = document.createElement('div');
  pop.id = 'cal-quick-picker';
  pop.className = 'cal-quick-picker';
  const timeLabel = `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  pop.innerHTML = `
    <div class="cqp-head">
      <span class="mi mi-sm">schedule</span>
      <span>${timeLabel} 부터 추가</span>
      <button class="cqp-close" onclick="_closeCalQuickPicker()" aria-label="닫기"><span class="mi mi-sm">close</span></button>
    </div>
    <button class="cqp-card cqp-mine" onclick="_calQuickPick('mine', ${h}, ${mm}, ${totalMin})">
      <span class="mi">event_note</span>
      <span class="cqp-text">
        <span class="cqp-title">타임블록</span>
        <span class="cqp-sub">투두·색상 지정 가능</span>
      </span>
    </button>
    <button class="cqp-card cqp-gcal" onclick="_calQuickPick('google', ${h}, ${mm}, ${totalMin})">
      <span class="mi">event</span>
      <span class="cqp-text">
        <span class="cqp-title">Google 일정</span>
        <span class="cqp-sub">${writeCal ? _escapeHtml(writeCal) : 'Google Calendar'}</span>
      </span>
    </button>
  `;
  document.body.appendChild(pop);
  // 위치 — 클릭 좌표 근처. 화면 밖 넘으면 보정.
  const rect = pop.getBoundingClientRect();
  let left = clientX + 10;
  let top = clientY - rect.height / 2;
  if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - 10;
  if (top < 10) top = 10;
  if (top + rect.height > window.innerHeight - 10) top = window.innerHeight - rect.height - 10;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.classList.add('show');
  // 외부 클릭 시 닫기
  setTimeout(() => {
    document.addEventListener('click', _calQuickPickerOutsideClick, true);
  }, 0);
}
function _calQuickPickerOutsideClick(e) {
  const pop = document.getElementById('cal-quick-picker');
  if (!pop) { document.removeEventListener('click', _calQuickPickerOutsideClick, true); return; }
  if (!pop.contains(e.target)) _closeCalQuickPicker();
}
function _closeCalQuickPicker() {
  document.getElementById('cal-quick-picker')?.remove();
  document.removeEventListener('click', _calQuickPickerOutsideClick, true);
}
window._closeCalQuickPicker = _closeCalQuickPicker;
window._calQuickPick = function(type, h, mm, totalMin) {
  _closeCalQuickPicker();
  if (type === 'google') {
    if (typeof openGCalNewEvent === 'function') openGCalNewEvent(calSelectedKey, h, mm);
  } else {
    _openTbModalAt(h, mm, totalMin);
  }
};

function _openTbModalAt(h, mm, totalMin) {
  if (typeof openTbModal === 'function') openTbModal(h);
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

// 특정 날짜에 Google 일정이 있는지 (빠른 검사, mini cal · slider 점 표시용)
function _gcalHasEventsOnDay(date) {
  if (typeof window.gcal === 'undefined' || !window.gcal.enabled) return false;
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const dayEnd   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
  return _gcalEventsInRange(dayStart, dayEnd).length > 0;
}

// Google 일정 — 한 날짜 안의 이벤트만 필터
// ⚠️ 종일 이벤트: Google API에서 end.date는 EXCLUSIVE (다음 날)
//    예: 1/1 하루 종일 → start.date='2026-01-01', end.date='2026-01-02'
//    그냥 Date 비교하면 1/2에도 표시되는 버그 → 종일은 dayKey 문자열로 별도 비교
function _gcalEventsInRange(dayStart, dayEnd) {
  if (typeof window.gcal === 'undefined') return [];
  const events = window.gcal.events || {};
  const out = [];
  // dayStart에서 YYYY-MM-DD 추출 (로컬 타임존 기준)
  const _pad2 = n => String(n).padStart(2, '0');
  const dayKey = `${dayStart.getFullYear()}-${_pad2(dayStart.getMonth()+1)}-${_pad2(dayStart.getDate())}`;
  for (const key in events) {
    const ev = events[key];
    if (window.gcal.eventIsAllDay(ev)) {
      // 종일: start.date <= dayKey < end.date (end는 exclusive)
      const sk = ev.start.date;
      const ek = ev.end.date;
      if (sk && ek && sk <= dayKey && dayKey < ek) out.push(ev);
    } else {
      // 시간 이벤트: 일반 시간 겹침 검사
      const s = window.gcal.eventStart(ev);
      const e = window.gcal.eventEnd(ev);
      if (e >= dayStart && s <= dayEnd) out.push(ev);
    }
  }
  return out;
}

// 캘린더 모드 변경 — 토글 클릭 핸들러
function setCalendarModeAndRefresh(mode) {
  if (typeof window.gcal === 'undefined') return;
  // 토글 활성 표시 (데스크탑·모바일 둘 다)
  document.querySelectorAll('.cal-mode-seg button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  window.gcal.setMode(mode);
  // 'google'/'all' 모드 + 연동 꺼져있으면 자동으로 켜기 (사용자가 명시적으로 누른 의도)
  if ((mode === 'google' || mode === 'all') && !window.gcal.enabled) {
    window.gcal.setEnabled(true);
  }
  if ((mode === 'google' || mode === 'all') && window.gcal.enabled) {
    // 인증 없으면 자동 토큰 요청까지 시도
    if (typeof driveClient !== 'undefined' && !driveClient.hasValidToken()) {
      toast('Google 인증 중...', 'info');
      driveClient.ensureToken().then(() => {
        refreshGCalEventsForVisibleWeek();
      }).catch(() => {
        toast('Google 동기화 버튼을 한번 눌러 연결해주세요', 'error');
        renderCalendar();
      });
      return;
    }
    refreshGCalEventsForVisibleWeek();
  } else {
    renderCalendar();
  }
}

// 지금 화면이 필요로 하는 기간.
// 예전엔 보이는 주 7일만 불러왔다. 그래서 미니 월간 달력의 점이 그 주에만
// 찍히고, 주를 넘길 때마다 매번 다시 불러와야 했다.
// 월 단위(+ 앞뒤 1주)로 넉넉히 받아 미니 월간 전체가 정확해지고 주 이동은
// 대부분 이미 받아둔 범위 안에서 끝난다.
function _gcalDesiredRange() {
  const m = (typeof calViewMonth !== 'undefined') ? calViewMonth : new Date();
  const mStart = new Date(m.getFullYear(), m.getMonth(), 1);
  const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
  // 미니 월간 그리드는 앞뒤 달 일부를 함께 그리므로 1주씩 여유
  let from = _calAddDays(mStart, -7);
  let to = _calAddDays(mEnd, 7);
  // 월은 그대로 두고 주만 넘긴 경우 주간 뷰가 범위 밖일 수 있다
  const wStart = new Date(calWeekStart);
  const wEnd = _calAddDays(calWeekStart, 7);
  if (wStart < from) from = _calAddDays(wStart, -7);
  if (wEnd > to) to = _calAddDays(wEnd, 7);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

// 이미 받아둔 기간. 이 안이면 다시 부르지 않는다.
let _gcalFetchedRange = null;
function invalidateGCalRange() { _gcalFetchedRange = null; }

// 화면에 필요한 기간의 Google 이벤트 fetch + 다시 렌더
async function refreshGCalEventsForVisibleWeek(opts) {
  if (typeof window.gcal === 'undefined' || !window.gcal.enabled) {
    renderCalendar();
    return;
  }
  const force = !!(opts && opts.force);
  const { from, to } = _gcalDesiredRange();
  // 이미 가진 범위 안이면 네트워크를 타지 않고 그리기만 한다
  if (!force && _gcalFetchedRange
      && from >= _gcalFetchedRange.from && to <= _gcalFetchedRange.to) {
    renderCalendar();
    return;
  }
  try {
    // 캘린더 목록 / 선택된 ids가 없으면 자동 fetch (모바일 첫 진입 케이스)
    // — 데스크탑 localStorage와 별도라 모바일 처음엔 비어있음
    if (window.gcal.selectedIds.length === 0) {
      await window.gcal.fetchCalendarList();
    }
    await window.gcal.fetchEvents(from, to);
    _gcalFetchedRange = { from, to };
  } catch (e) {
    console.warn('[GCal] week fetch failed:', e);
    if (e.status === 401 || e.status === 403) {
      toast('Google 인증이 만료됐어요. 동기화 버튼을 눌러주세요', 'error');
    } else if (e.status === 404) {
      toast('Calendar API가 활성화 안 됐어요 (Cloud Console 확인)', 'error');
    } else {
      toast('Google 일정 가져오기 실패: ' + (e.message || ''), 'error');
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

// 주 네비게이션 (Google 모드 또는 '전체' 모드면 새 주 이벤트 자동 fetch)
function _shouldFetchGCal() {
  return typeof window.gcal !== 'undefined' && window.gcal.enabled
    && (window.gcal.mode === 'google' || window.gcal.mode === 'all');
}
function calPrevWeek() {
  calWeekStart = _calAddDays(calWeekStart, -7);
  renderCalendar();
  if (_shouldFetchGCal()) refreshGCalEventsForVisibleWeek();
}
function calNextWeek() {
  calWeekStart = _calAddDays(calWeekStart, 7);
  renderCalendar();
  if (_shouldFetchGCal()) refreshGCalEventsForVisibleWeek();
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
  // 선택일에 남긴 노트 (데스크톱 사이드 패널)
  const notesHost = document.getElementById('cal-day-notes');
  if (notesHost) notesHost.innerHTML = _dayNotesCard(calSelectedKey);

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

  // 7일 슬라이더 — timeBlock + Google 일정 둘 다 has-event . 표시
  let slider = '<div class="mob-week-slider">';
  for (let i = 0; i < 7; i++) {
    const d = _calAddDays(calWeekStart, i);
    const k = dateKey(d);
    const hasTb = (timeBlocks[k] || []).length > 0;
    const hasGCal = _gcalHasEventsOnDay(d);
    const has = hasTb || hasGCal;
    const cls = [
      'mob-day',
      k === calSelectedKey ? 'active' : '',
      i === 0 ? 'sun' : '',
      i === 6 ? 'sat' : '',
      has ? 'has-event' : '',
      hasGCal ? 'has-gcal' : '',
      _notesOnDay(k).length > 0 ? 'has-note' : '',
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
  const dayNotes = _notesOnDay(calSelectedKey);
  const head = `
    <div class="mob-day-head">
      <div class="mob-day-big">${m}월 ${dd}일 ${dowName}</div>
      <div class="mob-day-stat">
        <span class="pill accent">${blocks.length} 블록</span>
        ${blocks.length > 0 ? `<span class="pill">${done}/${blocks.length} 완료</span>` : ''}
        ${total > 0 ? `<span class="pill">${Math.floor(total/60)}h ${total%60}m</span>` : ''}
        ${dayNotes.length > 0 ? `<span class="pill">메모 ${dayNotes.length}</span>` : ''}
      </div>
    </div>
  `;

  // 그날 남긴 노트 — 일정과 별개로 "이날 무엇을 남겼나"를 보여준다.
  const notesSection = _dayNotesCard(calSelectedKey);

  // 1일 시간표
  const START_H = 7, END_H = 22;
  let timeCol = '<div class="time-col">';
  for (let h = START_H; h <= END_H; h++) {
    timeCol += `<div class="time-slot">${h.toString().padStart(2,'0')}</div>`;
  }
  timeCol += '</div>';
  let dayCol = `<div class="day-col" data-day-key="${calSelectedKey}" data-start-h="${START_H}" onclick="calGridEmptyClick(event)">`;
  for (let h = START_H; h <= END_H; h++) dayCol += '<div class="hour-line"></div>';

  // 캘린더 모드 분기 — 'all'/'mine' → timeBlock / 'all'/'google' → gcal
  const _mobMode = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'all';
  const _showMine = (_mobMode === 'all' || _mobMode === 'mine');
  const _showGcal = (_mobMode === 'all' || _mobMode === 'google');

  if (_showMine) {
    for (const b of blocks) {
      const startMin = _timeToMin(b.start);
      const endMin = _timeToMin(b.end);
      const top = (startMin - START_H * 60) + 4;
      const height = Math.max(28, endMin - startMin - 4);
      if (top < 0) continue;
      dayCol += `<div class="event-card ${tbColorClass(b.color)}" style="top:${top}px;height:${height}px;" onclick="event.stopPropagation();calEditBlockKey('${calSelectedKey}', ${blocks.indexOf(b)})">
        <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-mine">event_note</span>${_escapeHtml(b.title || '제목 없음')}</div>
        <div class="ev-time">${b.start} — ${b.end}</div>
      </div>`;
    }
  }

  if (_showGcal && typeof window.gcal !== 'undefined') {
    const dayStart = new Date(y, m-1, dd, 0, 0, 0);
    const dayEnd   = new Date(y, m-1, dd, 23, 59, 59);
    const evList = _gcalEventsInRange(dayStart, dayEnd);
    let alldayTop = 0;
    for (const ev of evList) {
      if (window.gcal.eventIsAllDay(ev)) {
        dayCol += `<div class="event-card gcal-allday" style="top:${alldayTop}px;height:20px;background:${window.gcal.eventColor(ev)}26;border-left:3px solid ${window.gcal.eventColor(ev)};" onclick="event.stopPropagation();openGCalEditor('${ev._calendarId}','${ev.id}')">
          <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-gcal">event</span>${_escapeHtml(ev.summary || '제목 없음')}</div>
        </div>`;
        alldayTop += 22;
        continue;
      }
      const evStart = window.gcal.eventStart(ev);
      const evEnd = window.gcal.eventEnd(ev);
      const startMin = evStart.getHours() * 60 + evStart.getMinutes();
      const endMin = evEnd.getHours() * 60 + evEnd.getMinutes();
      const top = (startMin - START_H * 60) + 4;
      const height = Math.max(28, endMin - startMin - 4);
      if (top < 0) continue;
      const bg = window.gcal.eventColor(ev);
      const startLabel = `${String(evStart.getHours()).padStart(2,'0')}:${String(evStart.getMinutes()).padStart(2,'0')}`;
      const endLabel   = `${String(evEnd.getHours()).padStart(2,'0')}:${String(evEnd.getMinutes()).padStart(2,'0')}`;
      dayCol += `<div class="event-card gcal-event" style="top:${top}px;height:${height}px;background:${bg}26;border-left:3px solid ${bg};color:var(--text);" onclick="event.stopPropagation();openGCalEditor('${ev._calendarId}','${ev.id}')">
        <div class="ev-title"><span class="mi mi-sm ev-icon ev-icon-gcal">event</span>${_escapeHtml(ev.summary || '제목 없음')}</div>
        <div class="ev-time">${startLabel} — ${endLabel}</div>
      </div>`;
    }
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

  // 모드 토글은 정적 HTML(.cal-mobile-mode-static)에서 처리 — 여기선 active 상태만 동기화
  const _curMode = (typeof window.gcal !== 'undefined') ? window.gcal.mode : 'all';
  document.querySelectorAll('#cal-mode-seg-mobile button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === _curMode);
  });

  // 헤더 — 한 줄로 깔끔하게 (사장님 보고: 캘린더 상세 날짜 깨짐)
  el.innerHTML = `
    <div class="mob-cal-month-row">
      <button class="mob-week-nav" onclick="calPrevWeek()" aria-label="이전 주">
        <span class="mi mi-sm">chevron_left</span>
      </button>
      <div class="mob-cal-month">${y}년 ${m}월</div>
      <button class="mob-week-nav" onclick="calNextWeek()" aria-label="다음 주">
        <span class="mi mi-sm">chevron_right</span>
      </button>
      <button class="mob-cal-today" onclick="calGoToday()" aria-label="오늘로 이동">
        <span class="mi mi-sm">today</span>
      </button>
    </div>
    ${slider}
    ${head}
    <div class="mob-timeline">${timeCol}${dayCol}</div>
    ${notesSection}
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
// 달을 넘기면 그 달 일정을 받아와야 미니 월간의 점이 채워진다.
// (예전엔 주 단위로만 받아서 다른 주는 늘 비어 보였다)
function calPrevMonth() {
  calViewMonth.setMonth(calViewMonth.getMonth() - 1);
  _renderMiniCal();
  if (_shouldFetchGCal()) refreshGCalEventsForVisibleWeek();
}
function calNextMonth() {
  calViewMonth.setMonth(calViewMonth.getMonth() + 1);
  _renderMiniCal();
  if (_shouldFetchGCal()) refreshGCalEventsForVisibleWeek();
}
function calGoToday() {
  const t = new Date();
  calViewMonth = new Date(t.getFullYear(), t.getMonth(), 1);
  calSelectedKey = dateKey(t);
  calWeekStart = _calStartOfWeek(t);
  renderCalendar();
  if (_shouldFetchGCal()) refreshGCalEventsForVisibleWeek();
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
