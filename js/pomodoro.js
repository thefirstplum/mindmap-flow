// =================== 집중 타이머 (포모도로 / 45분 KMM) ===================
// "최소 시간 단위를 정하고 그만큼 집중한다" — 사이클 기계가 아니라 단위 하나가 주인공.
//
// 설계의 핵심은 **카운트다운을 쓰지 않는 것**이다.
//   ❌ 남은시간-- 방식 : 아이폰이 화면을 끄면 JS가 멈춰서 같이 멈춘다
//   ✅ 경과 = 지금 − 시작시각 : JS가 멈춰도 돌아오는 순간 항상 정확하다
// 그래서 저장하는 건 시작 시각 하나뿐이고, 화면 숫자는 매초 다시 계산한 값이다.
// 45분을 넘겨도 계속 센다 — 목표는 목표선일 뿐 타이머를 자르지 않는다.
//
// 알림은 목표 시각에 한 번 쏜다. 못 쏘는 환경(아이폰 화면 꺼짐)은 조용히 넘어가고,
// 돌아왔을 때 _pomoOnReturn()의 확인창이 대신 받는다 — 알람은 놓쳐도 기록은 안 놓친다.
//
// 기록은 그날의 `YYYY-MM-DD 집중` 메모(#집중)에 한 줄씩 쌓인다. 별도 사일로 없음
// — 감정일기를 #일기 메모로 흡수한 것과 같은 구조. 그래서 드라이브 .md·검색·
// 캘린더 흔적·백링크가 전부 공짜로 따라온다.

const POMO_TAG = '집중';
const POMO_LINE_RE = /^(\d{2}:\d{2})~(\d{2}:\d{2}) · (\d+)분 · /;

let pomoState = load('pomo_state', null);
let pomoRecent = load('pomo_recent', []);
let pomoSettings = load('pomo_settings', { targetMin: 45, presets: [45, 25], sound: true });

let _pomoTicker = null;
let _pomoAudioCtx = null;
let _pomoBarKey = '';        // 바를 다시 그릴지 판단하는 지문
let _pomoWasHidden = false;  // 백그라운드에 다녀왔는가
let _pomoPendingTarget = pomoSettings.targetMin;

// ── 시간 계산 ────────────────────────────────────────────────
// 모든 숫자가 여기서 나온다. 일시정지 누적을 빼는 것 말고는 뺄 게 없다.
function _pomoElapsedMs() {
  if (!pomoState) return 0;
  const end = pomoState.pausedAt || Date.now();
  return Math.max(0, end - pomoState.startedAt - (pomoState.pausedTotalMs || 0));
}

function _pomoTargetMs() {
  return (pomoState ? pomoState.targetMin : pomoSettings.targetMin) * 60000;
}

