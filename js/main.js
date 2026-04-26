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
  starter.nodes.push({ id: starter.idCounter++, text: '중심 주제', x: cx, y: cy, color: '#b58900' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 1', x: cx - 200, y: cy - 110, color: '#268bd2' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 2', x: cx + 200, y: cy - 110, color: '#dc322f' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 3', x: cx - 200, y: cy + 110, color: '#859900' });
  starter.nodes.push({ id: starter.idCounter++, text: '아이디어 4', x: cx + 200, y: cy + 110, color: '#d33682' });
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

// Apply settings (show/hide ledger tab etc.) and init ledger renderer
applySettings();
if (typeof initLedger === 'function') initLedger();

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
