// =================== GOOGLE CALENDAR INTEGRATION ===================
// 사장님 요청 (2026-06-05): 우리 timeBlock과 별개로 Google Calendar 일정을
// 가져와서 자유롭게 수정·삭제·추가. 캘린더 페이지 내 토글로 분리 표시.
//
// 의존: sync.js의 driveClient (OAuth scope: drive + calendar 통합).
//       calendar.js의 주간뷰 (_renderWeekGrid)와 _renderMobileCal에서 호출.
//
// 데이터 흐름:
//   1. fetchGCalEvents(weekStart, 7) — 한 주 일정 가져옴
//   2. 로컬 캐시 gcalEvents에 저장 (메모리 + localStorage)
//   3. 캘린더 모드가 'google'일 때 _renderWeekGrid가 gcalEvents 표시
//   4. CRUD: createGCalEvent / updateGCalEvent / deleteGCalEvent
//
// scope (sync.js):
//   https://www.googleapis.com/auth/calendar  — full read/write events + list

const GCAL_API = 'https://www.googleapis.com/calendar/v3';

// 로드한 캘린더 list (사장님이 설정에서 multi-select)
let gcalCalendars = load('gcal_calendars', []);  // [{id, summary, primary, backgroundColor, foregroundColor, accessRole}]
let gcalSelectedIds = load('gcal_selected_ids', []);  // 표시할 캘린더 id 배열
let gcalWriteCalendarId = load('gcal_write_calendar_id', null);  // 새 일정 추가 대상 캘린더
let gcalEvents = load('gcal_events_cache', {});  // { 'cal_id:event_id': {...event, _calendarId} }
let gcalLastFetchAt = load('gcal_last_fetch_at', 0);  // ms
let gcalEnabled = load('gcal_enabled', false);

// 캘린더 모드 — 'mine' (timeBlock) | 'google' (gcal events)
let calendarMode = load('calendar_mode', 'mine');

// ──────────────────── API 호출 헬퍼 ────────────────────
// driveClient의 토큰을 그대로 재사용 (같은 scope 안에 calendar 포함)
async function _gcalApi(method, path, body, params) {
  if (typeof driveClient === 'undefined') throw new Error('driveClient 미준비 — sync.js 먼저 로드');
  await driveClient.ensureToken();
  const url = new URL(GCAL_API + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Authorization': 'Bearer ' + driveClient.accessToken,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`GCal API ${res.status}: ${text || res.statusText}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ──────────────────── 캘린더 list ────────────────────
async function fetchGCalCalendarList() {
  const data = await _gcalApi('GET', '/users/me/calendarList', null, {
    fields: 'items(id,summary,primary,backgroundColor,foregroundColor,accessRole,selected)',
    minAccessRole: 'reader',
  });
  const items = (data && data.items) || [];
  gcalCalendars = items.map(c => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary,
    backgroundColor: c.backgroundColor || '#A4BDFC',
    foregroundColor: c.foregroundColor || '#FFFFFF',
    accessRole: c.accessRole,  // 'owner' | 'writer' | 'reader' | 'freeBusyReader'
    selected: !!c.selected,
  }));
  save('gcal_calendars', gcalCalendars);
  // 첫 fetch — 기본 캘린더(primary)는 자동 선택, 쓰기 대상도 primary
  if (gcalSelectedIds.length === 0) {
    const primary = gcalCalendars.find(c => c.primary);
    if (primary) {
      gcalSelectedIds = [primary.id];
      save('gcal_selected_ids', gcalSelectedIds);
      if (!gcalWriteCalendarId) {
        gcalWriteCalendarId = primary.id;
        save('gcal_write_calendar_id', primary.id);
      }
    }
  }
  return gcalCalendars;
}

