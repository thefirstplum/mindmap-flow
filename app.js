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

// =================== PAGE NAVIGATION ===================
const pages = { mindmap: '마인드맵', timeblock: '타임블록', memo: '메모' };
const subtitles = {
  mindmap: '아이디어를 자유롭게 연결하세요',
  timeblock: '하루를 블록 단위로 계획하세요',
  memo: '생각을 자유롭게 기록하세요'
};
const pageIcons = {
  mindmap: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><line x1="9.5" y1="10.5" x2="5.5" y2="7.5"/><line x1="14.5" y1="10.5" x2="18.5" y2="7.5"/><line x1="9.5" y1="13.5" x2="5.5" y2="16.5"/><line x1="14.5" y1="13.5" x2="18.5" y2="16.5"/></svg>',
  timeblock: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  memo: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
};

function setHeaderIcon(page) {
  document.getElementById('header-icon').innerHTML = pageIcons[page];
}
setHeaderIcon('timeblock');

document.querySelectorAll('.sidebar .nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    document.querySelectorAll('.sidebar .nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    document.getElementById('page-title').textContent = pages[page];
    document.getElementById('page-subtitle').textContent = subtitles[page];
    setHeaderIcon(page);
    if (page === 'mindmap') resizeCanvas();
    if (page === 'timeblock') renderTimeBlocks();
  });
});
document.getElementById('sync-btn').addEventListener('click', openSyncModal);

// =================== MIND MAP (multi-map support) ===================
const canvas = document.getElementById('mindmap-canvas');
const ctx = canvas.getContext('2d');

let mindmaps = load('mindmaps', []);
let activeMindmapId = load('mm_active', null);

// Migrate from old single-map storage (v1 → v2)
(function migrateMindmaps() {
  if (mindmaps.length > 0) return;
  const oldNodes = load('mm_nodes', null);
  if (oldNodes !== null) {
    mindmaps = [{
      id: Date.now(),
      name: '내 첫 마인드맵',
      nodes: oldNodes,
      edges: load('mm_edges', []),
      idCounter: load('mm_idcounter', 1),
      pan: load('mm_pan', { x: 0, y: 0 }),
      zoom: load('mm_zoom', 1),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }];
    activeMindmapId = mindmaps[0].id;
    save('mindmaps', mindmaps);
    save('mm_active', activeMindmapId);
  }
})();

if (!activeMindmapId && mindmaps.length > 0) activeMindmapId = mindmaps[0].id;

let nodes = [], edges = [], pan = { x: 0, y: 0 }, zoom = 1, nodeIdCounter = 1;
let selectedNode = null;
let draggingNode = null;
let connectingFrom = null;
let isConnecting = false;
let isDraggingConnection = false;
let connDragPos = { x: 0, y: 0 };
let currentNodeColor = '#7c6cf5';
let isPanning = false;
let lastMouse = { x: 0, y: 0 };
let pinchStart = null;

function activeMap() { return mindmaps.find(m => m.id === activeMindmapId); }

function bindActiveMap() {
  const m = activeMap();
  if (!m) {
    nodes = []; edges = []; pan = { x: 0, y: 0 }; zoom = 1; nodeIdCounter = 1;
    return;
  }
  nodes = m.nodes;
  edges = m.edges;
  pan = m.pan;
  zoom = m.zoom;
  nodeIdCounter = m.idCounter;
}
bindActiveMap();

function saveMindMap() {
  const m = activeMap();
  if (!m) return;
  m.nodes = nodes;
  m.edges = edges;
  m.pan = pan;
  m.zoom = zoom;
  m.idCounter = nodeIdCounter;
  m.updatedAt = new Date().toISOString();
  save('mindmaps', mindmaps);
  save('mm_active', activeMindmapId);
  renderMindmapList();
}

function renderMindmapList() {
  const container = document.getElementById('mindmap-items');
  if (!container) return;
  if (mindmaps.length === 0) {
    container.innerHTML = `<div class="mm-empty">마인드맵이 없습니다<br>+ 버튼을 눌러 시작하세요</div>`;
    return;
  }
  container.innerHTML = mindmaps.map(m => {
    const isActive = m.id === activeMindmapId;
    return `<div class="swipe-row" data-id="${m.id}">
      <div class="mindmap-item swipe-content ${isActive ? 'active' : ''}" onclick="switchMindmap(${m.id})">
        <div class="mm-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="6" r="1.8"/><circle cx="19" cy="6" r="1.8"/><circle cx="5" cy="18" r="1.8"/><circle cx="19" cy="18" r="1.8"/><line x1="9.7" y1="10.5" x2="6.3" y2="7.5"/><line x1="14.3" y1="10.5" x2="17.7" y2="7.5"/><line x1="9.7" y1="13.5" x2="6.3" y2="16.5"/><line x1="14.3" y1="13.5" x2="17.7" y2="16.5"/></svg>
        </div>
        <div class="mm-content">
          <div class="mm-name">${escapeHtml(m.name)}</div>
          <div class="mm-meta">노드 ${m.nodes.length}개 · 연결 ${m.edges.length}개</div>
        </div>
        <button class="mm-menu-btn" onclick="event.stopPropagation();showMindmapMenu(${m.id})" title="이름 변경 / 삭제">⋯</button>
      </div>
      <button class="swipe-action" aria-label="삭제">🗑 삭제</button>
    </div>`;
  }).join('');
  if (!container.dataset.swipeReady) {
    attachSwipeToDelete(container, {
      resolveId: (row) => parseInt(row.dataset.id),
      onDelete: (id) => {
        if (mindmaps.length <= 1) { toast('최소 1개의 마인드맵이 필요합니다'); return; }
        const m = mindmaps.find(x => x.id === id);
        if (!m || !confirm(`"${m.name}"을(를) 삭제하시겠습니까?`)) return;
        mindmaps = mindmaps.filter(x => x.id !== id);
        if (activeMindmapId === id) {
          activeMindmapId = mindmaps[0].id;
          bindActiveMap();
        }
        save('mindmaps', mindmaps);
        save('mm_active', activeMindmapId);
        renderMindmapList();
        drawMindMap();
      }
    });
    container.dataset.swipeReady = '1';
  }
}

function createMindmap() {
  const name = prompt('새 마인드맵 이름:', `마인드맵 ${mindmaps.length + 1}`);
  if (!name || !name.trim()) return;
  // Save current map state first
  if (activeMap()) saveMindMap();
  const map = {
    id: Date.now(),
    name: name.trim(),
    nodes: [],
    edges: [],
    idCounter: 1,
    pan: { x: 0, y: 0 },
    zoom: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  mindmaps.unshift(map);
  activeMindmapId = map.id;
  selectedNode = null;
  bindActiveMap();
  saveMindMap();
  renderMindmapList();
  updateToolbarState();
  drawMindMap();
  closeMindmapList();
  toast('새 마인드맵 생성됨', 'success');
}

function switchMindmap(id) {
  if (id === activeMindmapId) { closeMindmapList(); return; }
  saveMindMap();
  activeMindmapId = id;
  save('mm_active', activeMindmapId);
  selectedNode = null;
  bindActiveMap();
  renderMindmapList();
  updateToolbarState();
  drawMindMap();
  closeMindmapList();
}

function showMindmapMenu(id) {
  const m = mindmaps.find(x => x.id === id);
  if (!m) return;
  const choice = prompt(`"${m.name}"\n\n[r] 이름 변경  /  [d] 삭제  /  [x] 취소\n\n선택:`, 'r');
  if (!choice) return;
  if (choice.toLowerCase() === 'r') {
    const name = prompt('새 이름:', m.name);
    if (name && name.trim()) {
      m.name = name.trim();
      m.updatedAt = new Date().toISOString();
      save('mindmaps', mindmaps);
      renderMindmapList();
    }
  } else if (choice.toLowerCase() === 'd') {
    if (mindmaps.length <= 1) { toast('최소 1개의 마인드맵이 필요합니다'); return; }
    if (!confirm(`"${m.name}"을(를) 삭제하시겠습니까?`)) return;
    mindmaps = mindmaps.filter(x => x.id !== id);
    if (activeMindmapId === id) {
      activeMindmapId = mindmaps[0].id;
      bindActiveMap();
    }
    save('mindmaps', mindmaps);
    save('mm_active', activeMindmapId);
    renderMindmapList();
    drawMindMap();
    toast('삭제됨');
  }
}

function toggleMindmapList() {
  const list = document.getElementById('mindmap-list');
  const backdrop = document.getElementById('mm-list-backdrop');
  if (!list) return;
  list.classList.toggle('show');
  backdrop.classList.toggle('show');
}
function closeMindmapList() {
  const list = document.getElementById('mindmap-list');
  const backdrop = document.getElementById('mm-list-backdrop');
  if (list) list.classList.remove('show');
  if (backdrop) backdrop.classList.remove('show');
}

function updateToolbarState() {
  document.getElementById('delete-btn').disabled = !selectedNode;
  document.getElementById('connect-btn').disabled = !selectedNode;
}

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMindMap();
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 50);

function screenToWorld(sx, sy) { return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom }; }
function worldToScreen(wx, wy) { return { x: wx * zoom + pan.x, y: wy * zoom + pan.y }; }

function drawMindMap() {
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  // Background grid
  ctx.save();
  ctx.translate(pan.x, pan.y);
  ctx.scale(zoom, zoom);
  const grid = 40;
  const startX = Math.floor(-pan.x / zoom / grid) * grid;
  const startY = Math.floor(-pan.y / zoom / grid) * grid;
  const endX = startX + (w / zoom) + grid * 2;
  const endY = startY + (h / zoom) + grid * 2;
  ctx.strokeStyle = (document.body.getAttribute('data-theme') === 'leather')
    ? 'rgba(255,255,255,0.04)'
    : 'rgba(60,40,20,0.07)';
  ctx.lineWidth = 1 / zoom;
  for (let x = startX; x < endX; x += grid) {
    ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, endY); ctx.stroke();
  }
  for (let y = startY; y < endY; y += grid) {
    ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(endX, y); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(pan.x, pan.y);
  ctx.scale(zoom, zoom);

  // Edges
  edges.forEach(e => {
    const from = nodes.find(n => n.id === e.from);
    const to = nodes.find(n => n.id === e.to);
    if (!from || !to) return;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2 - 30;
    ctx.quadraticCurveTo(mx, my, to.x, to.y);
    const grad = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    grad.addColorStop(0, hexA(from.color || '#7c6cf5', 0.6));
    grad.addColorStop(1, hexA(to.color || '#7c6cf5', 0.6));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });

  if (isConnecting && connectingFrom) {
    const from = nodes.find(n => n.id === connectingFrom);
    if (from) {
      const mp = screenToWorld(connDragPos.x, connDragPos.y);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(mp.x, mp.y);
      ctx.strokeStyle = hexA(from.color || '#7c6cf5', 0.85);
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      // Endpoint dot
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = hexA(from.color || '#7c6cf5', 0.85);
      ctx.fill();
    }
  }

  nodes.forEach(n => {
    const isSelected = selectedNode === n.id;
    ctx.font = '600 14px -apple-system, sans-serif';
    const textWidth = ctx.measureText(n.text).width;
    const w = Math.max(textWidth + 40, 90);
    const h = 44;

    ctx.shadowColor = hexA(n.color || '#7c6cf5', 0.5);
    ctx.shadowBlur = isSelected ? 24 : 14;
    ctx.shadowOffsetY = 4;

    ctx.beginPath();
    ctx.roundRect(n.x - w/2, n.y - h/2, w, h, 12);
    const grad = ctx.createLinearGradient(n.x - w/2, n.y - h/2, n.x + w/2, n.y + h/2);
    grad.addColorStop(0, lightenColor(n.color || '#7c6cf5', 0.1));
    grad.addColorStop(1, n.color || '#7c6cf5');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowColor = 'transparent';

    if (isSelected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.text, n.x, n.y);

    // Connection handle on selected node (right side)
    if (isSelected && !isDraggingConnection) {
      const hx = n.x + w/2 + 16;
      const hy = n.y;
      ctx.beginPath();
      ctx.arc(hx, hy, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = hexA(n.color || '#7c6cf5', 0.6);
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = n.color || '#7c6cf5';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx - 5, hy);
      ctx.lineTo(hx + 5, hy);
      ctx.moveTo(hx, hy - 5);
      ctx.lineTo(hx, hy + 5);
      ctx.strokeStyle = n.color || '#7c6cf5';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  });

  ctx.restore();
}

function getHandleAt(sx, sy) {
  if (!selectedNode) return null;
  const n = nodes.find(x => x.id === selectedNode);
  if (!n) return null;
  ctx.font = '600 14px -apple-system, sans-serif';
  const textWidth = ctx.measureText(n.text).width;
  const w = Math.max(textWidth + 40, 90);
  const hx = n.x + w/2 + 16;
  const hy = n.y;
  const wp = screenToWorld(sx, sy);
  const dist = Math.hypot(wp.x - hx, wp.y - hy);
  return dist <= 14 / zoom ? n : null;
}

function hexA(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function lightenColor(hex, amt) {
  const r = Math.min(255, parseInt(hex.slice(1,3),16) + amt*255);
  const g = Math.min(255, parseInt(hex.slice(3,5),16) + amt*255);
  const b = Math.min(255, parseInt(hex.slice(5,7),16) + amt*255);
  return `rgb(${r},${g},${b})`;
}

function getNodeAt(sx, sy) {
  const wp = screenToWorld(sx, sy);
  ctx.font = '600 14px -apple-system, sans-serif';
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const textWidth = ctx.measureText(n.text).width;
    const w = Math.max(textWidth + 40, 90);
    const h = 44;
    if (wp.x >= n.x - w/2 && wp.x <= n.x + w/2 && wp.y >= n.y - h/2 && wp.y <= n.y + h/2) {
      return n;
    }
  }
  return null;
}

function getCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return { x: t.clientX - rect.left, y: t.clientY - rect.top, cx: t.clientX, cy: t.clientY };
}

function pointerDown(e) {
  if (e.touches && e.touches.length === 2) {
    const t1 = e.touches[0], t2 = e.touches[1];
    pinchStart = {
      dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
      zoom: zoom,
      cx: (t1.clientX + t2.clientX) / 2,
      cy: (t1.clientY + t2.clientY) / 2
    };
    return;
  }
  const p = getCanvasPoint(e);

  // 1) Connection-handle drag start (only on selected node's "+" handle)
  const handleNode = getHandleAt(p.x, p.y);
  if (handleNode) {
    isConnecting = true;
    isDraggingConnection = true;
    connectingFrom = handleNode.id;
    canvas.classList.add('connecting');
    connDragPos = { x: p.x, y: p.y };
    drawMindMap();
    e.preventDefault && e.preventDefault();
    return;
  }

  const node = getNodeAt(p.x, p.y);

  // 2) Toolbar-button-triggered click-to-connect flow
  if (isConnecting && !isDraggingConnection && node) {
    if (connectingFrom && connectingFrom !== node.id) {
      const exists = edges.find(eg => (eg.from === connectingFrom && eg.to === node.id) || (eg.from === node.id && eg.to === connectingFrom));
      if (!exists) { edges.push({ from: connectingFrom, to: node.id }); saveMindMap(); toast('연결 완료', 'success'); }
    }
    connectingFrom = null; isConnecting = false;
    canvas.classList.remove('connecting');
    drawMindMap();
    return;
  }

  if (node) {
    selectedNode = node.id;
    draggingNode = node;
    lastMouse = { x: p.cx, y: p.cy };
    updateToolbarState();
    drawMindMap();
  } else {
    selectedNode = null;
    isPanning = true;
    lastMouse = { x: p.cx, y: p.cy };
    updateToolbarState();
    drawMindMap();
  }
}

