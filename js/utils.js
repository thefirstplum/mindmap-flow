// =================== IMAGE URL OPTIMIZATION ===================
// Rewrite slow-loading Drive thumbnail URLs to the lh3.googleusercontent
// CDN form, which is much faster (CDN-edge cached, no on-demand generation).
// Files must already be public-shared (Drive's drive.file scope + the
// driveMakePublic call after upload handles this).
function optimizeImageUrl(url) {
  if (!url) return url;
  // drive.google.com/thumbnail?id=ID&sz=...  →  lh3.googleusercontent.com/d/ID=w2560
  // (Always request 2560 — covers retina at full memo width, source is
  // already at most 2560px after the upload-side resize.)
  let m = url.match(/^https?:\/\/(?:www\.)?drive\.google\.com\/thumbnail\?(?:.*&)?id=([^&]+)/);
  if (m) {
    return `https://lh3.googleusercontent.com/d/${m[1]}=w2560`;
  }
  // drive.google.com/uc?export=view&id=ID  →  lh3.googleusercontent.com/d/ID=w2560
  m = url.match(/^https?:\/\/(?:www\.)?drive\.google\.com\/uc\?(?:.*&)?id=([^&]+)/);
  if (m) {
    return `https://lh3.googleusercontent.com/d/${m[1]}=w2560`;
  }
  return url;
}

// =================== MARKDOWN PARSER ===================
// 블록 임베드용 — 제목으로 메모 찾아서 본문 재귀 렌더 (depth 2 가드)
function _renderEmbed(title, depth) {
  if (depth >= 2) {
    return `<div class="embed-block embed-block-skip">↻ 임베드 깊이 제한 (${title})</div>`;
  }
  if (typeof memos === 'undefined') {
    return `<div class="embed-block embed-block-miss">↻ [[${title}]]</div>`;
  }
  const m = memos.find(x => (x.title || '').trim() === title);
  if (!m) {
    return `<div class="embed-block embed-block-miss">↻ <a href="#" class="wikilink" onclick="event.preventDefault();openMemoByTitle('${title.replace(/'/g, "\\'")}')">${title}</a> (없음 — 클릭해 만들기)</div>`;
  }
  // 재귀 렌더 (전역 깊이 카운터)
  window._mdEmbedDepth = (window._mdEmbedDepth || 0) + 1;
  let inner;
  try { inner = md2html(m.content || '*(빈 메모)*'); }
  finally { window._mdEmbedDepth = Math.max(0, (window._mdEmbedDepth || 0) - 1); }
  return `<div class="embed-block">
    <div class="embed-block-head" onclick="openMemoByTitle('${title.replace(/'/g, "\\'")}')">
      <span class="mi mi-sm">north_east</span>
      <span>${title}</span>
    </div>
    <div class="embed-block-body">${inner}</div>
  </div>`;
}

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

  // Highlight (Obsidian-style ==강조==)
  s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Block embed ![[Title]] — Obsidian-style transclusion. Renders referenced
  // memo's body inline as a quote-box. Depth-limited (2) to prevent infinite
  // recursion. Must run BEFORE wikilinks (else [[]] inside ![[]] matches first)
  // and BEFORE image syntax (![alt](url)) — but the !\[\[ token is unique.
  s = s.replace(/!\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_m, target) => {
    return _renderEmbed(target.trim(), (window._mdEmbedDepth || 0));
  });

  // Wikilinks [[Title]] or [[Title|Display]] — Obsidian/Roam-style links to other
  // memos by title. Resolved at click time (onclick → openMemoByTitle).
  // Render before markdown links so [[x]] doesn't get misparsed as [x](y).
  s = s.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_m, target, display) => {
    const safeTarget = (target || '').trim().replace(/"/g, '&quot;');
    const safeDisp = ((display || target) || '').trim();
    return `<a href="#" class="wikilink" data-wikilink="${safeTarget}" onclick="event.preventDefault();openMemoByTitle('${safeTarget.replace(/'/g, "\\'")}')">${safeDisp}</a>`;
  });

  // Links and images. Rewrite Drive thumbnail URLs to the lh3 CDN form
  // for ~2-3× faster fetches (CDN-cached vs. on-demand thumbnail gen).
  // Add loading="lazy" + decoding="async" so multiple images don't block
  // the main thread and the parser stays responsive while they fetch.
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
    const optimized = optimizeImageUrl(url);
    return `<img src="${optimized}" alt="${alt}" loading="lazy" decoding="async">`;
  });
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