function _pomoFmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function _pomoHM(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 132 → "2시간 12분"
function _pomoDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

// 상태 저장 — save()는 안에서 scheduleDriveSave()를 부르므로 매초 부르면
// 드라이브 동기화가 매초 돈다. 반드시 상태 전이에서만 호출할 것.
function _pomoSaveState() {
  save('pomo_state', pomoState);
}

// ── 세션 제어 ────────────────────────────────────────────────
function startPomodoro(subject, targetMin, noteId, noteType) {
  subject = String(subject || '').trim().normalize('NFC');
  if (!subject) { if (typeof toast === 'function') toast('무엇에 집중할지 입력해주세요'); return; }
  targetMin = Math.max(1, Math.min(600, parseInt(targetMin, 10) || pomoSettings.targetMin));

  pomoState = {
    startedAt: Date.now(),
    targetMin,
    subject,
    noteId: noteId != null ? noteId : null,
    noteType: noteType || null,
    pausedTotalMs: 0,
    pausedAt: null,
    alarmedAt: null,
    lastSeenAt: Date.now()
  };
  _pomoSaveState();
  _pomoPushRecent(subject, noteId, noteType);

  // 이 두 줄은 반드시 사용자 제스처(시작 버튼) 안에서 — 브라우저 정책상
  // 클릭 밖에서 부르면 오디오도 알림 권한도 거부된다.
  _pomoUnlockAudio();
  _pomoAskNotifyPermission();

  _pomoStartTicker();
  renderPomodoroBar();
  if (typeof haptic === 'function') haptic('light');
}

function pausePomodoro() {
  if (!pomoState || pomoState.pausedAt) return;
  pomoState.pausedAt = Date.now();
  _pomoSaveState();
  renderPomodoroBar();
}

function resumePomodoro() {
  if (!pomoState || !pomoState.pausedAt) return;
  pomoState.pausedTotalMs = (pomoState.pausedTotalMs || 0) + (Date.now() - pomoState.pausedAt);
  pomoState.pausedAt = null;
  _pomoSaveState();
  _pomoStartTicker();
  renderPomodoroBar();
}

function togglePomodoroPause() {
  if (!pomoState) return;
  pomoState.pausedAt ? resumePomodoro() : pausePomodoro();
}

// 기록 없이 버린다 (확인 후)
function cancelPomodoro(skipConfirm) {
  if (!pomoState) return;
  if (!skipConfirm && !confirm('이번 집중을 기록 없이 버릴까요?')) return;
  pomoState = null;
  _pomoSaveState();
  _pomoStopTicker();
  _pomoCloseReturn();
  renderPomodoroBar();
}

// 기록을 확정하고 세션을 끝낸다. actualMin이 없으면 실제 경과분.
function finishPomodoro(actualMin) {
  if (!pomoState) return;
  const s = pomoState;
  if (actualMin == null) actualMin = Math.round(_pomoElapsedMs() / 60000);
  actualMin = Math.max(1, Math.round(actualMin));

  const endMs = s.startedAt + (s.pausedTotalMs || 0) + actualMin * 60000;
  _pomoAppendToDaily(s, actualMin, endMs);

  pomoState = null;
  _pomoSaveState();
  _pomoStopTicker();
  _pomoCloseReturn();
  renderPomodoroBar();
  if (typeof haptic === 'function') haptic('medium');
  if (typeof toast === 'function') toast(`🍅 ${_pomoDur(actualMin)} 기록 — ${s.subject}`, 'success');
}

// ── 최근 대상 ────────────────────────────────────────────────
function _pomoPushRecent(subject, noteId, noteType) {
  pomoRecent = (pomoRecent || []).filter(r => r.subject !== subject);
  pomoRecent.unshift({ subject, noteId: noteId != null ? noteId : null, noteType: noteType || null });
  if (pomoRecent.length > 8) pomoRecent.length = 8;
  save('pomo_recent', pomoRecent);
}

// ── 알람 ─────────────────────────────────────────────────────
// 목표 시각에 한 번만. alarmedAt을 상태에 박아두므로 새로고침해도 두 번 안 운다.
function _pomoAlarm() {
  if (!pomoState || pomoState.alarmedAt) return;
  pomoState.alarmedAt = Date.now();
  _pomoSaveState();

  _pomoBeep();
  if (typeof haptic === 'function') haptic('heavy');
  _pomoNotify(`🍅 ${pomoState.targetMin}분 집중 완료`, pomoState.subject);
  if (typeof toast === 'function') {
    toast(`🍅 ${pomoState.targetMin}분 완료 — ${pomoState.subject}`, 'success');
  }
}

// 클릭 안에서 오디오 컨텍스트를 깨워둔다. 안 그러면 나중에 소리가 안 난다.
function _pomoUnlockAudio() {
  if (!pomoSettings.sound) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_pomoAudioCtx) _pomoAudioCtx = new AC();
    if (_pomoAudioCtx.state === 'suspended') _pomoAudioCtx.resume();
  } catch {}
}

// mp3 없이 WebAudio로 직접 만든 3음 알림 — 오프라인에서도 울린다.
function _pomoBeep() {
  if (!pomoSettings.sound) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = _pomoAudioCtx || (_pomoAudioCtx = new AC());
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    [880, 880, 1108.73].forEach((freq, i) => {   // A5 A5 C#6
      const off = i * 0.26;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0 + off);
      gain.gain.setValueAtTime(0.0001, t0 + off);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + off + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.22);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t0 + off); osc.stop(t0 + off + 0.24);
    });
  } catch {}
}

function _pomoAskNotifyPermission() {
  try {
    if (typeof Notification === 'undefined') return;          // iOS 홈화면 밖 등 — 조용히 넘어감
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } catch {}
}

// 알림. 안 되는 환경이면 아무 일도 안 하고 넘어간다 (사장님 지시).
async function _pomoNotify(title, body) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    const opts = { body, icon: './icon.svg', badge: './icon.svg', tag: 'pomodoro', renotify: true };
    // iOS 홈화면 PWA는 서비스워커 경로로만 알림을 띄울 수 있다
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return; }
    new Notification(title, opts);
  } catch {}
}

// ── 틱 (화면만 갱신, 저장 안 함) ──────────────────────────────
function _pomoStartTicker() {
  _pomoStopTicker();
  if (!pomoState || pomoState.pausedAt) { _pomoTick(); return; }
  _pomoTicker = setInterval(_pomoTick, 1000);
  _pomoTick();
}