function pointerMove(e) {
  if (e.touches && e.touches.length === 2 && pinchStart) {
    const t1 = e.touches[0], t2 = e.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const newZoom = Math.max(0.2, Math.min(3, pinchStart.zoom * (dist / pinchStart.dist)));
    const rect = canvas.getBoundingClientRect();
    const cx = pinchStart.cx - rect.left;
    const cy = pinchStart.cy - rect.top;
    pan.x = cx - (cx - pan.x) * (newZoom / zoom);
    pan.y = cy - (cy - pan.y) * (newZoom / zoom);
    zoom = newZoom;
    drawMindMap();
    e.preventDefault && e.preventDefault();
    return;
  }
  const t = e.touches ? e.touches[0] : e;
  if (!t) return;

  // Connection drag: just update endpoint position
  if (isDraggingConnection || isConnecting) {
    const rect = canvas.getBoundingClientRect();
    connDragPos = { x: t.clientX - rect.left, y: t.clientY - rect.top };
    drawMindMap();
    if (isDraggingConnection) e.preventDefault && e.preventDefault();
    return;
  }

  const dx = t.clientX - lastMouse.x;
  const dy = t.clientY - lastMouse.y;

  if (draggingNode) {
    draggingNode.x += dx / zoom;
    draggingNode.y += dy / zoom;
    lastMouse = { x: t.clientX, y: t.clientY };
    drawMindMap();
    e.preventDefault && e.preventDefault();
  } else if (isPanning) {
    pan.x += dx; pan.y += dy;
    lastMouse = { x: t.clientX, y: t.clientY };
    drawMindMap();
    e.preventDefault && e.preventDefault();
  }
}

function pointerUp(e) {
  if (isDraggingConnection) {
    const t = (e && e.changedTouches && e.changedTouches[0]) || e;
    if (t) {
      const rect = canvas.getBoundingClientRect();
      const sx = t.clientX - rect.left;
      const sy = t.clientY - rect.top;
      const target = getNodeAt(sx, sy);
      if (target && target.id !== connectingFrom) {
        const exists = edges.find(eg =>
          (eg.from === connectingFrom && eg.to === target.id) ||
          (eg.from === target.id && eg.to === connectingFrom));
        if (!exists) {
          edges.push({ from: connectingFrom, to: target.id });
          saveMindMap();
          toast('연결 완료', 'success');
        } else {
          toast('이미 연결되어 있습니다');
        }
      }
    }
    isConnecting = false;
    isDraggingConnection = false;
    connectingFrom = null;
    canvas.classList.remove('connecting');
    drawMindMap();
    return;
  }
  if (draggingNode) saveMindMap();
  if (isPanning) saveMindMap();
  draggingNode = null;
  isPanning = false;
  pinchStart = null;
}

canvas.addEventListener('mousedown', pointerDown);
canvas.addEventListener('mousemove', pointerMove);
window.addEventListener('mouseup', pointerUp);
canvas.addEventListener('touchstart', pointerDown, { passive: false });
canvas.addEventListener('touchmove', pointerMove, { passive: false });
canvas.addEventListener('touchend', pointerUp);

function addNodeAtScreenPoint(sx, sy, clientX, clientY) {
  const wp = screenToWorld(sx, sy);
  const node = {
    id: nodeIdCounter++,
    text: '새 노드',
    x: wp.x,
    y: wp.y,
    color: currentNodeColor
  };
  nodes.push(node);
  selectedNode = node.id;
  saveMindMap();
  updateToolbarState();
  drawMindMap();
  openNodeEdit(node, clientX, clientY);
}

canvas.addEventListener('dblclick', e => {
  const p = getCanvasPoint(e);
  const node = getNodeAt(p.x, p.y);
  if (node) openNodeEdit(node, p.cx, p.cy);
  else addNodeAtScreenPoint(p.x, p.y, p.cx, p.cy);
});

// Double tap on touch — works on both nodes and empty space
let lastTap = 0;
let lastTapPos = { x: 0, y: 0 };
canvas.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTap < 300 && e.changedTouches.length === 1) {
    const t = e.changedTouches[0];
    // Only treat as double-tap if both taps were near the same spot
    const dx = t.clientX - lastTapPos.x;
    const dy = t.clientY - lastTapPos.y;
    if (Math.hypot(dx, dy) < 30) {
      const rect = canvas.getBoundingClientRect();
      const sx = t.clientX - rect.left;
      const sy = t.clientY - rect.top;
      const node = getNodeAt(sx, sy);
      e.preventDefault();
      if (node) openNodeEdit(node, t.clientX, t.clientY);
      else addNodeAtScreenPoint(sx, sy, t.clientX, t.clientY);
      lastTap = 0;
      return;
    }
  }
  lastTap = now;
  if (e.changedTouches[0]) lastTapPos = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const oldZoom = zoom;
  zoom *= e.deltaY < 0 ? 1.1 : 0.9;
  zoom = Math.max(0.2, Math.min(3, zoom));
  pan.x = mx - (mx - pan.x) * (zoom / oldZoom);
  pan.y = my - (my - pan.y) * (zoom / oldZoom);
  drawMindMap();
  saveMindMap();
}, { passive: false });

function addMindNode() {
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  const cx = (w / 2 - pan.x) / zoom;
  const cy = (h / 2 - pan.y) / zoom;
  const node = {
    id: nodeIdCounter++,
    text: '새 노드',
    x: cx + (Math.random() - 0.5) * 100,
    y: cy + (Math.random() - 0.5) * 100,
    color: currentNodeColor
  };
  nodes.push(node);
  selectedNode = node.id;
  saveMindMap();
  updateToolbarState();
  drawMindMap();
  const sp = worldToScreen(node.x, node.y);
  const rect = canvas.getBoundingClientRect();
  openNodeEdit(node, sp.x + rect.left, sp.y + rect.top);
}

function startConnecting() {
  if (!selectedNode) { toast('먼저 노드를 선택하세요'); return; }
  isConnecting = true;
  connectingFrom = selectedNode;
  canvas.classList.add('connecting');
  toast('연결할 노드를 탭하세요');
}

function deleteSelected() {
  if (!selectedNode) return;
  if (!confirm('이 노드를 삭제하시겠습니까?')) return;
  nodes = nodes.filter(n => n.id !== selectedNode);
  edges = edges.filter(e => e.from !== selectedNode && e.to !== selectedNode);
  selectedNode = null;
  saveMindMap();
  updateToolbarState();
  drawMindMap();
}

function setNodeColor(el) {
  document.querySelectorAll('.mindmap-toolbar .color-dot').forEach(d => d.classList.remove('active'));
  el.classList.add('active');
  currentNodeColor = el.dataset.color;
  if (selectedNode) {
    const node = nodes.find(n => n.id === selectedNode);
    if (node) { node.color = currentNodeColor; saveMindMap(); drawMindMap(); }
  }
}

function zoomIn() { zoom = Math.min(3, zoom * 1.2); saveMindMap(); drawMindMap(); }
function zoomOut() { zoom = Math.max(0.2, zoom / 1.2); saveMindMap(); drawMindMap(); }
function resetView() { zoom = 1; pan = { x: 0, y: 0 }; saveMindMap(); drawMindMap(); }

const popup = document.getElementById('node-edit-popup');
const popupInput = document.getElementById('node-edit-input');
let editingNodeId = null;
let editOriginalText = '';

function openNodeEdit(node, cx, cy) {
  editingNodeId = node.id;
  editOriginalText = node.text;
  popupInput.value = node.text;
  popup.style.display = 'block';
  // Position adjust to stay in viewport
  const popupW = 240;
  const left = Math.min(window.innerWidth - popupW - 12, Math.max(12, cx - popupW/2));
  const top = Math.min(window.innerHeight - 70, cy + 20);
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popupInput.focus();
  popupInput.select();
}

function closeNodeEdit(cancel) {
  if (editingNodeId && !cancel) {
    const node = nodes.find(n => n.id === editingNodeId);
    if (node && popupInput.value.trim()) {
      node.text = popupInput.value.trim();
      saveMindMap();
      drawMindMap();
    }
  }
  popup.style.display = 'none';
  editingNodeId = null;
}

document.addEventListener('mousedown', e => {
  if (popup.style.display === 'block' && !popup.contains(e.target)) closeNodeEdit();
});
document.addEventListener('touchstart', e => {
  if (popup.style.display === 'block' && !popup.contains(e.target)) closeNodeEdit();
}, { passive: true });

// Hint
setTimeout(() => {
  const hint = document.getElementById('mm-hint');
  hint.classList.add('show');
  setTimeout(() => hint.classList.remove('show'), 4000);
}, 800);

updateToolbarState();

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const activePage = document.querySelector('.page.active').id;
  if (activePage === 'page-mindmap') {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); addMindNode(); }
    if (e.key === 'Escape') { selectedNode = null; isConnecting = false; connectingFrom = null; canvas.classList.remove('connecting'); updateToolbarState(); drawMindMap(); }
  }
});

