// =================== MIND MAP (multi-map support) ===================
const canvas = document.getElementById('mindmap-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;

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

// Migrate old Moleskine/Journey palette hex colors → Solarized palette
(function migrateNodeColors() {
  const MAP = {
    '#d99e1f': '#b58900', '#d99f1f': '#b58900',
    '#c97a2c': '#cb4b16',
    '#b85577': '#d33682',
    '#4a6c8a': '#268bd2',
    '#4d7d8f': '#2aa198',
    '#6a8c4f': '#859900',
    '#7c6cf5': '#6c71c4',
    '#d33a2c': '#dc322f',
  };
  let changed = false;
  mindmaps.forEach(m => {
    (m.nodes || []).forEach(n => {
      const mapped = n.color && MAP[n.color.toLowerCase()];
      if (mapped) { n.color = mapped; changed = true; }
    });
  });
  if (changed) save('mindmaps', mindmaps);
})();

let nodes = [], edges = [], pan = { x: 0, y: 0 }, zoom = 1, nodeIdCounter = 1;
let selectedNode = null;
let selectedEdge = null; // index into edges array
let draggingNode = null;
let draggingNodeMoved = false; // true once an active drag actually moves the node
                               // (so a plain tap doesn't bump updatedAt → no sync churn)
let connectingFrom = null;
let isConnecting = false;
let isDraggingConnection = false;
let connDragPos = { x: 0, y: 0 };
let currentNodeColor = '#b58900';
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

function saveMindMap(opts) {
  opts = opts || {};
  const m = activeMap();
  if (!m) return;
  m.nodes = nodes;
  m.edges = edges;
  m.pan = pan;
  m.zoom = zoom;
  m.idCounter = nodeIdCounter;
  if (opts.viewOnly) {
    // Pan/zoom are per-device view state — persist locally, but DON'T bump
    // updatedAt or trigger Drive sync. Otherwise every pan on Device A
    // races against Device B's pan and forks conflict copies endlessly.
    try { localStorage.setItem('mindflow_mindmaps', JSON.stringify(mindmaps)); } catch {}
    try { localStorage.setItem('mindflow_mm_active', JSON.stringify(activeMindmapId)); } catch {}
    return;
  }
  m.updatedAt = new Date().toISOString();
  save('mindmaps', mindmaps);
  save('mm_active', activeMindmapId);
  renderMindmapList();
}

// The mindmap list is now part of the unified notes list — just refresh it.
function renderMindmapList() {
  if (typeof renderMemoList === 'function') renderMemoList();
}

function createMindmap() {
  // (Previously we re-saved the currently-active map "just in case", but every
  // legitimate edit already calls saveMindMap on its own; this redundant save
  // was bumping updatedAt with no real change → other device thought a new
  // version arrived and forked a "(충돌)" copy when it tried to push.)
  const map = {
    // Date.now() * 10000 + random — 같은 ms에 양 기기 동시 생성해도 충돌 사실상 불가
    id: Date.now() * 10000 + Math.floor(Math.random() * 10000),
    name: '새 마인드맵',
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
  selectedEdge = null;
  bindActiveMap();
  saveMindMap();
  updateToolbarState();
  if (typeof selectNote === 'function') selectNote('mindmap', map.id);
  else drawMindMap();
  toast('새 마인드맵 생성됨 — 빈 곳을 더블탭해 노드를 추가하세요', 'success');
}

// Delete a mindmap by id — used by the unified list (swipe / action sheet).
async function deleteMindmapById(id) {
  const m = mindmaps.find(x => x.id === id);
  if (!m) return;
  if (!(await confirmDialog(`마인드맵 "${m.name}"을(를) 삭제하시겠습니까?`, { danger: true, okText: '삭제' }))) return;
  // Record tombstone so Drive sync can't resurrect this mindmap on the next pull
  // (parallels memo_tombstones in js/memo.js — snapshot-only deletion was unsafe
  //  when snapshot was empty after schema bump / fresh device / ITP eviction).
  const tombs = load('mindmap_tombstones', {});
  tombs[id] = new Date().toISOString();
  save('mindmap_tombstones', tombs);
  const wasActive = (activeMindmapId === id);
  mindmaps = mindmaps.filter(x => x.id !== id);
  if (wasActive) {
    activeMindmapId = mindmaps[0] ? mindmaps[0].id : null;
    selectedNode = null;
    selectedEdge = null;
    bindActiveMap();
  }
  save('mindmaps', mindmaps);
  save('mm_active', activeMindmapId);
  // If the deleted mindmap was open in the detail pane, drop back to the list
  if (wasActive && typeof activeNoteType !== 'undefined' && activeNoteType === 'mindmap') {
    const page = document.getElementById('memo-page');
    if (page) page.classList.remove('note-mindmap', 'show-editor');
    activeNoteType = 'memo';
  }
  updateToolbarState();
  drawMindMap();
  if (typeof renderMemoList === 'function') renderMemoList();
  toast('마인드맵 삭제됨');
}

function switchMindmap(id) {
  if (id === activeMindmapId) { closeMindmapList(); return; }
  // No save of the outgoing map — real edits already persisted themselves.
  // (A switch-time save was bumping updatedAt on a map nobody had touched,
  // which produced phantom diffs and conflict copies between devices.)
  activeMindmapId = id;
  save('mm_active', activeMindmapId);
  selectedNode = null;
  selectedEdge = null;
  bindActiveMap();
  renderMindmapList();
  updateToolbarState();
  drawMindMap();
  closeMindmapList();
}

let mmMenuTargetId = null;

function showMindmapMenu(id) {
  const m = mindmaps.find(x => x.id === id);
  if (!m) return;
  mmMenuTargetId = id;
  document.getElementById('mm-action-title').textContent = m.name;
  document.getElementById('mm-action-overlay').classList.add('show');
  document.getElementById('mm-action-sheet').classList.add('show');
}

function closeMmMenu() {
  document.getElementById('mm-action-overlay').classList.remove('show');
  document.getElementById('mm-action-sheet').classList.remove('show');
  mmMenuTargetId = null;
}

async function renameMindmapActive() {
  const id = mmMenuTargetId;
  closeMmMenu();
  const m = mindmaps.find(x => x.id === id);
  if (!m) return;
  const name = await promptDialog('새 이름', m.name, { placeholder: '마인드맵 제목' });
  if (name && name.trim()) {
    m.name = name.trim();
    m.updatedAt = new Date().toISOString();
    save('mindmaps', mindmaps);
    renderMindmapList();
  }
}

function duplicateMindmapActive() {
  const id = mmMenuTargetId;
  closeMmMenu();
  const m = mindmaps.find(x => x.id === id);
  if (!m) return;
  const copy = JSON.parse(JSON.stringify(m));
  copy.id = Date.now();
  copy.name = m.name + ' (복사)';
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = new Date().toISOString();
  const insertIdx = mindmaps.findIndex(x => x.id === id);
  mindmaps.splice(insertIdx + 1, 0, copy);
  save('mindmaps', mindmaps);
  renderMindmapList();
  toast(`"${copy.name}" 복제됨`, 'success');
}

function deleteMindmapActive() {
  const id = mmMenuTargetId;
  closeMmMenu();
  deleteMindmapById(id);
}

// =================== MINDMAP TAGS ===================
// 마인드맵도 노트이므로 태그를 가진다. memo와 달리 본문이 없어 tags 배열을 직접 편집.
function renderMindmapTags() {
  const wrap = document.getElementById('mm-tag-chips');
  if (!wrap) return;
  const m = activeMap();
  const tags = (m && m.tags) || [];
  wrap.innerHTML = tags.map(t => {
    const safe = JSON.stringify(t).replace(/"/g, '&quot;');
    return `<span class="memo-tag-chip">${escapeHtml(t)}<button onclick="removeMindmapTag(${safe})" class="memo-tag-del" aria-label="태그 삭제">✕</button></span>`;
  }).join('');
}
function focusMmTagInput() {
  const i = document.getElementById('mm-tag-input');
  if (!i) return;
  i.classList.add('visible');
  i.focus();
}
function hideMmTagInput() {
  const i = document.getElementById('mm-tag-input');
  if (!i || document.activeElement === i) return;
  i.classList.remove('visible');
  i.value = '';
}
function addMindmapTagFromInput() {
  const i = document.getElementById('mm-tag-input');
  if (!i) return;
  addMindmapTag(i.value);
  i.value = '';
  i.classList.remove('visible');
}
function addMindmapTag(tag) {
  const m = activeMap();
  if (!m) return;
  tag = (tag || '').trim().replace(/^#/, '');  // "#회의" 또는 "회의" 모두 허용
  if (!tag) return;
  if (!m.tags) m.tags = [];
  if (!m.tags.includes(tag)) {
    m.tags.push(tag);
    m.updatedAt = new Date().toISOString();
    save('mindmaps', mindmaps);
  }
  renderMindmapTags();
  if (typeof renderMemoList === 'function') renderMemoList();  // 사이드바 태그 트리 갱신
}
function removeMindmapTag(tag) {
  const m = activeMap();
  if (!m || !m.tags) return;
  m.tags = m.tags.filter(t => t !== tag);
  m.updatedAt = new Date().toISOString();
  save('mindmaps', mindmaps);
  renderMindmapTags();
  if (typeof renderMemoList === 'function') renderMemoList();
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
  // 연결·삭제는 노드 액션바로 옮겨졌으므로 툴바 버튼이 없을 수 있다 — null 가드
  const d = document.getElementById('delete-btn');
  if (d) d.disabled = !selectedNode && selectedEdge === null;
  const c = document.getElementById('connect-btn');
  if (c) c.disabled = !selectedNode;
}

function resizeCanvas() {
  if (!canvas || !ctx) return;
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
  if (!canvas || !ctx) return;
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
  const _darkThemes = new Set(['leather','cobalt','solarized-dark','panic','gotham','dracula','dieci','toothpaste']);
  const _isDarkMm = _darkThemes.has(document.body.getAttribute('data-theme') || '');
  ctx.strokeStyle = _isDarkMm ? 'rgba(255,255,255,0.05)' : 'rgba(60,40,20,0.07)';
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
  edges.forEach((e, idx) => {
    const from = nodes.find(n => n.id === e.from);
    const to = nodes.find(n => n.id === e.to);
    if (!from || !to) return;
    const isEdgeSelected = selectedEdge === idx;
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2 - 30;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(mx, my, to.x, to.y);
    if (isEdgeSelected) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 4;
    } else {
      const grad = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
      grad.addColorStop(0, hexA(from.color || '#b58900', 0.6));
      grad.addColorStop(1, hexA(to.color || '#b58900', 0.6));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.5;
    }
    ctx.stroke();

    if (isEdgeSelected) {
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2 - 15;
      const r = 12 / zoom;
      ctx.beginPath();
      ctx.arc(midX, midY, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.shadowColor = 'rgba(239,68,68,0.6)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
      const s = 4.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(midX - s, midY - s); ctx.lineTo(midX + s, midY + s);
      ctx.moveTo(midX + s, midY - s); ctx.lineTo(midX - s, midY + s);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / zoom;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  });

  if (isConnecting && connectingFrom) {
    const from = nodes.find(n => n.id === connectingFrom);
    if (from) {
      const mp = screenToWorld(connDragPos.x, connDragPos.y);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(mp.x, mp.y);
      ctx.strokeStyle = hexA(from.color || '#b58900', 0.85);
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      // Endpoint dot
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = hexA(from.color || '#b58900', 0.85);
      ctx.fill();
    }
  }

  nodes.forEach(n => {
    const isSelected = selectedNode === n.id;
    ctx.font = '600 14px -apple-system, sans-serif';
    const textWidth = ctx.measureText(n.text).width;
    const w = Math.max(textWidth + 40, 90);
    const h = 44;

    ctx.shadowColor = hexA(n.color || '#b58900', 0.5);
    ctx.shadowBlur = isSelected ? 24 : 14;
    ctx.shadowOffsetY = 4;

    ctx.beginPath();
    ctx.roundRect(n.x - w/2, n.y - h/2, w, h, 12);
    const grad = ctx.createLinearGradient(n.x - w/2, n.y - h/2, n.x + w/2, n.y + h/2);
    grad.addColorStop(0, lightenColor(n.color || '#b58900', 0.1));
    grad.addColorStop(1, n.color || '#b58900');
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

    // Note link indicator (작은 문서 아이콘, 좌상단 코너) — 노드가 메모와 연결된 경우
    if (n.noteId) {
      const ix = n.x - w/2 + 8;
      const iy = n.y - h/2 + 8;
      ctx.beginPath();
      ctx.arc(ix, iy, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      // 작은 doc 모양 (직사각형 + 접힌 모서리)
      ctx.fillStyle = n.color || '#b58900';
      ctx.font = '700 9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('📝', ix, iy + 0.5);
    }

    // Connection handle on selected node (right side)
    if (isSelected && !isDraggingConnection) {
      const hx = n.x + w/2 + 16;
      const hy = n.y;
      ctx.beginPath();
      ctx.arc(hx, hy, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = hexA(n.color || '#b58900', 0.6);
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = n.color || '#b58900';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx - 5, hy);
      ctx.lineTo(hx + 5, hy);
      ctx.moveTo(hx, hy - 5);
      ctx.lineTo(hx, hy + 5);
      ctx.strokeStyle = n.color || '#b58900';
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

function getEdgeAt(sx, sy) {
  const wp = screenToWorld(sx, sy);
  const threshold = 8 / zoom;
  for (let i = edges.length - 1; i >= 0; i--) {
    const e = edges[i];
    const from = nodes.find(n => n.id === e.from);
    const to = nodes.find(n => n.id === e.to);
    if (!from || !to) continue;
    const cpx = (from.x + to.x) / 2;
    const cpy = (from.y + to.y) / 2 - 30;
    for (let t = 0; t <= 1; t += 0.05) {
      const bx = (1-t)*(1-t)*from.x + 2*(1-t)*t*cpx + t*t*to.x;
      const by = (1-t)*(1-t)*from.y + 2*(1-t)*t*cpy + t*t*to.y;
      if (Math.hypot(wp.x - bx, wp.y - by) <= threshold) return i;
    }
  }
  return null;
}

function getEdgeDeleteAt(sx, sy) {
  if (selectedEdge === null) return false;
  const e = edges[selectedEdge];
  if (!e) return false;
  const from = nodes.find(n => n.id === e.from);
  const to = nodes.find(n => n.id === e.to);
  if (!from || !to) return false;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2 - 15;
  const sp = worldToScreen(midX, midY);
  return Math.hypot(sx - sp.x, sy - sp.y) <= 16;
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

  // 0) Delete selected edge via its × button
  if (selectedEdge !== null && getEdgeDeleteAt(p.x, p.y)) {
    edges.splice(selectedEdge, 1);
    selectedEdge = null;
    saveMindMap();
    updateToolbarState();
    drawMindMap();
    e.preventDefault && e.preventDefault();
    return;
  }

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
    selectedEdge = null;
    draggingNode = node;
    draggingNodeMoved = false;
    lastMouse = { x: p.cx, y: p.cy };
    syncToolbarColor(node.color || currentNodeColor);
    updateToolbarState();
    updateNodeActionBar();
    drawMindMap();
  } else {
    const edgeIdx = getEdgeAt(p.x, p.y);
    if (edgeIdx !== null) {
      selectedEdge = edgeIdx;
      selectedNode = null;
      updateToolbarState();
      updateNodeActionBar();
      drawMindMap();
    } else {
      selectedNode = null;
      selectedEdge = null;
      isPanning = true;
      lastMouse = { x: p.cx, y: p.cy };
      updateToolbarState();
      updateNodeActionBar();
      drawMindMap();
    }
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
    if (dx !== 0 || dy !== 0) draggingNodeMoved = true;
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
  // Only save (= bump updatedAt = trigger Drive push) if the node ACTUALLY moved.
  // A plain tap-on-node lands here too, and a redundant save was forcing every
  // node tap to race with the other device's mtime → "(충돌)" fork.
  if (draggingNode && draggingNodeMoved) {
    draggingNode.updatedAt = new Date().toISOString();  // CRDT-lite node mtime
    saveMindMap();
  }
  if (isPanning) saveMindMap({ viewOnly: true }); // pan = local view only
  draggingNode = null;
  draggingNodeMoved = false;
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
  saveMindMap({ viewOnly: true });          // zoom = local view only
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
    color: currentNodeColor,
    updatedAt: new Date().toISOString()        // node-level mtime for CRDT-lite merge
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
  selectedEdge = null;
  isConnecting = true;
  connectingFrom = selectedNode;
  canvas.classList.add('connecting');
  updateToolbarState();
  toast('연결할 노드를 탭하세요');
}

async function deleteSelected() {
  if (selectedEdge !== null) {
    edges.splice(selectedEdge, 1);
    selectedEdge = null;
    saveMindMap();
    updateToolbarState();
    drawMindMap();
    return;
  }
  if (!selectedNode) return;
  if (!(await confirmDialog('이 노드를 삭제하시겠습니까?', { danger: true, okText: '삭제' }))) return;
  // Node tombstone — node-level CRDT 머지가 부활시키지 않도록 기록
  const m = activeMap();
  if (m) {
    m.deletedNodes = m.deletedNodes || {};
    m.deletedNodes[selectedNode] = new Date().toISOString();
  }
  nodes = nodes.filter(n => n.id !== selectedNode);
  edges = edges.filter(e => e.from !== selectedNode && e.to !== selectedNode);
  selectedNode = null;
  saveMindMap();
  updateToolbarState();
  drawMindMap();
}

function setNodeColor(el) {
  currentNodeColor = el.dataset.color;
  syncToolbarColor(currentNodeColor);
  if (selectedNode) {
    const node = nodes.find(n => n.id === selectedNode);
    if (node) {
      node.color = currentNodeColor;
      node.updatedAt = new Date().toISOString();  // CRDT-lite node mtime
      saveMindMap();
      drawMindMap();
    }
  }
}

function syncToolbarColor(color) {
  document.querySelectorAll('.mm-color-grid .color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === color));
  document.querySelectorAll('#nab-colors .nab-color').forEach(d => d.classList.toggle('active', d.dataset.color === color));
  const preview = document.getElementById('mm-color-preview');
  if (preview) preview.style.background = color;
}

function toggleMmColorPicker(e) {
  if (e) e.stopPropagation();
  const popup = document.getElementById('mm-color-popup');
  if (!popup) return;
  if (popup.classList.contains('open')) { popup.classList.remove('open'); return; }
  const btn = document.getElementById('mm-color-btn');
  if (btn) {
    const r = btn.getBoundingClientRect();
    popup.style.top = (r.bottom + 8) + 'px';
    popup.style.left = Math.max(8, r.left + r.width/2 - 100) + 'px';
  }
  popup.classList.add('open');
}

function closeMmColorPicker() {
  const popup = document.getElementById('mm-color-popup');
  if (popup) popup.classList.remove('open');
}

// 팝업 외부 클릭 시 닫기
document.addEventListener('click', e => {
  if (!e.target.closest('#mm-color-popup') && !e.target.closest('#mm-color-btn')) closeMmColorPicker();
});

// Palette shown in the node action bar — 사장님 요청: 8개
const NAB_COLORS = [
  { c: '#d33682', l: '마젠타' },
  { c: '#cb4b16', l: '오렌지' },
  { c: '#b58900', l: '옐로우' },
  { c: '#859900', l: '그린' },
  { c: '#2aa198', l: '시안' },
  { c: '#268bd2', l: '블루' },
  { c: '#7c3aed', l: '퍼플' },
  { c: '#475569', l: '슬레이트' },
];

function initNodeActionBar() {
  const el = document.getElementById('nab-colors');
  if (!el) return;
  el.innerHTML = NAB_COLORS.map(({ c, l }) =>
    `<span class="nab-color" data-color="${c}" style="background:${c}" onclick="nabSetColor('${c}')" title="${l}"></span>`
  ).join('');
}

function nabSetColor(color) {
  currentNodeColor = color;
  syncToolbarColor(color);
  if (selectedNode) {
    const node = nodes.find(n => n.id === selectedNode);
    if (node) { node.color = color; saveMindMap(); drawMindMap(); }
  }
}

function updateNodeActionBar() {
  const bar = document.getElementById('node-action-bar');
  if (!bar) return;
  if (!selectedNode) { bar.classList.remove('show'); return; }
  bar.classList.add('show');
  const node = nodes.find(n => n.id === selectedNode);
  if (node) syncToolbarColor(node.color || currentNodeColor);
  // 메모 연결 버튼 라벨/액션 토글
  const noteBtn = document.getElementById('nab-note-link');
  if (noteBtn && node) {
    if (node.noteId) {
      noteBtn.title = '연결된 메모 열기';
      noteBtn.innerHTML = '<span class="mi mi-sm mi-fill">description</span><span>메모 열기</span>';
      noteBtn.onclick = (e) => jumpToLinkedMemo(node.id);
      noteBtn.oncontextmenu = (e) => { e.preventDefault(); unlinkNodeFromMemo(); return false; };
    } else {
      noteBtn.title = '메모 연결';
      noteBtn.innerHTML = '<span class="mi mi-sm">description</span><span>메모</span>';
      noteBtn.onclick = (e) => openNoteLinkPicker();
      noteBtn.oncontextmenu = null;
    }
  }
  // 연결 해제 버튼 — 노드가 메모와 연결된 경우에만 표시
  const unlinkBtn = document.getElementById('nab-note-unlink');
  if (unlinkBtn && node) {
    unlinkBtn.style.display = node.noteId ? '' : 'none';
  }
}

function openNodeEditSelected() {
  if (!selectedNode) return;
  const node = nodes.find(n => n.id === selectedNode);
  if (!node) return;
  const sp = worldToScreen(node.x, node.y);
  const rect = canvas.getBoundingClientRect();
  openNodeEdit(node, sp.x + rect.left, sp.y + rect.top);
}

function zoomIn() { zoom = Math.min(3, zoom * 1.2); saveMindMap(); drawMindMap(); }
function zoomOut() { zoom = Math.max(0.2, zoom / 1.2); saveMindMap(); drawMindMap(); }
function resetView() { zoom = 1; pan = { x: 0, y: 0 }; saveMindMap(); drawMindMap(); }

function fitToScreen() {
  if (!canvas || nodes.length === 0) return;
  const PADDING = 60;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x - 80);
    minY = Math.min(minY, n.y - 30);
    maxX = Math.max(maxX, n.x + 80);
    maxY = Math.max(maxY, n.y + 30);
  });
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);
  const bw = maxX - minX;
  const bh = maxY - minY;
  const newZoom = Math.min(3, Math.max(0.2, Math.min((w - PADDING * 2) / bw, (h - PADDING * 2) / bh)));
  pan = {
    x: (w - bw * newZoom) / 2 - minX * newZoom,
    y: (h - bh * newZoom) / 2 - minY * newZoom,
  };
  zoom = newZoom;
  saveMindMap();
  drawMindMap();
}

const popup = document.getElementById('node-edit-popup');
const popupInput = document.getElementById('node-edit-input');
let editingNodeId = null;
let editOriginalText = '';

function openNodeEdit(node, cx, cy) {
  editingNodeId = node.id;
  editOriginalText = node.text;
  popupInput.value = node.text;
  popup.style.display = 'flex';

  const positionPopup = () => {
    const vv = window.visualViewport || { offsetTop: 0, height: window.innerHeight };
    const vpBottom = vv.offsetTop + vv.height;
    const popupW = 290;
    const left = Math.min(window.innerWidth - popupW - 8, Math.max(8, cx - popupW / 2));
    let top = cy + 32;
    if (top + 56 > vpBottom - 16) top = cy - 32 - 56;
    top = Math.max(vv.offsetTop + 8, Math.min(vpBottom - 64, top));
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  };
  positionPopup();
  if (window.visualViewport) window.visualViewport.addEventListener('resize', positionPopup, { once: true });

  popupInput.focus();
  popupInput.select();
}

function closeNodeEdit(cancel) {
  if (editingNodeId && !cancel) {
    const node = nodes.find(n => n.id === editingNodeId);
    if (node) {
      const text = popupInput.value.trim();
      if (text) {
        node.text = text;
        node.updatedAt = new Date().toISOString();  // CRDT-lite node mtime
        saveMindMap();
        drawMindMap();
      } else if (!editOriginalText) {
        // 새 노드에 아무것도 입력 안 했으면 삭제
        const nid = node.id;
        nodes.splice(nodes.indexOf(node), 1);
        for (let i = edges.length - 1; i >= 0; i--) {
          if (edges[i].from === nid || edges[i].to === nid) edges.splice(i, 1);
        }
        saveMindMap();
        drawMindMap();
      }
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
initNodeActionBar();
updateNodeActionBar();

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const activeEl = document.querySelector('.page.active');
  const activePage = activeEl ? activeEl.id : '';
  // The mindmap canvas now lives inside the unified notes page — only handle
  // these shortcuts when a mindmap note is actually open.
  if (activePage === 'page-memo' && typeof activeNoteType !== 'undefined' && activeNoteType === 'mindmap') {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); addMindNode(); }
    if (e.key === 'Escape') { selectedNode = null; selectedEdge = null; isConnecting = false; connectingFrom = null; canvas.classList.remove('connecting'); updateToolbarState(); updateNodeActionBar(); drawMindMap(); }
  }
});

// =================== NODE ↔ MEMO LINKING ===================
// 노드에 메모를 연결하면 노드 좌상단에 작은 아이콘이 뜨고, 노드 더블탭(또는
// 액션바 메모 버튼) 시 그 메모로 점프. 메모 컨텍스트 메뉴에서도 역방향 연결 가능.

let _noteLinkPickerActiveIdx = 0;
let _noteLinkPickerResults = [];
let _noteLinkPickerTargetNodeId = null;

function openNoteLinkPicker(targetNodeId) {
  // Default = currently selected node
  _noteLinkPickerTargetNodeId = targetNodeId != null ? targetNodeId : selectedNode;
  if (_noteLinkPickerTargetNodeId == null) {
    toast('먼저 노드를 선택하세요'); return;
  }
  const o = document.getElementById('note-link-picker-overlay');
  if (!o) return;
  o.classList.add('show');
  const inp = document.getElementById('note-link-picker-input');
  inp.value = '';
  _noteLinkPickerActiveIdx = 0;
  renderNoteLinkPickerResults('');
  setTimeout(() => inp.focus(), 30);
}
function closeNoteLinkPicker() {
  const o = document.getElementById('note-link-picker-overlay');
  if (o) o.classList.remove('show');
  _noteLinkPickerTargetNodeId = null;
}
function renderNoteLinkPickerResults(q) {
  const cont = document.getElementById('note-link-picker-results');
  if (!cont) return;
  const tokens = (typeof parseSearchQuery === 'function') ? parseSearchQuery(q) : [];
  // 메모만 보여줌 (마인드맵 연결은 의미 없음)
  const list = (typeof memos !== 'undefined' ? memos : [])
    .filter(m => {
      if (!tokens.length) return true;
      if (typeof evalSearchQuery === 'function') {
        // memo의 searchText 필드 보장
        const sm = { ...m, type: 'memo', searchText: ((m.title || '') + ' ' + (m.content || '')).toLowerCase() };
        return evalSearchQuery(sm, tokens);
      }
      return ((m.title || '') + ' ' + (m.content || '')).toLowerCase().includes((q || '').toLowerCase());
    })
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 20);
  _noteLinkPickerResults = list;
  let html = '';
  if (list.length === 0) {
    // 검색어가 있으면 "새 메모로 생성" 옵션
    if (q && q.trim()) {
      html = `<div class="cmd-palette-section">없으면 새로 만들기</div>
        <div class="cmd-palette-item active" data-create="1">
          <span class="mi mi-sm">add</span>
          <div class="cmd-palette-item-main">
            <div class="cmd-palette-item-title">"${(typeof escapeHtml === 'function' ? escapeHtml(q) : q)}" 메모 생성하고 연결</div>
          </div>
        </div>`;
    } else {
      html = '<div class="cmd-palette-empty">검색 결과 없음</div>';
    }
  } else {
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const titleHl = (typeof highlightSearchMatch === 'function' && typeof escapeHtml === 'function')
        ? highlightSearchMatch(escapeHtml(m.title || '제목 없음'), tokens)
        : (m.title || '제목 없음');
      const sub = (typeof previewSnippetWithMatch === 'function')
        ? previewSnippetWithMatch(m.content || '', tokens)
        : (m.content || '').slice(0, 80);
      const subHl = (typeof highlightSearchMatch === 'function' && typeof escapeHtml === 'function')
        ? highlightSearchMatch(escapeHtml(sub), tokens) : sub;
      html += `<div class="cmd-palette-item ${i === _noteLinkPickerActiveIdx ? 'active' : ''}" data-mid="${m.id}">
        <span class="mi mi-sm">edit_note</span>
        <div class="cmd-palette-item-main">
          <div class="cmd-palette-item-title">${titleHl}</div>
          <div class="cmd-palette-item-sub">${subHl}</div>
        </div>
      </div>`;
    }
  }
  cont.innerHTML = html;
  cont.querySelectorAll('.cmd-palette-item').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.create) {
        const q = document.getElementById('note-link-picker-input').value.trim();
        _createAndLinkMemo(q);
      } else {
        const mid = parseInt(el.dataset.mid);
        _linkNodeToMemo(_noteLinkPickerTargetNodeId, mid);
      }
    });
  });
}
function _linkNodeToMemo(nodeId, memoId) {
  const n = nodes.find(x => x.id === nodeId);
  if (!n) { closeNoteLinkPicker(); return; }
  n.noteId = memoId;
  saveMindMap();
  closeNoteLinkPicker();
  drawMindMap();
  updateNodeActionBar();
  const m = (typeof memos !== 'undefined' ? memos : []).find(x => x.id === memoId);
  toast(`노드 "${n.text}" ↔ 메모 "${m?.title || '제목 없음'}" 연결됨`, 'success');
}
function _createAndLinkMemo(title) {
  if (typeof memos === 'undefined' || typeof newMemoId !== 'function') {
    toast('메모 모듈이 로드되지 않았어요'); return;
  }
  const now = new Date().toISOString();
  const m = { id: newMemoId(), title: title, content: '', date: now, updatedAt: now, tags: [] };
  memos.unshift(m);
  if (typeof saveMemos === 'function') saveMemos();
  _linkNodeToMemo(_noteLinkPickerTargetNodeId, m.id);
}
function unlinkNodeFromMemo() {
  if (selectedNode == null) return;
  const n = nodes.find(x => x.id === selectedNode);
  if (!n || !n.noteId) return;
  delete n.noteId;
  saveMindMap();
  drawMindMap();
  updateNodeActionBar();
  toast('연결 해제됨');
}
// 노드 더블탭 시 호출 — 메모로 점프
function jumpToLinkedMemo(nodeId) {
  const n = nodes.find(x => x.id === nodeId);
  if (!n || !n.noteId) return false;
  if (typeof navigateTo === 'function' && currentPage !== 'memo') navigateTo('memo', { updateHash: false });
  if (typeof selectNote === 'function') selectNote('memo', n.noteId);
  return true;
}

// Wire picker input
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('note-link-picker-input');
  if (!inp) return;
  inp.addEventListener('input', (e) => renderNoteLinkPickerResults(e.target.value));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _noteLinkPickerActiveIdx = Math.min(_noteLinkPickerResults.length - 1, _noteLinkPickerActiveIdx + 1); renderNoteLinkPickerResults(inp.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _noteLinkPickerActiveIdx = Math.max(0, _noteLinkPickerActiveIdx - 1); renderNoteLinkPickerResults(inp.value); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const cont = document.getElementById('note-link-picker-results');
      const createBtn = cont.querySelector('[data-create="1"]');
      if (createBtn) { _createAndLinkMemo(inp.value.trim()); return; }
      const r = _noteLinkPickerResults[_noteLinkPickerActiveIdx];
      if (r) _linkNodeToMemo(_noteLinkPickerTargetNodeId, r.id);
    }
    else if (e.key === 'Escape') { e.preventDefault(); closeNoteLinkPicker(); }
  });
});


