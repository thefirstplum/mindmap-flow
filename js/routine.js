// =================== DAILY ROUTINE ===================
// Editable daily routine — sections w/ timed alerts + checkable items per day.
// Default = the PM 24-hour system manual; user can edit/add/remove freely.
// Persists separately from check history (so reset preserves past stats).

const DEFAULT_ROUTINE = [
  {
    id: 'morning', time: '07:00', icon: 'wb_sunny',
    title: '부팅 — 코어 빌드',
    items: [
      { id: 'water_morning', label: '미지근한 물 500ml' },
      { id: 'mcgill_curl',   label: '맥길 컬업 10초 × 10회',
        link: 'https://www.youtube.com/results?search_query=McGill+curl-up+%EB%A7%A5%EA%B8%B8+%EC%BB%AC%EC%97%85+%EC%9E%90%EC%84%B8' },
      { id: 'side_plank',    label: '사이드 플랭크 양쪽 45초 × 3세트',
        link: 'https://www.youtube.com/results?search_query=%EC%82%AC%EC%9D%B4%EB%93%9C+%ED%94%8C%EB%9E%AD%ED%81%AC+%EB%AC%B4%EB%A6%8E+%EB%8C%80%EA%B3%A0' },
      { id: 'bird_dog',      label: '버드독 각 10회',
        link: 'https://www.youtube.com/results?search_query=%EB%B2%84%EB%93%9C%EB%8F%85+bird+dog+%EC%9A%B4%EB%8F%99+%EC%9E%90%EC%84%B8' },
      { id: 'wall_squat',    label: '월 스쿼트 45초 × 2세트',
        link: 'https://www.youtube.com/results?search_query=%EC%9B%94+%EC%8A%A4%EC%BF%BC%ED%8A%B8+wall+sit+%EC%9E%90%EC%84%B8' },
    ]
  },
  {
    id: 'commute', time: '08:00', icon: 'directions_run',
    title: '출근 — 백그라운드 프로세스',
    items: [
      { id: 'power_walk', label: '7,000보 파워 워킹 (브레이싱)' },
      { id: 'no_stairs',  label: '내리막 계단 피하기' },
    ]
  },
  {
    id: 'lunch', time: '12:00', icon: 'restaurant',
    title: '점심 — 데이터 인풋 관리',
    items: [
      { id: 'lunch_protein', label: '단백질 + 식이섬유 메뉴' },
      { id: 'half_rice',     label: '밥 받자마자 절반 덜기' },
      { id: 'eat_order',     label: '채소·단백질 먼저, 밥 나중' },
    ]
  },
  {
    id: 'afternoon', time: '15:00', icon: 'local_cafe',
    title: '카페인 컷오프',
    items: [
      { id: 'caffeine_cut', label: '오후 3시 이후 카페인 컷' },
      { id: 'micro_walk',   label: '틈새 1분 제자리 걷기' },
    ]
  },
  {
    id: 'evening', time: '20:00', icon: 'business_center',
    title: '야근/저녁 — 리소스 관리',
    items: [
      { id: 'water_limit',  label: '저녁 8시 이후 물 섭취 최소화' },
      { id: 'light_dinner', label: '가벼운 저녁 (샐러드/닭가슴살)' },
      { id: 'no_late_eat',  label: '밤 10시 이후 취식 금지' },
    ]
  },
  {
    id: 'shutdown', time: '22:00', icon: 'bedtime',
    title: '셧다운 — 야간 회복',
    items: [
      { id: 'warm_shower',  label: '따뜻한 물 샤워' },
      { id: 'psoas',        label: '장요근 스트레칭',
        link: 'https://www.youtube.com/results?search_query=%EC%9E%A5%EC%9A%94%EA%B7%BC+%EC%8A%A4%ED%8A%B8%EB%A0%88%EC%B9%AD+iliopsoas' },
      { id: 'bar_traction', label: '철봉 견인 30초 × 3회' },
      { id: 'detox',        label: '디지털 디톡스 (폰 멀리)' },
    ]
  },
  {
    id: 'sleep', time: '00:30', icon: 'bed',
    title: '수면 — 강제 셧다운',
    items: [
      { id: 'knee_pillow', label: '무릎 사이 베개 끼우기' },
      { id: 'sleep_6h30',  label: '최소 6시간 30분 수면 확보' },
    ]
  },
];