// =================== TIME BLOCK ===================
let currentDate = new Date();
let timeBlocks = load('tb_blocks', {});
let tbSelectedColor = 'accent';
let tbClickedHour = null;
let tbEditingIdx = null;

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
    html += `<div class="time-block-item tb-color-${b.color} ${b.done ? 'done' : ''}" data-idx="${idx}" style="top:${top}px;height:${height}px;">
      <div class="block-title">
        <span class="block-checkbox" data-toggle="${idx}" title="완료 토글" aria-label="완료 토글"></span>
        <span class="block-title-text">${escapeHtml(b.title)}</span>
      </div>
      ${height > 36 ? `<div class="block-time">${b.start} – ${b.end}</div>` : ''}
      ${b.desc && height > 78 ? `<div class="block-desc">${escapeHtml(b.desc)}</div>` : ''}
      <button class="block-delete" data-del="${idx}">✕</button>
    </div>`;
  });
  html += '</div>';
  html += '</div>';

  body.innerHTML = html;

  // Wire up events
  body.querySelectorAll('.time-slot').forEach(s => {
    s.addEventListener('click', () => openTbModal(parseInt(s.dataset.hour)));
  });
  body.querySelectorAll('.time-block-item').forEach(item => {
    item.addEventListener('click', e => {
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
      const idx = parseInt(item.dataset.idx);
      editTbBlock(key, idx);
    });
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
  tbSelectedColor = 'accent';
  document.querySelectorAll('.modal-colors .mc').forEach(m => m.classList.remove('active'));
  document.querySelector('.modal-colors .mc').classList.add('active');
  document.getElementById('tb-modal').classList.add('show');
  setTimeout(() => document.getElementById('tb-title').focus(), 100);
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
  tbSelectedColor = block.color;
  document.querySelectorAll('.modal-colors .mc').forEach(m => {
    m.classList.toggle('active', m.dataset.color === block.color);
  });
  document.getElementById('tb-modal').classList.add('show');
}

function closeTbModal() { document.getElementById('tb-modal').classList.remove('show'); tbEditingIdx = null; }

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

  const data = {
    title, start, end,
    desc: document.getElementById('tb-desc').value.trim(),
    color: tbSelectedColor,
    done: document.getElementById('tb-done').checked
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
  closeTbModal();
  renderTimeBlocks();
  renderTimeblockList();
}

function deleteTbBlock(key, idx) {
  timeBlocks[key].splice(idx, 1);
  if (timeBlocks[key].length === 0) delete timeBlocks[key];
  save('tb_blocks', timeBlocks);
  renderTimeBlocks();
  renderTimeblockList();
}

function toggleTbDone(key, idx) {
  if (!timeBlocks[key] || !timeBlocks[key][idx]) return;
  timeBlocks[key][idx].done = !timeBlocks[key][idx].done;
  save('tb_blocks', timeBlocks);
  renderTimeBlocks();
  renderTimeblockList();
}

renderDate();
renderTimeBlocks();
renderTimeblockList();
// Refresh "now" indicator every minute
setInterval(() => {
  if (document.getElementById('page-timeblock').classList.contains('active')) renderTimeBlocks();
}, 60000);

// =================== MEMO ===================
let memos = load('memos', []);
let activeMemoId = null;
let memoIdCounter = load('memo_idcounter', 1);

function saveMemos() {
  save('memos', memos);
  save('memo_idcounter', memoIdCounter);
}

function createMemo() {
  const memo = { id: memoIdCounter++, title: '새 메모', content: '', date: new Date().toISOString() };
  memos.unshift(memo);
  activeMemoId = memo.id;
  saveMemos();
  renderMemoList();
  renderMemoEditor();
  document.getElementById('memo-page').classList.add('show-editor');
  setTimeout(() => {
    const inp = document.querySelector('.memo-editor-header input');
    if (inp) { inp.focus(); inp.select(); }
  }, 100);
}

function selectMemo(id) {
  activeMemoId = id;
  renderMemoList();
  renderMemoEditor();
  document.getElementById('memo-page').classList.add('show-editor');
}

function backToList() {
  document.getElementById('memo-page').classList.remove('show-editor');
}

function deleteMemo(id) {
  if (!confirm('이 메모를 삭제하시겠습니까?')) return;
  memos = memos.filter(m => m.id !== id);
  if (activeMemoId === id) activeMemoId = null;
  saveMemos();
  renderMemoList();
  renderMemoEditor();
  backToList();
  toast('삭제되었습니다');
}

function renderMemoList() {
  const search = document.getElementById('memo-search').value.toLowerCase();
  const filtered = memos.filter(m => m.title.toLowerCase().includes(search) || m.content.toLowerCase().includes(search));
  const container = document.getElementById('memo-items');
  const countEl = document.getElementById('memo-count');
  if (countEl) countEl.textContent = memos.length;
  if (filtered.length === 0) {
    container.innerHTML = `<div class="memo-empty">
      <div class="big-icon">📝</div>
      ${memos.length === 0 ? '아직 메모가 없습니다<br>+ 버튼을 눌러 시작하세요' : '검색 결과가 없습니다'}
    </div>`;
    return;
  }
  container.innerHTML = filtered.map(m => {
    const date = new Date(m.date);
    const now = new Date();
    let dateStr;
    if (isSameDay(date, now)) {
      dateStr = `오늘 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    } else {
      const dayDiff = Math.floor((now - date) / (1000*60*60*24));
      if (dayDiff < 7) dateStr = `${dayDiff}일 전`;
      else dateStr = `${date.getMonth()+1}월 ${date.getDate()}일`;
    }
    const preview = m.content.replace(/^#+\s+.*$/gm, '').replace(/[*_`>#]/g, '').replace(/\n+/g, ' ').trim().slice(0, 90) || '내용 없음';
    const wordCount = m.content.length;
    return `<div class="swipe-row" data-id="${m.id}">
      <div class="memo-item swipe-content ${m.id === activeMemoId ? 'active' : ''}" onclick="selectMemo(${m.id})">
        <div class="memo-item-title">${escapeHtml(m.title) || '제목 없음'}</div>
        <div class="memo-item-preview">${escapeHtml(preview)}</div>
        <div class="memo-item-meta">
          <span>${dateStr}</span>
          <span class="dot"></span>
          <span>${wordCount}자</span>
        </div>
      </div>
      <button class="swipe-action" aria-label="삭제">🗑 삭제</button>
    </div>`;
  }).join('');
  // Wire swipe-to-delete (idempotent — handler attached once via flag)
  if (!container.dataset.swipeReady) {
    attachSwipeToDelete(container, {
      resolveId: (row) => parseInt(row.dataset.id),
      onDelete: (id) => deleteMemo(id)
    });
    container.dataset.swipeReady = '1';
  }
}

function renderMemoEditor() {
  const editor = document.getElementById('memo-editor');
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) {
    editor.innerHTML = `<div class="memo-editor-empty">
      <div class="big">📝</div>
      <div style="font-size:16px;font-weight:600;color:var(--text-dim);">메모를 선택하거나 새로 만드세요</div>
      <div class="hint">목록에서 메모를 선택하거나 + 버튼을 눌러 새 메모를 만드세요</div>
      <div class="shortcuts">
        <div style="font-weight:600;color:var(--text);margin-bottom:6px;">마크다운 단축 문법</div>
        <code># </code> 큰 제목 ·  <code>## </code> 중제목<br>
        <code>**굵게**</code> ·  <code>*기울임*</code> ·  <code>~~취소~~</code><br>
        <code>- </code> 목록 ·  <code>- [ ] </code> 체크박스<br>
        <code>\`코드\`</code> ·  <code>&gt; </code> 인용문 ·  <code>---</code> 구분선
      </div>
    </div>`;
    return;
  }
  const date = new Date(memo.date);
  const dateStr = `${date.getFullYear()}년 ${date.getMonth()+1}월 ${date.getDate()}일 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
  const charCount = memo.content.length;
  const wordCount = memo.content.trim().split(/\s+/).filter(Boolean).length;

  const editPart = `<textarea placeholder="# 제목\n\n마크다운으로 자유롭게 작성하세요..." oninput="updateMemoContent(this.value)">${escapeHtml(memo.content)}</textarea>`;
  const previewPart = `<div class="markdown-body">${memo.content.trim() ? md2html(memo.content) : '<div class="markdown-empty">미리볼 내용이 없습니다</div>'}</div>`;
  const livePart = `<div class="bear-editor" contenteditable="true" id="bear-editor-${memo.id}" spellcheck="false"></div>`;

  let bodyHtml = '';
  if (memoMode === 'live') bodyHtml = `<div class="memo-body-wrap">${livePart}</div>`;
  else if (memoMode === 'edit') bodyHtml = `<div class="memo-body-wrap">${editPart}</div>`;
  else if (memoMode === 'preview') bodyHtml = `<div class="memo-body-wrap">${previewPart}</div>`;
  else bodyHtml = `<div class="memo-body-wrap split">${editPart}${previewPart}</div>`;

  const liveIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
  const splitIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`;
  const eyeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

  editor.innerHTML = `
    <div class="memo-editor-toolbar">
      <button class="panel-reopen-btn" onclick="togglePanel('memo-page')" title="목록 열기">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <button class="memo-back" onclick="backToList()" aria-label="뒤로">‹</button>
      <div class="memo-mode-toggle">
        <button class="${memoMode==='live'?'active':''}" onclick="setMemoMode('live')" title="라이브 (Bear 스타일)">${liveIcon}<span class="label-text">라이브</span></button>
        <button class="${memoMode==='split'?'active':''}" onclick="setMemoMode('split')" title="분할">${splitIcon}<span class="label-text">분할</span></button>
        <button class="${memoMode==='preview'?'active':''}" onclick="setMemoMode('preview')" title="미리보기">${eyeIcon}<span class="label-text">미리보기</span></button>
      </div>
      <div class="memo-toolbar-spacer"></div>
      <button class="memo-icon-btn" onclick="openDrawingModal()" title="드로잉 (Apple Pencil)">
        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
      </button>
      <button class="memo-icon-btn" onclick="triggerImageUpload()" title="이미지 업로드 (또는 메모에 붙여넣기/드래그)">
        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </button>
      <button class="memo-icon-btn danger" onclick="deleteMemo(${memo.id})" title="메모 삭제">
        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/></svg>
      </button>
    </div>
    <div class="memo-editor-header">
      <input type="text" value="${escapeHtml(memo.title)}" oninput="updateMemoTitle(this.value)" placeholder="제목 없음">
    </div>
    <div class="memo-meta">
      <span>${dateStr}</span>
      <span class="dot"></span>
      <span>${charCount}자 · ${wordCount}단어</span>
      <span class="dot"></span>
      <span class="badge">MARKDOWN</span>
    </div>
    ${bodyHtml}
  `;
  // Wire interactions once the new DOM exists
  setTimeout(() => {
    if (memoMode === 'split') setupSplitScrollSync();
    if (memoMode === 'live') {
      const ed = document.getElementById('bear-editor-' + memo.id);
      if (ed) {
        setupBearEditor(ed, memo.content, (newContent) => {
          memo.content = newContent;
          memo.date = new Date().toISOString();
          saveMemos();
          // Live char-count update in meta (optional)
          const meta = document.querySelector('.memo-meta');
          if (meta) {
            const date = new Date(memo.date);
            const dateStr = `${date.getFullYear()}년 ${date.getMonth()+1}월 ${date.getDate()}일 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
            const wc = newContent.trim().split(/\s+/).filter(Boolean).length;
            meta.querySelector('span:nth-child(1)').textContent = dateStr;
            meta.querySelector('span:nth-child(3)').textContent = `${newContent.length}자 · ${wc}단어`;
          }
          clearTimeout(window._memoListTimer);
          window._memoListTimer = setTimeout(renderMemoList, 500);
        });
      }
    }
  }, 0);
}

// =================== PANEL COLLAPSE / SWIPE-TO-DELETE ===================
function togglePanel(pageId) {
  const el = document.getElementById(pageId);
  if (!el) return;
  el.classList.toggle('list-collapsed');
}

// Generic touch swipe handler — apply to any container with .swipe-row children.
// JS owns transform throughout (no class-vs-inline conflict), supports
// rubber-band, velocity-aware flick, and tap-on-swiped-row to close.
function attachSwipeToDelete(rootEl, options) {
  const { resolveId, onDelete, max = 88 } = options;
  const threshold = max * 0.4;
  let row = null, content = null;
  let startX = 0, startY = 0, startTime = 0;
  let dragLocked = false, isHorizontal = false, startedOpen = false;

  function setState(r, isOpen) {
    const c = r.querySelector('.swipe-content');
    if (!c) return;
    c.style.transition = 'transform 0.24s cubic-bezier(0.32,0.72,0.16,1)';
    c.style.transform = isOpen ? 'translateX(-' + max + 'px)' : 'translateX(0)';
    r.classList.toggle('swiped', isOpen);
  }

  function closeAll() {
    rootEl.querySelectorAll('.swipe-row.swiped').forEach(r => setState(r, false));
  }

  function onStart(e) {
    const t = e.touches ? e.touches[0] : e;
    const r = e.target.closest('.swipe-row');
    if (!r) return;
    // Tap on action button: handled by click handler, don't start drag here
    if (e.target.closest('.swipe-action')) return;
    // Close other swiped rows first
    rootEl.querySelectorAll('.swipe-row.swiped').forEach(o => { if (o !== r) setState(o, false); });
    row = r;
    content = r.querySelector('.swipe-content');
    if (!content) { row = null; return; }
    content.style.transition = 'none';
    startedOpen = r.classList.contains('swiped');
    startX = t.clientX;
    startY = t.clientY;
    startTime = Date.now();
    dragLocked = false;
    isHorizontal = false;
  }

  function onMove(e) {
    if (!row || !content) return;
    const t = e.touches ? e.touches[0] : e;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (!dragLocked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      dragLocked = true;
      isHorizontal = Math.abs(dx) > Math.abs(dy) + 2; // bias toward vertical for ambiguous gestures
      if (!isHorizontal) {
        // Yield to vertical scroll
        content.style.transition = '';
        row = null;
        content = null;
        return;
      }
    }
    if (!isHorizontal) return;

    const baseX = startedOpen ? -max : 0;
    let offset = baseX + dx;
    // Rubber-band beyond bounds
    if (offset > 0) offset = offset * 0.25;
    else if (offset < -max) offset = -max + (offset + max) * 0.25;

    content.style.transform = 'translateX(' + offset + 'px)';
    if (e.cancelable) e.preventDefault();
  }

  function onEnd(e) {
    if (!row || !content) { row = null; content = null; return; }
    if (!isHorizontal) {
      content.style.transition = '';
      row = null; content = null;
      return;
    }
    const t = (e.changedTouches && e.changedTouches[0]) || e;
    const dx = t.clientX - startX;
    const dt = Math.max(1, Date.now() - startTime);
    const velocity = dx / dt; // px/ms (negative = leftward)
    const flickLeft = velocity < -0.5 && dx < -20;
    const flickRight = velocity > 0.5 && dx > 20;

    let shouldOpen;
    if (startedOpen) {
      shouldOpen = !(dx >= threshold || flickRight);
    } else {
      shouldOpen = dx <= -threshold || flickLeft;
    }
    setState(row, shouldOpen);
    row = null; content = null;
    dragLocked = false; isHorizontal = false;
  }

  rootEl.addEventListener('touchstart', onStart, { passive: true });
  rootEl.addEventListener('touchmove', onMove, { passive: false });
  rootEl.addEventListener('touchend', onEnd);
  rootEl.addEventListener('touchcancel', onEnd);

  rootEl.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.swipe-row')) return;
    onStart(e);
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      onEnd(ev);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // Capture-phase click: delete on action tap, close on tap of swiped content
  rootEl.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('.swipe-action');
    if (actionBtn) {
      e.stopPropagation();
      e.preventDefault();
      const r = actionBtn.closest('.swipe-row');
      if (!r) return;
      const id = resolveId(r);
      if (id != null) onDelete(id, r);
      setState(r, false);
      return;
    }
    const r = e.target.closest('.swipe-row');
    if (r && r.classList.contains('swiped')) {
      e.stopPropagation();
      e.preventDefault();
      setState(r, false);
    }
  }, true);

  // Outside tap closes any open swipe in this list
  document.addEventListener('click', (e) => {
    if (rootEl.contains(e.target)) return;
    closeAll();
  });
}

// =================== BEAR-STYLE LIVE EDITOR ===================
function bearRenderLine(text) {
  if (!text) return '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Block-level: headers, bullets, quote
  let m;
  if (m = text.match(/^(#{1,3}) (.*)$/)) {
    const level = m[1].length;
    return `<span class="md-marker">${m[1]} </span><span class="md-h${level}">${esc(m[2])}</span>`;
  }
  if (m = text.match(/^([-*+]) (.*)$/)) {
    return `<span class="md-bullet">•</span><span class="md-marker">${esc(m[1])} </span>${bearInline(esc(m[2]))}`;
  }
  if (m = text.match(/^(\d+)\. (.*)$/)) {
    return `<span class="md-marker">${m[1]}. </span>${bearInline(esc(m[2]))}`;
  }
  if (m = text.match(/^&gt; (.*)$/) || text.match(/^> (.*)$/)) {
    const body = m ? m[1] : text.slice(2);
    return `<span class="md-quote"><span class="md-marker">&gt; </span>${bearInline(esc(body))}</span>`;
  }
  return bearInline(esc(text));
}

function bearInline(html) {
  // Bold ** **
  html = html.replace(/\*\*([^\*\n]+)\*\*/g,
    '<span class="md-marker">**</span><span class="md-bold">$1</span><span class="md-marker">**</span>');
  // Italic * * (not **)
  html = html.replace(/(^|[^\*])\*([^\*\n]+)\*(?!\*)/g,
    '$1<span class="md-marker">*</span><span class="md-em">$2</span><span class="md-marker">*</span>');
  // Strikethrough ~~ ~~
  html = html.replace(/~~([^~\n]+)~~/g,
    '<span class="md-marker">~~</span><span class="md-strike">$1</span><span class="md-marker">~~</span>');
  // Inline code `
  html = html.replace(/`([^`\n]+)`/g,
    '<span class="md-marker">`</span><span class="md-code">$1</span><span class="md-marker">`</span>');
  // Link [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<span class="md-marker">[</span><span class="md-link">$1</span><span class="md-marker">](</span><span class="md-marker">$2</span><span class="md-marker">)</span>');
  return html;
}

function bearRenderContent(text) {
  return text.split('\n').map(line =>
    `<div data-line>${bearRenderLine(line)}</div>`
  ).join('');
}

// All offset/text functions use Range.toString() so block boundaries count
// as \n consistently. Critically, set-caret walks BLOCKS (not just text
// nodes) so the caret can land on an empty line (whose div has no text
// node) — that's the case after pressing Enter at end of a line.
function bearGetCaretOffset(editor) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return 0;
  const tempRange = document.createRange();
  tempRange.selectNodeContents(editor);
  tempRange.setEnd(range.startContainer, range.startOffset);
  return tempRange.toString().length;
}

function bearSetCaretOffset(editor, target) {
  const blocks = [...editor.children];
  if (blocks.length === 0) {
    // Place caret in editor itself
    const r = document.createRange();
    const sel = window.getSelection();
    r.setStart(editor, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }

  // Find the LAST block whose start position <= target. That's the block
  // the caret should live in. Using LAST handles the boundary case where
  // target equals the position right after a \n separator (start of next
  // block), not the end of the previous block.
  let containingIdx = 0;
  let containingStart = 0;
  for (let i = 0; i < blocks.length; i++) {
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.setEndBefore(blocks[i]);
    const startPos = r.toString().length;
    if (startPos <= target) {
      containingIdx = i;
      containingStart = startPos;
    } else {
      break;
    }
  }

  const block = blocks[containingIdx];
  const offsetInBlock = target - containingStart;

  // Walk text nodes within the block to place caret at offsetInBlock
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
  let chars = 0;
  let node;
  let lastNode = null;
  while ((node = walker.nextNode())) {
    lastNode = node;
    if (chars + node.length >= offsetInBlock) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, Math.max(0, Math.min(node.length, offsetInBlock - chars)));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    chars += node.length;
  }
  // No text nodes in block (empty line): place caret at the start of the
  // block element itself — the browser renders it on the empty line.
  const sel = window.getSelection();
  const r = document.createRange();
  if (lastNode) {
    r.setStart(lastNode, lastNode.length);
  } else {
    r.setStart(block, 0);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function bearGetText(editor) {
  // Range.toString() of full contents gives \n-separated text consistently,
  // even when the browser inserted plain <div> blocks (e.g. after Enter).
  const range = document.createRange();
  range.selectNodeContents(editor);
  return range.toString().replace(/​/g, '');
}

function setupBearEditor(editor, content, onChange) {
  editor.innerHTML = bearRenderContent(content || '');
  let composing = false;
  let renderTimer = null;

  function rerender() {
    if (composing) return;
    const offset = bearGetCaretOffset(editor);
    const text = bearGetText(editor);
    onChange(text);
    editor.innerHTML = bearRenderContent(text);
    bearSetCaretOffset(editor, offset);
  }

  editor.addEventListener('compositionstart', () => { composing = true; });
  editor.addEventListener('compositionend', () => {
    composing = false;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(rerender, 80);
  });

  editor.addEventListener('input', () => {
    if (composing) {
      // Still notify changes during composition for autosave (no rerender)
      onChange(bearGetText(editor));
      return;
    }
    clearTimeout(renderTimer);
    renderTimer = setTimeout(rerender, 120);
  });

  // Plain-text paste: avoid pasting styled HTML which could break our layout
  editor.addEventListener('paste', (e) => {
    if (e.clipboardData?.types?.includes('Files')) return; // image paste handled elsewhere
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  });
}

let memoMode = load('memo_mode', 'live'); // live (Bear-style WYSIWYG) | split | preview
function setMemoMode(mode) {
  memoMode = mode;
  save('memo_mode', mode);
  renderMemoEditor();
}

// Sync scroll between textarea and preview in split mode (proportional)
function setupSplitScrollSync() {
  if (memoMode !== 'split') return;
  const wrap = document.querySelector('.memo-body-wrap.split');
  if (!wrap) return;
  const ta = wrap.querySelector('textarea');
  const preview = wrap.querySelector('.markdown-body');
  if (!ta || !preview) return;
  let syncing = false;
  const link = (from, to) => {
    if (syncing) return;
    syncing = true;
    const fromMax = Math.max(1, from.scrollHeight - from.clientHeight);
    const toMax = Math.max(0, to.scrollHeight - to.clientHeight);
    to.scrollTop = (from.scrollTop / fromMax) * toMax;
    requestAnimationFrame(() => { syncing = false; });
  };
  ta.addEventListener('scroll', () => link(ta, preview));
  preview.addEventListener('scroll', () => link(preview, ta));
}

function updateMemoTitle(val) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (memo) {
    memo.title = val;
    memo.date = new Date().toISOString();
    saveMemos();
    renderMemoList();
  }
}

function updateMemoContent(val) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (memo) {
    memo.content = val;
    memo.date = new Date().toISOString();
    saveMemos();
    const meta = document.querySelector('.memo-meta');
    if (meta) {
      const date = new Date(memo.date);
      const dateStr = `${date.getFullYear()}.${(date.getMonth()+1).toString().padStart(2,'0')}.${date.getDate().toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
      meta.textContent = `${dateStr} · ${val.length}자 · 마크다운 (.md)`;
    }
    // Live preview in split mode
    if (memoMode === 'split') {
      const preview = document.querySelector('.memo-body-wrap.split .markdown-body');
      if (preview) preview.innerHTML = val.trim() ? md2html(val) : '<div class="markdown-empty">미리볼 내용이 없습니다</div>';
    }
    clearTimeout(window._memoListTimer);
    window._memoListTimer = setTimeout(renderMemoList, 500);
  }
}

function filterMemos() { renderMemoList(); }

renderMemoList();
renderMemoEditor();

// =================== SYNC / BACKUP ===================
function getAllData() {
  return {
    version: 2,
    app: 'mindflow',
    exportedAt: new Date().toISOString(),
    mindmaps: load('mindmaps', []),
    activeMindmapId: load('mm_active', null),
    timeBlocks: load('tb_blocks', {}),
    memos: load('memos', []),
    memoIdCounter: load('memo_idcounter', 1)
  };
}

function applyData(data) {
  if (!data || data.app !== 'mindflow') throw new Error('올바른 MindFlow 백업 파일이 아닙니다');
  if (data.mindmaps) {
    save('mindmaps', data.mindmaps);
    save('mm_active', data.activeMindmapId || (data.mindmaps[0]?.id ?? null));
  } else if (data.mindmap) {
    // v1 backwards-compat: convert single mindmap to multi
    const m = {
      id: Date.now(),
      name: '내 마인드맵',
      nodes: data.mindmap.nodes || [],
      edges: data.mindmap.edges || [],
      idCounter: data.mindmap.idCounter || 1,
      pan: data.mindmap.pan || { x: 0, y: 0 },
      zoom: data.mindmap.zoom || 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    save('mindmaps', [m]);
    save('mm_active', m.id);
  }
  save('tb_blocks', data.timeBlocks || {});
  save('memos', data.memos || []);
  save('memo_idcounter', data.memoIdCounter || 1);
}

function openSyncModal() {
  const data = getAllData();
  const totalNodes = data.mindmaps.reduce((s, m) => s + (m.nodes?.length || 0), 0);
  const totalEdges = data.mindmaps.reduce((s, m) => s + (m.edges?.length || 0), 0);
  const totalBlocks = Object.values(data.timeBlocks).reduce((s, a) => s + a.length, 0);
  const stats = `
    🧠 마인드맵: <strong>${data.mindmaps.length}개</strong> · 노드 <strong>${totalNodes}개</strong> · 연결 <strong>${totalEdges}개</strong><br>
    📅 타임블록: <strong>${totalBlocks}개</strong> (${Object.keys(data.timeBlocks).length}일)<br>
    📝 메모: <strong>${data.memos.length}개</strong>
  `;
  document.getElementById('sync-stats').innerHTML = stats;

  // Hide share button if Web Share API unavailable (e.g. desktop browsers without share)
  if (!navigator.share) {
    document.getElementById('share-btn').style.display = 'none';
  }

  // Update Drive, Gist & folder status
  updateDriveStatus();
  updateGistStatus();
  updateFolderStatus();
  if (!isFsApiSupported()) {
    const folderEl = document.getElementById('folder-status');
    if (folderEl) {
      folderEl.innerHTML = `
        <div class="icon-circle" style="background:var(--orange);color:#1a1300">!</div>
        <div class="text-area">
          <div class="name" style="color:var(--orange)">이 브라우저는 폴더 자동 동기화를 지원하지 않습니다</div>
          <div class="desc">데스크톱 Chrome / Edge / Brave에서만 동작합니다 (Safari · iOS 미지원)</div>
        </div>
      `;
      // Hide folder action buttons in unsupported environments
      const reloadBtn = document.getElementById('reload-folder-btn');
      const disconnectBtn = document.getElementById('disconnect-folder-btn');
      if (reloadBtn) reloadBtn.style.display = 'none';
      if (disconnectBtn) disconnectBtn.style.display = 'none';
    }
  }

  document.getElementById('sync-modal').classList.add('show');
}

function closeSyncModal() { document.getElementById('sync-modal').classList.remove('show'); }

function exportData(mode) {
  const data = getAllData();
  const json = JSON.stringify(data, null, 2);
  const ts = new Date();
  const fname = `mindflow-${ts.getFullYear()}${(ts.getMonth()+1).toString().padStart(2,'0')}${ts.getDate().toString().padStart(2,'0')}-${ts.getHours().toString().padStart(2,'0')}${ts.getMinutes().toString().padStart(2,'0')}.json`;

  if (mode === 'share' && navigator.share) {
    const file = new File([json], fname, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'MindFlow 백업', text: 'MindFlow 데이터 백업 파일' })
        .then(() => toast('공유 완료', 'success'))
        .catch(err => { if (err.name !== 'AbortError') toast('공유 실패', 'error'); });
      return;
    }
  }

  // Fallback: download
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('파일이 저장되었습니다', 'success');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm('현재 데이터를 덮어씁니다. 계속하시겠습니까?')) {
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      applyData(data);
      toast('불러오기 완료. 새로고침합니다...', 'success');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      toast('파일을 읽을 수 없습니다: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// =================== GOOGLE DRIVE SYNC (data + images, all platforms) ===================
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER_NAME = 'MindFlow';
const DRIVE_ASSETS_NAME = 'assets';
const DRIVE_APP_FILENAME = '_mindflow-app.json';

let driveClientId = load('drive_client_id', null);
let driveAccessToken = null;
let driveTokenExpires = 0;
let driveFolderId = load('drive_folder_id', null);
let driveAssetsFolderId = load('drive_assets_folder_id', null);
let driveTokenClient = null;
let drivePollTimer = null;
let driveLastPushAt = 0;
let driveLastSyncAt = null;
let driveLastModifiedTime = null; // server-side mtime of folder for change detection
let isLoadingFromDrive = false;
let isPushingToDrive = false;
// driveDirty is persisted across sessions: if user closes browser before the 2s
// debounce push fires, we remember on next load that there are unflushed local
// changes — push them first before pulling (otherwise pull would clobber them).
let driveDirty = !!localStorage.getItem('mindflow_drive_dirty');
let driveUserEmail = null;
let driveStatus = 'idle';
let driveAutoSaveTimer = null;
const DRIVE_POLL_INTERVAL = 15_000;

function ensureGsiLoaded() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    let attempts = 0;
    const check = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(check); resolve(); return; }
      if (++attempts > 80) { clearInterval(check); reject(new Error('Google 인증 라이브러리를 불러오지 못했습니다 (네트워크 확인)')); }
    }, 100);
  });
}

async function driveAuth(promptUser = false) {
  if (!driveClientId) throw new Error('Client ID 미설정');
  await ensureGsiLoaded();
  return new Promise((resolve, reject) => {
    try {
      driveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: driveClientId,
        scope: DRIVE_SCOPE,
        prompt: promptUser ? 'consent' : '',
        callback: (resp) => {
          if (resp.error) return reject(new Error(resp.error_description || resp.error));
          driveAccessToken = resp.access_token;
          driveTokenExpires = Date.now() + (resp.expires_in - 60) * 1000;
          resolve();
        },
        error_callback: (err) => reject(new Error(err.message || '인증 거부됨'))
      });
      driveTokenClient.requestAccessToken();
    } catch (e) { reject(e); }
  });
}

