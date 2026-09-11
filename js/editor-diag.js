// =================== 에디터 계측 (임시) ===================
// 재현이 안 되는 두 증상을 현장에서 잡기 위한 기록기.
//   (1) 동기화 중 메모 입력이 밀림
//   (2) 체크박스 줄에서 화살표를 누르면 공백이 들어감
//
// 두 증상 모두 개발 환경에서 합성 입력으로는 재현되지 않았다. 실제 키보드·
// 한글 IME·실제 동기화가 겹쳐야 나오는 것으로 보여, 사장님 기기에서 사건이
// 일어난 순간을 남기게 한다.
//
// [로드 위치] sync.js 다음, main.js 앞.
//   SyncEvents는 sync.js가 만들고, itemsMerged 리스너는 등록 순서대로 실행된다.
//   main.js보다 먼저 등록돼야 '동기화 직전' 상태를 찍을 수 있다.
//
// [기록 범위] 커서 주변 14자씩만. 메모 전문을 남기지 않는다.
//   저장 위치는 localStorage(기기 로컬)이고 Drive로 올라가지 않는다.
//
// 원인이 특정되면 이 파일 + index.html의 script 태그 + 설정의 details 한 덩이를
// 지우면 흔적 없이 사라진다.

const EDIAG_KEY = 'mindflow_editor_diag';
const EDIAG_MAX = 80;          // 링 버퍼 — 오래된 것부터 버린다
const EDIAG_BLOCK_MS = 80;     // 이 이상 메인 스레드를 잡으면 '밀림'으로 본다

function _ediagLoad() {
  try { return JSON.parse(localStorage.getItem(EDIAG_KEY) || '[]'); } catch { return []; }
}

function _ediagPush(rec) {
  try {
    const log = _ediagLoad();
    log.push({ t: new Date().toISOString(), ...rec });
    while (log.length > EDIAG_MAX) log.shift();
    localStorage.setItem(EDIAG_KEY, JSON.stringify(log));
  } catch {}
}

function clearEditorDiag() {
  try { localStorage.removeItem(EDIAG_KEY); } catch {}
  if (typeof renderEditorDiag === 'function') renderEditorDiag();
}

// 지금 편집기 상태 한 장. 커서 위치와 그 주변 글자만 남긴다.
function _ediagSnap() {
  const v = window._cm6View;
  if (!v) return null;
  try {
    const head = v.state.selection.main.head;
    const doc = v.state.doc.toString();
    const around = (doc.slice(Math.max(0, head - 14), head) + '‸' + doc.slice(head, head + 14))
      .replace(/\n/g, '⏎');
    return { len: doc.length, cur: head, around };
  } catch { return null; }
}

function _ediagInEditor(el) {
  return !!(el && el.closest && el.closest('#memo-live-editor'));
}

// ── (2) 키 입력 ────────────────────────────────────────────────
// 이동 전용 키(화살표 등)는 본문을 바꿔서는 안 된다. 바뀌면 그게 버그다.
// capture 단계에서 '누르기 직전'을 찍고, 매크로태스크에서 '직후'와 비교한다.
(function watchKeys() {
  const NAV = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

  document.addEventListener('keydown', (e) => {
    if (!_ediagInEditor(e.target)) return;
    const before = _ediagSnap();
    if (!before) return;

    const key = e.key;
    const isNav = NAV.includes(key);
    // e.isComposing = 한글 조합 중. 조합 중 화살표는 IME가 조합을 끊는 시점이라
    // 가장 의심스러운 구간이다. 반드시 함께 남긴다.
    const composing = !!e.isComposing;

    setTimeout(() => {
      const after = _ediagSnap();
      if (!after) return;
      const changed = after.len !== before.len || after.around !== before.around;
      if (isNav && changed) {
        _ediagPush({
          ev: 'nav-changed', key, composing,
          delta: after.len - before.len,
          before, after,
        });
      }
    }, 0);
  }, true);

  // 한글 조합이 끝나는 순간도 따로 남긴다 — 조합 커밋이 엉뚱한 자리에
  // 들어가는 유형은 keydown만 봐서는 안 잡힌다.
  document.addEventListener('compositionend', (e) => {
    if (!_ediagInEditor(e.target)) return;
    const before = _ediagSnap();
    setTimeout(() => {
      const after = _ediagSnap();
      if (!before || !after) return;
      // 조합 결과보다 훨씬 많이 늘었으면 이상
      const grew = after.len - before.len;
      if (grew > (e.data ? e.data.length : 0)) {
        _ediagPush({ ev: 'ime-overshoot', data: e.data || '', delta: grew, before, after });
      }
    }, 0);
  }, true);
})();

