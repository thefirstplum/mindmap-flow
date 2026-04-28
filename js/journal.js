// =================== JOURNAL ===================
let journalEntries = load('journal_entries', {});
let journalCurrentDate = new Date();

const MOODS = [
  { e: '😊', l: '행복' }, { e: '🥰', l: '설렘' }, { e: '😌', l: '평온' },
  { e: '💪', l: '의욕' }, { e: '🤩', l: '신남' }, { e: '😄', l: '즐거움' },
  { e: '🤔', l: '고민' }, { e: '😴', l: '피곤' }, { e: '😔', l: '슬픔' },
  { e: '🥺', l: '속상' }, { e: '😰', l: '불안' }, { e: '😤', l: '답답' },
  { e: '😡', l: '화남' }, { e: '🌧', l: '우울' }, { e: '😶', l: '무감각' },
];

let _jSaveTimer = null;

function journalDK(d) {
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
}

function renderJournalDate() {
  const d = journalCurrentDate;
  const isToday = isSameDay(d, new Date());
  const el = document.getElementById('journal-date');
  if (!el) return;
  el.innerHTML = `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일<span class="day-of-week">${dayNames[d.getDay()]}</span>`
    + (isToday ? '<span class="today-badge">오늘</span>' : '');
}

function renderJournalEditor() {
  const key = journalDK(journalCurrentDate);
  const entry = journalEntries[key] || { mood: '', content: '' };

  const picker = document.getElementById('journal-mood-picker');
  if (picker) {
    picker.innerHTML = MOODS.map(m =>
      `<button class="mood-btn${entry.mood === m.e ? ' active' : ''}" onclick="setJournalMood('${m.e}')" title="${m.l}">${m.e}</button>`
    ).join('');
  }

  const ta = document.getElementById('journal-textarea');
  if (ta) {
    ta.value = entry.content || '';
    ta.oninput = () => {
      clearTimeout(_jSaveTimer);
      _jSaveTimer = setTimeout(saveJournalEntry, 600);
    };
  }
}

function setJournalMood(emoji) {
  const key = journalDK(journalCurrentDate);
  if (!journalEntries[key]) journalEntries[key] = { mood: '', content: '' };
  journalEntries[key].mood = journalEntries[key].mood === emoji ? '' : emoji;
  journalEntries[key].updatedAt = new Date().toISOString();
  _pruneJournalEntry(key);
  save('journal_entries', journalEntries);
  renderJournalEditor();
  renderJournalList();
}

function saveJournalEntry() {
  const key = journalDK(journalCurrentDate);
  const ta = document.getElementById('journal-textarea');
  if (!ta) return;
  if (!journalEntries[key]) journalEntries[key] = { mood: '', content: '' };
  journalEntries[key].content = ta.value;
  journalEntries[key].updatedAt = new Date().toISOString();
  _pruneJournalEntry(key);
  save('journal_entries', journalEntries);
  renderJournalList();
}

function _pruneJournalEntry(key) {
  const e = journalEntries[key];
  if (e && !e.mood && !(e.content || '').trim()) delete journalEntries[key];
}

function renderJournalList() {
  const container = document.getElementById('journal-items');
  if (!container) return;
  const keys = Object.keys(journalEntries).sort((a, b) => b.localeCompare(a));
  const countEl = document.getElementById('journal-count');
  if (countEl) countEl.textContent = keys.length;
  const curKey = journalDK(journalCurrentDate);
  const todayKey = journalDK(new Date());

  if (keys.length === 0) {
    container.innerHTML = '<div class="journal-list-empty">아직 기록이 없어요 😊</div>';
    return;
  }

  container.innerHTML = keys.map(k => {
    const entry = journalEntries[k];
    const [y, m, d] = k.split('-').map(Number);
    const date = new Date(y, m-1, d);
    const preview = (entry.content || '').trim().replace(/\n/g, ' ').slice(0, 55);
    const isToday = k === todayKey;
    return `<div class="journal-list-item${k === curKey ? ' active' : ''}${isToday ? ' is-today' : ''}" onclick="journalGoToDate('${k}')">
      <div class="journal-list-mood">${entry.mood || '📝'}</div>
      <div class="journal-list-info">
        <div class="journal-list-date">${m}월 ${d}일 (${dayNames[date.getDay()]})${isToday ? '<span class="today-tag">TODAY</span>' : ''}</div>
        <div class="journal-list-preview">${escapeHtml(preview) || '<span style="opacity:.45">내용 없음</span>'}</div>
      </div>
    </div>`;
  }).join('');
}

function journalGoToDate(key) {
  saveJournalEntry();
  const [y, m, d] = key.split('-').map(Number);
  journalCurrentDate = new Date(y, m-1, d);
  renderJournalDate();
  renderJournalEditor();
  renderJournalList();
  showJournalDetail();
}

function journalPrevDay() {
  saveJournalEntry();
  journalCurrentDate.setDate(journalCurrentDate.getDate() - 1);
  renderJournalDate();
  renderJournalEditor();
  renderJournalList();
}

function journalNextDay() {
  saveJournalEntry();
  journalCurrentDate.setDate(journalCurrentDate.getDate() + 1);
  renderJournalDate();
  renderJournalEditor();
  renderJournalList();
}

function journalGoToday() {
  saveJournalEntry();
  journalCurrentDate = new Date();
  renderJournalDate();
  renderJournalEditor();
  renderJournalList();
  showJournalDetail();
}

function showJournalDetail() {
  const el = document.getElementById('journal-page-root');
  if (el) el.classList.add('show-detail');
}

function backToJournalList() {
  saveJournalEntry();
  const el = document.getElementById('journal-page-root');
  if (el) el.classList.remove('show-detail');
}

renderJournalDate();
renderJournalEditor();
renderJournalList();