async function ensureDriveToken() {
  if (driveAccessToken && Date.now() < driveTokenExpires) return;
  await driveAuth(false);
}

async function driveApi(method, path, body, query = {}) {
  await ensureDriveToken();
  const url = new URL('https://www.googleapis.com/drive/v3' + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const headers = { 'Authorization': 'Bearer ' + driveAccessToken };
  let bodyToSend = body;
  if (body && typeof body === 'object' && !(body instanceof Blob)) {
    headers['Content-Type'] = 'application/json';
    bodyToSend = JSON.stringify(body);
  }
  const r = await fetch(url, { method, headers, body: bodyToSend });
  if (!r.ok) {
    let msg = `Drive ${r.status}`;
    try { const j = await r.json(); if (j.error?.message) msg = j.error.message; } catch {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  return r.json();
}

async function driveDownloadFile(fileId) {
  await ensureDriveToken();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { 'Authorization': 'Bearer ' + driveAccessToken }
  });
  if (!r.ok) throw new Error('다운로드 실패');
  return r.text();
}

async function driveUploadFile(name, content, mimeType, parentId, appProperties) {
  await ensureDriveToken();
  const metadata = { name, mimeType };
  if (parentId) metadata.parents = [parentId];
  if (appProperties) metadata.appProperties = appProperties;
  const boundary = '----mfb' + Math.random().toString(36).slice(2);
  const isBlob = content instanceof Blob;
  if (isBlob) {
    // Two-step for binary: create then upload media (simpler than multipart with binary)
    const created = await driveApi('POST', '/files', metadata);
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + driveAccessToken, 'Content-Type': mimeType },
      body: content
    });
    if (!r.ok) throw new Error('업로드 실패: ' + await r.text());
    return r.json();
  } else {
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + driveAccessToken,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });
    if (!r.ok) throw new Error('업로드 실패: ' + await r.text());
    return r.json();
  }
}

async function driveUpdateFile(fileId, content, mimeType) {
  await ensureDriveToken();
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + driveAccessToken, 'Content-Type': mimeType },
    body: content instanceof Blob ? content : new Blob([content], { type: mimeType })
  });
  if (!r.ok) throw new Error('수정 실패: ' + await r.text());
  return r.json();
}

async function driveDeleteFile(fileId) {
  await ensureDriveToken();
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + driveAccessToken }
  });
}

async function driveListInFolder(folderId) {
  return driveApi('GET', '/files', null, {
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime,size,appProperties)',
    pageSize: 1000
  });
}

