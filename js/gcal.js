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
