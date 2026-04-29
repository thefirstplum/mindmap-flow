// =================== TIME BLOCK ===================
let currentDate = new Date();
let timeBlocks = load('tb_blocks', {});
let tbMeta = load('tb_meta', {}); // { 'YYYY-MM-DD': ISO_TIMESTAMP } — tracks last local write per day
// Stamp existing days so sync doesn't blindly overwrite them after upgrade
if (Object.keys(tbMeta).length === 0 && Object.keys(timeBlocks).length > 0) {
  const now = new Date().toISOString();
  Object.keys(timeBlocks).forEach(k => { tbMeta[k] = now; });
  save('tb_meta', tbMeta);
}

// Migrate old color names to current palette
(function migrateTbColors() {
  const MAP = { accent: 'yellow', pink: 'magenta' };
  let changed = false;
  Object.values(timeBlocks).forEach(blocks => {
    blocks.forEach(b => {
      if (b.color && MAP[b.color]) { b.color = MAP[b.color]; changed = true; }
    });
  });
  if (changed) save('tb_blocks', timeBlocks);
})();
function updateTbMeta(key) {
  tbMeta[key] = new Date().toISOString();
  save('tb_meta', tbMeta);
}

let tbSelectedColor = 'yellow';
let tbClickedHour = null;
let tbEditingIdx = null;
let tbTodos = [];
let _tbModalDuration = 60; // minutes — preserved when start time changes

// ── 프리픽스 자동 색상 ──
// "무전기: ㅇㅇ" 처럼 "PREFIX: 내용" 패턴을 감지해서 같은 프리픽스는 같은 색상으로 자동 매핑
let tbPrefixColors = load('tb_prefix_colors', {}); // { "무전기": "yellow", "POS": "orange", ... }
const TB_COLOR_CYCLE = ['yellow','orange','blue','green','purple','cyan','red','violet','teal','rose','magenta','sky','brown','slate'];

function extractTbPrefix(title) {
  const m = (title || '').match(/^([^:：]{1,20})[：:]\s*.+/);
  return m ? m[1].trim() : null;
}

function getColorForPrefix(prefix) {
  if (tbPrefixColors[prefix]) return tbPrefixColors[prefix];
  // 새 프리픽스: 아직 안 쓴 색상 중 첫 번째 배정
  const used = new Set(Object.values(tbPrefixColors));
  const next = TB_COLOR_CYCLE.find(c => !used.has(c)) || TB_COLOR_CYCLE[Object.keys(tbPrefixColors).length % TB_COLOR_CYCLE.length];
  tbPrefixColors[prefix] = next;
  save('tb_prefix_colors', tbPrefixColors);
  return next;
}

function applyPrefixColor(title) {
  const prefix = extractTbPrefix(title);
  if (!prefix) return;
  const color = getColorForPrefix(prefix);
  tbSelectedColor = color;
  document.querySelectorAll('.modal-colors .mc').forEach(m => {
    m.classList.toggle('active', m.dataset.color === color);
  });
}

const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