async function driveFindOrCreateFolder(name, parentId) {
  const escaped = name.replace(/'/g, "\\'");
  const q = parentId
    ? `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`
    : `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`;
  const list = await driveApi('GET', '/files', null, { q, fields: 'files(id,name)' });
  if (list.files.length > 0) return list.files[0].id;
  const folder = await driveApi('POST', '/files', {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : []
  });
  return folder.id;
}

async function driveMakePublic(fileId) {
  try {
    await driveApi('POST', `/files/${fileId}/permissions`, { role: 'reader', type: 'anyone' });
  } catch (e) { console.warn('Make public failed:', e); }
}

async function driveConnect() {
  const cidInput = document.getElementById('drive-client-id-input');
  const cid = (cidInput?.value || driveClientId || '').trim();
  if (!cid) { toast('Google OAuth Client ID를 입력하세요', 'error'); return; }
  if (!cid.endsWith('.apps.googleusercontent.com')) {
    toast('Client ID 형식이 잘못된 것 같습니다 (...apps.googleusercontent.com)', 'error');
    return;
  }
  driveClientId = cid;
  save('drive_client_id', cid);

  driveStatus = 'saving';
  updateDriveStatus();
  toast('Google 인증 중...');

  try {
    await driveAuth(true);
    // Get user email so user can verify same account is used on all devices
    try {
      const about = await driveApi('GET', '/about', null, { fields: 'user(emailAddress,displayName)' });
      driveUserEmail = about.user?.emailAddress || null;
    } catch {}
    driveFolderId = await driveFindOrCreateFolder(DRIVE_FOLDER_NAME, null);
    save('drive_folder_id', driveFolderId);
    driveAssetsFolderId = await driveFindOrCreateFolder(DRIVE_ASSETS_NAME, driveFolderId);
    save('drive_assets_folder_id', driveAssetsFolderId);
    updateDriveStatus();

    const list = await driveListInFolder(driveFolderId);
    const remoteHasMd = list.files.some(f => f.name.toLowerCase().endsWith('.md'));
    const remoteHasApp = list.files.some(f => f.name === DRIVE_APP_FILENAME);
    const remoteHasData = remoteHasMd || remoteHasApp;
    const localHasData = memos.length > 0 || mindmaps.some(m => m.nodes.length > 0) || Object.keys(load('tb_blocks', {})).length > 0;

    if (remoteHasData && localHasData) {
      if (confirm('Drive 폴더에 이미 데이터가 있습니다.\n\n[확인] 가져오기 — Drive 데이터로 로컬을 덮어씁니다\n[취소] 로컬 유지 — 다음 저장 시 Drive를 로컬로 덮어씁니다')) {
        await drivePullAll(true);
      } else {
        await drivePushAll();
      }
    } else if (remoteHasData) {
      await drivePullAll(true);
    } else {
      await drivePushAll();
    }
    if (cidInput) cidInput.value = '';
    driveStartPolling();
    toast('Google Drive 연결 완료', 'success');
  } catch (e) {
    console.error(e);
    driveStatus = 'error';
    updateDriveStatus();
    let detail = '';
    if (/popup|blocked/i.test(e.message)) detail = '\n\n팝업 차단을 해제하고 다시 시도하세요.';
    else if (/access_denied|denied/i.test(e.message)) detail = '\n\n동의 화면에서 권한을 허용해 주세요.';
    else if (/origin/i.test(e.message)) detail = '\n\nGoogle Cloud Console에서 OAuth Client의\n"승인된 JavaScript 원본"에 https://thefirstplum.github.io 추가했는지 확인';
    alert('❌ 연결 실패\n\n' + e.message + detail);
  }
}

async function driveDisconnect() {
  if (!confirm('Drive 연결을 해제하시겠습니까? 로컬 데이터는 그대로 유지됩니다.\n(Drive 폴더는 그대로 남아있습니다)')) return;
  driveStopPolling();
  driveAccessToken = null;
  driveTokenExpires = 0;
  driveFolderId = null;
  driveAssetsFolderId = null;
  driveLastModifiedTime = null;
  save('drive_folder_id', null);
  save('drive_assets_folder_id', null);
  // Keep client_id for easy re-connect
  updateDriveStatus();
  toast('연결 해제됨');
}

function sanitizeDriveName(s) {
  return (s || 'untitled').replace(/[\/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
}

function parseMemoIdFromFilename(name) {
  const m = name.match(/^(\d+)-/);
  return m ? parseInt(m[1]) : null;
}

async function drivePushAll() {
  if (!driveFolderId || isLoadingFromDrive || isPushingToDrive) return;
  isPushingToDrive = true;
  try {
    driveStatus = 'saving';
    updateDriveStatus();

    // Get current files in folder
    const current = await driveListInFolder(driveFolderId);
    const byName = new Map();
    const byMemoId = new Map();
    for (const f of current.files) {
      if (f.mimeType === 'application/vnd.google-apps.folder') continue;
      byName.set(f.name, f);
      // Match by appProperties.memoId (preferred) or legacy {id}-prefix filename
      const propId = f.appProperties?.memoId ? parseInt(f.appProperties.memoId) : null;
      const fnId = parseMemoIdFromFilename(f.name);
      const id = propId || fnId;
      if (id) byMemoId.set(id, f);
    }

    // App data
    const appData = {
      version: 2,
      app: 'mindflow',
      exportedAt: new Date().toISOString(),
      mindmaps: load('mindmaps', []),
      activeMindmapId: load('mm_active', null),
      timeBlocks: load('tb_blocks', {})
    };
    const appJson = JSON.stringify(appData, null, 2);
    const appFile = byName.get(DRIVE_APP_FILENAME);
    if (appFile) {
      await driveUpdateFile(appFile.id, appJson, 'application/json');
    } else {
      await driveUploadFile(DRIVE_APP_FILENAME, appJson, 'application/json', driveFolderId);
    }

    // Build clean filenames with deduplication for same-title memos
    const usedNames = new Set([DRIVE_APP_FILENAME]);
    const memoFilenames = new Map();
    for (const memo of memos) {
      const base = sanitizeDriveName(memo.title);
      let fname = `${base}.md`;
      let n = 2;
      while (usedNames.has(fname)) { fname = `${base} (${n}).md`; n++; }
      usedNames.add(fname);
      memoFilenames.set(memo.id, fname);
    }

    // Push each memo: clean title.md filename + appProperties.memoId for matching
    const keptFiles = new Set([DRIVE_APP_FILENAME]);
    for (const memo of memos) {
      const fname = memoFilenames.get(memo.id);
      const content = `---\nid: ${memo.id}\ntitle: ${(memo.title || '').replace(/\n/g, ' ')}\ndate: ${memo.date}\n---\n\n${memo.content || ''}`;
      const existing = byMemoId.get(memo.id);
      if (existing) {
        await driveUpdateFile(existing.id, content, 'text/markdown');
        // Migrate from old "{id}-title.md" name and/or attach appProperties for stable matching
        const needsRename = existing.name !== fname;
        const needsProp = !existing.appProperties?.memoId;
        if (needsRename || needsProp) {
          const patch = {};
          if (needsRename) patch.name = fname;
          if (needsProp) patch.appProperties = { memoId: String(memo.id) };
          try { await driveApi('PATCH', `/files/${existing.id}`, patch); } catch (e) { console.warn('Metadata patch failed:', e); }
        }
        keptFiles.add(fname);
        keptFiles.add(existing.name);
      } else {
        await driveUploadFile(fname, content, 'text/markdown', driveFolderId, { memoId: String(memo.id) });
        keptFiles.add(fname);
      }
    }

    // Delete orphan .md files (managed by us — has appProperties.memoId or legacy {id}- prefix — but no longer in memos)
    for (const [name, f] of byName) {
      if (keptFiles.has(name)) continue;
      if (!name.toLowerCase().endsWith('.md')) continue;
      const propId = f.appProperties?.memoId ? parseInt(f.appProperties.memoId) : null;
      const fnId = parseMemoIdFromFilename(f.name);
      const id = propId || fnId;
      if (id && !memos.find(m => m.id === id)) {
        try { await driveDeleteFile(f.id); } catch {}
      }
    }

    driveLastPushAt = Date.now();
    driveLastSyncAt = driveLastPushAt;
    // Update mtime sentinel to MAX CHILD mtime so the next poll won't re-pull our own write
    try {
      const after = await driveListInFolder(driveFolderId);
      driveLastModifiedTime = after.files.reduce((max, f) => f.modifiedTime > max ? f.modifiedTime : max, '');
    } catch {}

    driveStatus = 'saved';
    updateDriveStatus();
    setTimeout(() => { if (driveStatus === 'saved') { driveStatus = 'idle'; updateDriveStatus(); } }, 1800);
  } catch (e) {
    console.error('Drive push failed:', e);
    driveStatus = 'error';
    updateDriveStatus();
    toast('Drive 동기화 실패: ' + e.message, 'error');
    throw e; // let scheduleDriveSave see failure to keep dirty=true
  } finally {
    isPushingToDrive = false;
  }
}

async function applyDriveData(files) {
  isLoadingFromDrive = true;
  try {
    const ae = document.activeElement;
    const editingMemoId = (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.closest('.memo-editor-header'))))
      ? activeMemoId : null;

    // App data
    const appFile = files.find(f => f.name === DRIVE_APP_FILENAME);
    if (appFile) {
      try {
        const text = await driveDownloadFile(appFile.id);
        const app = JSON.parse(text);
        if (app.app === 'mindflow') {
          if (app.mindmaps) {
            mindmaps = app.mindmaps;
            activeMindmapId = app.activeMindmapId || (mindmaps[0]?.id ?? null);
            localStorage.setItem('mindflow_mindmaps', JSON.stringify(mindmaps));
            localStorage.setItem('mindflow_mm_active', JSON.stringify(activeMindmapId));
            bindActiveMap();
          }
          if (app.timeBlocks) {
            timeBlocks = app.timeBlocks;
            localStorage.setItem('mindflow_tb_blocks', JSON.stringify(timeBlocks));
          }
        }
      } catch (e) { console.warn(e); }
    }

    // Memos — fetch all .md files
    const remoteMemos = [];
    let maxId = 0;
    const mdFiles = files.filter(f => f.name.toLowerCase().endsWith('.md'));
    for (const f of mdFiles) {
      try {
        const text = await driveDownloadFile(f.id);
        const memo = parseFrontmatter(text, f.name, Date.now());
        if (!memo.id) memo.id = ++maxId + 100000;
        else if (memo.id > maxId) maxId = memo.id;
        remoteMemos.push(memo);
      } catch (e) { console.warn('Memo parse failed:', f.name, e); }
    }

    // Per-memo timestamp merge: keep whichever side has the later date.
    // This protects local edits that haven't pushed yet (browser closed,
    // network hiccup, etc.) from being silently overwritten by stale remote.
    const merged = new Map();
    for (const m of remoteMemos) merged.set(m.id, m);
    for (const m of memos) {
      const r = merged.get(m.id);
      if (!r || new Date(m.date) > new Date(r.date)) merged.set(m.id, m);
      if (m.id > maxId) maxId = m.id;
    }
    const newMemos = [...merged.values()];
    newMemos.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Always preserve the in-progress edit, regardless of timestamp comparison
    if (editingMemoId != null) {
      const local = memos.find(m => m.id === editingMemoId);
      if (local) {
        const idx = newMemos.findIndex(m => m.id === editingMemoId);
        if (idx >= 0) newMemos[idx] = local;
        else newMemos.unshift(local);
      }
    }

    memos = newMemos;
    memoIdCounter = Math.max(maxId, memos.length) + 1;
    localStorage.setItem('mindflow_memos', JSON.stringify(memos));
    localStorage.setItem('mindflow_memo_idcounter', JSON.stringify(memoIdCounter));
    if (!memos.find(m => m.id === activeMemoId)) {
      activeMemoId = memos[0]?.id || null;
    }

    renderMindmapList();
    drawMindMap();
    renderMemoList();
    if (editingMemoId == null) renderMemoEditor();
    renderTimeBlocks();
    renderTimeblockList();
  } finally {
    isLoadingFromDrive = false;
  }
}

async function drivePullAll(skipConfirm = false) {
  if (!driveFolderId) { toast('먼저 Drive를 연결하세요'); return; }
  if (!skipConfirm && !confirm('Drive의 내용으로 현재 데이터를 덮어씁니다. 계속하시겠습니까?')) return;

  try {
    driveStatus = 'saving';
    updateDriveStatus();
    const list = await driveListInFolder(driveFolderId);
    await applyDriveData(list.files);
    driveLastSyncAt = Date.now();
    // Track max child mtime so next poll won't re-pull what we just got
    driveLastModifiedTime = list.files.reduce((max, f) => f.modifiedTime > max ? f.modifiedTime : max, '');
    driveStatus = 'saved';
    updateDriveStatus();
    toast(`동기화 완료 (메모 ${memos.length}개)`, 'success');
    setTimeout(() => { if (driveStatus === 'saved') { driveStatus = 'idle'; updateDriveStatus(); } }, 1800);
  } catch (e) {
    driveStatus = 'error';
    updateDriveStatus();
    toast('가져오기 실패: ' + e.message, 'error');
  }
}

async function drivePoll(force = false) {
  if (!driveFolderId || isLoadingFromDrive || isPushingToDrive) return;
  if (!force && driveDirty) return; // don't poll while we have unpushed local changes — would overwrite
  if (!force && document.hidden) return;
  if (!force && Date.now() - driveLastPushAt < 4000) return;
  if (!force) {
    const ae = document.activeElement;
    const inEditor = ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.closest('.memo-editor-header')));
    if (inEditor) return;
  }
  try {
    // Always list children — folder modifiedTime does NOT change when child file
    // contents change in Drive, so we must check max child mtime to detect updates
    const list = await driveListInFolder(driveFolderId);
    const latestChild = list.files.reduce((max, f) => f.modifiedTime > max ? f.modifiedTime : max, '');
    if (driveLastModifiedTime && latestChild === driveLastModifiedTime) return;
    await applyDriveData(list.files);
    driveLastModifiedTime = latestChild;
    driveLastSyncAt = Date.now();
    driveStatus = 'saved';
    updateDriveStatus();
    setTimeout(() => { if (driveStatus === 'saved') { driveStatus = 'idle'; updateDriveStatus(); } }, 1500);
  } catch (e) {
    console.warn('Drive poll error:', e);
  }
}

function driveStartPolling() {
  if (drivePollTimer) clearInterval(drivePollTimer);
  if (!driveFolderId) return;
  drivePollTimer = setInterval(() => drivePoll(false), DRIVE_POLL_INTERVAL);
}

function driveStopPolling() {
  if (drivePollTimer) { clearInterval(drivePollTimer); drivePollTimer = null; }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && driveFolderId) drivePoll(false);
});

async function driveSyncNow() {
  if (!driveFolderId) { toast('먼저 Drive를 연결하세요'); return; }
  try {
    clearTimeout(driveAutoSaveTimer);
    toast('동기화 중...');
    await drivePushAll();
    await drivePoll(true);
    toast('동기화 완료', 'success');
  } catch (e) {
    toast('동기화 실패: ' + e.message, 'error');
  }
}

function scheduleDriveSave() {
  if (!driveFolderId || isLoadingFromDrive) return;
  if (!isOnline) {
    // Mark dirty so we'll push when network returns
    driveDirty = true;
    localStorage.setItem('mindflow_drive_dirty', '1');
    return;
  }
  driveDirty = true;
  localStorage.setItem('mindflow_drive_dirty', '1');
  clearTimeout(driveAutoSaveTimer);
  driveAutoSaveTimer = setTimeout(async () => {
    try {
      await drivePushAll();
      driveDirty = false;
      driveRetryAttempt = 0;
      localStorage.removeItem('mindflow_drive_dirty');
    } catch (e) {
      console.warn('Drive push failed; scheduling retry:', e);
      scheduleDriveRetry();
    }
  }, 2000);
}

function updateDriveStatus() {
  updateHeaderSyncPill();
  const el = document.getElementById('drive-status');
  if (!el) return;
  const reloadBtn = document.getElementById('drive-pull-btn');
  const disconnectBtn = document.getElementById('drive-disconnect-btn');
  const syncNowBtn = document.getElementById('drive-sync-now-btn');
  if (driveFolderId) {
    el.classList.add('connected');
    let statusText;
    if (driveStatus === 'saving') statusText = '<span class="save-pulse"></span>동기화 중...';
    else if (driveStatus === 'error') statusText = '⚠ 동기화 실패';
    else {
      const ago = driveLastSyncAt ? Math.max(0, Math.floor((Date.now() - driveLastSyncAt) / 1000)) : null;
      const agoText = ago == null ? '' :
        ago < 5 ? '방금 동기화됨' :
        ago < 60 ? `${ago}초 전 동기화` :
        ago < 3600 ? `${Math.floor(ago/60)}분 전 동기화` :
        `${Math.floor(ago/3600)}시간 전 동기화`;
      statusText = `✓ 연결됨 · 15초마다 폴링${agoText ? ' · ' + agoText : ''}`;
    }
    const acct = driveUserEmail ? ` · <span style="color:var(--accent2)">${escapeHtml(driveUserEmail)}</span>` : '';
    el.innerHTML = `
      <div class="icon-circle" style="background:#1a73e8;color:#fff;font-size:14px;font-weight:700;">G</div>
      <div class="text-area">
        <div class="name">Drive 연결됨 · ${escapeHtml(DRIVE_FOLDER_NAME)} 폴더${acct}</div>
        <div class="desc">${statusText}</div>
      </div>
    `;
    if (reloadBtn) reloadBtn.style.display = '';
    if (disconnectBtn) disconnectBtn.style.display = '';
    if (syncNowBtn) syncNowBtn.style.display = '';
  } else {
    el.classList.remove('connected');
    el.innerHTML = `
      <div class="icon-circle" style="background:var(--surface3)">G</div>
      <div class="text-area">
        <div class="name" style="color:var(--text-dim)">Google Drive 연결되지 않음</div>
        <div class="desc">메모·마인드맵·이미지를 Drive 폴더에 자동 동기화 (모든 기기)</div>
      </div>
    `;
    if (reloadBtn) reloadBtn.style.display = 'none';
    if (disconnectBtn) disconnectBtn.style.display = 'none';
    if (syncNowBtn) syncNowBtn.style.display = 'none';
  }
}

// ---- Network awareness + retry ----
let isOnline = (typeof navigator !== 'undefined' && 'onLine' in navigator) ? navigator.onLine : true;
let driveRetryTimer = null;
let driveRetryAttempt = 0;

window.addEventListener('online', () => {
  isOnline = true;
  updateHeaderSyncPill();
  if (driveDirty && driveFolderId) {
    // Resume sync immediately
    clearTimeout(driveAutoSaveTimer);
    driveAutoSaveTimer = setTimeout(async () => {
      try { await drivePushAll(); driveDirty = false; localStorage.removeItem('mindflow_drive_dirty'); } catch {}
    }, 500);
  }
});
window.addEventListener('offline', () => {
  isOnline = false;
  updateHeaderSyncPill();
});

function scheduleDriveRetry() {
  // Exponential backoff: 5s, 15s, 60s, then give up (user can manually retry)
  if (driveRetryAttempt >= 3) return;
  const delays = [5000, 15000, 60000];
  const delay = delays[driveRetryAttempt];
  driveRetryAttempt++;
  clearTimeout(driveRetryTimer);
  driveRetryTimer = setTimeout(async () => {
    if (!driveDirty || !driveFolderId) { driveRetryAttempt = 0; return; }
    try {
      await drivePushAll();
      driveDirty = false;
      localStorage.removeItem('mindflow_drive_dirty');
      driveRetryAttempt = 0;
    } catch (e) {
      console.warn(`Retry ${driveRetryAttempt} failed:`, e);
      scheduleDriveRetry();
    }
  }, delay);
}