// ──────────────────── 이벤트 fetch (선택된 모든 캘린더, 기간) ────────────────────
async function fetchGCalEvents(timeMin, timeMax) {
  if (!gcalEnabled) return [];
  if (gcalSelectedIds.length === 0) return [];
  const allEvents = [];
  await Promise.all(gcalSelectedIds.map(async (calId) => {
    try {
      const data = await _gcalApi('GET', `/calendars/${encodeURIComponent(calId)}/events`, null, {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',   // 반복 일정도 개별 인스턴스로 펼침
        orderBy: 'startTime',
        maxResults: '250',
        fields: 'items(id,summary,description,location,start,end,colorId,creator,htmlLink,recurringEventId,status)',
      });
      const items = (data && data.items) || [];
      for (const ev of items) {
        if (ev.status === 'cancelled') continue;
        ev._calendarId = calId;
        allEvents.push(ev);
      }
    } catch (e) {
      console.warn('[GCal] fetch failed for', calId, e.message);
    }
  }));
  // 캐시 갱신
  gcalEvents = {};
  for (const ev of allEvents) gcalEvents[`${ev._calendarId}:${ev.id}`] = ev;
  save('gcal_events_cache', gcalEvents);
  gcalLastFetchAt = Date.now();
  save('gcal_last_fetch_at', gcalLastFetchAt);
  return allEvents;
}

// ──────────────────── CRUD ────────────────────
// 새 일정 추가 — 쓰기 대상 캘린더로
// body: { summary, description, location, start, end }  (start/end: ISO with timezone)
async function createGCalEvent(payload) {
  const calId = gcalWriteCalendarId || (gcalCalendars.find(c => c.primary) || {}).id;
  if (!calId) throw new Error('쓰기 대상 캘린더가 설정되지 않았어요');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  const body = {
    summary: payload.summary || '',
    description: payload.description || undefined,
    location: payload.location || undefined,
    start: payload.allDay
      ? { date: payload.start }                        // 'YYYY-MM-DD'
      : { dateTime: payload.start, timeZone: tz },     // ISO
    end: payload.allDay
      ? { date: payload.end }
      : { dateTime: payload.end, timeZone: tz },
  };
  const created = await _gcalApi('POST', `/calendars/${encodeURIComponent(calId)}/events`, body);
  if (created) {
    created._calendarId = calId;
    gcalEvents[`${calId}:${created.id}`] = created;
    save('gcal_events_cache', gcalEvents);
  }
  return created;
}

// 기존 일정 수정
async function updateGCalEvent(calId, eventId, patch) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  const body = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.start) {
    body.start = patch.allDay ? { date: patch.start } : { dateTime: patch.start, timeZone: tz };
  }
  if (patch.end) {
    body.end = patch.allDay ? { date: patch.end } : { dateTime: patch.end, timeZone: tz };
  }
  const updated = await _gcalApi('PATCH', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, body);
  if (updated) {
    updated._calendarId = calId;
    gcalEvents[`${calId}:${updated.id}`] = updated;
    save('gcal_events_cache', gcalEvents);
  }
  return updated;
}

