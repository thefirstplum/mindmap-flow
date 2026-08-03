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
let tbEditingKey = null;   // 편집 중인 블록이 원래 속한 날짜 (날짜 변경 시 이동 처리용)
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

function minutesFromTime(t) {
  const [h,m] = t.split(':').map(Number);
  return h * 60 + m;
}

let _tbDragJustEnded = false;

function minsToTime(m) {
  m = Math.max(0, Math.min(23 * 60 + 59, Math.round(m)));
  return `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function openTbModal(hour) {
  tbClickedHour = hour;
  tbEditingIdx = null;
  tbEditingKey = null;
  document.getElementById('tb-modal-title').textContent = '타임블록 추가';
  document.getElementById('tb-date-input').value = dateKey(currentDate);
  const delBtn = document.getElementById('tb-delete-btn');
  if (delBtn) delBtn.style.display = 'none';
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
  // 어느 날짜의 블록을 편집 중인지 기억한다. 예전엔 저장할 때 전역
  // currentDate만 봤기 때문에, 날짜를 바꾸면 원래 날의 블록을 못 지웠다.
  tbEditingKey = key;
  document.getElementById('tb-modal-title').textContent = '타임블록 편집';
  document.getElementById('tb-date-input').value = key;
  const delBtn = document.getElementById('tb-delete-btn');
  if (delBtn) delBtn.style.display = '';
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

function closeTbModal() {
  document.getElementById('tb-modal').classList.remove('show');
  tbEditingIdx = null; tbEditingKey = null; tbTodos = [];
}

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
  // 날짜 입력값이 우선. 비어 있으면(구버전 캐시 등) 기존처럼 현재 날짜.
  const key = document.getElementById('tb-date-input')?.value || dateKey(currentDate);
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

  const movedDay = tbEditingIdx !== null && tbEditingKey && tbEditingKey !== key;

  if (tbEditingIdx !== null && !movedDay) {
    timeBlocks[key][tbEditingIdx] = data;
    toast('수정되었습니다', 'success');
  } else if (movedDay) {
    // 다른 날짜로 이동 — 원래 날에서 빼고 새 날에 넣는다.
    // 원본 제거를 빠뜨리면 블록이 양쪽 날짜에 복제된다.
    timeBlocks[tbEditingKey].splice(tbEditingIdx, 1);
    if (timeBlocks[tbEditingKey].length === 0) {
      delete timeBlocks[tbEditingKey];
      delete tbMeta[tbEditingKey];
    } else {
      updateTbMeta(tbEditingKey);
    }
    timeBlocks[key].push(data);
    const [, mm, dd] = key.split('-');
    toast(`${Number(mm)}월 ${Number(dd)}일로 옮겼습니다`, 'success');
  } else {
    timeBlocks[key].push(data);
    toast('추가되었습니다', 'success');
  }
  timeBlocks[key].sort((a, b) => a.start.localeCompare(b.start));
  save('tb_blocks', timeBlocks);
  save('tb_meta', tbMeta);
  updateTbMeta(key);
  closeTbModal();

  if (typeof renderCalendar === 'function') renderCalendar();
}

// 모달의 삭제 버튼 — 편집 중인 블록을 지운다.
// deleteTbBlock 자체는 예전부터 있었지만 모달에서 부를 방법이 없었다.
function deleteTbFromModal() {
  if (tbEditingIdx === null || !tbEditingKey) return;
  const block = (timeBlocks[tbEditingKey] || [])[tbEditingIdx];
  const name = block ? block.title : '이 블록';
  if (!confirm(`"${name}"을(를) 삭제할까요?`)) return;
  deleteTbBlock(tbEditingKey, tbEditingIdx);
  closeTbModal();
  toast('삭제되었습니다', 'success');
  if (typeof renderCalendar === 'function') renderCalendar();
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

}

function toggleTbDone(key, idx) {
  if (!timeBlocks[key] || !timeBlocks[key][idx]) return;
  timeBlocks[key][idx].done = !timeBlocks[key][idx].done;
  save('tb_blocks', timeBlocks);
  updateTbMeta(key);

}

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

// (타임블록 독립 페이지 제거로 "지금" 표시 갱신 타이머도 삭제.
//  page-timeblock이 없어져 getElementById가 null을 돌려주므로 그대로 두면
//  1분마다 TypeError가 났다. 캘린더의 now-line은 자체 렌더가 처리한다.)

