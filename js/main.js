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

// One-time: extract inline hashtags from existing memo content into tag chips
if (typeof migrateHashtagsFromContent === 'function') {
  try { migrateHashtagsFromContent(); } catch (e) { console.warn('hashtag migration failed:', e); }
}

// Daily backup (idle, runs at most once per 24h)
if (typeof BackupService !== 'undefined') {
  BackupService.maybeDaily().catch(() => {});
}

// =================== SERVICE WORKER (PWA fresh-update) ===================
// Registers a network-first SW so installed PWAs always pick up new deploys
// the next time they're opened — no more "stuck on old version" on iOS/Android.
if ('serviceWorker' in navigator) {
  // Use ./service-worker.js so it works on GitHub Pages subpath
  navigator.serviceWorker.register('./service-worker.js').then((reg) => {
    // Detect when a new SW is waiting (new deploy arrived)
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          // A new version is ready — non-blocking toast offering reload
          if (typeof toast === 'function') {
            toast('새 버전이 설치됐어요. 새로고침하면 적용돼요', 'success');
          }
        }
      });
    });
    // When the new SW takes control, reload once so the page actually uses it
    let _reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_reloaded) return;
      _reloaded = true;
      location.reload();
    });
  }).catch((e) => console.warn('SW register failed:', e));
}

// =================== SYNC EVENTS → UI WIRE-UP ===================
// Sync engine emits domain events; the UI listens here. This keeps sync logic
// unaware of which renderers exist — easier to test, less coupling.
if (window.SyncEvents) {
  SyncEvents.on('itemsMerged', ({ types, editingMemoId, focusedEl, focusSel }) => {
    if (types.includes('mindmap')) {
      if (typeof renderMindmapList === 'function') renderMindmapList();
      if (typeof drawMindMap === 'function') drawMindMap();
    }
    if (types.includes('memo')) {
      if (typeof renderMemoList === 'function') renderMemoList();
      // Skip editor redraw if user is actively editing — would clobber cursor
      if (editingMemoId == null && typeof renderMemoEditor === 'function') renderMemoEditor();
    }
    if (types.includes('timeblock')) {
      if (typeof renderTimeBlocks === 'function') renderTimeBlocks();
      if (typeof renderTimeblockList === 'function') renderTimeblockList();
    }
    if (types.includes('journal') && typeof renderJournalList === 'function') {
      renderJournalList();
    }
    // Restore focus + selection after re-renders disrupted the DOM
    if (focusedEl && focusedEl.isConnected) {
      try {
        focusedEl.focus();
        if (focusSel && focusedEl.setSelectionRange) {
          focusedEl.setSelectionRange(focusSel.start, focusSel.end);
        }
      } catch {}
    }
  });
}

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