// Header sync pill: always-visible status indicator
function updateHeaderSyncPill() {
  const pill = document.getElementById('header-sync-pill');
  const label = document.getElementById('header-sync-label');
  const banner = document.getElementById('sync-error-banner');
  if (!pill || !label) return;
  pill.classList.remove('synced', 'syncing', 'error', 'offline');

  if (!isOnline) {
    pill.classList.add('offline');
    label.textContent = '오프라인';
    if (banner) banner.classList.remove('show');
    return;
  }

  // Determine active sync method (Drive primary, Gist secondary)
  const driveActive = !!driveFolderId;
  const gistActive = !!(gistToken && gistId);
  const status = driveActive ? driveStatus : gistActive ? gistStatus : 'idle';
  const lastSync = driveActive ? driveLastSyncAt : gistActive ? gistLastSyncAt : null;

  if (!driveActive && !gistActive) {
    label.textContent = '미연결';
    if (banner) banner.classList.remove('show');
    return;
  }

  if (status === 'saving') {
    pill.classList.add('syncing');
    label.textContent = '동기화 중';
    if (banner) banner.classList.remove('show');
  } else if (status === 'error') {
    pill.classList.add('error');
    label.textContent = '동기화 실패';
    if (banner) {
      banner.classList.add('show');
      const msg = document.getElementById('sync-error-msg');
      if (msg) msg.textContent = isOnline ? '동기화 실패 — 재시도하거나 동기화 모달 확인' : '오프라인 상태';
    }
  } else {
    pill.classList.add('synced');
    if (lastSync) {
      const ago = Math.floor((Date.now() - lastSync) / 1000);
      label.textContent = ago < 5 ? '동기화됨' :
        ago < 60 ? `${ago}초 전` :
        ago < 3600 ? `${Math.floor(ago/60)}분 전` :
        `${Math.floor(ago/3600)}시간 전`;
    } else {
      label.textContent = '동기화됨';
    }
    if (banner) banner.classList.remove('show');
  }
}
function dismissSyncError() {
  const banner = document.getElementById('sync-error-banner');
  if (banner) banner.classList.remove('show');
}
// Refresh "X초 전" label every 10s
setInterval(updateHeaderSyncPill, 10_000);

async function initDrive() {
  if (driveClientId && driveFolderId) {
    updateDriveStatus();
    try {
      await driveAuth(false);
      try {
        const about = await driveApi('GET', '/about', null, { fields: 'user(emailAddress,displayName)' });
        driveUserEmail = about.user?.emailAddress || null;
      } catch {}
      // CRITICAL: if previous session had unflushed changes (e.g. browser closed
      // mid-debounce), push them BEFORE pulling — otherwise pull would clobber
      // local changes with stale Drive content.
      if (driveDirty) {
        try {
          await drivePushAll();
          driveDirty = false;
          localStorage.removeItem('mindflow_drive_dirty');
          toast('이전 세션 변경사항을 동기화했습니다', 'success');
        } catch (e) {
          console.warn('Pending push failed; skipping pull to preserve local changes:', e);
          driveStartPolling();
          return;
        }
      }
      await drivePullAll(true);
      driveStartPolling();
    } catch (e) {
      console.warn('Drive auto-restore failed:', e);
      driveStatus = 'error';
      updateDriveStatus();
    }
  }
}

// =================== DRAWING (Apple Pencil / stylus / finger / mouse) ===================
let drawStrokes = [];
let drawCurrentStroke = null;
let drawTool = 'pen';
let drawColor = '#1f1a14';
let drawWidthBase = 2;
let drawCanvas = null;
let drawCtx = null;

function openDrawingModal() {
  if (!activeMemoId) { toast('먼저 메모를 선택하세요'); return; }
  drawStrokes = [];
  drawCurrentStroke = null;
  drawTool = 'pen';
  drawColor = '#1f1a14';
  drawWidthBase = 2;
  document.querySelectorAll('.draw-color').forEach(c => c.classList.toggle('active', c.dataset.color === drawColor));
  document.getElementById('tool-pen').classList.add('active');
  document.getElementById('tool-eraser').classList.remove('active');
  document.getElementById('draw-width').value = '2';
  document.getElementById('draw-width-display').textContent = '2';

  document.getElementById('drawing-modal-overlay').classList.add('show');
  // Defer canvas init to ensure modal layout is done
  setTimeout(() => {
    drawCanvas = document.getElementById('drawing-canvas');
    if (!drawCanvas) return;
    drawCtx = drawCanvas.getContext('2d');
    resizeDrawingCanvas();
    setupDrawingPointer(drawCanvas);
    updateDrawEmptyHint();
  }, 30);
}

function closeDrawingModal() {
  document.getElementById('drawing-modal-overlay').classList.remove('show');
}

function resizeDrawingCanvas() {
  if (!drawCanvas || !drawCtx) return;
  const wrap = drawCanvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  drawCanvas.width = rect.width * dpr;
  drawCanvas.height = rect.height * dpr;
  drawCanvas.style.width = rect.width + 'px';
  drawCanvas.style.height = rect.height + 'px';
  drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawAllStrokes();
}
window.addEventListener('resize', () => {
  if (document.getElementById('drawing-modal-overlay')?.classList.contains('show')) {
    resizeDrawingCanvas();
  }
});

function redrawAllStrokes() {
  if (!drawCtx) return;
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  drawCtx.clearRect(0, 0, w, h);
  for (const stroke of drawStrokes) renderStroke(stroke);
  if (drawCurrentStroke) renderStroke(drawCurrentStroke);
}

function renderStroke(stroke) {
  if (!stroke || !drawCtx || stroke.points.length < 1) return;
  drawCtx.save();
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  drawCtx.strokeStyle = stroke.color;
  drawCtx.fillStyle = stroke.color;
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    drawCtx.beginPath();
    drawCtx.arc(p.x, p.y, Math.max(1, stroke.width * (p.p || 0.5)), 0, Math.PI * 2);
    drawCtx.fill();
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      const p1 = stroke.points[i-1];
      const p2 = stroke.points[i];
      const w = Math.max(0.5, stroke.width * 1.5 * Math.max(0.3, ((p1.p || 0.5) + (p2.p || 0.5)) / 2));
      drawCtx.lineWidth = w;
      drawCtx.beginPath();
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();
    }
  }
  drawCtx.restore();
}

function setDrawTool(tool) {
  drawTool = tool;
  document.getElementById('tool-pen').classList.toggle('active', tool === 'pen');
  document.getElementById('tool-eraser').classList.toggle('active', tool === 'eraser');
  if (drawCanvas) drawCanvas.classList.toggle('eraser-mode', tool === 'eraser');
}

function setDrawColor(color, el) {
  drawColor = color;
  document.querySelectorAll('.draw-color').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  // Switch to pen when a color is picked
  setDrawTool('pen');
}

function updateDrawWidth(v) {
  drawWidthBase = parseFloat(v) || 2;
  document.getElementById('draw-width-display').textContent = String(Math.round(drawWidthBase));
}

function undoDraw() {
  drawStrokes.pop();
  redrawAllStrokes();
  updateDrawEmptyHint();
}

function clearDraw() {
  if (drawStrokes.length === 0) return;
  if (!confirm('모두 지우시겠습니까?')) return;
  drawStrokes = [];
  redrawAllStrokes();
  updateDrawEmptyHint();
}

function updateDrawEmptyHint() {
  const hint = document.getElementById('draw-empty-hint');
  if (hint) hint.classList.toggle('hidden', drawStrokes.length > 0 || !!drawCurrentStroke);
}

function setupDrawingPointer(canvas) {
  if (canvas.dataset.drawReady) return;
  canvas.dataset.drawReady = '1';

  // ---- Palm rejection ----
  // If we ever see a pen (Apple Pencil) input on this canvas, we treat it as
  // "stylus mode" and reject all touch pointers (which are almost certainly
  // palm/wrist contact). The mode persists for a short buffer after the
  // last pen event so palm contacts that linger on lift-off still get
  // ignored. Touch-only devices (no Apple Pencil ever seen) keep working.
  let stylusModeActive = false;       // true while a pen pointer is down
  let lastPenAt = 0;                   // ms since epoch of last pen event
  let everSawPen = false;              // sticky: any pen seen this session?
  const PALM_BUFFER_MS = 1200;
  let activePenPointerId = null;

  function shouldRejectTouch() {
    if (stylusModeActive) return true;
    if (!everSawPen) return false; // no Apple Pencil device involved → finger drawing OK
    return (Date.now() - lastPenAt) < PALM_BUFFER_MS;
  }

  const start = (e) => {
    if (e.pointerType === 'touch' && shouldRejectTouch()) {
      // Palm / unintended touch — drop silently
      return;
    }
    if (e.pointerType === 'pen') {
      everSawPen = true;
      stylusModeActive = true;
      lastPenAt = Date.now();
      activePenPointerId = e.pointerId;
      // Cancel any in-progress finger stroke if pen takes over
      drawCurrentStroke = null;
    }
    e.preventDefault();
    if (e.pointerId != null) {
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    drawCurrentStroke = {
      tool: drawTool,
      color: drawColor,
      width: drawWidthBase,
      points: [{ x, y, p: e.pressure > 0 ? e.pressure : 0.5 }],
      pointerId: e.pointerId,
      pointerType: e.pointerType
    };
    updateDrawEmptyHint();
  };

  const move = (e) => {
    if (!drawCurrentStroke) return;
    // Only accept moves from the same pointer that started the stroke
    if (e.pointerId !== drawCurrentStroke.pointerId) return;
    if (e.pointerType === 'pen') lastPenAt = Date.now();
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      drawCurrentStroke.points.push({
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
        p: ev.pressure > 0 ? ev.pressure : 0.5
      });
    }
    redrawAllStrokes();
  };

  const end = (e) => {
    // If a non-stroke pointer ends, ignore
    if (drawCurrentStroke && e.pointerId !== drawCurrentStroke.pointerId) return;
    if (e.pointerType === 'pen') {
      stylusModeActive = false;
      lastPenAt = Date.now();
      activePenPointerId = null;
    }
    if (!drawCurrentStroke) return;
    if (drawCurrentStroke.points.length > 0) drawStrokes.push(drawCurrentStroke);
    drawCurrentStroke = null;
    redrawAllStrokes();
    updateDrawEmptyHint();
  };

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);
}

// Generate compact SVG from stroke history
function strokesToSVG() {
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  // Apply eraser strokes as a separate transparent layer using mask
  // Simpler approach: bake erased strokes by skipping pixels covered by eraser path
  // For first version: just emit pen strokes; eraser is applied client-side preview only
  // (To preserve eraser, we'd need a full canvas → PNG path. Falls back to that if eraser used.)
  const hasEraser = drawStrokes.some(s => s.tool === 'eraser');
  if (hasEraser) {
    // Use canvas snapshot for accuracy when eraser is involved
    return null;
  }
  const f = (n) => Math.round(n * 10) / 10;
  let paths = '';
  for (const stroke of drawStrokes) {
    if (stroke.points.length < 1) continue;
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      paths += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(Math.max(1, stroke.width * (p.p || 0.5)))}" fill="${stroke.color}"/>`;
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        const p1 = stroke.points[i-1];
        const p2 = stroke.points[i];
        const sw = f(Math.max(0.5, stroke.width * 1.5 * Math.max(0.3, ((p1.p || 0.5) + (p2.p || 0.5)) / 2)));
        paths += `<line x1="${f(p1.x)}" y1="${f(p1.y)}" x2="${f(p2.x)}" y2="${f(p2.y)}" stroke="${stroke.color}" stroke-width="${sw}" stroke-linecap="round"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}">${paths}</svg>`;
}

async function insertDrawing() {
  if (drawStrokes.length === 0) {
    toast('그림이 비어있습니다');
    return;
  }
  let blob, mimeType, filename;

  const svg = strokesToSVG();
  if (svg) {
    blob = new Blob([svg], { type: 'image/svg+xml' });
    mimeType = 'image/svg+xml';
    filename = `drawing-${Date.now()}.svg`;
  } else {
    // Fallback: PNG (covers eraser case where SVG composition is complex)
    const pngBlob = await new Promise(resolve => drawCanvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) { toast('이미지 생성 실패', 'error'); return; }
    blob = pngBlob;
    mimeType = 'image/png';
    filename = `drawing-${Date.now()}.png`;
  }

  let insertText;
  if (driveAssetsFolderId) {
    try {
      toast('드로잉 업로드 중...');
      const file = await driveUploadFile(filename, blob, mimeType, driveAssetsFolderId);
      await driveMakePublic(file.id);
      const url = `https://drive.google.com/thumbnail?id=${file.id}&sz=w2000`;
      insertText = `\n![drawing](${url})\n`;
      toast('드로잉이 메모에 삽입됨', 'success');
    } catch (e) {
      console.warn('Drive upload failed; falling back to inline:', e);
      const dataUrl = await blobToDataUrl(blob);
      insertText = `\n![drawing](${dataUrl})\n`;
    }
  } else {
    const dataUrl = await blobToDataUrl(blob);
    insertText = `\n![drawing](${dataUrl})\n`;
  }

  // Append to memo content
  const memo = memos.find(m => m.id === activeMemoId);
  if (memo) {
    memo.content = (memo.content || '') + insertText;
    memo.date = new Date().toISOString();
    saveMemos();
    renderMemoEditor();
  }

  closeDrawingModal();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Cmd/Ctrl+Z while drawing modal open → undo last stroke
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('drawing-modal-overlay')?.classList.contains('show')) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undoDraw(); }
  if (e.key === 'Escape') { e.preventDefault(); closeDrawingModal(); }
});

// =================== IMAGE UPLOAD (paste / drag / button → Drive) ===================
async function uploadImageToDrive(blob) {
  if (!driveAssetsFolderId) {
    toast('이미지 업로드는 Drive 연결이 필요합니다', 'error');
    return null;
  }
  try {
    toast('이미지 업로드 중...');
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const name = `img-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const file = await driveUploadFile(name, blob, blob.type, driveAssetsFolderId);
    await driveMakePublic(file.id);
    // Use thumbnail URL for reliable hotlinking; size up to ~2000px
    const url = `https://drive.google.com/thumbnail?id=${file.id}&sz=w2000`;
    toast('이미지 업로드 완료', 'success');
    return { url, id: file.id, name };
  } catch (e) {
    toast('업로드 실패: ' + e.message, 'error');
    return null;
  }
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + text + after;
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  // Trigger input event so updateMemoContent runs
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

async function handleImageInsert(blob) {
  const ta = document.querySelector('.memo-editor textarea');
  if (!ta) return;
  if (driveAssetsFolderId) {
    const result = await uploadImageToDrive(blob);
    if (result) insertAtCursor(ta, `\n![${result.name}](${result.url})\n`);
  } else {
    // Fallback: base64 inline (small images only)
    if (blob.size > 800_000) {
      toast('Drive 미연결 + 파일 800KB 초과 → 업로드 불가', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      insertAtCursor(ta, `\n![image](${reader.result})\n`);
      toast('인라인 이미지로 삽입됨 (Drive 연결하면 자동 업로드)', 'success');
    };
    reader.readAsDataURL(blob);
  }
}

document.addEventListener('paste', (e) => {
  const ta = document.activeElement;
  if (!ta || ta.tagName !== 'TEXTAREA' || !ta.closest('.memo-editor')) return;
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (blob) handleImageInsert(blob);
      return;
    }
  }
});