function _pomoStopTicker() {
  if (_pomoTicker) clearInterval(_pomoTicker);
  _pomoTicker = null;
}

// 여기서 innerHTML을 쓰면 안 된다 — 1초마다 DOM을 갈아엎게 되고, 감정일기
// 포커스 소실과 같은 부류의 버그가 생긴다. textContent/style만 만진다.
function _pomoTick() {
  if (!pomoState) { _pomoStopTicker(); return; }
  const ms = _pomoElapsedMs();
  const target = _pomoTargetMs();

  const timeEl = document.getElementById('pomo-time');
  if (timeEl) timeEl.textContent = _pomoFmt(ms);

  const fill = document.getElementById('pomo-fill');
  if (fill) fill.style.width = Math.min(100, (ms / target) * 100) + '%';

  const bar = document.getElementById('pomo-bar');
  const over = ms >= target;
  if (bar) bar.classList.toggle('over', over);

  if (over && !pomoState.pausedAt && !pomoState.alarmedAt) _pomoAlarm();
}

// ── 플로팅 바 ────────────────────────────────────────────────
function renderPomodoroBar() {
  const host = document.getElementById('pomo-bar-host');
  if (!host) return;
  if (!pomoState) { host.innerHTML = ''; _pomoBarKey = ''; return; }

  // 구조가 같으면 다시 그리지 않는다 (틱이 textContent만 갱신하게 두려고)
  const key = `${pomoState.startedAt}|${pomoState.pausedAt ? 1 : 0}|${pomoState.targetMin}`;
  if (key === _pomoBarKey) return;
  _pomoBarKey = key;

  const paused = !!pomoState.pausedAt;
  const subj = escapeHtml(pomoState.subject);
  host.innerHTML = `
    <div class="pomo-bar${paused ? ' paused' : ''}" id="pomo-bar">
      <div class="pomo-track"><div class="pomo-fill" id="pomo-fill"></div></div>
      <div class="pomo-row">
        <span class="pomo-emoji">🍅</span>
        <span class="pomo-time" id="pomo-time">00:00</span>
        <span class="pomo-target">/ ${pomoState.targetMin}분</span>
        <span class="pomo-subject" title="${subj}">${subj}</span>
        <button class="pomo-btn" onclick="togglePomodoroPause()" title="${paused ? '재개' : '일시정지'}">
          <span class="mi mi-sm">${paused ? 'play_arrow' : 'pause'}</span>
        </button>
        <button class="pomo-btn done" onclick="finishPomodoro()" title="완료 — 지금까지를 기록">
          <span class="mi mi-sm">check</span>
        </button>
        <button class="pomo-btn" onclick="cancelPomodoro()" title="버리기">
          <span class="mi mi-sm">close</span>
        </button>
      </div>
    </div>`;
  _pomoTick();
}

// ── 시작 모달 ────────────────────────────────────────────────
// 집중 대상 없이는 시작할 수 없다 — "무엇을 집중했는지"가 이 기능의 핵심이라서.
function openPomodoroStart(noteId, noteType, presetSubject) {
  if (pomoState) { if (typeof toast === 'function') toast('이미 집중 중이에요'); return; }
  const modal = document.getElementById('pomo-start-modal');
  if (!modal) return;
  _pomoPendingTarget = pomoSettings.targetMin;
  modal.dataset.noteId = noteId != null ? noteId : '';
  modal.dataset.noteType = noteType || '';
  const input = document.getElementById('pomo-subject');
  if (input) input.value = presetSubject || '';
  renderPomoPresets();
  renderPomoRecent();
  modal.classList.add('show');
  setTimeout(() => input && input.focus(), 100);
}

function closePomoStart() {
  document.getElementById('pomo-start-modal')?.classList.remove('show');
}

function renderPomoPresets() {
  const el = document.getElementById('pomo-presets');
  if (!el) return;
  const list = pomoSettings.presets || [45, 25];
  el.innerHTML = list.map(m =>
    `<button class="pomo-preset${m === _pomoPendingTarget ? ' active' : ''}" onclick="setPomoTarget(${m})">${m}분</button>`
  ).join('') +
    `<input type="number" class="pomo-preset-custom" id="pomo-custom" min="1" max="600" placeholder="직접"
       value="${list.includes(_pomoPendingTarget) ? '' : _pomoPendingTarget}"
       oninput="setPomoTarget(this.value, true)">`;
}

function setPomoTarget(min, fromCustom) {
  const v = parseInt(min, 10);
  if (!v || v < 1) return;
  _pomoPendingTarget = Math.min(600, v);
  if (!fromCustom) renderPomoPresets();     // 직접입력 중엔 다시 그리면 포커스가 날아간다
  else document.querySelectorAll('.pomo-preset').forEach(b => b.classList.remove('active'));
}

