// =================== MARKDOWN PARSER ===================
function md2html(md) {
  if (!md) return '';
  let s = md;
  // Escape HTML
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks ```
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `\n<pre><code>${code.replace(/\n$/, '')}</code></pre>\n`);

  // Headers
  s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  s = s.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule
  s = s.replace(/^---+$/gm, '<hr>');

  // Blockquote
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  s = s.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

  // Task lists
  s = s.replace(/^[-*+] \[ \] (.+)$/gm, '<li class="task"><input type="checkbox" disabled> $1</li>');
  s = s.replace(/^[-*+] \[x\] (.+)$/gmi, '<li class="task done"><input type="checkbox" checked disabled> <del>$1</del></li>');

  // Unordered list
  s = s.replace(/^[-*+] (.+)$/gm, '<li>$1</li>');
  // Ordered list
  s = s.replace(/^\d+\. (.+)$/gm, '<li class="ord">$1</li>');

  // Wrap consecutive <li>
  s = s.replace(/(<li(?:\s+class="(?:task(?:\s+done)?|ord)")?>[\s\S]*?<\/li>(?:\n|$))+/g, m => {
    if (m.includes('class="ord"')) return '<ol>' + m.replace(/ class="ord"/g, '') + '</ol>';
    return '<ul>' + m + '</ul>';
  });

  // Bold (use sentinels to avoid conflict with italic)
  s = s.replace(/\*\*([^\*\n]+)\*\*/g, 'B$1b');
  s = s.replace(/__([^_\n]+)__/g, 'B$1b');

  // Italic
  s = s.replace(/\*([^\*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>');

  // Convert bold sentinels
  s = s.replace(/B/g, '<strong>').replace(/b/g, '</strong>');

  // Strikethrough
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Links and images
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Paragraphs (split by blank lines)
  s = s.split(/\n\n+/).map(block => {
    block = block.trim();
    if (!block) return '';
    if (/^<(h\d|ul|ol|pre|blockquote|hr|table|img)/.test(block)) return block;
    return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');

  return s;
}

// =================== THEME (Moleskine paper / leather) ===================
let currentTheme = (function () {
  try { return JSON.parse(localStorage.getItem('mindflow_theme')) || 'paper'; } catch { return 'paper'; }
})();

function applyTheme(theme) {
  if (theme === 'leather') document.body.setAttribute('data-theme', 'leather');
  else document.body.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'leather' ? '#221810' : '#f1ead2';
  // Swap icon
  const paperIcon = document.getElementById('theme-icon-paper');
  const leatherIcon = document.getElementById('theme-icon-leather');
  if (paperIcon && leatherIcon) {
    if (theme === 'leather') { paperIcon.style.display = ''; leatherIcon.style.display = 'none'; }
    else { paperIcon.style.display = 'none'; leatherIcon.style.display = ''; }
  }
  currentTheme = theme;
}

function toggleTheme() {
  const next = currentTheme === 'paper' ? 'leather' : 'paper';
  try { localStorage.setItem('mindflow_theme', JSON.stringify(next)); } catch {}
  applyTheme(next);
  // Mindmap canvas needs redraw because some colors are computed
  if (typeof drawMindMap === 'function') drawMindMap();
}

applyTheme(currentTheme);

// =================== TOAST ===================
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.remove('show'); }, 2500);
}

// =================== STORAGE ===================
function save(key, data) {
  try {
    localStorage.setItem('mindflow_' + key, JSON.stringify(data));
    scheduleAutoSave();
    scheduleGistSave();
    scheduleDriveSave();
  } catch (e) { toast('저장 실패: 저장 공간 부족', 'error'); }
}
function load(key, def) {
  try { const v = localStorage.getItem('mindflow_' + key); return v ? JSON.parse(v) : def; }
  catch { return def; }
}

// =================== INDEXEDDB (folder handle persistence) ===================
const IDB_NAME = 'mindflow-fs';
const IDB_STORE = 'handles';
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}


// =================== DATE HELPERS ===================
// Local-timezone YYYY-MM-DD for any Date or ISO string. Important: ISO
// strings are UTC, so a Korea-morning entry's ISO date is YESTERDAY in
// UTC. Using slice(0,10) on ISO would mis-bucket those entries.
function localDateKey(d) {
  const date = (d instanceof Date) ? d : new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function localMonthKey(d) {
  const date = (d instanceof Date) ? d : new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
function localTimeHHMM(d) {
  const date = (d instanceof Date) ? d : new Date(d);
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

// =================== APP SETTINGS ===================
const DEFAULT_LEDGER_METHODS = [
  '현금', '체크카드', '지역화폐',
  '신한카드', 'KB국민카드', '삼성카드', '현대카드',
  '롯데카드', '하나카드', '우리카드', 'NH농협카드', 'BC카드'
];
let appSettings = load('settings', { ledgerEnabled: false, ledgerMethods: DEFAULT_LEDGER_METHODS });
// Migrate older saved settings: empty list, or the old 4-entry default
// that lumped all credit cards into "신용카드", expand to per-brand list.
if (!appSettings.ledgerMethods || !Array.isArray(appSettings.ledgerMethods) || appSettings.ledgerMethods.length === 0) {
  appSettings.ledgerMethods = DEFAULT_LEDGER_METHODS;
}
const OLD_GENERIC_DEFAULT = ['현금', '체크카드', '지역화폐', '신용카드'];
if (
  appSettings.ledgerMethods.length === OLD_GENERIC_DEFAULT.length &&
  appSettings.ledgerMethods.every((v, i) => v === OLD_GENERIC_DEFAULT[i])
) {
  appSettings.ledgerMethods = DEFAULT_LEDGER_METHODS;
  save('settings', appSettings);
}

function applySettings() {
  // Show/hide ledger nav button
  const ledgerNav = document.querySelector('[data-page="ledger"]');
  if (ledgerNav) {
    ledgerNav.style.display = appSettings.ledgerEnabled ? '' : 'none';
  }
  // If ledger was disabled while user was on its page, switch to first available page
  if (!appSettings.ledgerEnabled) {
    const cur = document.querySelector('.page.active');
    if (cur && cur.id === 'page-ledger') {
      const firstNav = document.querySelector('.sidebar .nav-btn[data-page]:not([style*="none"])');
      if (firstNav) firstNav.click();
    }
  }
  // Sync the toggle state in the settings modal
  const toggle = document.getElementById('setting-ledger-enabled');
  if (toggle) toggle.checked = !!appSettings.ledgerEnabled;
  // Sync the methods textarea
  const methodsTa = document.getElementById('setting-ledger-methods');
  if (methodsTa) methodsTa.value = (appSettings.ledgerMethods || []).join('\n');
  // Toggle visibility of the ledger-specific settings group
  const ledgerGroup = document.getElementById('settings-ledger-group');
  if (ledgerGroup) ledgerGroup.style.display = appSettings.ledgerEnabled ? '' : 'none';
}

function saveLedgerMethods() {
  const ta = document.getElementById('setting-ledger-methods');
  if (!ta) return;
  const list = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (list.length === 0) { toast('최소 1개 이상의 결제 수단이 필요합니다', 'error'); return; }
  appSettings.ledgerMethods = list;
  saveSettings();
  // Refresh the dropdown in the ledger page
  if (typeof updateMethodOptions === 'function') updateMethodOptions();
  toast('결제 수단 저장됨', 'success');
}

function saveSettings() {
  save('settings', appSettings);
  applySettings();
  // Refresh timeblock if visible so the ledger summary card appears/disappears
  if (typeof renderTimeBlocks === 'function' && document.getElementById('page-timeblock')?.classList.contains('active')) {
    renderTimeBlocks();
  }
}

function setSetting(key, value) {
  appSettings = { ...appSettings, [key]: value };
  saveSettings();
}

function openSettingsModal() {
  applySettings();
  document.getElementById('settings-modal')?.classList.add('show');
}
function closeSettingsModal() {
  document.getElementById('settings-modal')?.classList.remove('show');
}