document.addEventListener('dragover', (e) => {
  if (e.target.closest && e.target.closest('.memo-editor')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  const target = e.target.closest && e.target.closest('.memo-editor');
  if (!target) return;
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const img = [...files].find(f => f.type.startsWith('image/'));
  if (img) {
    e.preventDefault();
    handleImageInsert(img);
  }
});

function triggerImageUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const f = e.target.files?.[0];
    if (f) handleImageInsert(f);
  };
  input.click();
}

// =================== GITHUB GIST SYNC (works on iOS & desktop) ===================
let gistToken = load('gist_token', null);
let gistId = load('gist_id', null);
let gistAutoSaveTimer = null;
let gistStatus = 'idle'; // idle | saving | saved | error
let isLoadingFromGist = false;
let gistETag = null;
let gistPollTimer = null;
let gistLastPushAt = 0;
let gistLastSyncAt = null;
const GIST_POLL_INTERVAL = 15_000; // 15s

async function gistApi(method, path, body) {
  if (!gistToken) throw new Error('Token not set');
  const headers = {
    'Authorization': 'Bearer ' + gistToken,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch('https://api.github.com' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const t = await r.json(); if (t.message) msg = t.message; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

async function gistConnect() {
  const tokenInput = document.getElementById('gist-token-input');
  const idInput = document.getElementById('gist-id-input');
  const token = tokenInput.value.trim();
  let existingId = idInput.value.trim();
  if (!token) { toast('GitHub Token을 입력하세요', 'error'); return; }

  gistToken = token;
  gistStatus = 'saving';
  updateGistStatus();
  toast('GitHub에 연결 중...');

  try {
    // Auto-discover: if no ID specified, try to find an existing MindFlow gist on this account
    if (!existingId) {
      try {
        const list = await gistApi('GET', '/gists?per_page=100');
        const found = list.find(g =>
          (g.files && g.files['_mindflow-app.json']) ||
          (g.description || '').toLowerCase().includes('mindflow')
        );
        if (found) {
          existingId = found.id;
          toast(`기존 Gist 발견: ${existingId.slice(0,8)}…`, 'success');
        }
      } catch (e) { /* ignore, will create new */ }
    }

    if (existingId) {
      const r = await gistApi('GET', `/gists/${existingId}`);
      gistId = r.id;
      save('gist_token', gistToken);
      save('gist_id', gistId);
      updateGistStatus();
      const remoteHasMd = Object.keys(r.files || {}).some(n => n.toLowerCase().endsWith('.md') && n !== 'README.md');
      const remoteHasApp = !!(r.files && r.files['_mindflow-app.json']);
      const remoteHasData = remoteHasMd || remoteHasApp;
      const localHasData = memos.length > 0 || mindmaps.some(m => m.nodes.length > 0) || Object.keys(load('tb_blocks', {})).length > 0;

      if (remoteHasData && localHasData) {
        if (confirm('이 Gist에 이미 데이터가 있습니다.\n\n[확인] 가져오기 — Gist 데이터로 로컬을 덮어씁니다\n[취소] 로컬 유지 — 다음 저장 시 Gist를 로컬로 덮어씁니다')) {
          await gistPullAll(true);
        } else {
          await gistPushAll();
          toast('로컬 데이터를 Gist에 업로드했습니다', 'success');
        }
      } else if (remoteHasData) {
        await gistPullAll(true);
      } else {
        await gistPushAll();
        toast('Gist에 데이터 업로드 완료', 'success');
      }
    } else {
      const r = await gistApi('POST', '/gists', {
        description: 'MindFlow data sync',
        public: false,
        files: {
          'README.md': {
            content: '# MindFlow Sync Vault\n\nThis private gist is used by MindFlow web app for cross-device data sync.\n\n- `_mindflow-app.json`: mindmaps & timeblocks\n- `*.md`: memos (Obsidian-compatible markdown with YAML frontmatter)\n\nDo not delete or rename files manually.'
          }
        }
      });
      gistId = r.id;
      save('gist_token', gistToken);
      save('gist_id', gistId);
      updateGistStatus();
      await gistPushAll();
      toast('새 Gist 생성 및 데이터 업로드 완료', 'success');
    }
    tokenInput.value = '';
    idInput.value = gistId;
    gistStartPolling();
  } catch (e) {
    gistToken = null;
    save('gist_token', null);
    gistStatus = 'error';
    updateGistStatus();
    let msg = e.message;
    let detail = '';
    if (/bad credentials|401/i.test(msg)) {
      detail = '\n\n해결:\n• 토큰이 만료되었거나 잘못됨\n• Account permissions → Gists 가 "Read and write" 인지 확인\n• https://github.com/settings/personal-access-tokens 에서 토큰 활성 여부 확인';
    } else if (/resource not accessible|403/i.test(msg)) {
      detail = '\n\n해결: 토큰에 Gist 권한이 없습니다.\nAccount permissions → Gists → Read and write 활성화 필요';
    } else if (/not found|404/i.test(msg)) {
      detail = '\n\n해결: 입력한 Gist ID가 존재하지 않거나 다른 계정의 Gist입니다';
    }
    toast('연결 실패: ' + msg, 'error');
    alert('❌ 연결 실패\n\n' + msg + detail);
  }
}

async function gistDisconnect() {
  if (!confirm('Gist 연결을 해제하시겠습니까? 로컬 데이터는 그대로 유지됩니다.\n(Gist 자체는 GitHub에 그대로 남아있습니다)')) return;
  gistStopPolling();
  gistToken = null;
  gistId = null;
  gistETag = null;
  save('gist_token', null);
  save('gist_id', null);
  const ti = document.getElementById('gist-token-input');
  const ii = document.getElementById('gist-id-input');
  if (ti) ti.value = '';
  if (ii) ii.value = '';
  updateGistStatus();
  toast('연결 해제됨');
}

function sanitizeMdFilename(s) {
  return (s || 'untitled').replace(/[\/\\?%*:|"<>#]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
}

async function gistPushAll() {
  if (!gistToken || !gistId || isLoadingFromGist) return;
  try {
    gistStatus = 'saving';
    updateGistStatus();

    const appData = {
      version: 2,
      app: 'mindflow',
      exportedAt: new Date().toISOString(),
      mindmaps: load('mindmaps', []),
      activeMindmapId: load('mm_active', null),
      timeBlocks: load('tb_blocks', {})
    };

    // Get current gist files to know which old files to delete
    const current = await gistApi('GET', `/gists/${gistId}`);
    const currentMdFiles = Object.keys(current.files || {}).filter(n => n.toLowerCase().endsWith('.md') && n !== 'README.md');

    const files = {
      '_mindflow-app.json': { content: JSON.stringify(appData, null, 2) }
    };

    const desiredMd = new Set();
    for (const memo of memos) {
      let base = sanitizeMdFilename(memo.title);
      let fname = base + '.md';
      let n = 2;
      while (desiredMd.has(fname)) { fname = `${base} (${n}).md`; n++; }
      desiredMd.add(fname);
      const fm = `---\nid: ${memo.id}\ntitle: ${(memo.title || '').replace(/\n/g, ' ')}\ndate: ${memo.date}\n---\n\n${memo.content || ''}`;
      files[fname] = { content: fm };
    }

    // Delete files that exist remotely but not in our desired set
    for (const fn of currentMdFiles) {
      if (!desiredMd.has(fn)) files[fn] = null;
    }

    // Use raw fetch so we can capture the ETag, preventing the next poll from
    // refetching what we just pushed.
    const patchRes = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + gistToken,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: `MindFlow — ${memos.length} memos · ${load('mindmaps', []).length} maps`,
        files
      })
    });
    if (!patchRes.ok) {
      let msg = `HTTP ${patchRes.status}`;
      try { const j = await patchRes.json(); if (j.message) msg = j.message; } catch {}
      throw new Error(msg);
    }
    gistETag = patchRes.headers.get('ETag');
    gistLastPushAt = Date.now();
    gistLastSyncAt = gistLastPushAt;

    gistStatus = 'saved';
    updateGistStatus();
    setTimeout(() => { if (gistStatus === 'saved') { gistStatus = 'idle'; updateGistStatus(); } }, 1800);
  } catch (e) {
    gistStatus = 'error';
    updateGistStatus();
    console.error('Gist push failed:', e);
    toast('Gist 동기화 실패: ' + e.message, 'error');
  }
}

// Apply gist data to local state (used by both manual pull and polling)
async function applyGistData(data) {
  isLoadingFromGist = true;
  try {
    const fileMap = data.files || {};

    // Track which memo is being edited so we don't blow away the user's draft
    const ae = document.activeElement;
    const editingMemoId = (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.closest('.memo-editor-header'))))
      ? activeMemoId : null;

    // App data (mindmaps + timeblocks)
    if (fileMap['_mindflow-app.json']) {
      try {
        const app = JSON.parse(fileMap['_mindflow-app.json'].content);
        if (app.app === 'mindflow') {
          if (app.mindmaps) {
            mindmaps = app.mindmaps;
            activeMindmapId = app.activeMindmapId || (mindmaps[0]?.id ?? null);
            localStorage.setItem('mindflow_mindmaps', JSON.stringify(mindmaps));
            localStorage.setItem('mindflow_mm_active', JSON.stringify(activeMindmapId));
            bindActiveMap();
          }
          if (app.timeBlocks) {
            timeBlocks = app.timeBlocks;
            localStorage.setItem('mindflow_tb_blocks', JSON.stringify(timeBlocks));
          }
        }
      } catch (e) { console.warn('Failed to parse app data:', e); }
    }

    // Memos from .md files (preserve currently-edited memo from local)
    const newMemos = [];
    let maxId = 0;
    for (const [filename, info] of Object.entries(fileMap)) {
      if (!info || filename === 'README.md' || !filename.toLowerCase().endsWith('.md')) continue;
      let content = info.content;
      if (info.truncated && info.raw_url) {
        try {
          const r = await fetch(info.raw_url);
          if (r.ok) content = await r.text();
        } catch (e) { console.warn('Failed to fetch raw:', e); }
      }
      const memo = parseFrontmatter(content, filename, Date.now());
      if (!memo.id) memo.id = ++maxId + 100000;
      else if (memo.id > maxId) maxId = memo.id;
      newMemos.push(memo);
    }
    newMemos.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Preserve the in-progress edit
    if (editingMemoId != null) {
      const local = memos.find(m => m.id === editingMemoId);
      if (local) {
        const idx = newMemos.findIndex(m => m.id === editingMemoId);
        if (idx >= 0) newMemos[idx] = local;
        else newMemos.unshift(local);
      }
    }

    memos = newMemos;
    memoIdCounter = Math.max(maxId, memos.length) + 1;
    localStorage.setItem('mindflow_memos', JSON.stringify(memos));
    localStorage.setItem('mindflow_memo_idcounter', JSON.stringify(memoIdCounter));
    if (!memos.find(m => m.id === activeMemoId)) {
      activeMemoId = memos[0]?.id || null;
    }

    renderMindmapList();
    drawMindMap();
    renderMemoList();
    if (editingMemoId == null) renderMemoEditor();
    renderTimeBlocks();
    renderTimeblockList();
  } finally {
    isLoadingFromGist = false;
  }
}

async function gistPullAll(skipConfirm = false) {
  if (!gistToken || !gistId) { toast('먼저 Gist를 연결하세요'); return; }
  if (!skipConfirm && !confirm('Gist의 내용으로 현재 데이터를 덮어씁니다. 계속하시겠습니까?')) return;

  try {
    gistStatus = 'saving';
    updateGistStatus();
    const data = await gistApi('GET', `/gists/${gistId}`);
    await applyGistData(data);
    gistLastSyncAt = Date.now();
    gistStatus = 'saved';
    updateGistStatus();
    toast(`동기화 완료 (메모 ${memos.length}개)`, 'success');
    setTimeout(() => { if (gistStatus === 'saved') { gistStatus = 'idle'; updateGistStatus(); } }, 1800);
  } catch (e) {
    gistStatus = 'error';
    updateGistStatus();
    console.error(e);
    toast('가져오기 실패: ' + e.message, 'error');
  }
}

function scheduleGistSave() {
  if (!gistToken || !gistId || isLoadingFromGist) return;
  clearTimeout(gistAutoSaveTimer);
  gistAutoSaveTimer = setTimeout(gistPushAll, 2500);
}

function updateGistStatus() {
  updateHeaderSyncPill();
  const el = document.getElementById('gist-status');
  if (!el) return;
  const reloadBtn = document.getElementById('gist-pull-btn');
  const disconnectBtn = document.getElementById('gist-disconnect-btn');
  const syncNowBtn = document.getElementById('gist-sync-now-btn');
  const idInput = document.getElementById('gist-id-input');
  if (gistToken && gistId) {
    el.classList.add('connected');
    let statusText;
    if (gistStatus === 'saving') statusText = '<span class="save-pulse"></span>동기화 중...';
    else if (gistStatus === 'error') statusText = '⚠ 동기화 실패 — 토큰/네트워크 확인';
    else {
      const ago = gistLastSyncAt ? Math.max(0, Math.floor((Date.now() - gistLastSyncAt) / 1000)) : null;
      const agoText = ago == null ? '' :
        ago < 5 ? '방금 동기화됨' :
        ago < 60 ? `${ago}초 전 동기화` :
        ago < 3600 ? `${Math.floor(ago/60)}분 전 동기화` :
        `${Math.floor(ago/3600)}시간 전 동기화`;
      statusText = `✓ 연결됨 · 30초마다 자동 폴링${agoText ? ' · ' + agoText : ''}`;
    }
    el.innerHTML = `
      <div class="icon-circle" style="background:var(--green)">☁</div>
      <div class="text-area">
        <div class="name">Gist 연결됨</div>
        <div class="desc">${statusText}</div>
      </div>
    `;
    if (reloadBtn) reloadBtn.style.display = '';
    if (disconnectBtn) disconnectBtn.style.display = '';
    if (syncNowBtn) syncNowBtn.style.display = '';
    if (idInput && !idInput.value) idInput.value = gistId;
  } else {
    el.classList.remove('connected');
    el.innerHTML = `
      <div class="icon-circle" style="background:var(--surface3)">☁</div>
      <div class="text-area">
        <div class="name" style="color:var(--text-dim)">연결되지 않음</div>
        <div class="desc">GitHub Token으로 모든 기기에서 자동 동기화 (iOS·Mac 모두)</div>
      </div>
    `;
    if (reloadBtn) reloadBtn.style.display = 'none';
    if (disconnectBtn) disconnectBtn.style.display = 'none';
    if (syncNowBtn) syncNowBtn.style.display = 'none';
  }
}