function renderPomoRecent() {
  const el = document.getElementById('pomo-recent');
  if (!el) return;
  const q = (document.getElementById('pomo-subject')?.value || '').trim().toLowerCase();
  const list = (pomoRecent || []).filter(r => !q || r.subject.toLowerCase().includes(q)).slice(0, 5);
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="pomo-recent-label">최근</div>` + list.map(r =>
    `<button class="pomo-recent-item" onclick="pickPomoRecent(${JSON.stringify(r.subject).replace(/"/g, '&quot;')})">
      <span class="mi mi-sm">${r.noteId != null ? 'edit_note' : 'bolt'}</span>
      <span>${escapeHtml(r.subject)}</span>
    </button>`
  ).join('');
}

function pickPomoRecent(subject) {
  const input = document.getElementById('pomo-subject');
  if (input) input.value = subject;
  const r = (pomoRecent || []).find(x => x.subject === subject);
  const modal = document.getElementById('pomo-start-modal');
  if (modal && r) {
    modal.dataset.noteId = r.noteId != null ? r.noteId : '';
    modal.dataset.noteType = r.noteType || '';
  }
  confirmPomoStart();
}

function confirmPomoStart() {
  const modal = document.getElementById('pomo-start-modal');
  const subject = (document.getElementById('pomo-subject')?.value || '').trim();
  if (!subject) { if (typeof toast === 'function') toast('무엇에 집중할지 입력해주세요'); return; }
  const rawId = modal?.dataset.noteId;
  const noteId = rawId ? Number(rawId) : null;
  closePomoStart();
  startPomodoro(subject, _pomoPendingTarget, noteId, modal?.dataset.noteType || null);
}

// 노트 편집기 툴바에서 바로 시작 — 그 노트가 집중 대상이 된다
function startPomodoroForActiveMemo() {
  if (typeof activeMemoId === 'undefined' || activeMemoId == null) { openPomodoroStart(); return; }
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) { openPomodoroStart(); return; }
  openPomodoroStart(memo.id, 'memo', memo.title || '제목 없음');
}

// ── 복귀 확인 ────────────────────────────────────────────────
// 앱은 사장님이 실제로 집중했는지 알 수 없다. 그러니 아는 척하지 않고 묻는다.
// 목표를 넘긴 채로 백그라운드에서 돌아왔을 때만 뜬다.
function _pomoOnReturn() {
  if (!pomoState) return;
  const wasAway = _pomoWasHidden;
  _pomoWasHidden = false;
  pomoState.lastSeenAt = Date.now();

  const elapsedMin = Math.round(_pomoElapsedMs() / 60000);
  const target = pomoState.targetMin;
  _pomoStartTicker();

  if (!wasAway || pomoState.pausedAt || elapsedMin < target) return;
  _pomoOpenReturn(elapsedMin, target);
}

function _pomoOpenReturn(elapsedMin, target) {
  const modal = document.getElementById('pomo-return-modal');
  if (!modal) return;
  const sub = document.getElementById('pomo-return-sub');
  const btns = document.getElementById('pomo-return-btns');
  const started = new Date(pomoState.startedAt);
  if (sub) {
    sub.innerHTML = `<div class="pomo-return-subject">${escapeHtml(pomoState.subject)}</div>
      <div class="pomo-return-meta">${_pomoHM(started)} 시작 · ${_pomoDur(elapsedMin)} 지남 (목표 ${target}분)</div>`;
  }
  if (btns) {
    // 목표의 2배를 넘어가면 "실제 N분"은 의미가 없으니 안 보여준다
    const showActual = elapsedMin > target && elapsedMin <= target * 2;
    btns.innerHTML = `
      <button class="pomo-ret-btn primary" onclick="finishPomodoro(${target})">${target}분 집중 완료로 기록</button>
      ${showActual ? `<button class="pomo-ret-btn" onclick="finishPomodoro(${elapsedMin})">실제 ${_pomoDur(elapsedMin)}으로 기록</button>` : ''}
      <button class="pomo-ret-btn" onclick="_pomoAskManual(${target})">직접 입력…</button>
      <button class="pomo-ret-btn danger" onclick="cancelPomodoro(true)">이번 건 버리기</button>`;
  }
  modal.classList.add('show');
}

function _pomoCloseReturn() {
  document.getElementById('pomo-return-modal')?.classList.remove('show');
}

function _pomoAskManual(defMin) {
  const v = prompt('실제로 집중한 시간(분)', String(defMin));
  if (v == null) return;
  const n = parseInt(v, 10);
  if (!n || n < 1) { if (typeof toast === 'function') toast('1분 이상 입력해주세요'); return; }
  finishPomodoro(n);
}

// ── 기록 → `YYYY-MM-DD 집중` 메모 ────────────────────────────
// 그날의 집중 메모를 찾는다. 제목 완전일치가 1순위인 이유:
// 태그만으로 찾으면 태그 추출이 실패한 순간(드라이브에서 NFD로 돌아온 경우 등)
// 매 세션마다 새 메모가 생겨버린다. 제목은 그 경로를 안 탄다.
function _pomoDailyMemo(key) {
  if (typeof memos === 'undefined' || !Array.isArray(memos)) return null;
  const wanted = `${key} ${POMO_TAG}`.normalize('NFC');
  return memos.find(m => (m.title || '').normalize('NFC') === wanted)
      || memos.find(m => (m.tags || []).includes(POMO_TAG) && (m.title || '').slice(0, 10) === key)
      || null;
}

function _pomoAppendToDaily(s, actualMin, endMs) {
  if (typeof memos === 'undefined' || !Array.isArray(memos)) return;
  const startD = new Date(s.startedAt);
  // 자정을 넘겨도 '시작한 날'에 기록한다 — 안 그러면 하루 집계가 쪼개진다
  const key = dateKey(startD);
  const subj = s.noteId != null ? `[[${s.subject}]]` : s.subject;
  const short = actualMin < s.targetMin ? ` (목표 ${s.targetMin}분)` : '';
  const line = `${_pomoHM(startD)}~${_pomoHM(new Date(endMs))} · ${actualMin}분 · ${subj}${short}`;

  let memo = _pomoDailyMemo(key);
  const lines = memo
    ? String(memo.content || '').split('\n').map(l => l.trim()).filter(l => POMO_LINE_RE.test(l))
    : [];
  lines.push(line);
  lines.sort();   // 시각 문자열이 앞에 있어 사전순 = 시간순

  const total = lines.reduce((a, l) => a + (parseInt(l.match(POMO_LINE_RE)[3], 10) || 0), 0);
  const content = (
    lines.join('\n') +
    `\n\n합계 ${_pomoDur(total)} · ${lines.length}회\n\n#${POMO_TAG}`
  ).normalize('NFC');   // NFD로 들어가면 해시태그 추출이 조용히 실패한다

  const now = new Date().toISOString();
  if (memo) {
    memo.content = content;
    memo.updatedAt = now;
  } else {
    memo = {
      id: newMemoId(),
      title: `${key} 집중`.normalize('NFC'),
      content,
      date: startD.toISOString(),
      updatedAt: now,
      tags: [POMO_TAG]   // 본문 #집중이 진실원이지만, 추출 실패해도 안 깨지게 미리 박아둔다
    };
    memos.unshift(memo);
  }
  if (typeof syncMemoHashtags === 'function') syncMemoHashtags(memo);
  saveMemos();
  if (typeof renderMemoList === 'function') renderMemoList();
}

