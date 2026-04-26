// =================== LEDGER (가계부) ===================
// Quick-entry household ledger. Each entry: { id, type, amount, category, note, date }.
// Synced together with the rest of app data via _mindflow-app.json.

let ledgerEntries = load('ledger', []);
let ledgerIdCounter = load('ledger_idcounter', 1);
let ledgerType = 'expense'; // current quick-add type

const LEDGER_CATEGORIES = {
  expense: ['식비', '카페', '교통', '쇼핑', '주거', '통신', '의료', '문화', '경조사', '기타'],
  income:  ['월급', '부수입', '용돈', '투자', '기타']
};

function saveLedger() {
  save('ledger', ledgerEntries);
  save('ledger_idcounter', ledgerIdCounter);
}

function todayLocalISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function updateCategoryOptions() {
  const sel = document.getElementById('ledger-category');
  if (!sel) return;
  const previous = sel.value;
  const cats = LEDGER_CATEGORIES[ledgerType] || [];
  sel.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  // Try to keep selection if still valid; otherwise pick first
  if (cats.includes(previous)) sel.value = previous;
  else sel.value = cats[0] || '';
}

function setLedgerType(type) {
  ledgerType = type;
  document.querySelectorAll('.ledger-type-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
  updateCategoryOptions();
}

function formatWon(n) {
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

function addLedgerEntry() {
  const amountInput = document.getElementById('ledger-amount');
  const noteInput = document.getElementById('ledger-note');
  const dateInput = document.getElementById('ledger-date');
  const catInput = document.getElementById('ledger-category');
  const raw = (amountInput?.value || '').replace(/[^0-9]/g, '');
  const amount = parseInt(raw, 10);
  if (!amount || amount <= 0) {
    toast('금액을 입력하세요');
    amountInput?.focus();
    return;
  }
  const dateStr = dateInput?.value || todayLocalISODate();
  const [y, m, d] = dateStr.split('-').map(Number);
  const now = new Date();
  const entryDate = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());

  ledgerEntries.unshift({
    id: ledgerIdCounter++,
    type: ledgerType,
    amount,
    category: (catInput?.value || '').trim(),
    note: (noteInput?.value || '').trim(),
    date: entryDate.toISOString()
  });
  saveLedger();
  if (amountInput) amountInput.value = '';
  if (noteInput) noteInput.value = '';
  // Keep date and category as-is — likely the user will add another entry for same context
  renderLedger();
  toast(`${ledgerType === 'income' ? '수입' : '지출'} ${formatWon(amount)} 추가됨`, 'success');
  amountInput?.focus();
}

function deleteLedgerEntry(id) {
  if (!confirm('이 항목을 삭제하시겠습니까?')) return;
  ledgerEntries = ledgerEntries.filter(e => e.id !== id);
  saveLedger();
  renderLedger();
}

function renderLedger() {
  const list = document.getElementById('ledger-list');
  const summary = document.getElementById('ledger-summary');
  if (!list || !summary) return;

  // This-month summary
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  let monthIncome = 0, monthExpense = 0;
  for (const e of ledgerEntries) {
    if (e.date.startsWith(ym)) {
      if (e.type === 'income') monthIncome += e.amount;
      else monthExpense += e.amount;
    }
  }
  const balance = monthIncome - monthExpense;
  summary.innerHTML = `
    <div class="ledger-stat">
      <div class="label">이번 달 수입</div>
      <div class="value income">+${formatWon(monthIncome)}</div>
    </div>
    <div class="ledger-stat">
      <div class="label">이번 달 지출</div>
      <div class="value expense">-${formatWon(monthExpense)}</div>
    </div>
    <div class="ledger-stat">
      <div class="label">잔액</div>
      <div class="value ${balance >= 0 ? 'income' : 'expense'}">${balance >= 0 ? '+' : ''}${formatWon(balance)}</div>
    </div>
  `;

  // Group entries by yyyy-mm-dd
  const groups = new Map();
  for (const e of ledgerEntries) {
    const key = e.date.slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => b.localeCompare(a));

  if (sortedKeys.length === 0) {
    list.innerHTML = `<div class="ledger-empty">
      <div class="big-icon">💰</div>
      <div>아직 기록이 없습니다</div>
      <div style="font-size:12px;color:var(--text-mute);margin-top:6px;">위에서 금액을 입력하고 [추가]를 누르세요</div>
    </div>`;
    return;
  }

  list.innerHTML = sortedKeys.map(k => {
    const [y, m, d] = k.split('-').map(Number);
    const date = new Date(y, m-1, d);
    const dayNames = ['일','월','화','수','목','금','토'];
    const dayLabel = `${m}월 ${d}일 (${dayNames[date.getDay()]})`;
    const isToday = isSameDay(date, new Date());
    let dayIncome = 0, dayExpense = 0;
    for (const e of groups.get(k)) {
      if (e.type === 'income') dayIncome += e.amount;
      else dayExpense += e.amount;
    }
    const dayNet = dayIncome - dayExpense;
    const items = groups.get(k).map(e => {
      const time = e.date.slice(11, 16);
      const sign = e.type === 'income' ? '+' : '-';
      const catBadge = e.category ? `<span class="ledger-cat-badge">${escapeHtml(e.category)}</span>` : '';
      const noteText = e.note || (e.category ? '' : (e.type === 'income' ? '수입' : '지출'));
      return `<div class="ledger-item" data-id="${e.id}">
        <div class="ledger-item-time">${time}</div>
        <div class="ledger-item-note">${catBadge}${escapeHtml(noteText)}</div>
        <div class="ledger-item-amount ${e.type}">${sign}${formatWon(e.amount)}</div>
        <button class="ledger-item-delete" onclick="deleteLedgerEntry(${e.id})" title="삭제">✕</button>
      </div>`;
    }).join('');
    return `<div class="ledger-day">
      <div class="ledger-day-header">
        <div class="ledger-day-date">${dayLabel}${isToday ? ' <span class="today-tag">TODAY</span>' : ''}</div>
        <div class="ledger-day-net ${dayNet >= 0 ? 'income' : 'expense'}">${dayNet >= 0 ? '+' : ''}${formatWon(dayNet)}</div>
      </div>
      <div class="ledger-day-items">${items}</div>
    </div>`;
  }).join('');
}

// Init: render on load (in case ledger page is the active page) and seed
// the date input with today + populate the category dropdown
function initLedger() {
  setTimeout(() => {
    const dateInput = document.getElementById('ledger-date');
    if (dateInput && !dateInput.value) dateInput.value = todayLocalISODate();
    updateCategoryOptions();
    renderLedger();
  }, 0);
}

// Allow Enter in the amount field to submit
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  if (!ae) return;
  if (ae.id !== 'ledger-amount' && ae.id !== 'ledger-note') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    addLedgerEntry();
  }
});