// =================== STATE ===================
function _cloneDefaultRoutine() { return JSON.parse(JSON.stringify(DEFAULT_ROUTINE)); }
function _routineId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// User-editable config. Falls back to the default when no saved config exists.
let routineConfig = load('routine_config', null) || _cloneDefaultRoutine();
// Migration: backfill `link` fields from defaults onto already-saved configs
// (so users who saved before YouTube links were added still get them).
(function _migrateRoutineLinks() {
  let changed = false;
  for (const section of routineConfig) {
    const defSection = DEFAULT_ROUTINE.find(s => s.id === section.id);
    if (!defSection) continue;
    for (const it of section.items) {
      const defIt = defSection.items.find(d => d.id === it.id);
      if (defIt && defIt.link && !it.link) { it.link = defIt.link; changed = true; }
    }
  }
  if (changed) save('routine_config', routineConfig);
})();
// routineChecks: { 'YYYY-MM-DD': { itemId: true, ... } }
let routineChecks = load('routine_checks', {});
let routineAlertsEnabled = load('routine_alerts', false);
// _notifiedToday: { 'YYYY-MM-DD': { sectionId: true } } — prevents re-firing
let _notifiedToday = load('routine_notified', {});
let _routineCheckTimer = null;
let routineEditMode = false;

function _saveRoutineConfig() { save('routine_config', routineConfig); }

// =================== CHECK TOGGLE (view mode) ===================
function toggleRoutineItem(itemId) {
  const today = dateKey(new Date());
  if (!routineChecks[today]) routineChecks[today] = {};
  if (routineChecks[today][itemId]) delete routineChecks[today][itemId];
  else routineChecks[today][itemId] = true;
  if (Object.keys(routineChecks[today]).length === 0) delete routineChecks[today];
  save('routine_checks', routineChecks);
  renderRoutinePage();
}

// =================== EDIT MODE ===================
function toggleRoutineEditMode() {
  routineEditMode = !routineEditMode;
  renderRoutinePage();
}

function updateRoutineSectionField(sectionId, field, value) {
  const s = routineConfig.find(s => s.id === sectionId);
  if (!s) return;
  s[field] = value;
  _saveRoutineConfig();
  // Don't re-render — would clobber focus inside the input the user is typing
}

function updateRoutineItemLabel(sectionId, itemId, value) {
  const s = routineConfig.find(s => s.id === sectionId);
  const it = s && s.items.find(i => i.id === itemId);
  if (!it) return;
  it.label = value;
  _saveRoutineConfig();
}

function updateRoutineItemLink(sectionId, itemId, value) {
  const s = routineConfig.find(s => s.id === sectionId);
  const it = s && s.items.find(i => i.id === itemId);
  if (!it) return;
  const v = (value || '').trim();
  if (v) it.link = v;
  else delete it.link;
  _saveRoutineConfig();
}

function addRoutineItem(sectionId) {
  const s = routineConfig.find(s => s.id === sectionId);
  if (!s) return;
  s.items.push({ id: _routineId(), label: '새 항목' });
  _saveRoutineConfig();
  renderRoutinePage();
  // Focus the newly-added input
  setTimeout(() => {
    const inputs = document.querySelectorAll(`[data-section-id="${sectionId}"] .routine-item-input`);
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  }, 30);
}

function deleteRoutineItem(sectionId, itemId) {
  const s = routineConfig.find(s => s.id === sectionId);
  if (!s) return;
  s.items = s.items.filter(i => i.id !== itemId);
  _saveRoutineConfig();
  renderRoutinePage();
}

function addRoutineSection() {
  routineConfig.push({
    id: _routineId(), time: '12:00', icon: 'task_alt',
    title: '새 섹션', items: []
  });
  _saveRoutineConfig();
  renderRoutinePage();
  // Focus the new section's title input
  setTimeout(() => {
    const inputs = document.querySelectorAll('.routine-title-input');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  }, 30);
}

function deleteRoutineSection(sectionId) {
  if (!confirm('이 섹션을 삭제할까요? (속한 항목들도 같이 삭제됩니다)')) return;
  routineConfig = routineConfig.filter(s => s.id !== sectionId);
  _saveRoutineConfig();
  renderRoutinePage();
}

function resetRoutineToDefault() {
  if (!confirm('루틴을 기본값으로 초기화할까요? 추가/수정한 항목이 사라집니다.\n(체크 기록은 그대로 유지)')) return;
  routineConfig = _cloneDefaultRoutine();
  _saveRoutineConfig();
  renderRoutinePage();
}

