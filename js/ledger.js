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

function getLedgerMethods() {
  if (typeof appSettings !== 'undefined' && Array.isArray(appSettings.ledgerMethods) && appSettings.ledgerMethods.length) {
    return appSettings.ledgerMethods;
  }
  return ['현금', '체크카드', '지역화폐', '신용카드'];
}

function updateMethodOptions() {
  const sel = document.getElementById('ledger-method');
  if (!sel) return;
  const previous = sel.value;
  const methods = getLedgerMethods();
  sel.innerHTML = methods.map(m => `<option value="${m}">${m}</option>`).join('');
  if (methods.includes(previous)) sel.value = previous;
  else sel.value = methods[0] || '';
}

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
  const methodInput = document.getElementById('ledger-method');
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
    method: (methodInput?.value || '').trim(),
    note: (noteInput?.value || '').trim(),
    date: entryDate.toISOString()
  });
  saveLedger();
  if (amountInput) amountInput.value = '';
  if (noteInput) noteInput.value = '';
  renderLedger();
  // If timeblock page is showing the ledger summary card, refresh it
  if (typeof renderTimeBlocks === 'function' && document.getElementById('page-timeblock')?.classList.contains('active')) {
    renderTimeBlocks();
  }
  toast(`${ledgerType === 'income' ? '수입' : '지출'} ${formatWon(amount)} 추가됨`, 'success');
  amountInput?.focus();
}

function deleteLedgerEntry(id) {
  if (!confirm('이 항목을 삭제하시겠습니까?')) return;
  ledgerEntries = ledgerEntries.filter(e => e.id !== id);
  saveLedger();
  renderLedger();
  if (typeof renderTimeBlocks === 'function' && document.getElementById('page-timeblock')?.classList.contains('active')) {
    renderTimeBlocks();
  }
}