// =================== THEME (14종 — Bear 영감 + craft 시그니처) ===================
// CSS selector: body 또는 body[data-theme="xxx"]
// 'light' (Solarized Light, default — no attr), 'dark', 'charcoal' + 11개 확장
const THEMES_META = [
  { section: '코어' },
  { key: 'light',      label: 'Solarized Light', dots: ['#FDF6E3', '#B85E94', '#D2832E'] },
  { key: 'dark',       label: 'Solarized Dark',  dots: ['#1B2027', '#E093BD', '#F0B264'] },
  { key: 'charcoal',   label: 'Charcoal',        dots: ['#1B1E22', '#B89866', '#8FA68E'] },
  { section: '라이트' },
  { key: 'sepia',      label: 'Sepia',           dots: ['#F2E7CD', '#A66B23', '#B0512E'] },
  { key: 'sakura',     label: 'Sakura',          dots: ['#FCEFF3', '#D86A8A', '#C7869E'] },
  { key: 'toothpaste', label: 'Toothpaste',      dots: ['#EAF4F1', '#2E96A0', '#E29C8E'] },
  { key: 'leather',    label: 'Leather',         dots: ['#F4E9D0', '#A35817', '#C99244'] },
  { key: 'botanical',  label: 'Botanical',       dots: ['#F2EFE0', '#6B8C5A', '#B8A06B'] },
  { key: 'diary',      label: 'Diary',           dots: ['#F8E8D8', '#C76E55', '#7B9A8A'] },
  { section: '다크' },
  { key: 'dracula',    label: 'Dracula',         dots: ['#282A36', '#FF79C6', '#BD93F9'] },
  { key: 'gotham',     label: 'Gotham',          dots: ['#0A1019', '#4A8FD4', '#95C8E8'] },
  { key: 'forest',     label: 'Forest',          dots: ['#1A2620', '#79B36F', '#C9A85C'] },
  { key: 'ocean',      label: 'Ocean',           dots: ['#0E1E2F', '#4FB3D9', '#E08B6E'] },
  { key: 'sunset',     label: 'Sunset',          dots: ['#2A1A28', '#E85E8A', '#F5BC4A'] },
];
const THEMES = THEMES_META.filter(t => t.key).map(t => t.key);
const THEME_LABELS = Object.fromEntries(THEMES_META.filter(t => t.key).map(t => [t.key, t.label]));
const THEME_META_COLOR = Object.fromEntries(THEMES_META.filter(t => t.key).map(t => [t.key, t.dots[0]]));

// 기존 12개 사용자가 쓰던 테마 → 새 14개로 매핑
function migrateThemeName(t) {
  if (t == null || t === 'paper' || t === 'solarized' || t === 'duotone-snow' || t === 'ayu') return 'light';
  if (t === 'solarized-dark') return 'dark';
  if (t === 'cobalt') return 'ocean';
  if (t === 'panic') return 'sunset';
  if (t === 'duotone-light') return 'sakura';
  if (t === 'dieci') return 'charcoal';
  if (t === 'leather') return 'charcoal';  // 기존 leather (다크 차콜) → charcoal (새 다크 톤)
  return THEMES.includes(t) ? t : 'light';
}

let currentTheme = (function () {
  try { return migrateThemeName(JSON.parse(localStorage.getItem('mindflow_theme'))); }
  catch { return 'light'; }
})();

function applyTheme(theme) {
  theme = migrateThemeName(theme);
  if (theme === 'light') document.body.removeAttribute('data-theme');
  else document.body.setAttribute('data-theme', theme);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_META_COLOR[theme] || '#FDF6E3';

  currentTheme = theme;
  try { localStorage.setItem('mindflow_theme', JSON.stringify(theme)); } catch {}

  // 드롭다운 active state 동기화
  document.querySelectorAll('.theme-dd-item').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === theme);
  });
}

function toggleTheme() { openThemePicker(); }