// 오늘 집계 — 홈 카드가 쓴다. { min, count }
function pomoTodayStats() {
  const memo = _pomoDailyMemo(dateKey(new Date()));
  if (!memo) return { min: 0, count: 0 };
  const lines = String(memo.content || '').split('\n').map(l => l.trim()).filter(l => POMO_LINE_RE.test(l));
  const min = lines.reduce((a, l) => a + (parseInt(l.match(POMO_LINE_RE)[3], 10) || 0), 0);
  return { min, count: lines.length };
}

// ── 부팅 복원 ────────────────────────────────────────────────
// 앱을 완전히 껐다 켜도, 배포 자동 새로고침이 껴들어도 여기서 이어붙는다.
function restorePomodoro() {
  if (!pomoState || !pomoState.startedAt) { pomoState = null; return; }
  // 24시간 넘게 방치된 세션은 잘못된 것 — 조용히 버린다
  if (Date.now() - pomoState.startedAt > 24 * 3600 * 1000) {
    pomoState = null;
    _pomoSaveState();
    return;
  }
  _pomoWasHidden = true;   // 앱이 꺼져 있던 것도 '자리를 비운' 것으로 본다
  renderPomodoroBar();
  _pomoOnReturn();
}

// 화면을 떠날 때·돌아올 때만 기록한다. 폴링하지 않으므로 배터리·동기화 부담 0.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    _pomoWasHidden = true;
    if (pomoState) { pomoState.lastSeenAt = Date.now(); _pomoSaveState(); }
    _pomoStopTicker();
  } else {
    _pomoOnReturn();
  }
});