// 삭제
async function deleteGCalEvent(calId, eventId) {
  await _gcalApi('DELETE', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`);
  delete gcalEvents[`${calId}:${eventId}`];
  save('gcal_events_cache', gcalEvents);
}

// ──────────────────── 설정 토글 ────────────────────
function setGCalEnabled(on) {
  gcalEnabled = !!on;
  save('gcal_enabled', gcalEnabled);
}

function setCalendarMode(mode) {
  calendarMode = (mode === 'google') ? 'google' : 'mine';
  save('calendar_mode', calendarMode);
  if (typeof renderCalendar === 'function') renderCalendar();
}

// ──────────────────── 헬퍼 ────────────────────
// 이벤트의 시작/끝 시각을 Date 객체로
function gcalEventStart(ev) {
  return new Date(ev.start.dateTime || ev.start.date);
}
function gcalEventEnd(ev) {
  return new Date(ev.end.dateTime || ev.end.date);
}
function gcalEventIsAllDay(ev) {
  return !!ev.start.date && !ev.start.dateTime;
}

// 캘린더 색 → 캘린더 객체에서 background 가져옴
function gcalEventColor(ev) {
  const cal = gcalCalendars.find(c => c.id === ev._calendarId);
  return cal ? cal.backgroundColor : '#A4BDFC';
}

// ──────────────────── UI: 동기화 모달 (캘린더 선택 섹션) ────────────────────
// 모달 열릴 때 호출 — 연결 상태에 따라 표시 분기
function renderGCalSection() {
  const cb = document.getElementById('setting-gcal-enabled');
  const connected = (typeof driveClient !== 'undefined') && driveClient.hasValidToken();
  const ncEl = document.getElementById('gcal-not-connected');
  const cEl = document.getElementById('gcal-connected');
  if (cb) cb.checked = !!gcalEnabled;
  if (ncEl) ncEl.style.display = connected ? 'none' : '';
  if (cEl)  cEl.style.display  = (connected && gcalEnabled) ? '' : 'none';
  if (connected && gcalEnabled) _renderGCalLists();
}
window.renderGCalSection = renderGCalSection;

function _renderGCalLists() {
  const listEl = document.getElementById('gcal-list');
  const writeEl = document.getElementById('gcal-write-cal');
  if (listEl) {
    if (gcalCalendars.length === 0) {
      listEl.innerHTML = `<div style="font-size:11.5px;color:var(--text-mute);padding:8px 6px;">캘린더 목록 새로고침을 누르세요</div>`;
    } else {
      listEl.innerHTML = gcalCalendars.map(c => {
        const checked = gcalSelectedIds.includes(c.id) ? 'checked' : '';
        const readonly = (c.accessRole === 'reader' || c.accessRole === 'freeBusyReader') ? '<span style="font-size:10px;color:var(--text-mute);background:var(--surface3);padding:1px 5px;border-radius:3px;margin-left:6px;">읽기</span>' : '';
        return `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:6px;">
          <input type="checkbox" ${checked} onchange="onGCalCalendarToggle('${c.id.replace(/'/g, "\\'")}', this.checked)" style="accent-color:${c.backgroundColor};">
          <span style="width:10px;height:10px;border-radius:50%;background:${c.backgroundColor};flex-shrink:0;"></span>
          <span style="flex:1;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escapeGCal(c.summary)}</span>
          ${c.primary ? '<span style="font-size:10px;color:var(--accent);font-weight:700;">기본</span>' : ''}
          ${readonly}
        </label>`;
      }).join('');
    }
  }
  if (writeEl) {
    const writableCals = gcalCalendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer');
    writeEl.innerHTML = writableCals.map(c =>
      `<option value="${c.id}" ${c.id === gcalWriteCalendarId ? 'selected' : ''}>${_escapeGCal(c.summary)}${c.primary ? ' (기본)' : ''}</option>`
    ).join('');
  }
}

function _escapeGCal(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 토글 — 연동 on/off
window.onToggleGCalEnabled = async function() {
  const cb = document.getElementById('setting-gcal-enabled');
  if (!cb) return;
  setGCalEnabled(cb.checked);
  if (cb.checked) {
    // 처음 켜면 캘린더 목록 자동 로드
    if (gcalCalendars.length === 0) await loadGCalCalendars();
  }
  renderGCalSection();
};

// 캘린더 목록 fetch (버튼 클릭)
window.loadGCalCalendars = async function() {
  try {
    if (typeof toast === 'function') toast('Google 캘린더 목록 불러오는 중...');
    await fetchGCalCalendarList();
    if (typeof toast === 'function') toast(`캘린더 ${gcalCalendars.length}개 로드됨`, 'success');
    _renderGCalLists();
  } catch (e) {
    console.warn('[GCal] list fetch failed:', e);
    if (typeof toast === 'function') {
      if (e.status === 403) {
        toast('Calendar API가 활성화되지 않았어요. Google Cloud Console에서 활성화하세요', 'error');
      } else if (e.status === 401) {
        toast('인증이 만료됐어요. 동기화 버튼 한 번 누르세요', 'error');
      } else {
        toast('캘린더 목록 가져오기 실패', 'error');
      }
    }
  }
};

// 캘린더 선택 토글
window.onGCalCalendarToggle = function(calId, checked) {
  if (checked) {
    if (!gcalSelectedIds.includes(calId)) gcalSelectedIds = [...gcalSelectedIds, calId];
  } else {
    gcalSelectedIds = gcalSelectedIds.filter(x => x !== calId);
  }
  save('gcal_selected_ids', gcalSelectedIds);
};

// 쓰기 대상 캘린더 변경
window.onGCalWriteCalendarChange = function() {
  const sel = document.getElementById('gcal-write-cal');
  if (!sel) return;
  gcalWriteCalendarId = sel.value;
  save('gcal_write_calendar_id', gcalWriteCalendarId);
};

// ──────────────────── UI: Google 일정 편집 모달 ────────────────────
let _gcalEditingKey = null;  // 'calId:eventId' 또는 null (신규)
let _gcalEditingNewSlot = null; // {dayKey, hour, minute} 신규 시간 미리채움

window.openGCalEditor = function(calId, eventId) {
  const ev = gcalEvents[`${calId}:${eventId}`];
  if (!ev) { toast('일정을 찾을 수 없어요'); return; }
  _gcalEditingKey = `${calId}:${eventId}`;
  _gcalEditingNewSlot = null;
  _openGCalModal({
    title: ev.summary || '',
    description: ev.description || '',
    location: ev.location || '',
    start: gcalEventStart(ev),
    end: gcalEventEnd(ev),
    allDay: gcalEventIsAllDay(ev),
    calId,
    eventId,
    canDelete: true,
  });
};

window.openGCalNewEvent = function(dayKey, hour, minute) {
  if (!gcalWriteCalendarId) {
    toast('쓰기 대상 캘린더가 설정되지 않았어요', 'error');
    return;
  }
  _gcalEditingKey = null;
  _gcalEditingNewSlot = { dayKey, hour, minute };
  const [y, m, d] = dayKey.split('-').map(Number);
  const start = new Date(y, m-1, d, hour, minute);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  _openGCalModal({
    title: '', description: '', location: '',
    start, end, allDay: false,
    calId: gcalWriteCalendarId,
    canDelete: false,
  });
};

function _openGCalModal({title, description, location, start, end, allDay, calId, eventId, canDelete}) {
  // 기존 모달 제거
  document.getElementById('gcal-editor-modal')?.remove();
  const writableCals = gcalCalendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer');
  const calOptions = writableCals.map(c =>
    `<option value="${c.id}" ${c.id === calId ? 'selected' : ''}>${_escapeGCal(c.summary)}</option>`
  ).join('');
  const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const fmtTime = d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const overlay = document.createElement('div');
  overlay.id = 'gcal-editor-modal';
  overlay.className = 'modal-overlay show';
  overlay.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()" style="max-width:480px;">
      <h3>${eventId ? '📅 일정 수정' : '📅 새 일정'}</h3>
      <label>제목</label>
      <input type="text" id="gcal-edit-title" placeholder="일정 제목" value="${_escapeGCal(title)}">
      <label style="margin-top:14px;">캘린더</label>
      <select id="gcal-edit-cal" style="width:100%;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;">${calOptions}</select>
      <label style="margin-top:14px;display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text);font-weight:500;">
        <input type="checkbox" id="gcal-edit-allday" ${allDay ? 'checked' : ''} onchange="_gcalEditorAllDayToggle()" style="width:18px;height:18px;accent-color:var(--accent);">
        종일
      </label>
      <div class="time-row-input" style="margin-top:10px;">
        <div>
          <label style="margin-top:0;">시작</label>
          <input type="date" id="gcal-edit-start-date" value="${fmtDate(start)}">
          <input type="time" id="gcal-edit-start-time" value="${fmtTime(start)}" style="margin-top:4px;${allDay?'display:none;':''}">
        </div>
        <div>
          <label style="margin-top:0;">종료</label>
          <input type="date" id="gcal-edit-end-date" value="${fmtDate(end)}">
          <input type="time" id="gcal-edit-end-time" value="${fmtTime(end)}" style="margin-top:4px;${allDay?'display:none;':''}">
        </div>
      </div>
      <label style="margin-top:14px;">위치 (선택)</label>
      <input type="text" id="gcal-edit-location" placeholder="장소" value="${_escapeGCal(location)}">
      <label style="margin-top:14px;">설명 (선택)</label>
      <textarea id="gcal-edit-description" placeholder="메모" style="min-height:64px;">${_escapeGCal(description)}</textarea>
      <div class="modal-actions" style="margin-top:18px;">
        ${canDelete ? `<button class="danger" onclick="_gcalEditorDelete()" style="margin-right:auto;">삭제</button>` : ''}
        <button onclick="_gcalEditorClose()">취소</button>
        <button class="primary" onclick="_gcalEditorSave()">저장</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) _gcalEditorClose(); });
  document.body.appendChild(overlay);
}

window._gcalEditorClose = function() {
  document.getElementById('gcal-editor-modal')?.remove();
  _gcalEditingKey = null;
};

window._gcalEditorAllDayToggle = function() {
  const allDay = document.getElementById('gcal-edit-allday').checked;
  document.getElementById('gcal-edit-start-time').style.display = allDay ? 'none' : '';
  document.getElementById('gcal-edit-end-time').style.display = allDay ? 'none' : '';
};

window._gcalEditorSave = async function() {
  const title = document.getElementById('gcal-edit-title').value.trim();
  if (!title) { toast('제목을 입력하세요'); return; }
  const calId = document.getElementById('gcal-edit-cal').value;
  const allDay = document.getElementById('gcal-edit-allday').checked;
  const sd = document.getElementById('gcal-edit-start-date').value;
  const st = document.getElementById('gcal-edit-start-time').value;
  const ed = document.getElementById('gcal-edit-end-date').value;
  const et = document.getElementById('gcal-edit-end-time').value;
  const description = document.getElementById('gcal-edit-description').value;
  const location = document.getElementById('gcal-edit-location').value;
  const payload = {
    summary: title,
    description,
    location,
    allDay,
    start: allDay ? sd : new Date(`${sd}T${st}:00`).toISOString(),
    end:   allDay ? ed : new Date(`${ed}T${et}:00`).toISOString(),
  };
  try {
    if (_gcalEditingKey) {
      // 수정 — 캘린더 바뀐 경우는 일단 같은 캘린더 update만 지원 (이동은 후속)
      const [origCalId, eventId] = _gcalEditingKey.split(':');
      await updateGCalEvent(origCalId, eventId, payload);
      toast('일정 수정됨', 'success');
    } else {
      // 신규 — calId가 gcalWriteCalendarId 와 다르면 일단 기본 동작 (gcal-edit-cal로 설정)
      const prevWrite = gcalWriteCalendarId;
      if (calId && calId !== prevWrite) gcalWriteCalendarId = calId;
      await createGCalEvent(payload);
      if (calId !== prevWrite) gcalWriteCalendarId = prevWrite;  // 되돌림
      toast('일정 생성됨', 'success');
    }
    _gcalEditorClose();
    if (typeof renderCalendar === 'function') renderCalendar();
  } catch (e) {
    console.warn('[GCal] save failed:', e);
    toast('일정 저장 실패: ' + (e.message || ''), 'error');
  }
};

window._gcalEditorDelete = async function() {
  if (!_gcalEditingKey) return;
  if (!confirm('이 일정을 Google Calendar에서 삭제할까요?')) return;
  const [calId, eventId] = _gcalEditingKey.split(':');
  try {
    await deleteGCalEvent(calId, eventId);
    toast('일정 삭제됨', 'success');
    _gcalEditorClose();
    if (typeof renderCalendar === 'function') renderCalendar();
  } catch (e) {
    console.warn('[GCal] delete failed:', e);
    toast('삭제 실패: ' + (e.message || ''), 'error');
  }
};

// expose
window.gcal = {
  fetchCalendarList: fetchGCalCalendarList,
  fetchEvents: fetchGCalEvents,
  create: createGCalEvent,
  update: updateGCalEvent,
  delete: deleteGCalEvent,
  setEnabled: setGCalEnabled,
  setMode: setCalendarMode,
  // state
  get calendars()    { return gcalCalendars; },
  get selectedIds()  { return gcalSelectedIds; },
  get writeId()      { return gcalWriteCalendarId; },
  get events()       { return gcalEvents; },
  get enabled()      { return gcalEnabled; },
  get mode()         { return calendarMode; },
  set selectedIds(v) { gcalSelectedIds = v; save('gcal_selected_ids', v); },
  set writeId(v)     { gcalWriteCalendarId = v; save('gcal_write_calendar_id', v); },
  // utils
  eventStart: gcalEventStart,
  eventEnd: gcalEventEnd,
  eventIsAllDay: gcalEventIsAllDay,
  eventColor: gcalEventColor,
};