// 드롭다운 popup — palette 아이콘 옆에 펼침
function openThemePicker() {
  const dd = document.getElementById('theme-dd');
  if (!dd) return;
  // 메뉴 빌드 (한 번만)
  const menu = document.getElementById('theme-dd-menu');
  if (menu && !menu.children.length) {
    for (const t of THEMES_META) {
      if (t.section) {
        const h = document.createElement('div');
        h.className = 'theme-dd-section';
        h.textContent = t.section;
        menu.appendChild(h);
        continue;
      }
      const btn = document.createElement('button');
      btn.className = 'theme-dd-item' + (t.key === currentTheme ? ' active' : '');
      btn.dataset.theme = t.key;
      btn.innerHTML = `<span class="theme-dd-dots">
        <span class="theme-dd-dot" style="background:${t.dots[0]}"></span>
        <span class="theme-dd-dot" style="background:${t.dots[1]}"></span>
        <span class="theme-dd-dot" style="background:${t.dots[2]}"></span>
      </span><span>${t.label}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTheme(t.key);
        if (typeof drawMindMap === 'function') drawMindMap();
        if (typeof toast === 'function') toast(t.label);
        closeThemePicker();
      });
      menu.appendChild(btn);
    }
  }
  dd.classList.toggle('open');
}

function closeThemePicker() {
  document.getElementById('theme-dd')?.classList.remove('open');
}

// 외부 클릭 시 드롭다운 닫기 (한 번만 등록)
if (typeof window !== 'undefined' && !window._themeDdInited) {
  window._themeDdInited = true;
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('theme-dd');
    if (dd && !dd.contains(e.target)) dd.classList.remove('open');
  });
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

// =================== STORAGE (IDB primary + memory cache + LS mirror) ===================
// 아키텍처:
//   - 메모리 캐시 (_kvCache) = 동기 응답을 위한 진실원
//   - IDB (mindflow-kv/kv) = persistent primary, 용량 ~50GB+
//   - localStorage = 부팅 시드 + 백업 미러 (실패해도 OK)
// 부팅:
//   1) 동기적으로 localStorage 모든 mindflow_* 키를 _kvCache에 즉시 시드
//      → 다른 모듈의 IIFE가 load() 호출 시 즉시 응답 가능
//   2) 비동기로 IDB 열기 + IDB → _kvCache 머지 (IDB가 더 신선하면 갱신)
//   3) localStorage 마이그레이션 — IDB에 키 없는 LS 키를 IDB에 복사
// save:
//   - _kvCache 즉시 갱신 (load는 다음 tick에 새 값 봄)
//   - IDB write-behind (await 없음, fire-and-forget)
//   - localStorage 미러 (실패해도 IDB가 살아있음)
//   - 기존 동기화 트리거(scheduleAutoSave 등)

const _kvCache = new Map();
let _kvDb = null;
let _kvReadyResolve;
const kvReady = new Promise(r => { _kvReadyResolve = r; });

// 1) 동기 시드 — utils.js 로드 즉시 실행. 다른 모듈 IIFE가 load() 호출 전에 끝남.
(function _seedFromLocalStorage() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('mindflow_')) continue;
      const raw = localStorage.getItem(k);
      if (raw == null) continue;
      try { _kvCache.set(k.slice('mindflow_'.length), JSON.parse(raw)); }
      catch { _kvCache.set(k.slice('mindflow_'.length), raw); }
    }
  } catch (e) { console.warn('[kv] LS seed failed:', e); }
})();

function _kvOpen() {
  if (_kvDb) return Promise.resolve(_kvDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mindflow-kv', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => { _kvDb = req.result; resolve(_kvDb); };
    req.onerror = () => reject(req.error);
  });
}

// 2) IDB → cache 머지 + LS 마이그레이션 (백그라운드)
(async function _kvBoot() {
  try {
    const db = await _kvOpen();
    // 모든 IDB 키 → cache (IDB 우선 — 더 신선)
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const store = tx.objectStore('kv');
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        _kvCache.set(cursor.key, cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    // LS에는 있지만 IDB엔 없는 키 → IDB로 마이그레이션 (일회성, 자동 멱등)
    const toMigrate = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('mindflow_')) continue;
        const subKey = k.slice('mindflow_'.length);
        if (!_kvCache.has(subKey)) continue; // 시드에서 빠진 건 손상으로 보고 스킵
        toMigrate.push(subKey);
      }
    } catch {}
    if (toMigrate.length) {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      for (const k of toMigrate) store.put(_kvCache.get(k), k);
    }
  } catch (e) {
    console.warn('[kv] IDB boot failed — localStorage mode 유지:', e);
  } finally {
    _kvReadyResolve();
  }
})();

// IDB write-behind 큐 (디바운스로 묶기 — 빠른 연속 save 시 1 트랜잭션)
const _kvPendingWrites = new Map();
let _kvFlushTimer = null;
function _kvFlush() {
  if (!_kvDb || _kvPendingWrites.size === 0) return;
  const pending = new Map(_kvPendingWrites);
  _kvPendingWrites.clear();
  try {
    const tx = _kvDb.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    for (const [k, v] of pending) {
      if (v === undefined) store.delete(k);
      else store.put(v, k);
    }
  } catch (e) { console.warn('[kv] flush failed:', e); }
}

function save(key, data) {
  // 1) 메모리 캐시 즉시 갱신 — load는 다음 호출에 새 값 봄
  _kvCache.set(key, data);
  // 2) IDB write-behind (디바운스 80ms)
  _kvPendingWrites.set(key, data);
  clearTimeout(_kvFlushTimer);
  _kvFlushTimer = setTimeout(_kvFlush, 80);
  // 3) localStorage 미러 — 실패해도 IDB가 살아있어서 안전
  try {
    localStorage.setItem('mindflow_' + key, JSON.stringify(data));
  } catch (e) {
    // 한계 도달 — IDB가 primary니까 silent OK, 모니터링만
    console.warn('[save] LS mirror failed (IDB OK):', key);
  }
  // 동기화 트리거 (기존 동작)
  scheduleAutoSave();
  scheduleGistSave();
  scheduleDriveSave();
  _maybeCheckQuota();
}

function load(key, def) {
  if (_kvCache.has(key)) return _kvCache.get(key);
  // 캐시 미스 — localStorage fallback (시드 누락 케이스 안전망)
  try {
    const v = localStorage.getItem('mindflow_' + key);
    if (v != null) {
      try { return JSON.parse(v); } catch { return v; }
    }
  } catch {}
  return def;
}

// 명시적 IDB-await 필요한 경우용 (sync.js의 일부 정확성 critical path 등)
async function saveAsync(key, data) {
  save(key, data);
  // 다음 tick의 flush까지 명시적으로 기다림
  await new Promise(r => setTimeout(r, 100));
}
async function loadAsync(key, def) {
  await kvReady;
  return load(key, def);
}

// 키 삭제 — sync.js의 cleanup 같은 곳에서 직접 호출 가능
function kvDelete(key) {
  _kvCache.delete(key);
  _kvPendingWrites.set(key, undefined);
  clearTimeout(_kvFlushTimer);
  _kvFlushTimer = setTimeout(_kvFlush, 80);
  try { localStorage.removeItem('mindflow_' + key); } catch {}
}

// 페이지 떠나기 직전 마지막 flush (모바일 lifecycle 안전)
window.addEventListener('pagehide', _kvFlush);
window.addEventListener('beforeunload', _kvFlush);

// Storage.prototype monkey-patch — sync.js·기타 코드의 localStorage.setItem/removeItem
// 직접 호출이 cache·IDB에도 자동 반영되게 함. mindflow_ 접두 키만 잡음 (다른 사이트/
// 라이브러리 영향 X). 52곳을 다 손대지 않고 한 줄로 일관성 보장.
(function _patchStorageForKv() {
  const origSet = Storage.prototype.setItem;
  const origRm = Storage.prototype.removeItem;
  Storage.prototype.setItem = function(key, value) {
    if (this === localStorage && typeof key === 'string' && key.startsWith('mindflow_')) {
      const subKey = key.slice('mindflow_'.length);
      let parsed = value;
      try { parsed = JSON.parse(value); } catch {}
      _kvCache.set(subKey, parsed);
      _kvPendingWrites.set(subKey, parsed);
      clearTimeout(_kvFlushTimer);
      _kvFlushTimer = setTimeout(_kvFlush, 80);
    }
    return origSet.call(this, key, value);
  };
  Storage.prototype.removeItem = function(key) {
    if (this === localStorage && typeof key === 'string' && key.startsWith('mindflow_')) {
      const subKey = key.slice('mindflow_'.length);
      _kvCache.delete(subKey);
      _kvPendingWrites.set(subKey, undefined);
      clearTimeout(_kvFlushTimer);
      _kvFlushTimer = setTimeout(_kvFlush, 80);
    }
    return origRm.call(this, key);
  };
})();

// =================== STORAGE QUOTA ===================
// IDB primary 전환 후 quota는 디스크 ~60% (수십 GB). 95% 도달 시에만 경고.
let _quotaLastCheckAt = 0;
let _quotaLastWarnAt = 0;
async function _maybeCheckQuota() {
  // Throttle: check at most once per 60s
  const now = Date.now();
  if (now - _quotaLastCheckAt < 60_000) return;
  _quotaLastCheckAt = now;
  if (!navigator.storage?.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!usage || !quota) return;
    const pct = usage / quota;
    if (pct > 0.95 && now - _quotaLastWarnAt > 60 * 60_000) {
      _quotaLastWarnAt = now;
      const mb = (n) => (n / 1024 / 1024).toFixed(1);
      toast(`⚠️ 저장공간 ${Math.round(pct * 100)}% (${mb(usage)}MB / ${mb(quota)}MB) — 정리 권장`, 'error');
    }
  } catch {}
}
// Request persistent storage so the browser doesn't evict our data under pressure
// (iOS Safari may evict after 7 days idle without this — silent data loss risk).
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return null;
  try {
    const already = await navigator.storage.persisted?.();
    if (already) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}
// Expose for manual diagnostics in the sync modal
async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

// =================== IN-APP DIALOGS (prompt/confirm 대체) ===================
// Native confirm()/prompt()는 standalone PWA(iOS)에서 도메인 헤더가 붙어 톤이
// 깨지고, IME/단축키도 잘 안 먹어서 인앱 모달로 통일.
function confirmDialog(message, opts) {
  opts = opts || {};
  const okText = opts.okText || '확인';
  const cancelText = opts.cancelText || '취소';
  const danger = !!opts.danger;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show app-dialog-overlay';
    overlay.innerHTML = `<div class="modal app-dialog">
      <div class="app-dialog-body"></div>
      <div class="app-dialog-actions">
        <button class="app-dialog-btn cancel" type="button"></button>
        <button class="app-dialog-btn ${danger ? 'danger' : 'primary'}" type="button"></button>
      </div>
    </div>`;
    overlay.querySelector('.app-dialog-body').textContent = message;
    overlay.querySelector('.app-dialog-btn.cancel').textContent = cancelText;
    overlay.querySelector('.app-dialog-btn.primary,.app-dialog-btn.danger').textContent = okText;
    document.body.appendChild(overlay);
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    function close(v) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(v);
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    overlay.querySelector('.app-dialog-btn.cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.app-dialog-btn.primary,.app-dialog-btn.danger').addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey);
  });
}

function promptDialog(label, defaultValue, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show app-dialog-overlay';
    overlay.innerHTML = `<div class="modal app-dialog">
      <div class="app-dialog-label"></div>
      <input type="text" class="app-dialog-input">
      <div class="app-dialog-actions">
        <button class="app-dialog-btn cancel" type="button">취소</button>
        <button class="app-dialog-btn primary" type="button">${opts.okText || '확인'}</button>
      </div>
    </div>`;
    overlay.querySelector('.app-dialog-label').textContent = label;
    const input = overlay.querySelector('.app-dialog-input');
    input.value = defaultValue || '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    document.body.appendChild(overlay);
    // Focus + select after the browser layout settles so iOS opens the keyboard
    setTimeout(() => { input.focus(); input.select(); }, 30);
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter') close(input.value);
    };
    function close(v) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(v);
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector('.app-dialog-btn.cancel').addEventListener('click', () => close(null));
    overlay.querySelector('.app-dialog-btn.primary').addEventListener('click', () => close(input.value));
    input.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);
  });
}

// =================== HAPTICS ===================
// Centralized vibration helper. Web Vibration API is supported on Android
// (Chrome, Edge, Brave, Samsung) and silently no-ops on iOS Safari.
// kind: 'light' (selection), 'medium' (action confirm), 'heavy' (warning/delete)
function haptic(kind) {
  if (!navigator.vibrate) return;
  const patterns = { light: 8, medium: 15, heavy: [10, 30, 10] };
  try { navigator.vibrate(patterns[kind] || patterns.light); } catch {}
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