function renderLedger() {
  const list = document.getElementById('ledger-list');
  const summary = document.getElementById('ledger-summary');
  if (!list || !summary) return;

  // This-month summary (LOCAL month, not UTC — so a Korea-morning entry
  // doesn't get bucketed into the previous month)
  const now = new Date();
  const ym = localMonthKey(now);
  let monthIncome = 0, monthExpense = 0;
  for (const e of ledgerEntries) {
    if (localMonthKey(e.date) === ym) {
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

  // Group entries by LOCAL yyyy-mm-dd
  const groups = new Map();
  for (const e of ledgerEntries) {
    const key = localDateKey(e.date);
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
      const time = localTimeHHMM(e.date);
      const sign = e.type === 'income' ? '+' : '-';
      const catBadge = e.category ? `<span class="ledger-cat-badge">${escapeHtml(e.category)}</span>` : '';
      const methodBadge = e.method ? `<span class="ledger-method-badge">${escapeHtml(e.method)}</span>` : '';
      const noteText = e.note || (e.category ? '' : (e.type === 'income' ? '수입' : '지출'));
      return `<div class="ledger-item" data-id="${e.id}">
        <div class="ledger-item-time">${time}</div>
        <div class="ledger-item-note">${catBadge}${methodBadge}${escapeHtml(noteText)}</div>
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

  // Update payment-method breakdown card after the list is rendered
  renderMethodBreakdown();
}

// Init: render on load (in case ledger page is the active page) and seed
// the date input with today + populate the category & method dropdowns
function initLedger() {
  setTimeout(() => {
    const dateInput = document.getElementById('ledger-date');
    if (dateInput && !dateInput.value) dateInput.value = todayLocalISODate();
    updateCategoryOptions();
    updateMethodOptions();
    renderLedger();
  }, 0);
}

// =================== SMS PARSER (한국 카드 결제 문자) ===================
// Best-effort regex extraction of amount, card, merchant, and date/time
// from a pasted card SMS. Returns null when nothing useful is found.
function parseCardSMS(text) {
  if (!text || text.trim().length < 5) return null;
  const result = {};

  // Amount: numbers (with commas) followed by 원
  const amountMatch = text.match(/([\d]{1,3}(?:,\d{3})+|\d{4,})\s*원/);
  if (!amountMatch) return null;
  result.amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);

  // Card brand
  const cardBrands = [
    { re: /(신한[가-힣\s]*카드)/, key: '신한' },
    { re: /(국민\s*카드|KB\s*카드|KB체크카드?|KB국민카드?)/i, key: 'KB국민' },
    { re: /(삼성\s*카드)/, key: '삼성' },
    { re: /(현대\s*카드)/, key: '현대' },
    { re: /(롯데\s*카드)/, key: '롯데' },
    { re: /(하나\s*카드)/, key: '하나' },
    { re: /(우리\s*카드)/, key: '우리' },
    { re: /(NH[농협가-힣\s]*카드)/, key: 'NH농협' },
    { re: /(농협\s*카드|농협체크)/, key: 'NH농협' },
    { re: /(BC\s*카드)/, key: 'BC' },
    { re: /(시티\s*카드)/, key: '시티' },
    { re: /(체크카드)/, key: '체크카드' },
    { re: /(지역화폐|온누리|동백전|인천e음|성남사랑|온동두천)/, key: '지역화폐' },
    { re: /(현금영수증)/, key: '현금' }
  ];
  for (const { re, key } of cardBrands) {
    if (re.test(text)) { result.method = key; break; }
  }

  // Date / time — common formats
  // MM/DD HH:MM   or   YYYY-MM-DD HH:MM
  let dateObj = null;
  const dt1 = text.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  const dt2 = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (dt2) {
    dateObj = new Date(+dt2[1], +dt2[2] - 1, +dt2[3], +dt2[4], +dt2[5]);
  } else if (dt1) {
    const yr = new Date().getFullYear();
    dateObj = new Date(yr, +dt1[1] - 1, +dt1[2], +dt1[3], +dt1[4]);
  }
  if (dateObj) result.date = dateObj;

  // Merchant: take the line that doesn't contain header markers / amount / time / card
  const lines = text.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/원/.test(line)) continue;
    if (/\d{1,2}\/\d{1,2}/.test(line)) continue;
    if (/\d{4}-\d{2}-\d{2}/.test(line)) continue;
    if (/^\[/.test(line)) continue;
    if (/^Web발신/.test(line)) continue;
    if (/카드|승인|체크|일시불|할부/.test(line) && line.length < 12) continue;
    if (line.length < 2) continue;
    result.merchant = line.replace(/^[a-zA-Z]+:/, '').trim();
    break;
  }

  return result;
}

function pasteSMSToLedger() {
  const text = prompt('카드 결제 문자(또는 알림)를 그대로 붙여넣으세요:');
  if (!text) return;
  const parsed = parseCardSMS(text);
  if (!parsed || !parsed.amount) {
    toast('문자에서 금액을 찾지 못했습니다');
    return;
  }
  const amountInput = document.getElementById('ledger-amount');
  const noteInput = document.getElementById('ledger-note');
  const dateInput = document.getElementById('ledger-date');
  const methodSel = document.getElementById('ledger-method');
  if (amountInput) amountInput.value = String(parsed.amount);
  if (parsed.merchant && noteInput) noteInput.value = parsed.merchant;
  if (parsed.date && dateInput) {
    dateInput.value = localDateKey(parsed.date);
  }
  if (parsed.method && methodSel) {
    // Match best-effort against existing methods
    const opts = [...methodSel.options].map(o => o.value);
    const direct = opts.find(o => o === parsed.method);
    const fuzzy = direct || opts.find(o => parsed.method.includes(o) || o.includes(parsed.method));
    if (fuzzy) methodSel.value = fuzzy;
  }
  // Card SMS = expense by default
  if (typeof setLedgerType === 'function') setLedgerType('expense');
  toast('자동 입력 완료. 확인 후 [추가]를 누르세요', 'success');
  amountInput?.focus();
}

// Monthly breakdown by payment method (this month, expenses only)
function renderMethodBreakdown() {
  const wrap = document.getElementById('ledger-method-breakdown');
  if (!wrap) return;
  const ym = localMonthKey(new Date());
  const totals = {};
  for (const e of ledgerEntries) {
    if (localMonthKey(e.date) !== ym) continue;
    if (e.type !== 'expense') continue;
    const m = e.method || '미지정';
    totals[m] = (totals[m] || 0) + e.amount;
  }
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) { wrap.innerHTML = ''; return; }
  const total = entries.reduce((s, [, v]) => s + v, 0);
  wrap.innerHTML = `
    <div class="ledger-breakdown-title">이번 달 결제수단별 지출</div>
    <div class="ledger-breakdown-list">
      ${entries.map(([m, v]) => {
        const pct = total > 0 ? Math.round((v / total) * 100) : 0;
        return `<div class="ledger-breakdown-row">
          <span class="ledger-breakdown-label">${escapeHtml(m)}</span>
          <div class="ledger-breakdown-bar"><div class="ledger-breakdown-fill" style="width:${pct}%"></div></div>
          <span class="ledger-breakdown-amt">${formatWon(v)}</span>
          <span class="ledger-breakdown-pct">${pct}%</span>
        </div>`;
      }).join('')}
    </div>
  `;
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