// ── (1) 동기화 ─────────────────────────────────────────────────
// 편집 중일 때만 관심 있다. 세 가지를 본다:
//   blockedMs  — 모든 itemsMerged 핸들러가 메인 스레드를 잡은 시간.
//                이게 길면 타이핑이 '밀리는' 직접 원인이다.
//   focusLost  — 재렌더가 포커스를 앗아갔는가
//   커서 이동  — 내가 안 움직였는데 커서가 튀었는가
if (window.SyncEvents) {
  SyncEvents.on('itemsMerged', (d) => {
    if (!_ediagInEditor(document.activeElement)) return;   // 편집 중이 아니면 무시
    const before = _ediagSnap();
    const t0 = performance.now();

    setTimeout(() => {
      // 여기는 emit 루프가 모두 끝난 뒤다 — main.js의 재렌더까지 포함된 시간.
      const blockedMs = Math.round(performance.now() - t0);
      const after = _ediagSnap();
      const focusLost = !_ediagInEditor(document.activeElement);
      const moved = !!(before && after && (after.cur !== before.cur || after.len !== before.len));

      if (blockedMs >= EDIAG_BLOCK_MS || focusLost || moved) {
        _ediagPush({
          ev: 'sync-disturbed',
          types: (d && d.types) || [],
          editingMemoId: (d && d.editingMemoId) != null ? String(d.editingMemoId) : null,
          blockedMs, focusLost, moved,
          before, after,
        });
      }
    }, 0);
  });
}

// ── 패널 ───────────────────────────────────────────────────────
function renderEditorDiag() {
  const out = document.getElementById('editor-diag-out');
  if (!out) return;
  const log = _ediagLoad();

  if (!log.length) {
    out.innerHTML = '<div style="font-size:11.5px;line-height:1.6;color:var(--text-mute);">'
      + '아직 잡힌 사건이 없습니다. 증상이 나타난 뒤 다시 열어보세요.<br>'
      + '정상 동작은 기록하지 않습니다 — 여기 뭔가 찍히면 그게 버그입니다.</div>';
    return;
  }

  const nav = log.filter(r => r.ev === 'nav-changed');
  const ime = log.filter(r => r.ev === 'ime-overshoot');
  const syn = log.filter(r => r.ev === 'sync-disturbed');

  const verdict = [];
  if (nav.length) {
    const comp = nav.filter(r => r.composing).length;
    verdict.push(`화살표가 본문을 바꾼 사건 <b>${nav.length}건</b>`
      + (comp ? ` — 그중 <b>${comp}건이 한글 조합 중</b>. IME가 원인일 가능성이 큽니다.`
              : ' — 조합 중이 아닐 때도 발생. IME와 무관한 경로입니다.'));
  }
  if (ime.length) verdict.push(`한글 조합이 예상보다 많이 입력된 사건 <b>${ime.length}건</b>`);
  if (syn.length) {
    const worst = Math.max(...syn.map(r => r.blockedMs || 0));
    const lost = syn.filter(r => r.focusLost).length;
    const mv = syn.filter(r => r.moved).length;
    verdict.push(`동기화 방해 <b>${syn.length}건</b> — 최대 멈춤 <b>${worst}ms</b>`
      + (lost ? ` · 포커스 잃음 ${lost}건` : '')
      + (mv ? ` · 커서 튐 ${mv}건` : ''));
    if (worst >= 300) verdict.push('멈춤이 300ms를 넘습니다 — 타이핑이 밀리는 직접 원인입니다.');
  }
  if (!verdict.length) verdict.push('기록은 있으나 분류되지 않았습니다.');

  let h = `<div style="font-size:11px;color:var(--accent2);font-weight:800;letter-spacing:.06em;">자동 판정</div>`
    + `<div style="margin-top:6px;font-size:11.5px;line-height:1.7;">${verdict.join('<br>')}</div>`
    + `<div style="margin-top:12px;font-size:11px;color:var(--accent2);font-weight:800;letter-spacing:.06em;">최근 사건 (${log.length}건, 최신순)</div>`
    + '<div style="margin-top:6px;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;line-height:1.65;">';

  for (const r of log.slice(-14).reverse()) {
    const ts = new Date(r.t);
    const stamp = `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')}`;
    let line;
    if (r.ev === 'nav-changed') {
      line = `<b>${r.key}</b>${r.composing ? ' <span style="color:var(--orange)">조합중</span>' : ''} · 길이 ${r.delta > 0 ? '+' : ''}${r.delta}`;
    } else if (r.ev === 'ime-overshoot') {
      line = `<b>IME</b> "${_ediagEsc(r.data)}" · 길이 +${r.delta}`;
    } else {
      line = `<b>동기화</b> ${(r.types || []).join(',')} · ${r.blockedMs}ms`
        + (r.focusLost ? ' · <span style="color:var(--orange)">포커스잃음</span>' : '')
        + (r.moved ? ' · 커서튐' : '');
    }
    h += `<div style="padding:5px 0;border-bottom:1px solid var(--border-light);">`
       + `<span style="color:var(--text-mute);">${stamp}</span> ${line}`
       + `<div style="color:var(--text-dim);">전 ${r.before ? _ediagEsc(r.before.around) : '—'}</div>`
       + `<div style="color:var(--text-dim);">후 ${r.after ? _ediagEsc(r.after.around) : '—'}</div>`
       + `</div>`;
  }
  h += '</div>';
  out.innerHTML = h;
}

function _ediagEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
