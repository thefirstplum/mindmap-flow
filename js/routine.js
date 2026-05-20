// =================== DAILY ROUTINE ===================
// PM 24-hour system manual — fixed daily routine with timed alerts.
// State: per-day check map + browser notification scheduling.

const DAILY_ROUTINE = [
  {
    id: 'morning', time: '07:00', icon: 'wb_sunny',
    title: '07:00 부팅 — 코어 빌드',
    items: [
      { id: 'water_morning', label: '미지근한 물 500ml' },
      { id: 'mcgill_curl',   label: '맥길 컬업 10초 × 10회' },
      { id: 'side_plank',    label: '사이드 플랭크 양쪽 45초 × 3세트' },
      { id: 'bird_dog',      label: '버드독 각 10회' },
      { id: 'wall_squat',    label: '월 스쿼트 45초 × 2세트' },
    ]
  },
  {
    id: 'commute', time: '08:00', icon: 'directions_run',
    title: '08:00 출근 — 백그라운드 프로세스',
    items: [
      { id: 'power_walk', label: '7,000보 파워 워킹 (브레이싱)' },
      { id: 'no_stairs',  label: '내리막 계단 피하기' },
    ]
  },
  {
    id: 'lunch', time: '12:00', icon: 'restaurant',
    title: '12:00 점심 — 데이터 인풋 관리',
    items: [
      { id: 'lunch_protein', label: '단백질 + 식이섬유 메뉴' },
      { id: 'half_rice',     label: '밥 받자마자 절반 덜기' },
      { id: 'eat_order',     label: '채소·단백질 먼저, 밥 나중' },
    ]
  },
  {
    id: 'afternoon', time: '15:00', icon: 'local_cafe',
    title: '15:00 카페인 컷오프',
    items: [
      { id: 'caffeine_cut', label: '오후 3시 이후 카페인 컷' },
      { id: 'micro_walk',   label: '틈새 1분 제자리 걷기' },
    ]
  },
  {
    id: 'evening', time: '20:00', icon: 'business_center',
    title: '20:00 야근/저녁 — 리소스 관리',
    items: [
      { id: 'water_limit',  label: '저녁 8시 이후 물 섭취 최소화' },
      { id: 'light_dinner', label: '가벼운 저녁 (샐러드/닭가슴살)' },
      { id: 'no_late_eat',  label: '밤 10시 이후 취식 금지' },
    ]
  },
  {
    id: 'shutdown', time: '22:00', icon: 'bedtime',
    title: '22:00 셧다운 — 야간 회복',
    items: [
      { id: 'warm_shower',  label: '따뜻한 물 샤워' },
      { id: 'psoas',        label: '장요근 스트레칭' },
      { id: 'bar_traction', label: '철봉 견인 30초 × 3회' },
      { id: 'detox',        label: '디지털 디톡스 (폰 멀리)' },
    ]
  },
  {
    id: 'sleep', time: '00:30', icon: 'bed',
    title: '00:30 수면 — 강제 셧다운',
    items: [
      { id: 'knee_pillow', label: '무릎 사이 베개 끼우기' },
      { id: 'sleep_6h30',  label: '최소 6시간 30분 수면 확보' },
    ]
  },
];

// =================== STATE ===================
// routineChecks: { 'YYYY-MM-DD': { itemId: true, ... } }
let routineChecks = load('routine_checks', {});
let routineAlertsEnabled = load('routine_alerts', false);
// _notifiedToday: { 'YYYY-MM-DD': { sectionId: true } } — prevents re-firing
let _notifiedToday = load('routine_notified', {});
let _routineCheckTimer = null;

// =================== CHECK TOGGLE ===================
function toggleRoutineItem(itemId) {
  const today = dateKey(new Date());
  if (!routineChecks[today]) routineChecks[today] = {};
  if (routineChecks[today][itemId]) delete routineChecks[today][itemId];
  else routineChecks[today][itemId] = true;
  if (Object.keys(routineChecks[today]).length === 0) delete routineChecks[today];
  save('routine_checks', routineChecks);
  renderRoutinePage();
}

// =================== RENDER ===================
function renderRoutinePage() {
  const el = document.getElementById('routine-body');
  if (!el) return;
  const today = dateKey(new Date());
  const checks = routineChecks[today] || {};
  const total = DAILY_ROUTINE.reduce((n, s) => n + s.items.length, 0);
  const done = DAILY_ROUTINE.reduce((n, s) =>
    n + s.items.filter(i => checks[i.id]).length, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const now = new Date();
  const todayLabel = `${now.getMonth() + 1}월 ${now.getDate()}일 (${['일','월','화','수','목','금','토'][now.getDay()]})`;

  // Determine which section is "current" — closest upcoming or in-progress
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let currentSectionId = null;
  for (const s of DAILY_ROUTINE) {
    const [h, m] = s.time.split(':').map(Number);
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
    <button class="routine-alert-btn ${routineAlertsEnabled ? 'on' : ''}"
      onclick="${routineAlertsEnabled ? 'disableRoutineNotifications()' : 'requestRoutineNotifications()'}"
      title="시간대마다 브라우저 알림">
      <span class="mi mi-sm">${routineAlertsEnabled ? 'notifications_active' : 'notifications_off'}</span>
      <span>${routineAlertsEnabled ? '알림 켜짐' : '알림 켜기'}</span>
    </button>
  </div>`;

  html += `<div class="routine-list">`;
  for (const section of DAILY_ROUTINE) {
    const sectionDone = section.items.filter(i => checks[i.id]).length;
    const isCurrent = section.id === currentSectionId;
    html += `<div class="routine-section${isCurrent ? ' is-current' : ''}">
      <div class="routine-section-head">
        <span class="mi mi-sm routine-section-icon">${section.icon}</span>
        <span class="routine-section-time">${section.time}</span>
        <span class="routine-section-title">${escapeHtml(section.title.replace(/^\d+:\d+\s*/, ''))}</span>
        <span class="routine-section-count">${sectionDone}/${section.items.length}</span>
      </div>`;
    for (const it of section.items) {
      const isDone = !!checks[it.id];
      html += `<div class="routine-item${isDone ? ' done' : ''}" onclick="toggleRoutineItem('${it.id}')">
        <span class="routine-check">${isDone ? '✓' : ''}</span>
        <span class="routine-text">${escapeHtml(it.label)}</span>
      </div>`;
    }
    html += `</div>`;
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
  for (const section of DAILY_ROUTINE) {
    const [h, m] = section.time.split(':').map(Number);
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
  for (const section of DAILY_ROUTINE) {
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