// Lightweight poll using ETag — only fetches data when remote actually changed
async function gistPoll(force = false) {
  if (!gistToken || !gistId || isLoadingFromGist) return;
  if (!force && document.hidden) return;
  // Don't poll during/right after a local push (avoid race + saving our own write back)
  if (!force && Date.now() - gistLastPushAt < 4000) return;
  // Don't disrupt active editing in the memo editor (search/sync inputs are fine)
  if (!force) {
    const ae = document.activeElement;
    const inEditor = ae && (
      ae.tagName === 'TEXTAREA' ||
      (ae.tagName === 'INPUT' && ae.closest('.memo-editor-header'))
    );
    if (inEditor) return;
  }

  try {
    const headers = {
      'Authorization': 'Bearer ' + gistToken,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (gistETag) headers['If-None-Match'] = gistETag;
    const r = await fetch('https://api.github.com/gists/' + gistId, { headers });
    if (r.status === 304) {
      // No remote change since last fetch
      return;
    }
    if (!r.ok) {
      // 401/403/404 — surface to status
      gistStatus = 'error';
      updateGistStatus();
      return;
    }
    gistETag = r.headers.get('ETag');
    const data = await r.json();
    await applyGistData(data);
    gistLastSyncAt = Date.now();
    gistStatus = 'saved';
    updateGistStatus();
    setTimeout(() => { if (gistStatus === 'saved') { gistStatus = 'idle'; updateGistStatus(); } }, 1500);
  } catch (e) {
    console.warn('Gist poll error:', e);
  }
}

function gistStartPolling() {
  if (gistPollTimer) clearInterval(gistPollTimer);
  if (!gistToken || !gistId) return;
  gistPollTimer = setInterval(() => gistPoll(false), GIST_POLL_INTERVAL);
}

// Force-sync now: push pending changes immediately + force pull
async function gistSyncNow() {
  if (!gistToken || !gistId) { toast('먼저 Gist를 연결하세요'); return; }
  try {
    clearTimeout(gistAutoSaveTimer);
    toast('동기화 중...');
    await gistPushAll();
    await gistPoll(true);
    toast('동기화 완료', 'success');
  } catch (e) {
    toast('동기화 실패: ' + e.message, 'error');
  }
}

function gistStopPolling() {
  if (gistPollTimer) { clearInterval(gistPollTimer); gistPollTimer = null; }
}

// Pull immediately when tab becomes visible again
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && gistToken && gistId) gistPoll();
});

async function initGist() {
  // Silently restore: if we have token+id, pull latest on load + start polling
  if (gistToken && gistId) {
    updateGistStatus();
    try {
      await gistPullAll(true);
    } catch (e) {
      console.warn('Auto-pull failed:', e);
    }
    gistStartPolling();
  }
}

// =================== VAULT (Obsidian-style folder sync) ===================
let folderHandle = null;
let autoSaveTimer = null;
let autoSaveStatus = 'idle'; // idle | saving | saved | error
let isLoadingFromFolder = false;
const APP_JSON = '_mindflow-app.json';

function isFsApiSupported() { return !!window.showDirectoryPicker; }

async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

function sanitizeFilename(s) {
  return (s || 'untitled').replace(/[\/\\?%*:|"<>#]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
}

async function pickFolder() {
  if (!isFsApiSupported()) {
    toast('이 브라우저는 폴더 자동 저장을 지원하지 않습니다 (Chrome/Edge 권장)', 'error');
    return;
  }
  try {
    const h = await window.showDirectoryPicker({ mode: 'readwrite' });
    folderHandle = h;
    await idbSet('folder', h);
    updateFolderStatus();
    await loadFromFolder({ silent: false });
  } catch (e) {
    if (e.name !== 'AbortError') toast('폴더 선택 실패: ' + e.message, 'error');
  }
}

async function disconnectFolder() {
  if (!confirm('폴더 연결을 해제하시겠습니까? 데이터는 그대로 유지됩니다.')) return;
  folderHandle = null;
  await idbDel('folder');
  updateFolderStatus();
  toast('폴더 연결 해제됨');
}

async function reloadFromFolder() {
  if (!folderHandle) { toast('연결된 폴더가 없습니다'); return; }
  if (!confirm('폴더의 내용으로 다시 불러옵니다. 현재 변경사항은 폴더 파일로 덮어써집니다.\n계속하시겠습니까?')) return;
  await loadFromFolder({ silent: false, force: true });
}

function parseFrontmatter(text, filename, mtime) {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n?([\s\S]*)$/);
  let title = filename.replace(/\.md$/i, '').replace(/^\d+[-_]/, '');
  let date = new Date(mtime).toISOString();
  let id = null;
  let content = text;
  if (fmMatch) {
    const fm = fmMatch[1];
    content = fmMatch[2];
    const titleM = fm.match(/^title:\s*(.+)$/m);
    const dateM = fm.match(/^date:\s*(.+)$/m);
    const idM = fm.match(/^id:\s*(\d+)$/m);
    if (titleM) title = titleM[1].trim().replace(/^["']|["']$/g, '');
    if (dateM) {
      const d = new Date(dateM[1].trim());
      if (!isNaN(d)) date = d.toISOString();
    }
    if (idM) id = parseInt(idM[1]);
  } else {
    const h1 = text.match(/^# (.+)$/m);
    if (h1) title = h1[1].trim();
  }
  return { id, title, content, date };
}

async function loadFromFolder({ silent = true, force = false } = {}) {
  if (!folderHandle) return;
  if (!(await ensurePermission(folderHandle))) {
    if (!silent) toast('폴더 권한이 거부되었습니다', 'error');
    return;
  }
  isLoadingFromFolder = true;
  try {
    // Load app data (mindmap/timeblock) if exists
    let appLoaded = false;
    try {
      const appFh = await folderHandle.getFileHandle(APP_JSON, { create: false });
      const appFile = await appFh.getFile();
      const appText = await appFile.text();
      const appData = JSON.parse(appText);
      if (appData && appData.app === 'mindflow') {
        if (appData.mindmaps) {
          localStorage.setItem('mindflow_mindmaps', JSON.stringify(appData.mindmaps));
          localStorage.setItem('mindflow_mm_active', JSON.stringify(appData.activeMindmapId || appData.mindmaps[0]?.id));
          mindmaps = appData.mindmaps;
          activeMindmapId = appData.activeMindmapId || (mindmaps[0]?.id ?? null);
          bindActiveMap();
          renderMindmapList();
          drawMindMap();
        } else if (appData.mindmap) {
          // v1 backwards-compat
          const m = {
            id: Date.now(),
            name: '내 마인드맵',
            nodes: appData.mindmap.nodes || [],
            edges: appData.mindmap.edges || [],
            idCounter: appData.mindmap.idCounter || 1,
            pan: appData.mindmap.pan || { x: 0, y: 0 },
            zoom: appData.mindmap.zoom || 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          mindmaps = [m];
          activeMindmapId = m.id;
          localStorage.setItem('mindflow_mindmaps', JSON.stringify(mindmaps));
          localStorage.setItem('mindflow_mm_active', JSON.stringify(activeMindmapId));
          bindActiveMap();
          renderMindmapList();
          drawMindMap();
        }
        if (appData.timeBlocks) localStorage.setItem('mindflow_tb_blocks', JSON.stringify(appData.timeBlocks));
        appLoaded = true;
      }
    } catch (e) {
      if (e.name !== 'NotFoundError') console.warn(e);
    }

    // Load .md files in folder root
    const loaded = [];
    let maxId = 0;
    for await (const entry of folderHandle.values()) {
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
        try {
          const file = await entry.getFile();
          const text = await file.text();
          const memo = parseFrontmatter(text, entry.name, file.lastModified);
          if (!memo.id) memo.id = ++maxId + 100000;
          else if (memo.id > maxId) maxId = memo.id;
          memo._filename = entry.name;
          loaded.push(memo);
        } catch (e) { console.warn('Failed to load', entry.name, e); }
      }
    }

    // Decide whether to replace
    const folderHasMemos = loaded.length > 0;
    const localHasMemos = memos.length > 0;

    if (folderHasMemos) {
      let replace = force;
      if (!force && localHasMemos && !silent) {
        replace = confirm(`이 폴더에서 ${loaded.length}개의 .md 메모를 찾았습니다.\n현재 ${memos.length}개의 로컬 메모를 폴더 내용으로 교체할까요?\n\n[확인] 폴더 내용으로 교체\n[취소] 로컬 유지 (다음 저장 시 폴더에 덮어씀)`);
      } else if (!localHasMemos) {
        replace = true;
      }
      if (replace) {
        loaded.sort((a, b) => new Date(b.date) - new Date(a.date));
        memos = loaded.map(({_filename, ...m}) => m);
        memoIdCounter = Math.max(maxId, memos.length) + 1;
        localStorage.setItem('mindflow_memos', JSON.stringify(memos));
        localStorage.setItem('mindflow_memo_idcounter', JSON.stringify(memoIdCounter));
        activeMemoId = memos[0]?.id || null;
        renderMemoList();
        renderMemoEditor();
        renderTimeBlocks();
        drawMindMap();
        if (!silent) toast(`${loaded.length}개 메모 + 앱 데이터 불러옴 ✓`, 'success');
      }
    }

    // Initial save of current data to folder (only if no memos there yet, or after replace)
    if (!folderHasMemos && localHasMemos) {
      if (!silent) toast('현재 데이터를 폴더에 저장합니다', 'success');
    }
    isLoadingFromFolder = false;
    await autoSaveToFolder();
  } catch (e) {
    isLoadingFromFolder = false;
    console.error(e);
    if (!silent) toast('불러오기 실패: ' + e.message, 'error');
  }
}

function memoToMarkdown(memo) {
  const fm = `---\nid: ${memo.id}\ntitle: ${(memo.title || '').replace(/\n/g, ' ')}\ndate: ${memo.date}\n---\n\n`;
  return fm + (memo.content || '');
}

async function autoSaveToFolder() {
  if (!folderHandle || isLoadingFromFolder) return;
  if (!(await ensurePermission(folderHandle))) return;
  try {
    autoSaveStatus = 'saving';
    updateFolderStatus();

    // Save app data (mindmaps + timeblock)
    const appData = {
      version: 2,
      app: 'mindflow',
      exportedAt: new Date().toISOString(),
      mindmaps: load('mindmaps', []),
      activeMindmapId: load('mm_active', null),
      timeBlocks: load('tb_blocks', {})
    };
    const appFh = await folderHandle.getFileHandle(APP_JSON, { create: true });
    const appW = await appFh.createWritable();
    await appW.write(JSON.stringify(appData, null, 2));
    await appW.close();

    // Save each memo as .md (one file per memo, Obsidian-style flat structure)
    const desiredFiles = new Set();
    for (const memo of memos) {
      const fname = `${sanitizeFilename(memo.title)}.md`;
      // Avoid filename collisions between memos with same title
      let final = fname;
      let n = 2;
      while (desiredFiles.has(final)) {
        final = fname.replace(/\.md$/, ` (${n}).md`);
        n++;
      }
      desiredFiles.add(final);
      memo._filename = final;
      const fh = await folderHandle.getFileHandle(final, { create: true });
      const w = await fh.createWritable();
      await w.write(memoToMarkdown(memo));
      await w.close();
    }

    // Remove orphan .md files (memos that were deleted) — match by frontmatter id
    const liveIds = new Set(memos.map(m => m.id));
    const liveFiles = new Set([...desiredFiles]);
    for await (const entry of folderHandle.values()) {
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md') && !liveFiles.has(entry.name)) {
        // Check if it's a managed file (has our frontmatter id)
        try {
          const f = await entry.getFile();
          const t = await f.text();
          const idM = t.match(/^---[\s\S]*?\nid:\s*(\d+)\s*\n[\s\S]*?\n---/);
          if (idM && !liveIds.has(parseInt(idM[1]))) {
            await folderHandle.removeEntry(entry.name);
          }
        } catch {}
      }
    }

    autoSaveStatus = 'saved';
    updateFolderStatus();
    setTimeout(() => {
      if (autoSaveStatus === 'saved') { autoSaveStatus = 'idle'; updateFolderStatus(); }
    }, 1800);
  } catch (e) {
    console.error(e);
    autoSaveStatus = 'error';
    updateFolderStatus();
    toast('자동 저장 실패: ' + e.message, 'error');
  }
}

function scheduleAutoSave() {
  if (!folderHandle || isLoadingFromFolder) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(autoSaveToFolder, 1200);
}

function updateFolderStatus() {
  const el = document.getElementById('folder-status');
  if (!el) return;
  const reloadBtn = document.getElementById('reload-folder-btn');
  const disconnectBtn = document.getElementById('disconnect-folder-btn');
  if (folderHandle) {
    el.classList.add('connected');
    let statusText = '연결됨 · 변경사항이 자동 저장됩니다';
    if (autoSaveStatus === 'saving') statusText = '<span class="save-pulse"></span>저장 중...';
    else if (autoSaveStatus === 'saved') statusText = '✓ 저장됨';
    else if (autoSaveStatus === 'error') statusText = '⚠ 저장 실패';
    el.innerHTML = `
      <div class="icon-circle">📁</div>
      <div class="text-area">
        <div class="name">${escapeHtml(folderHandle.name)}</div>
        <div class="desc">${statusText}</div>
      </div>
    `;
    if (reloadBtn) reloadBtn.style.display = '';
    if (disconnectBtn) disconnectBtn.style.display = '';
  } else {
    el.classList.remove('connected');
    el.innerHTML = `
      <div class="icon-circle" style="background:var(--surface3)">📁</div>
      <div class="text-area">
        <div class="name" style="color:var(--text-dim)">폴더가 연결되지 않음</div>
        <div class="desc">폴더를 선택하면 .md 파일을 자동으로 동기화합니다</div>
      </div>
    `;
    if (reloadBtn) reloadBtn.style.display = 'none';
    if (disconnectBtn) disconnectBtn.style.display = 'none';
  }
}

async function initFolder() {
  try {
    const h = await idbGet('folder');
    if (h) {
      folderHandle = h;
      updateFolderStatus();
      // Don't request permission immediately; wait for user gesture
    }
  } catch {}
}

// =================== INIT STARTER ===================
// If there are no mindmaps at all, create a starter
if (mindmaps.length === 0) {
  const starter = {
    id: Date.now(),
    name: '내 첫 마인드맵',
    nodes: [],
    edges: [],
    idCounter: 1,
    pan: { x: 0, y: 0 },
    zoom: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const cx = 400, cy = 300;
  starter.nodes.push({ id: starter.idCounter++, text: '중심 주제', x: cx, y: cy, color: '#7c6cf5' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 1', x: cx - 200, y: cy - 110, color: '#10b981' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 2', x: cx + 200, y: cy - 110, color: '#3b82f6' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 3', x: cx - 200, y: cy + 110, color: '#ec4899' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 4', x: cx + 200, y: cy + 110, color: '#f59e0b' });
  starter.edges.push({ from: 1, to: 2 }, { from: 1, to: 3 }, { from: 1, to: 4 }, { from: 1, to: 5 });
  mindmaps = [starter];
  activeMindmapId = starter.id;
  bindActiveMap();
  save('mindmaps', mindmaps);
  save('mm_active', activeMindmapId);
}
renderMindmapList();
drawMindMap();

// Prevent iOS bounce
document.body.addEventListener('touchmove', e => {
  if (e.target.closest('.timeblock-body, .memo-items, textarea, .modal, .markdown-body')) return;
  if (e.touches.length > 1) return;
}, { passive: true });

// Initialize persistent folder handle
initFolder();
// Initialize Gist sync (silently pulls latest if connected)
initGist();
// Initialize Drive sync (silently re-auths and pulls if connected before)
initDrive();
// Initial header pill render
updateHeaderSyncPill();

// When sync modal opens, attempt to verify folder permission silently
async function tryRestoreFolder() {
  if (folderHandle && folderHandle.queryPermission) {
    const perm = await folderHandle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      await loadFromFolder({ silent: true });
    }
  }
}
tryRestoreFolder();
