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
  const countEl = document.getElementById('mm-count');
  if (countEl) countEl.textContent = mindmaps.length;
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
  selectedEdge = null;
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

function renameMindmapActive() {
  const id = mmMenuTargetId;
  closeMmMenu();
  const m = mindmaps.find(x => x.id === id);
  if (!m) return;
  const name = prompt('새 이름:', m.name);
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
  const m = mindmaps.find(x => x.id === id);
  if (!m) { closeMmMenu(); return; }
  if (mindmaps.length <= 1) { closeMmMenu(); toast('최소 1개의 마인드맵이 필요합니다'); return; }
  if (!confirm(`"${m.name}"을(를) 삭제하시겠습니까?`)) return;
  closeMmMenu();
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
  document.getElementById('delete-btn').disabled = !selectedNode && selectedEdge === null;
  document.getElementById('connect-btn').disabled = !selectedNode;
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
  selectedEdge = null;
  isConnecting = true;
  connectingFrom = selectedNode;
  canvas.classList.add('connecting');
  updateToolbarState();
  toast('연결할 노드를 탭하세요');
}

function deleteSelected() {
  if (selectedEdge !== null) {
    edges.splice(selectedEdge, 1);
    selectedEdge = null;
    saveMindMap();
    updateToolbarState();
    drawMindMap();
    return;
  }
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
  currentNodeColor = el.dataset.color;
  syncToolbarColor(currentNodeColor);
  if (selectedNode) {
    const node = nodes.find(n => n.id === selectedNode);
    if (node) { node.color = currentNodeColor; saveMindMap(); drawMindMap(); }
  }
}

function syncToolbarColor(color) {
  document.querySelectorAll('.mm-color-grid .color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === color));
  document.querySelectorAll('#nab-colors .nab-color').forEach(d => d.classList.toggle('active', d.dataset.color === color));
  const preview = document.getElementById('mm-color-preview');
  if (preview) preview.style.background = color;
}

function toggleMmColorPicker() {
  const popup = document.getElementById('mm-color-popup');
  if (!popup) return;
  const isOpen = popup.classList.contains('open');
  if (isOpen) { popup.classList.remove('open'); return; }
  popup.classList.add('open');
}

function closeMmColorPicker() {
  const popup = document.getElementById('mm-color-popup');
  if (popup) popup.classList.remove('open');
}

// 팝업 외부 클릭 시 닫기
document.addEventListener('click', e => {
  if (!e.target.closest('.mm-color-picker-wrap')) closeMmColorPicker();
});

// Palette shown in the node action bar
const NAB_COLORS = [
  { c: '#b58900', l: '옐로우' }, { c: '#cb4b16', l: '오렌지' }, { c: '#dc322f', l: '레드' },
  { c: '#e11d48', l: '로즈' },   { c: '#d33682', l: '마젠타' }, { c: '#7c3aed', l: '퍼플' },
  { c: '#6c71c4', l: '바이올렛' },{ c: '#268bd2', l: '블루' },  { c: '#2aa198', l: '시안' },
  { c: '#859900', l: '그린' },   { c: '#475569', l: '슬레이트' }
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
  const activePage = document.querySelector('.page.active').id;
  if (activePage === 'page-mindmap') {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); addMindNode(); }
    if (e.key === 'Escape') { selectedNode = null; selectedEdge = null; isConnecting = false; connectingFrom = null; canvas.classList.remove('connecting'); updateToolbarState(); updateNodeActionBar(); drawMindMap(); }
  }
});