// =================== RENDER ===================
function renderRoutinePage() {
  const el = document.getElementById('routine-body');
  if (!el) return;
  const today = dateKey(new Date());
  const checks = routineChecks[today] || {};
  const total = routineConfig.reduce((n, s) => n + s.items.length, 0);
  const done = routineConfig.reduce((n, s) =>
    n + s.items.filter(i => checks[i.id]).length, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const now = new Date();
  const todayLabel = `${now.getMonth() + 1}월 ${now.getDate()}일 (${['일','월','화','수','목','금','토'][now.getDay()]})`;

  // Determine "current" section — most recent past time
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let currentSectionId = null;
  for (const s of routineConfig) {
    const [h, m] = (s.time || '00:00').split(':').map(Number);
    if (h * 60 + m <= nowMin) currentSectionId = s.id;
  }

  let html = `<div class="routine-summary">
    <div class="routine-progress">
      <div class="routine-date-row">
        <span class="routine-date">${todayLabel}</span>
        <span class="routine-progress-text">${done} / ${total}</span>
      </div>
      <div class="routine-progress-bar"><div class="routine-progress-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="routine-actions">
      <button class="routine-alert-btn ${routineEditMode ? 'on' : ''}" onclick="toggleRoutineEditMode()" title="루틴 항목 편집">
        <span class="mi mi-sm">${routineEditMode ? 'done' : 'edit'}</span>
        <span>${routineEditMode ? '완료' : '편집'}</span>
      </button>
      <button class="routine-alert-btn ${routineAlertsEnabled ? 'on' : ''}"
        onclick="${routineAlertsEnabled ? 'disableRoutineNotifications()' : 'requestRoutineNotifications()'}"
        title="시간대마다 브라우저 알림">
        <span class="mi mi-sm">${routineAlertsEnabled ? 'notifications_active' : 'notifications_off'}</span>
        <span>${routineAlertsEnabled ? '알림' : '알림'}</span>
      </button>
    </div>
  </div>`;

  html += `<div class="routine-list">`;
  for (const section of routineConfig) {
    const sectionDone = section.items.filter(i => checks[i.id]).length;
    const isCurrent = section.id === currentSectionId;
    html += `<div class="routine-section${isCurrent && !routineEditMode ? ' is-current' : ''}${routineEditMode ? ' is-editing' : ''}" data-section-id="${section.id}">`;

    if (routineEditMode) {
      html += `<div class="routine-section-head editing">
        <span class="mi mi-sm routine-section-icon">${section.icon || 'task_alt'}</span>
        <input type="time" class="routine-time-input" value="${section.time}"
          onchange="updateRoutineSectionField('${section.id}','time',this.value)">
        <input type="text" class="routine-title-input" value="${escapeHtml(section.title)}"
          oninput="updateRoutineSectionField('${section.id}','title',this.value)" placeholder="섹션 이름">
        <button class="routine-del-btn" onclick="deleteRoutineSection('${section.id}')" title="섹션 삭제">
          <span class="mi mi-sm">delete</span>
        </button>
      </div>`;
    } else {
      html += `<div class="routine-section-head">
        <span class="mi mi-sm routine-section-icon">${section.icon || 'task_alt'}</span>
        <span class="routine-section-time">${section.time}</span>
        <span class="routine-section-title">${escapeHtml(section.title)}</span>
        <span class="routine-section-count">${sectionDone}/${section.items.length}</span>
      </div>`;
    }

    for (const it of section.items) {
      if (routineEditMode) {
        html += `<div class="routine-item editing">
          <div class="routine-item-edit-fields">
            <input type="text" class="routine-item-input" value="${escapeHtml(it.label)}"
              oninput="updateRoutineItemLabel('${section.id}','${it.id}',this.value)"
              placeholder="항목 내용">
            <input type="url" class="routine-link-input" value="${escapeHtml(it.link || '')}"
              oninput="updateRoutineItemLink('${section.id}','${it.id}',this.value)"
              placeholder="유튜브/참고 링크 (선택)">
          </div>
          <button class="routine-del-btn" onclick="deleteRoutineItem('${section.id}','${it.id}')" title="항목 삭제">
            <span class="mi mi-sm">close</span>
          </button>
        </div>`;
      } else {
        const isDone = !!checks[it.id];
        const linkBtn = it.link ? `<a class="routine-link-btn" href="${escapeHtml(it.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="참고 영상 열기">
          <span class="mi mi-sm">play_circle</span>
        </a>` : '';
        html += `<div class="routine-item${isDone ? ' done' : ''}" onclick="toggleRoutineItem('${it.id}')">
          <span class="routine-check">${isDone ? '✓' : ''}</span>
          <span class="routine-text">${escapeHtml(it.label)}</span>
          ${linkBtn}
        </div>`;
      }
    }

    if (routineEditMode) {
      html += `<button class="routine-add-item-btn" onclick="addRoutineItem('${section.id}')">
        <span class="mi mi-sm">add</span> 항목 추가
      </button>`;
    }

    html += `</div>`;
  }

  if (routineEditMode) {
    html += `<button class="routine-add-section-btn" onclick="addRoutineSection()">
      <span class="mi mi-sm">add</span> 섹션 추가
    </button>`;
    html += `<button class="routine-reset-btn" onclick="resetRoutineToDefault()">
      <span class="mi mi-sm">restart_alt</span> 기본값으로 초기화
    </button>`;
  }

  html += `</div>`;
  el.innerHTML = html;
}

// =================== NOTIFICATIONS ===================
// Foreground-only: when the tab is open (or in the background) the setInterval
// fires `new Notification(...)`. If the tab is fully closed, the OS won't fire
// these. For true background push you'd need a Service Worker + server.
async function requestRoutineNotifications() {
  if (!('Notification' in window)) {
    toast('이 브라우저는 알림을 지원하지 않아요', 'error');
    return;
  }
  if (Notification.permission === 'denied') {
    toast('알림이 차단됨 — 브라우저 사이트 설정에서 허용해주세요', 'error');
    return;
  }
  let perm = Notification.permission;
  if (perm === 'default') {
    perm = await Notification.requestPermission();
  }
  if (perm !== 'granted') {
    toast('알림이 허용되지 않았어요', 'error');
    return;
  }
  routineAlertsEnabled = true;
  save('routine_alerts', true);
  _initNotifiedForToday();
  _startRoutineCheckLoop();
  toast('알림 켜짐 — 시간되면 알려드릴게요', 'success');
  renderRoutinePage();
}

function disableRoutineNotifications() {
  routineAlertsEnabled = false;
  save('routine_alerts', false);
  if (_routineCheckTimer) { clearInterval(_routineCheckTimer); _routineCheckTimer = null; }
  toast('알림 꺼짐');
  renderRoutinePage();
}

function _startRoutineCheckLoop() {
  if (_routineCheckTimer) clearInterval(_routineCheckTimer);
  _checkRoutineAlerts();
  _routineCheckTimer = setInterval(_checkRoutineAlerts, 60_000);
}

function _initNotifiedForToday() {
  // Mark all past sections (relative to current time) as already-notified so
  // opening the app at 14:00 doesn't dump morning notifications at you.
  const today = dateKey(new Date());
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  if (!_notifiedToday[today]) _notifiedToday[today] = {};
  for (const section of routineConfig) {
    const [h, m] = (section.time || '00:00').split(':').map(Number);
    if (h * 60 + m < nowMin) _notifiedToday[today][section.id] = true;
  }
  // Trim memory: keep only today's record
  Object.keys(_notifiedToday).forEach(k => { if (k !== today) delete _notifiedToday[k]; });
  save('routine_notified', _notifiedToday);
}

function _checkRoutineAlerts() {
  if (!routineAlertsEnabled) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const now = new Date();
  const today = dateKey(now);
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (!_notifiedToday[today]) _notifiedToday[today] = {};
  for (const section of routineConfig) {
    if (section.time === hhmm && !_notifiedToday[today][section.id]) {
      _notifiedToday[today][section.id] = true;
      save('routine_notified', _notifiedToday);
      _fireSectionNotification(section);
    }
  }
}

function _fireSectionNotification(section) {
  try {
    const body = section.items.map(i => '• ' + i.label).join('\n');
    new Notification(section.title, {
      body,
      icon: 'icon.svg',
      tag: 'routine-' + section.id,
      silent: false,
    });
  } catch (e) {
    console.warn('Notification fire failed:', e);
  }
}

// =================== INIT ===================
// If alerts were previously enabled AND permission is still granted, resume
// the check loop on page load. Doesn't request permission silently.
(function _initRoutineOnLoad() {
  if (!routineAlertsEnabled) return;
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    _initNotifiedForToday();
    _startRoutineCheckLoop();
  } else {
    // Permission was revoked — flip the setting off so the UI reflects reality
    routineAlertsEnabled = false;
    save('routine_alerts', false);
  }
})();

// Re-check when the tab regains visibility — clock may have ticked past a slot
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && routineAlertsEnabled) _checkRoutineAlerts();
});