function dateKey(d) {
  const y = d.getFullYear();
  const m = (d.getMonth()+1).toString().padStart(2,'0');
  const dd = d.getDate().toString().padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function renderDate() {
  const d = currentDate;
  const today = new Date();
  const isToday = isSameDay(d, today);
  const str = `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일<span class="day-of-week">${dayNames[d.getDay()]}</span>`;
  document.getElementById('tb-date').innerHTML = str + (isToday ? '<span class="today-badge">오늘</span>' : '');
}

function minutesFromTime(t) {
  const [h,m] = t.split(':').map(Number);
  return h * 60 + m;
}

function renderTimeBlocks() {
  const body = document.getElementById('timeblock-body');
  const key = dateKey(currentDate);
  const blocks = timeBlocks[key] || [];
  const ROW_HEIGHT = 60; // px per hour
  const START_HOUR = 6;
  const END_HOUR = 23; // inclusive

  // Summary
  let totalMin = 0;
  blocks.forEach(b => {
    const dur = minutesFromTime(b.end) - minutesFromTime(b.start);
    if (dur > 0) totalMin += dur;
  });
  const fmt = m => `${Math.floor(m/60)}시간 ${m%60}분`;

  let html = `<div class="day-summary">
    <div class="stat"><div class="label">블록</div><div class="value">${blocks.length}개</div></div>
    <div class="stat"><div class="label">계획 시간</div><div class="value">${fmt(totalMin)}</div></div>
    <div class="stat"><div class="label">완료</div><div class="value">${blocks.filter(b=>b.done).length} / ${blocks.length}</div></div>
  </div>`;

  // Ledger summary card — only when the ledger feature is enabled in settings
  if (typeof appSettings !== 'undefined' && appSettings.ledgerEnabled && typeof ledgerEntries !== 'undefined') {
    // Local-timezone match — entries' ISO timestamps are UTC, so slicing
     // would mis-bucket morning-Korea entries. localDateKey converts back
     // to local before comparing.
    const dayKey = dateKey(currentDate);
    const todays = ledgerEntries.filter(e => localDateKey(e.date) === dayKey);
    let dayIncome = 0, dayExpense = 0;
    todays.forEach(e => {
      if (e.type === 'income') dayIncome += e.amount;
      else dayExpense += e.amount;
    });
    const dayNet = dayIncome - dayExpense;
    const recent = todays.slice(0, 3);
    const winFmt = n => new Intl.NumberFormat('ko-KR').format(n) + '원';
    const recentList = recent.length === 0
      ? '<div class="tb-ledger-empty">이 날은 기록 없음</div>'
      : recent.map(e => {
          const time = localTimeHHMM(e.date);
          const sign = e.type === 'income' ? '+' : '-';
          const cls = e.type === 'income' ? 'income' : 'expense';
          const label = e.category || (e.type === 'income' ? '수입' : '지출');
          return `<div class="tb-ledger-line">
            <span class="tb-ledger-time">${time}</span>
            <span class="tb-ledger-label">${escapeHtml(label)}${e.note ? ' · ' + escapeHtml(e.note) : ''}</span>
            <span class="tb-ledger-amt ${cls}">${sign}${winFmt(e.amount)}</span>
          </div>`;
        }).join('');

    html += `<div class="tb-ledger-card" onclick="goToLedger()">
      <div class="tb-ledger-header">
        <div class="tb-ledger-title">💰 가계부</div>
        <div class="tb-ledger-totals">
          <span class="income">+${winFmt(dayIncome)}</span>
          <span class="sep">·</span>
          <span class="expense">-${winFmt(dayExpense)}</span>
          <span class="net ${dayNet >= 0 ? 'income' : 'expense'}">잔액 ${dayNet >= 0 ? '+' : ''}${winFmt(dayNet)}</span>
        </div>
      </div>
      <div class="tb-ledger-recent">${recentList}</div>
      ${todays.length > 3 ? `<div class="tb-ledger-more">+ ${todays.length - 3}건 더</div>` : ''}
    </div>`;
  }

  const today = new Date();
  const isToday = isSameDay(currentDate, today);
  const nowH = today.getHours();
  const nowM = today.getMinutes();

  // Background hour grid
  html += '<div class="timeblock-grid">';
  html += '<div class="time-rows-bg">';
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    const label = h.toString().padStart(2, '0') + ':00';
    const isNowRow = isToday && nowH === h;
    const nowOffset = isNowRow ? `${(nowM / 60) * 100}%` : '0';
    html += `<div class="time-row ${isNowRow ? 'now-row' : ''}" style="--now-offset: ${nowOffset}">
      <div class="time-label">${label}</div>
      <div class="time-slot" data-hour="${h}"></div>
    </div>`;
  }
  html += '</div>';

  // Foreground blocks layer (absolute positioned, visually span their duration)
  html += '<div class="time-blocks-layer">';
  const layout = computeBlockLayout(blocks);
  blocks.forEach((b, idx) => {
    const startMin = minutesFromTime(b.start);
    const endMin = minutesFromTime(b.end);
    const startOffset = startMin - START_HOUR * 60;
    const duration = Math.max(20, endMin - startMin); // min visual height for tiny blocks
    if (startOffset + duration <= 0) return; // entirely before view
    const visibleStart = Math.max(0, startOffset);
    const visibleHeight = Math.min((END_HOUR + 1 - START_HOUR) * 60 - visibleStart, duration - (visibleStart - startOffset));
    if (visibleHeight <= 0) return;
    const top = visibleStart;
    const height = visibleHeight;
    const todoTotal = (b.todos || []).length;
    const todoDone = (b.todos || []).filter(t => t.done).length;
    const { col, totalCols } = layout[idx];
    html += `<div class="time-block-item tb-color-${b.color} ${b.done ? 'done' : ''}" data-idx="${idx}" data-start="${b.start}" data-end="${b.end}" style="top:${top}px;height:${height}px;${colStyle(col, totalCols)}">
      <div class="block-title">
        <span class="block-checkbox" data-toggle="${idx}" title="완료 토글" aria-label="완료 토글"></span>
        <span class="block-title-text">${escapeHtml(b.title)}</span>
      </div>
      ${height > 36 ? `<div class="block-time">${b.start} – ${b.end}</div>` : ''}
      ${todoTotal > 0 && height > 50 ? `<div class="block-todo-chip">${todoDone}/${todoTotal} ✓</div>` : ''}
      ${b.desc && height > 78 ? `<div class="block-desc">${escapeHtml(b.desc)}</div>` : ''}
      <div class="block-actions">
        <button class="block-dup" data-dup="${idx}" title="복제">⎘</button>
        <button class="block-delete" data-del="${idx}" title="삭제">✕</button>
      </div>
      <div class="tb-resize-handle"></div>
    </div>`;
  });
  // 블록이 없으면 안내 힌트 표시
  if (blocks.length === 0) {
    html += `<div class="tb-empty-state">
      <div class="tb-empty-icon">📅</div>
      <div class="tb-empty-title">오늘의 계획을 세워보세요</div>
      <div class="tb-empty-desc">시간대를 탭하면 블록을 추가할 수 있어요</div>
    </div>`;
  }
  html += '</div>';
  html += '</div>';

  body.innerHTML = html;

  // Wire up events
  body.querySelectorAll('.time-slot').forEach(s => {
    s.addEventListener('click', () => openTbModal(parseInt(s.dataset.hour)));
  });
  body.querySelectorAll('.time-block-item').forEach(item => {
    item.addEventListener('click', e => {
      if (_tbDragJustEnded) return;
      if (e.target.closest('[data-toggle]')) {
        const idx = parseInt(e.target.dataset.toggle);
        toggleTbDone(key, idx);
        return;
      }
      if (e.target.closest('[data-del]')) {
        e.stopPropagation();
        const idx = parseInt(e.target.dataset.del);
        if (confirm('이 블록을 삭제하시겠습니까?')) deleteTbBlock(key, idx);
        return;
      }
      if (e.target.closest('[data-dup]')) {
        e.stopPropagation();
        const idx = parseInt(e.target.dataset.dup);
        duplicateTbBlock(key, idx);
        return;
      }
      const idx = parseInt(item.dataset.idx);
      editTbBlock(key, idx);
    });
  });
  attachTbDrag(body, key);

  // 오늘 보는 경우 현재 시각 라인으로 자동 스크롤
  if (isToday) {
    requestAnimationFrame(() => {
      const nowRow = body.querySelector('.now-row');
      const container = document.querySelector('.tb-main');
      if (nowRow && container) {
        const top = nowRow.offsetTop - container.clientHeight / 3;
        container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    });
  }
}

let _tbDragJustEnded = false;

function computeBlockLayout(blocks) {
  const n = blocks.length;
  const mS = blocks.map(b => minutesFromTime(b.start));
  const mE = blocks.map((b, i) => Math.max(minutesFromTime(b.end), mS[i] + 1));
  const col = new Array(n).fill(0);
  const slots = [];
  for (let i = 0; i < n; i++) {
    let c = -1;
    for (let s = 0; s < slots.length && s < 3; s++) {
      if (slots[s] <= mS[i]) { c = s; break; }
    }
    if (c === -1) c = Math.min(slots.length, 2);
    col[i] = c;
    if (c >= slots.length) slots.push(mE[i]);
    else slots[c] = Math.max(slots[c], mE[i]);
  }
  // Union-find: group transitively overlapping blocks together
  const par = Array.from({length: n}, (_, i) => i);
  const find = x => par[x] === x ? x : (par[x] = find(par[x]));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (mS[i] < mE[j] && mE[i] > mS[j]) par[find(i)] = find(j);
  const gMax = {};
  for (let i = 0; i < n; i++) { const g = find(i); gMax[g] = Math.max(gMax[g] ?? 0, col[i]); }
  return blocks.map((_, i) => ({ col: col[i], totalCols: gMax[find(i)] + 1 }));
}

function colStyle(c, total) {
  if (total <= 1) return '';
  const lp = (c / total * 100).toFixed(2);
  const rp = ((total - c - 1) / total * 100).toFixed(2);
  const left  = c === 0         ? '6px' : `calc(${lp}% + 3px)`;
  const right = c === total - 1 ? '6px' : `calc(${rp}% + 3px)`;
  return `left:${left};right:${right};`;
}

function minsToTime(m) {
  m = Math.max(0, Math.min(23 * 60 + 59, Math.round(m)));
  return `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
}

function attachTbDrag(container, key) {
  const layer = container.querySelector('.time-blocks-layer');
  if (!layer) return;
  const START_HOUR = 6;
  const END_HOUR = 23;
  const LONG_PRESS_MS = 420;

  let drag = null;
  let pending = null;
  let lpTimer = null;

  function clearPending() {
    clearTimeout(lpTimer);
    lpTimer = null;
    if (pending) { pending.item.classList.remove('tb-pressing'); pending = null; }
  }

  function activateDrag() {
    if (!pending) return;
    lpTimer = null;
    drag = pending;
    pending = null;
    drag.item.classList.remove('tb-pressing');
    drag.item.classList.add('tb-dragging');
    if (navigator.vibrate) navigator.vibrate(40);
  }

  function onMove(e) {
    if (pending) {
      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (dx * dx + dy * dy > 400) clearPending(); // >20px, user is scrolling
    }
    if (!drag) return;
    e.preventDefault();

    const delta = e.clientY - drag.startY;
    const deltaMin = Math.round(delta / 5) * 5;

    if (drag.mode === 'move') {
      const dur = drag.origEndMin - drag.origStartMin;
      let s = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - dur, drag.origStartMin + deltaMin));
      drag.curStartMin = s;
      drag.curEndMin   = s + dur;
      drag.item.style.top = (s - START_HOUR * 60) + 'px';
    } else {
      let e2 = Math.max(drag.origStartMin + 15, Math.min((END_HOUR + 1) * 60, drag.origEndMin + deltaMin));
      drag.curEndMin = e2;
      drag.item.style.height = Math.max(15, e2 - drag.origStartMin) + 'px';
    }

    const timeEl = drag.item.querySelector('.block-time');
    if (timeEl) timeEl.textContent = `${minsToTime(drag.curStartMin)} – ${minsToTime(drag.curEndMin)}`;
  }

  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    clearPending();
    if (!drag) return;

    const { item, idx, curStartMin, curEndMin } = drag;
    item.classList.remove('tb-dragging');
    drag = null;

    _tbDragJustEnded = true;
    setTimeout(() => { _tbDragJustEnded = false; }, 250);

    const blocks = timeBlocks[key];
    if (!blocks || !blocks[idx]) { renderTimeBlocks(); return; }
    blocks[idx].start = minsToTime(curStartMin);
    blocks[idx].end   = minsToTime(curEndMin);
    timeBlocks[key].sort((a, b) => a.start.localeCompare(b.start));
    save('tb_blocks', timeBlocks);
    updateTbMeta(key);
    renderTimeBlocks();
    renderTimeblockList();
  }

  function onCancel() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    clearPending();
    if (!drag) return;
    drag.item.classList.remove('tb-dragging');
    drag.item.style.top    = drag.origTop + 'px';
    drag.item.style.height = drag.origHeight + 'px';
    drag = null;
  }

  layer.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.tb-resize-handle');
    const item   = e.target.closest('.time-block-item');
    if (!item) return;
    if (!handle && e.target.closest('.block-checkbox, .block-delete, .block-dup, [data-toggle], [data-del], [data-dup]')) return;

    const origStartMin = minutesFromTime(item.dataset.start);
    const origEndMin   = minutesFromTime(item.dataset.end);
    pending = {
      item,
      idx: parseInt(item.dataset.idx),
      mode: handle ? 'resize' : 'move',
      startX: e.clientX, startY: e.clientY,
      origTop: parseInt(item.style.top),
      origHeight: parseInt(item.style.height),
      origStartMin, origEndMin,
      curStartMin: origStartMin,
      curEndMin: origEndMin,
    };
    item.classList.add('tb-pressing');
    lpTimer = setTimeout(activateDrag, LONG_PRESS_MS);

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function prevDay() { currentDate.setDate(currentDate.getDate() - 1); renderDate(); renderTimeBlocks(); renderTimeblockList(); }
function nextDay() { currentDate.setDate(currentDate.getDate() + 1); renderDate(); renderTimeBlocks(); renderTimeblockList(); }
function goToday() {
  currentDate = new Date();
  renderDate(); renderTimeBlocks(); renderTimeblockList();
  showTbDetail();
}
function goToDate(key) {
  const [y,m,d] = key.split('-').map(Number);
  currentDate = new Date(y, m-1, d);
  renderDate(); renderTimeBlocks(); renderTimeblockList();
  showTbDetail();
}
function showTbDetail() {
  const el = document.getElementById('timeblock-page-root');
  if (el) el.classList.add('show-detail');
}
function backToTbList() {
  const el = document.getElementById('timeblock-page-root');
  if (el) el.classList.remove('show-detail');
}

function renderTimeblockList() {
  const container = document.getElementById('timeblock-items');
  if (!container) return;
  const today = new Date();
  const todayKey = dateKey(today);
  const currentKey = dateKey(currentDate);
  const dateSet = new Set([todayKey, currentKey, ...Object.keys(timeBlocks)]);
  const sortedKeys = [...dateSet].sort((a,b) => b.localeCompare(a));

  let totalBlocks = 0;
  Object.values(timeBlocks).forEach(arr => totalBlocks += arr.length);
  const countEl = document.getElementById('tb-count');
  if (countEl) countEl.textContent = totalBlocks;

  container.innerHTML = sortedKeys.map(k => {
    const [y,m,d] = k.split('-').map(Number);
    const date = new Date(y, m-1, d);
    const dayName = dayNames[date.getDay()];
    const blocks = timeBlocks[k] || [];
    const done = blocks.filter(b=>b.done).length;
    const isToday = k === todayKey;
    const isActive = k === currentKey;
    const pct = blocks.length ? (done/blocks.length)*100 : 0;
    const meta = blocks.length === 0
      ? '<span style="color:var(--text-mute)">일정 없음</span>'
      : `<span>${done}/${blocks.length}</span><div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`;
    return `<div class="swipe-row" data-id="${k}">
      <div class="tb-list-item swipe-content ${isActive ? 'active' : ''} ${isToday ? 'is-today' : ''}" onclick="goToDate('${k}')">
        <div class="tb-list-date">${date.getMonth()+1}월 ${date.getDate()}일 (${dayName})${isToday ? '<span class="today-tag">TODAY</span>' : ''}</div>
        <div class="tb-list-meta">${meta}</div>
      </div>
      ${blocks.length > 0 ? '<button class="swipe-action" aria-label="이날 일정 모두 삭제">🗑 모두 삭제</button>' : ''}
    </div>`;
  }).join('');
  if (!container.dataset.swipeReady) {
    attachSwipeToDelete(container, {
      resolveId: (row) => row.dataset.id,
      onDelete: (key) => {
        if (!confirm(`${key} 의 모든 일정을 삭제하시겠습니까?`)) return;
        delete timeBlocks[key];
        save('tb_blocks', timeBlocks);
        renderTimeBlocks();
        renderTimeblockList();
      }
    });
    container.dataset.swipeReady = '1';
  }
}

function openTbModal(hour) {
  tbClickedHour = hour;
  tbEditingIdx = null;
  document.getElementById('tb-modal-title').textContent = '타임블록 추가';
  document.getElementById('tb-title').value = '';
  document.getElementById('tb-start').value = hour.toString().padStart(2, '0') + ':00';
  document.getElementById('tb-end').value = (hour + 1).toString().padStart(2, '0') + ':00';
  document.getElementById('tb-desc').value = '';
  document.getElementById('tb-done').checked = false;
  tbTodos = [];
  _tbModalDuration = 60;
  renderTbTodos();
  const firstDot = document.querySelector('.modal-colors .mc');
  tbSelectedColor = firstDot?.dataset.color || 'yellow';
  document.querySelectorAll('.modal-colors .mc').forEach(m => m.classList.remove('active'));
  if (firstDot) firstDot.classList.add('active');
  document.getElementById('tb-modal').classList.add('show');
  // 제목 입력 시 프리픽스 자동 색상 감지
  const titleEl = document.getElementById('tb-title');
  titleEl.oninput = () => applyPrefixColor(titleEl.value);
  setTimeout(() => titleEl.focus(), 100);
}

function editTbBlock(key, idx) {
  const block = timeBlocks[key][idx];
  if (!block) return;
  tbEditingIdx = idx;
  document.getElementById('tb-modal-title').textContent = '타임블록 편집';
  document.getElementById('tb-title').value = block.title;
  document.getElementById('tb-start').value = block.start;
  document.getElementById('tb-end').value = block.end;
  document.getElementById('tb-desc').value = block.desc || '';
  document.getElementById('tb-done').checked = !!block.done;
  tbTodos = (block.todos || []).map(t => ({ ...t }));
  _tbModalDuration = Math.max(15, minutesFromTime(block.end) - minutesFromTime(block.start));
  renderTbTodos();
  tbSelectedColor = block.color;
  document.querySelectorAll('.modal-colors .mc').forEach(m => {
    m.classList.toggle('active', m.dataset.color === block.color);
  });
  // 편집 시에도 제목 변경하면 프리픽스 자동 색상
  const titleEl2 = document.getElementById('tb-title');
  titleEl2.oninput = () => applyPrefixColor(titleEl2.value);
  document.getElementById('tb-modal').classList.add('show');
}

function closeTbModal() { document.getElementById('tb-modal').classList.remove('show'); tbEditingIdx = null; tbTodos = []; }

function renderTbTodos() {
  const list = document.getElementById('tb-todo-list');
  if (!list) return;
  list.innerHTML = tbTodos.map((t, i) => `
    <div class="tb-todo-item${t.done ? ' done' : ''}">
      <button class="tb-todo-check" onclick="toggleTbTodoItem(${i},${!t.done})">${t.done ? '✓' : ''}</button>
      <input class="tb-todo-text" type="text" value="${escapeHtml(t.text)}"
        oninput="tbTodos[${i}].text=this.value"
        onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault();document.getElementById('tb-todo-input').focus();}">
      <button class="tb-todo-del" onclick="removeTbTodo(${i})">✕</button>
    </div>`).join('');
}

function editTbTodoText(idx, val) {
  if (tbTodos[idx]) tbTodos[idx].text = val;
}

function addTbTodo() {
  const input = document.getElementById('tb-todo-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  tbTodos.push({ text, done: false });
  input.value = '';
  renderTbTodos();
}

function toggleTbTodoItem(idx, done) {
  if (tbTodos[idx]) { tbTodos[idx].done = done; renderTbTodos(); }
}

function removeTbTodo(idx) {
  tbTodos.splice(idx, 1);
  renderTbTodos();
}

function setTbColor(el) {
  document.querySelectorAll('.modal-colors .mc').forEach(m => m.classList.remove('active'));
  el.classList.add('active');
  tbSelectedColor = el.dataset.color;
}

function saveTbBlock() {
  const title = document.getElementById('tb-title').value.trim();
  if (!title) { toast('제목을 입력하세요'); return; }
  const start = document.getElementById('tb-start').value;
  const end = document.getElementById('tb-end').value;
  if (!start || !end) { toast('시간을 설정하세요'); return; }
  const key = dateKey(currentDate);
  if (!timeBlocks[key]) timeBlocks[key] = [];

  // 프리픽스가 있으면 현재 선택 색상을 해당 프리픽스에 저장 (수동 변경도 반영)
  const prefix = extractTbPrefix(title);
  if (prefix && tbPrefixColors[prefix] !== tbSelectedColor) {
    tbPrefixColors[prefix] = tbSelectedColor;
    save('tb_prefix_colors', tbPrefixColors);
  }

  const data = {
    title, start, end,
    desc: document.getElementById('tb-desc').value.trim(),
    color: tbSelectedColor,
    done: document.getElementById('tb-done').checked,
    todos: tbTodos.filter(t => t.text.trim())
  };

  if (tbEditingIdx !== null) {
    timeBlocks[key][tbEditingIdx] = data;
    toast('수정되었습니다', 'success');
  } else {
    timeBlocks[key].push(data);
    toast('추가되었습니다', 'success');
  }
  timeBlocks[key].sort((a, b) => a.start.localeCompare(b.start));
  save('tb_blocks', timeBlocks);
  updateTbMeta(key);
  closeTbModal();
  renderTimeBlocks();
  renderTimeblockList();
}

function deleteTbBlock(key, idx) {
  timeBlocks[key].splice(idx, 1);
  if (timeBlocks[key].length === 0) {
    delete timeBlocks[key];
    delete tbMeta[key]; save('tb_meta', tbMeta);
  } else {
    updateTbMeta(key);
  }
  save('tb_blocks', timeBlocks);
  renderTimeBlocks();
  renderTimeblockList();
}

function duplicateTbBlock(key, idx) {
  const blocks = timeBlocks[key];
  if (!blocks || !blocks[idx]) return;
  const src = blocks[idx];
  const dur = minutesFromTime(src.end) - minutesFromTime(src.start);
  const newStart = Math.min(23 * 60 + 59, minutesFromTime(src.end));
  const newEnd = Math.min(23 * 60 + 59, newStart + dur);
  const copy = { ...src, start: minsToTime(newStart), end: minsToTime(newEnd), done: false, todos: (src.todos || []).map(t => ({ ...t, done: false })) };
  blocks.splice(idx + 1, 0, copy);
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  save('tb_blocks', timeBlocks);
  updateTbMeta(key);
  renderTimeBlocks();
  renderTimeblockList();
  toast('블록이 복제되었습니다', 'success');
}

function toggleTbDone(key, idx) {
  if (!timeBlocks[key] || !timeBlocks[key][idx]) return;
  timeBlocks[key][idx].done = !timeBlocks[key][idx].done;
  save('tb_blocks', timeBlocks);
  updateTbMeta(key);
  renderTimeBlocks();
  renderTimeblockList();
}

renderDate();
renderTimeBlocks();
renderTimeblockList();

// Wire modal input events
(function() {
  const inp = document.getElementById('tb-todo-input');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addTbTodo(); } });

  const startInput = document.getElementById('tb-start');
  const endInput   = document.getElementById('tb-end');
  if (startInput && endInput) {
    startInput.addEventListener('change', () => {
      const s = minutesFromTime(startInput.value);
      endInput.value = minsToTime(Math.min(23 * 60 + 59, s + _tbModalDuration));
    });
    // Also track manual end changes to keep duration in sync
    endInput.addEventListener('change', () => {
      const s = minutesFromTime(startInput.value);
      const e = minutesFromTime(endInput.value);
      if (e > s) _tbModalDuration = e - s;
    });
  }
})();

// Refresh "now" indicator every minute
setInterval(() => {
  if (document.getElementById('page-timeblock').classList.contains('active')) renderTimeBlocks();
}, 60000);

