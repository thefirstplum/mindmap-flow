// =================== SYNC / BACKUP ===================

// Tiny pub/sub for sync ↔ UI decoupling. Sync engine emits domain events
// ('itemsMerged', 'conflict', 'status'); UI registers handlers that re-render.
window.SyncEvents = window.SyncEvents || {
  _l: {},
  on(event, fn) { (this._l[event] = this._l[event] || []).push(fn); return () => this.off(event, fn); },
  off(event, fn) { const arr = this._l[event]; if (arr) this._l[event] = arr.filter(f => f !== fn); },
  emit(event, data) {
    (this._l[event] || []).forEach(fn => { try { fn(data); } catch (e) { console.warn(`SyncEvents[${event}]`, e); } });
  }
};

// Run async tasks with at most `size` concurrent at a time
async function batchAll(items, fn, size = 8) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    results.push(...await Promise.all(chunk.map(fn)));
  }
  return results;
}

function getAllData() {
  return {
    version: 3,
    app: 'mindflow',
    exportedAt: new Date().toISOString(),
    mindmaps: load('mindmaps', []),
    activeMindmapId: load('mm_active', null),
    timeBlocks: load('tb_blocks', {}),
    tbMeta: load('tb_meta', {}),
    tbPrefixColors: load('tb_prefix_colors', {}),
    memos: load('memos', []),
    memoIdCounter: load('memo_idcounter', 1),
    journalEntries: load('journal_entries', {}),
    ledger: load('ledger', []),
    ledgerIdCounter: load('ledger_idcounter', 1),
    settings: load('settings', { ledgerEnabled: false })
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
  // Rebuild tbMeta from imported data so sync knows these are fresh
  if (data.tbMeta) {
    save('tb_meta', data.tbMeta);
  } else {
    const now = new Date().toISOString();
    const meta = {};
    Object.keys(data.timeBlocks || {}).forEach(k => { meta[k] = now; });
    save('tb_meta', meta);
  }
  save('memos', data.memos || []);
  save('memo_idcounter', data.memoIdCounter || 1);
  // Journal — per-entry merge: keep whichever side has the later updatedAt
  if (data.journalEntries) {
    const localJ = load('journal_entries', {});
    const merged = { ...data.journalEntries };
    Object.entries(localJ).forEach(([k, e]) => {
      const r = merged[k];
      if (!r || new Date(e.updatedAt || 0) >= new Date(r.updatedAt || 0)) merged[k] = e;
    });
    save('journal_entries', merged);
    if (typeof journalEntries !== 'undefined') {
      Object.assign(journalEntries, merged);
      if (typeof renderJournalList === 'function') renderJournalList();
    }
  }
  if (data.tbPrefixColors) {
    save('tb_prefix_colors', data.tbPrefixColors);
    if (typeof tbPrefixColors !== 'undefined') Object.assign(tbPrefixColors, data.tbPrefixColors);
  }
  if (data.ledger) save('ledger', data.ledger);
  if (data.ledgerIdCounter) save('ledger_idcounter', data.ledgerIdCounter);
  if (data.settings) {
    save('settings', data.settings);
    if (typeof appSettings !== 'undefined') {
      appSettings = data.settings;
      if (typeof applySettings === 'function') applySettings();
    }
  }
  // Refresh in-memory state + UI
  if (typeof ledgerEntries !== 'undefined') ledgerEntries = data.ledger || [];
  if (typeof renderLedger === 'function') renderLedger();
}

function openSyncModal() {
  const data = getAllData();
  const totalNodes = data.mindmaps.reduce((s, m) => s + (m.nodes?.length || 0), 0);
  const totalEdges = data.mindmaps.reduce((s, m) => s + (m.edges?.length || 0), 0);
  const totalBlocks = Object.values(data.timeBlocks).reduce((s, a) => s + a.length, 0);
  const journalCount = Object.keys(data.journalEntries || {}).length;
  const stats = `
    🧠 마인드맵: <strong>${data.mindmaps.length}개</strong> · 노드 <strong>${totalNodes}개</strong> · 연결 <strong>${totalEdges}개</strong><br>
    📅 타임블록: <strong>${totalBlocks}개</strong> (${Object.keys(data.timeBlocks).length}일)<br>
    📝 메모: <strong>${data.memos.length}개</strong><br>
    📔 감정일기: <strong>${journalCount}일</strong>
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
  refreshBackupList();
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

// =================== BACKUP UI ===================
function _formatBackupReason(r) {
  return ({
    'pre-push': '🔼 동기화 직전',
    'pre-pull': '🔽 가져오기 직전',
    'pre-restore': '↩️ 복원 직전',
    'pre-conflict-resolve': '⚠️ 충돌 처리 직전',
    'manual': '👆 수동 백업',
    'daily': '📅 일일 자동',
  })[r] || r;
}

function _formatBackupTime(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = d.getHours().toString().padStart(2,'0');
    const mm = d.getMinutes().toString().padStart(2,'0');
    if (sameDay) return `오늘 ${hh}:${mm}`;
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return `어제 ${hh}:${mm}`;
    return `${d.getMonth()+1}/${d.getDate()} ${hh}:${mm}`;
  } catch { return iso; }
}

async function refreshBackupList() {
  const el = document.getElementById('backup-list');
  if (!el || typeof BackupService === 'undefined') return;
  // Force-trim oldest entries so the cap is honored even if older snapshots
  // accumulated before BackupService.cleanup was called consistently.
  try { await BackupService.cleanup(); } catch {}
  const records = await BackupService.list();
  // Summary count next to the section title
  const countEl = document.getElementById('backup-summary-count');
  if (countEl) countEl.textContent = records.length ? `(${records.length}개)` : '';
  if (!records.length) {
    el.innerHTML = `<div style="padding:12px;background:var(--surface2);border-radius:8px;color:var(--text-mute);text-align:center;">백업이 아직 없어요. 첫 동기화 후 자동으로 생성돼요.</div>`;
    return;
  }
  el.innerHTML = records.map(r => {
    const s = r.summary || {};
    const summary = `메모 ${s.memoCount||0} · 마인드맵 ${s.mindmapCount||0} · 타임블록 ${s.timeblockDays||0}일 · 일기 ${s.journalDays||0}일`;
    const tsAttr = JSON.stringify(r.timestamp).replace(/"/g, '&quot;');
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--surface2);border-radius:8px;margin-bottom:6px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:var(--text);">${_formatBackupTime(r.timestamp)} <span style="font-weight:400;color:var(--text-mute);font-size:11px;">${escapeHtml(_formatBackupReason(r.reason))}</span></div>
          <div style="font-size:11px;color:var(--text-mute);margin-top:2px;">${escapeHtml(summary)}</div>
        </div>
        <button class="tb-btn" onclick="restoreBackup(${tsAttr})" style="font-size:12px;padding:6px 10px;">복원</button>
        <button class="tb-btn" onclick="exportBackup(${tsAttr})" style="font-size:12px;padding:6px 10px;" title="JSON 다운로드">⬇</button>
      </div>
    `;
  }).join('');
}

async function manualBackup() {
  if (typeof BackupService === 'undefined') { toast('백업 모듈 미로드', 'error'); return; }
  try {
    await BackupService.snapshot('manual');
    toast('백업 생성 완료', 'success');
    refreshBackupList();
  } catch (e) {
    toast('백업 실패: ' + e.message, 'error');
  }
}

async function restoreBackup(timestamp) {
  if (!confirm('이 백업으로 모든 데이터를 되돌립니다. 현재 데이터는 자동으로 한 번 더 백업됩니다.\n\n계속하시겠습니까?')) return;
  try {
    await BackupService.restore(timestamp);
    toast('복원 완료 — 페이지를 새로고침합니다', 'success');
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    toast('복원 실패: ' + e.message, 'error');
  }
}

async function exportBackup(timestamp) {
  try {
    await BackupService.export(timestamp);
    toast('백업 파일을 다운로드했습니다', 'success');
  } catch (e) {
    toast('내보내기 실패: ' + e.message, 'error');
  }
}

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
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_SCOPE_VER = 'v2'; // bump when scope changes so old tokens are invalidated
const DRIVE_FOLDER_NAME = 'MindFlow';
const DRIVE_ASSETS_NAME = 'assets';
// Subfolder structure (since 2026-05-07): items live in dedicated subfolders so
// the MindFlow/ root only contains singletons (settings/journal/prefix-colors).
// driveMigrateLegacyFiles auto-moves any root-level legacy files into these.
const DRIVE_MEMOS_FOLDER_NAME = 'memos';
const DRIVE_MINDMAPS_FOLDER_NAME = 'mindmaps';
const DRIVE_TIMEBLOCKS_FOLDER_NAME = 'timeblocks';
const DRIVE_APP_FILENAME = '_mindflow-app.json';

// One-time migration: clear cached token when scope changes
try {
  if (localStorage.getItem('mindflow_drive_scope') !== DRIVE_SCOPE_VER) {
    localStorage.removeItem('mindflow_drive_tok');
    localStorage.setItem('mindflow_drive_scope', DRIVE_SCOPE_VER);
  }
} catch {}

// Hardcoded default Client ID — published OAuth client for this app.
// Public-by-design: identifies the app, not the user. User data lives in
// each user's own Drive (drive.file scope). Override is still possible
// via the (now-hidden) input field if someone forks the repo.
const DEFAULT_DRIVE_CLIENT_ID = '47507563684-o5p5kjliou3bpddn6ae3ksabekjc6nlp.apps.googleusercontent.com';
let driveClientId = load('drive_client_id', null) || DEFAULT_DRIVE_CLIENT_ID;
let driveUserEmail = load('drive_user_email', null);
let driveFolderId = load('drive_folder_id', null);
let driveAssetsFolderId = load('drive_assets_folder_id', null);
let driveMemosFolderId = load('drive_memos_folder_id', null);
let driveMindmapsFolderId = load('drive_mindmaps_folder_id', null);
let driveTimeblocksFolderId = load('drive_timeblocks_folder_id', null);
// Layer 1 client — owns auth token + raw HTTP. Folder ids and snapshot live
// at this (engine) layer because they're business state, not transport state.
const driveClient = new DriveClient({ clientId: driveClientId });
if (driveUserEmail) driveClient.setLoginHint(driveUserEmail);
let drivePollTimer = null;
let driveLastPushAt = 0;
let driveLastSyncAt = null;
let driveLastModifiedTime = null; // server-side mtime of folder for change detection
let isLoadingFromDrive = false;
let isPushingToDrive = false;
// Conflict tracking — incremented when push detects another device wrote between
// our pushes and we forked a "conflict copy" to preserve their version.
let driveConflictsCount = 0;
let driveConflictsThisSession = [];
// Push progress — { uploaded: n, total: m } so the pill can show "동기화 중 14/87"
let driveProgress = null;
// driveDirty is persisted across sessions: if user closes browser before the 2s
// debounce push fires, we remember on next load that there are unflushed local
// changes — push them first before pulling (otherwise pull would clobber them).
let driveDirty = !!localStorage.getItem('mindflow_drive_dirty');
let driveStatus = 'idle';
let driveAutoSaveTimer = null;
const DRIVE_POLL_INTERVAL = 15_000;
// Watchdog: 'saving' must show progress within 60s — extended on each upload.
// Long full-resync pushes (e.g. snapshot migration) won't get killed mid-flight
// because every successful upload calls pingDriveSavingProgress().
let _driveSavingWatchdog = null;
const SAVING_WATCHDOG_MS = 60_000;
function _armSavingWatchdog() {
  if (_driveSavingWatchdog) clearTimeout(_driveSavingWatchdog);
  _driveSavingWatchdog = setTimeout(() => {
    if (driveStatus === 'saving') {
      console.warn('Drive sync watchdog: no progress for', SAVING_WATCHDOG_MS, 'ms — forcing error');
      setDriveStatus('error');
    }
  }, SAVING_WATCHDOG_MS);
}
function setDriveStatus(s) {
  const prev = driveStatus;
  driveStatus = s;
  updateDriveStatus();
  if (_driveSavingWatchdog) { clearTimeout(_driveSavingWatchdog); _driveSavingWatchdog = null; }
  if (s === 'saving') _armSavingWatchdog();
  // Emit so other UI surfaces (e.g. external indicators, debug logs) can react
  if (window.SyncEvents && prev !== s) {
    SyncEvents.emit('status', { provider: 'drive', status: s, previous: prev });
  }
}
function pingDriveSavingProgress() {
  if (driveStatus === 'saving') _armSavingWatchdog();
}
// Drive Changes API state — page token advances as we consume the change feed.
// Cheap "anything new?" check: if no relevant changes since last token, polling skips listing.
let driveChangesToken = load('drive_changes_token', null);

// Layer 1 (DriveClient) is now in js/drive-client.js. The wrappers below keep
// the old function names in place so the rest of the engine code doesn't have
// to change in a single phase — they just delegate. Phase 4 will replace the
// remaining call sites with direct `driveClient.X()` invocations.
async function driveAuth(promptUser = false) { return driveClient.authenticate(promptUser); }
function hasValidDriveToken() { return driveClient.hasValidToken(); }
async function ensureDriveToken() { return driveClient.ensureToken(); }
async function driveApi(method, path, body, query = {}) { return driveClient.request(method, path, body, query); }
async function driveDownloadFile(fileId) { return driveClient.download(fileId); }
async function driveUploadFile(name, content, mimeType, parentId, appProperties) {
  return driveClient.upload(name, content, mimeType, parentId, appProperties);
}
async function driveUpdateFile(fileId, content, mimeType) { return driveClient.update(fileId, content, mimeType); }
async function driveDeleteFile(fileId) { return driveClient.delete(fileId); }
async function driveListInFolder(folderId) { return driveClient.listInFolder(folderId); }

// Single API call listing root MindFlow + memos/ + mindmaps/ + timeblocks/.
// Returns categorized { rootFiles, memoFiles, mindmapFiles, timeblockFiles, files, latestMtime }.
// Files in root with subfolder-matching name patterns (e.g. leftover mindmap-*.json
// from before migration) are also surfaced through their type's array as a
// fallback so push/pull don't lose track during a half-completed migration.
async function driveListAllFiles() {
  await ensureDriveSubfolders();
  const parents = [driveFolderId, driveMemosFolderId, driveMindmapsFolderId, driveTimeblocksFolderId].filter(Boolean);
  const parentClause = parents.map(id => `'${id}' in parents`).join(' or ');
  const result = await driveApi('GET', '/files', null, {
    q: `(${parentClause}) and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime,size,appProperties,parents)',
    pageSize: 1000
  });

  const rootFiles = [];
  const memoFiles = [];
  const mindmapFiles = [];
  const timeblockFiles = [];
  for (const f of result.files) {
    if (f.mimeType === 'application/vnd.google-apps.folder') continue;
    const p = f.parents?.[0];
    if (p === driveMemosFolderId) memoFiles.push(f);
    else if (p === driveMindmapsFolderId) mindmapFiles.push(f);
    else if (p === driveTimeblocksFolderId) timeblockFiles.push(f);
    else rootFiles.push(f);
  }

  // Legacy fallback: surface any root-level files that match a type pattern
  // through that type's array so push lookups still find them mid-migration.
  for (const f of rootFiles) {
    const lc = f.name.toLowerCase();
    if (lc.endsWith('.md')) memoFiles.push(f);
    else if (lc.startsWith('mindmap-') && lc.endsWith('.json')) mindmapFiles.push(f);
    else if (lc.startsWith('timeblock-') && lc.endsWith('.json')) timeblockFiles.push(f);
  }

  const files = result.files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
  const latestMtime = files.reduce((max, f) => f.modifiedTime > max ? f.modifiedTime : max, '');
  // Maintain the legacy `subFiles` field for any caller still reading it
  return { files, rootFiles, memoFiles, mindmapFiles, timeblockFiles, subFiles: memoFiles, latestMtime, memosSubfolderId: driveMemosFolderId };
}

// Fetch incremental change feed and decide whether to do a full listing.
// First call (no token) just bootstraps the token without applying anything.
// Subsequent calls advance through changes; returns hasRelevant=true if any
// change touches our MindFlow folder or its memos subfolder (or is a removal,
// which the API doesn't include parent info for — we conservatively trigger).
async function driveFetchChanges() {
  if (!driveChangesToken) {
    try {
      const r = await driveApi('GET', '/changes/startPageToken');
      driveChangesToken = r.startPageToken;
      try { localStorage.setItem('mindflow_drive_changes_token', JSON.stringify(driveChangesToken)); } catch {}
    } catch (e) { console.warn('startPageToken failed:', e); }
    return { hasRelevant: false };
  }

  let pageToken = driveChangesToken;
  let hasRelevant = false;
  let nextToken = pageToken;

  for (let safety = 0; safety < 20 && pageToken; safety++) {
    let r;
    try {
      r = await driveApi('GET', '/changes', null, {
        pageToken,
        fields: 'newStartPageToken,nextPageToken,changes(removed,file(parents,trashed))',
        pageSize: 100,
        restrictToMyDrive: true
      });
    } catch (e) {
      // If the saved token has expired (very rare, after months of inactivity),
      // Drive returns 400. Reset and let next poll bootstrap a new one.
      if (/invalid|expired|400/i.test(e.message)) {
        driveChangesToken = null;
        try { localStorage.removeItem('mindflow_drive_changes_token'); } catch {}
        return { hasRelevant: true }; // do a full listing this once to be safe
      }
      throw e;
    }

    if (!hasRelevant) {
      for (const c of (r.changes || [])) {
        if (c.removed) { hasRelevant = true; break; }
        const parents = c.file?.parents || [];
        // Match any of our managed parents (root + 3 subfolders)
        const isOurs = parents.includes(driveFolderId)
          || (driveMemosFolderId && parents.includes(driveMemosFolderId))
          || (driveMindmapsFolderId && parents.includes(driveMindmapsFolderId))
          || (driveTimeblocksFolderId && parents.includes(driveTimeblocksFolderId));
        if (isOurs) {
          hasRelevant = true; break;
        }
      }
    }

    if (r.nextPageToken) pageToken = r.nextPageToken;
    else { nextToken = r.newStartPageToken; pageToken = null; }
  }

  if (nextToken && nextToken !== driveChangesToken) {
    driveChangesToken = nextToken;
    try { localStorage.setItem('mindflow_drive_changes_token', JSON.stringify(nextToken)); } catch {}
  }

  return { hasRelevant };
}

async function driveFindOrCreateFolder(name, parentId) { return driveClient.findOrCreateFolder(name, parentId); }

// Lazily ensure the per-type subfolders exist. Runs on connect AND init so
// upgrading users get their structure migrated automatically.
async function ensureDriveSubfolders() {
  if (!driveFolderId) return;
  const setLocal = (key, val) => {
    try { localStorage.setItem('mindflow_' + key, JSON.stringify(val)); } catch {}
  };
  if (!driveMemosFolderId) {
    driveMemosFolderId = await driveFindOrCreateFolder(DRIVE_MEMOS_FOLDER_NAME, driveFolderId);
    setLocal('drive_memos_folder_id', driveMemosFolderId);
  }
  if (!driveMindmapsFolderId) {
    driveMindmapsFolderId = await driveFindOrCreateFolder(DRIVE_MINDMAPS_FOLDER_NAME, driveFolderId);
    setLocal('drive_mindmaps_folder_id', driveMindmapsFolderId);
  }
  if (!driveTimeblocksFolderId) {
    driveTimeblocksFolderId = await driveFindOrCreateFolder(DRIVE_TIMEBLOCKS_FOLDER_NAME, driveFolderId);
    setLocal('drive_timeblocks_folder_id', driveTimeblocksFolderId);
  }
  if (!driveAssetsFolderId) {
    driveAssetsFolderId = await driveFindOrCreateFolder(DRIVE_ASSETS_NAME, driveFolderId);
    setLocal('drive_assets_folder_id', driveAssetsFolderId);
  }
}

// Move legacy root-level files into the per-type subfolders. Idempotent: only
// touches files that match a known pattern AND are still in MindFlow root. Safe
// to run on every connect/init — once migrated, subsequent runs find nothing.
async function driveMigrateLegacyFiles() {
  if (!driveFolderId || !driveMemosFolderId || !driveMindmapsFolderId || !driveTimeblocksFolderId) return 0;
  const rootListing = await driveListInFolder(driveFolderId);
  const toMigrate = [];
  for (const f of rootListing.files) {
    if (f.mimeType === 'application/vnd.google-apps.folder') continue;
    const lc = f.name.toLowerCase();
    if (lc.endsWith('.md')) {
      toMigrate.push({ f, target: driveMemosFolderId });
    } else if (lc.startsWith('mindmap-') && lc.endsWith('.json')) {
      toMigrate.push({ f, target: driveMindmapsFolderId });
    } else if (lc.startsWith('timeblock-') && lc.endsWith('.json')) {
      toMigrate.push({ f, target: driveTimeblocksFolderId });
    }
    // Singletons (_mindflow-app.json, journal.json, tb-prefix-colors.json) stay in root.
  }
  if (toMigrate.length === 0) return 0;
  console.log(`[Drive] Migrating ${toMigrate.length} legacy root file(s) into subfolders...`);
  await batchAll(toMigrate, async ({ f, target }) => {
    try {
      await driveApi('PATCH', `/files/${f.id}`, null, {
        addParents: target,
        removeParents: driveFolderId,
        fields: 'id,parents'
      });
    } catch (e) {
      console.warn('[Drive] Migrate failed for', f.name, '-', e.message);
    }
  });
  return toMigrate.length;
}

async function driveMakePublic(fileId) {
  try { await driveClient.makePublic(fileId); }
  catch (e) { console.warn('Make public failed:', e); }
}

// New flow (Authorization Code + PKCE):
//   driveConnect()  — initiated by user click → full-page redirect to Google
//   driveCompleteConnection() — runs when the browser returns with ?code=...,
//                               does the folder bootstrap + first push/pull
// The two halves are separated by a page navigation, so any state we need
// across the redirect lives in sessionStorage / localStorage (Client ID,
// PKCE verifier).
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
  driveClient.setClientId(cid);

  setDriveStatus('saving');
  toast('Google 인증 페이지로 이동합니다...');

  try {
    // Marks that a connect-flow is in progress, so when we come back we know
    // to run the full folder bootstrap (vs. a routine session refresh).
    sessionStorage.setItem('mindflow_drive_connecting', '1');
    await driveClient.startAuthFlow(); // page redirects — code below won't run
  } catch (e) {
    console.error(e);
    setDriveStatus('error');
    sessionStorage.removeItem('mindflow_drive_connecting');
    alert('❌ 인증 시작 실패\n\n' + e.message);
  }
}

// Called after the OAuth callback has been processed and we hold a fresh
// access token. Does the same folder bootstrap + initial push/pull that the
// old driveConnect() did inline.
async function driveCompleteConnection() {
  setDriveStatus('saving');
  try {
    try {
      const about = await driveClient.getAbout();
      driveUserEmail = about.user?.emailAddress || null;
      if (driveUserEmail) {
        save('drive_user_email', driveUserEmail);
        driveClient.setLoginHint(driveUserEmail);
      }
    } catch {}
    driveFolderId = await driveFindOrCreateFolder(DRIVE_FOLDER_NAME, null);
    save('drive_folder_id', driveFolderId);
    await ensureDriveSubfolders();
    updateDriveStatus();

    const migrated = await driveMigrateLegacyFiles();
    if (migrated > 0) toast(`기존 ${migrated}개 파일을 폴더별로 정리했습니다`, 'success');

    const { files: connectFiles } = await driveListAllFiles();
    const remoteHasData = connectFiles.some(f =>
      f.name.toLowerCase().endsWith('.md') ||
      f.name === DRIVE_APP_FILENAME ||
      (f.name.startsWith('mindmap-') && f.name.endsWith('.json')) ||
      (f.name.startsWith('timeblock-') && f.name.endsWith('.json'))
    );

    if (remoteHasData) await drivePullAll(true);
    await drivePushAll();
    driveStartPolling();
    if (driveStatus === 'saving') setDriveStatus('idle');
    toast('Google Drive 연결 완료', 'success');
  } catch (e) {
    console.error(e);
    setDriveStatus('error');
    alert('❌ 연결 실패\n\n' + e.message);
  }
}

async function driveDisconnect() {
  if (!confirm('Drive 연결을 해제하시겠습니까? 로컬 데이터는 그대로 유지됩니다.\n(Drive 폴더는 그대로 남아있습니다)')) return;
  driveStopPolling();
  // clearToken is now async — it tells the worker to revoke the refresh_token
  // and delete it from KV. Best-effort; we don't block disconnect on it.
  await driveClient.clearToken();
  save('drive_user_email', null);
  driveUserEmail = null;
  driveClient.setLoginHint(null);
  driveFolderId = null;
  driveAssetsFolderId = null;
  driveMemosFolderId = null;
  driveMindmapsFolderId = null;
  driveTimeblocksFolderId = null;
  driveLastModifiedTime = null;
  save('drive_folder_id', null);
  save('drive_assets_folder_id', null);
  try {
    localStorage.removeItem('mindflow_drive_memos_folder_id');
    localStorage.removeItem('mindflow_drive_mindmaps_folder_id');
    localStorage.removeItem('mindflow_drive_timeblocks_folder_id');
  } catch {}
  // Snapshot must be cleared — old snapshot would mismatch a fresh re-connect's Drive contents
  clearDriveSnapshot();
  driveChangesToken = null;
  try {
    localStorage.removeItem('mindflow_drive_changes_token');
    // legacy key cleanup
    localStorage.removeItem('mindflow_drive_memos_subfolder_id');
  } catch {}
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

// Stable artificial memo id derived from a filename. An external/orphan .md
// file (no frontmatter id, no appProperties, no id-prefix) must map to the
// SAME memo id on every pull. The old `++maxId` counter shifted between pulls,
// so each sync spawned a fresh duplicate memo + an endless push/pull loop.
// Range 1e9–2e9 stays clear of real memo ids (small counters).
const STABLE_ID_FLOOR = 1_000_000_000;
function stableMemoIdFromName(name) {
  let h = 5381;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  return STABLE_ID_FLOOR + (Math.abs(h) % STABLE_ID_FLOOR);
}

// =================== SHARED MERGE HELPERS (Drive + folder import) ===================
// Single source of truth for the memo/mindmap merge logic so a bug fixed in one
// path (Drive auto-pull / manual import) applies to all paths uniformly.

// Recover a memo id from a remote file object — covers ALL the fallbacks so
// that orphan .md files (no frontmatter id, no appProperties) still get a
// stable id, never null. Caller passes a Drive `File` or any object with
// `name` and (optionally) `appProperties`.
function recoverMemoIdFromFile(f) {
  if (!f || !f.name) return null;
  const propId = f.appProperties?.memoId ? parseInt(f.appProperties.memoId) : null;
  if (propId && !isNaN(propId)) return propId;
  const fnId = parseMemoIdFromFilename(f.name);
  if (fnId) return fnId;
  return stableMemoIdFromName(f.name);
}

// Parse a remote .md file (Drive / folder / Gist) into a memo with a stable id
// and stable updatedAt. Source: { text, name, appProperties?, modifiedTime? }.
function parseRemoteMemoFile(src) {
  // Stable fallback date — NEVER Date.now() (would churn id-less files every pull)
  const fallbackMtime = src.modifiedTime ? Date.parse(src.modifiedTime) : Date.now();
  const memo = parseFrontmatter(src.text, src.name, fallbackMtime);
  if (!memo.id) memo.id = recoverMemoIdFromFile(src);
  return memo;
}

// Merge remote memos into local memos. Applies all the protections the
// codebase has accumulated: tombstones (no resurrection), 3-way deletion
// detection (via pullSnap), per-item updatedAt comparison with tag
// preservation, and preservation of the in-progress edit (editingMemoId).
function mergeMemos(remoteMemos, localMemos, opts) {
  opts = opts || {};
  const tombstones = opts.tombstones || {};
  const pullSnap = opts.pullSnap || {};
  const editingMemoId = opts.editingMemoId == null ? null : opts.editingMemoId;

  const remoteIdSet = new Set(remoteMemos.map(m => m && m.id).filter(Boolean));
  const mtime = m => new Date(m.updatedAt || m.date || 0).getTime();
  const mergeWithTags = (winner, loser) => {
    if (!('tags' in winner) && loser && Array.isArray(loser.tags) && loser.tags.length > 0) {
      return { ...winner, tags: loser.tags };
    }
    return winner;
  };

  const merged = new Map();
  for (const m of remoteMemos) {
    if (!m) continue;
    const deletedAt = tombstones[m.id];
    if (deletedAt && new Date(deletedAt).getTime() >= mtime(m)) continue;
    merged.set(m.id, m);
  }
  for (const m of localMemos) {
    // Snapshot-based remote-deletion: id was in snapshot but absent from
    // remote now AND local hasn't been edited since last sync → accept deletion
    if (!remoteIdSet.has(m.id) && pullSnap.memos && (m.id in pullSnap.memos)) {
      const snapMtime = new Date(pullSnap.memos[m.id] || 0).getTime();
      if (mtime(m) <= snapMtime) continue;
    }
    const r = merged.get(m.id);
    if (!r) merged.set(m.id, m);
    else if (mtime(m) > mtime(r)) merged.set(m.id, mergeWithTags(m, r));
    else merged.set(m.id, mergeWithTags(r, m));
  }
  const out = [...merged.values()];
  out.sort((a, b) => mtime(b) - mtime(a));

  // Always preserve the in-progress edit (whatever timestamp comparison says)
  if (editingMemoId != null) {
    const local = localMemos.find(m => m.id === editingMemoId);
    if (local) {
      const idx = out.findIndex(m => m.id === editingMemoId);
      if (idx >= 0) out[idx] = local;
      else out.unshift(local);
    }
  }
  return out;
}

// Merge remote mindmaps into local mindmaps. Mirrors mergeMemos' protections:
// 3-way deletion detection AND tag preservation when remote lacks the field.
function mergeMindmaps(remoteMms, localMms, opts) {
  opts = opts || {};
  const pullSnapMm = opts.pullSnapMm || {};
  const remoteIdSet = new Set(remoteMms.map(m => m && m.id).filter(Boolean));
  const mergeWithTags = (winner, loser) => {
    if (!('tags' in winner) && loser && Array.isArray(loser.tags) && loser.tags.length > 0) {
      return { ...winner, tags: loser.tags };
    }
    return winner;
  };
  const map = new Map();
  for (const m of localMms) {
    if (!remoteIdSet.has(m.id) && (m.id in pullSnapMm)) {
      const snapAt = new Date(pullSnapMm[m.id] || 0).getTime();
      const localAt = new Date(m.updatedAt || 0).getTime();
      if (localAt <= snapAt) continue; // accept remote deletion
    }
    map.set(m.id, m);
  }
  for (const remote of remoteMms) {
    if (!remote?.id) continue;
    const local = map.get(remote.id);
    if (!local || new Date(remote.updatedAt || 0) >= new Date(local.updatedAt || 0)) {
      map.set(remote.id, mergeWithTags(remote, local));
    }
  }
  return [...map.values()];
}

// Compute memoIdCounter excluding artificial ids in the stable range.
// Without this, a single orphan import would inflate the counter to ~1e9 and
// `createMemo()` would emit ids colliding with future stable-artificial ids.
function recomputeMemoIdCounter(memos) {
  let maxReal = 0;
  for (const m of memos) {
    if (m && m.id && m.id < STABLE_ID_FLOOR && m.id > maxReal) maxReal = m.id;
  }
  return Math.max(maxReal, memos.length) + 1;
}

// =================== DRIVE DIFF (snapshot-based partial push) ===================
// Snapshot persists the state of what we last successfully pushed to Drive.
// computeDriveDirty returns the per-item diff so push only uploads what changed.

const DRIVE_SNAPSHOT_KEY = 'drive_push_snapshot';
// Bump when snapshot semantics change — old snapshots get wiped to force a
// full re-evaluation. History:
//   v2 (2026-05-07) — race-free capture (fixed buildSnapshotFromLocal data-loss bug)
//   v3 (2026-05-08) — driveMtimes added for 3-way conflict detection
//   v4 (2026-05-08) — tags now persisted in frontmatter; force re-push so
//                     existing Drive files get their tags written
const DRIVE_SNAPSHOT_VERSION = 4;
try {
  const v = parseInt(localStorage.getItem('mindflow_drive_snapshot_ver') || '0');
  if (v < DRIVE_SNAPSHOT_VERSION) {
    localStorage.removeItem('mindflow_' + DRIVE_SNAPSHOT_KEY);
    localStorage.setItem('mindflow_drive_snapshot_ver', String(DRIVE_SNAPSHOT_VERSION));
    // Force next push to re-evaluate everything
    localStorage.setItem('mindflow_drive_dirty', '1');
    driveDirty = true;
    // One-time legacy key cleanup
    try { localStorage.removeItem('mindflow_drive_memos_subfolder_id'); } catch {}
  }
} catch {}

function loadDriveSnapshot() {
  // driveMtimes added 2026-05-08 for 3-way conflict detection. Stores Drive's
  // server-side modifiedTime per item (separate from our local updatedAt) so
  // we can detect when another device wrote between our pushes.
  const empty = {
    memos: {}, mindmaps: {}, tbDays: {},
    journal: '', prefix: '', app: '',
    driveMtimes: { memo: {}, mindmap: {}, timeblock: {}, journal: '', prefix: '', app: '' }
  };
  try {
    const raw = localStorage.getItem('mindflow_' + DRIVE_SNAPSHOT_KEY);
    if (!raw) return empty;
    const s = JSON.parse(raw);
    const merged = { ...empty, ...s };
    merged.driveMtimes = { ...empty.driveMtimes, ...(s.driveMtimes || {}) };
    return merged;
  } catch { return empty; }
}

function saveDriveSnapshot(snap) {
  // Direct localStorage to avoid re-triggering scheduleDriveSave
  try { localStorage.setItem('mindflow_' + DRIVE_SNAPSHOT_KEY, JSON.stringify(snap)); } catch {}
}

function clearDriveSnapshot() {
  try { localStorage.removeItem('mindflow_' + DRIVE_SNAPSHOT_KEY); } catch {}
}

function computeDriveDirty() {
  const snap = loadDriveSnapshot();
  const localTbBlocks = load('tb_blocks', {});
  const localTbMeta = load('tb_meta', {});
  const localJournal = load('journal_entries', {});
  const localPrefix = load('tb_prefix_colors', {});
  const localApp = {
    activeMindmapId: load('mm_active', null),
    settings: load('settings', {})
  };

  // Memos: dirty if not yet pushed OR updatedAt > snapshot, deleted if in snap but not local
  const dirtyMemos = memos.filter(m => {
    const last = snap.memos[m.id];
    if (last === undefined) return true;
    const cur = m.updatedAt || m.date || '';
    return cur > last;
  });
  const localMemoIds = new Set(memos.map(m => m.id));
  const deletedMemoIds = Object.keys(snap.memos).map(s => parseInt(s)).filter(id => !localMemoIds.has(id));

  // Mindmaps: same pattern (mindmap.updatedAt is bumped on save in mindmap.js)
  const dirtyMindmaps = mindmaps.filter(mm => {
    const last = snap.mindmaps[mm.id];
    if (last === undefined) return true;
    const cur = mm.updatedAt || '';
    return cur > last;
  });
  const localMmIds = new Set(mindmaps.map(mm => mm.id));
  const deletedMindmapIds = Object.keys(snap.mindmaps).map(s => parseInt(s)).filter(id => !localMmIds.has(id));

  // Timeblock days: tb_meta[day] is the per-day mtime; days without meta still
  // need to push on first run (snap won't have them either, so "undefined → dirty")
  const dirtyTbDays = Object.keys(localTbBlocks).filter(day => {
    const last = snap.tbDays[day];
    if (last === undefined) return true;
    const cur = localTbMeta[day] || '';
    return cur > last;
  });
  const deletedTbDays = Object.keys(snap.tbDays).filter(day => !(day in localTbBlocks));

  // Journal: track max entry updatedAt as the journal-level mtime
  const journalMax = Object.values(localJournal).reduce((acc, e) => {
    const u = e?.updatedAt || '';
    return u > acc ? u : acc;
  }, '');
  const journalDirty = journalMax !== snap.journal;

  // Prefix colors and app meta: small singletons → string-compare
  const prefixStr = JSON.stringify(localPrefix);
  const appStr = JSON.stringify(localApp);
  const prefixDirty = prefixStr !== snap.prefix;
  const appDirty = appStr !== snap.app;

  const isEmpty =
    !dirtyMemos.length && !deletedMemoIds.length &&
    !dirtyMindmaps.length && !deletedMindmapIds.length &&
    !dirtyTbDays.length && !deletedTbDays.length &&
    !journalDirty && !prefixDirty && !appDirty;

  return {
    dirtyMemos, deletedMemoIds,
    dirtyMindmaps, deletedMindmapIds,
    dirtyTbDays, deletedTbDays,
    journalDirty, journalMax,
    prefixDirty, prefixStr,
    appDirty, appStr,
    localTbBlocks, localTbMeta,
    isEmpty
  };
}

// (Removed buildSnapshotFromLocal — it caused data loss when user typed during
// push: it read live `memos[i].updatedAt` AFTER the await, which may be newer
// than what we actually uploaded. The next push would then mistakenly think the
// new mtime is already on Drive, skip the upload, and the user's edits would
// vanish on the next session start. Snapshot is now built from values captured
// in the SAME synchronous tick as the upload — see drivePushAll below.)

// =================== CONFLICT FORKERS ===================
// When push detects another device wrote between our pushes, we fork their
// version into a local "conflict copy" so the user can see both. Local original
// continues to push normally; the copy gets pushed in the next push cycle as
// a brand-new item (fresh id, no snapshot entry → flagged dirty).

// Returns true if remote file content is essentially the same as what we'd
// have just pushed — used to skip spurious fork when Drive's modifiedTime
// bumped from a metadata-only change (rename, appProperties patch).
function _memoContentMatches(remoteText, localContent, localMemo) {
  if (!remoteText) return false;
  // Compare body only (strip frontmatter from both, since updated timestamps differ)
  const stripFm = s => {
    const m = s.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?([\s\S]*)$/);
    return m ? m[1] : s;
  };
  const a = stripFm(remoteText).trim();
  const b = (localMemo.content || '').trim();
  return a === b;
}

async function _forkMemoConflict(driveFile, alreadyDownloadedContent) {
  try {
    const content = alreadyDownloadedContent || await driveClient.download(driveFile.id);
    const remoteMemo = (typeof window.SyncAdapters !== 'undefined')
      ? window.SyncAdapters.Memo.parse(driveFile, content)
      : (typeof parseFrontmatter === 'function' ? parseFrontmatter(content, driveFile.name, Date.now()) : null);
    if (!remoteMemo) return;
    if (typeof memoIdCounter === 'undefined') return;
    const copy = window.SyncAdapters.Memo.createConflictCopy(remoteMemo, {
      nextMemoId: () => memoIdCounter++
    });
    if (typeof memos !== 'undefined' && Array.isArray(memos)) {
      memos.unshift(copy);
      try {
        localStorage.setItem('mindflow_memos', JSON.stringify(memos));
        localStorage.setItem('mindflow_memo_idcounter', JSON.stringify(memoIdCounter));
      } catch {}
    }
    driveConflictsCount++;
    driveConflictsThisSession.push({ type: 'memo', title: copy.title });
    console.warn('[Sync] Memo conflict forked:', copy.title);
  } catch (e) { console.warn('Memo conflict fork failed:', e); }
}

async function _forkMindmapConflict(driveFile) {
  try {
    const content = await driveClient.download(driveFile.id);
    const remoteMm = JSON.parse(content);
    if (!remoteMm || !remoteMm.id) return;
    const copy = window.SyncAdapters.Mindmap.createConflictCopy(remoteMm);
    if (typeof mindmaps !== 'undefined' && Array.isArray(mindmaps)) {
      mindmaps.push(copy);
      try { localStorage.setItem('mindflow_mindmaps', JSON.stringify(mindmaps)); } catch {}
    }
    driveConflictsCount++;
    driveConflictsThisSession.push({ type: 'mindmap', title: copy.name });
    console.warn('[Sync] Mindmap conflict forked:', copy.name);
  } catch (e) { console.warn('Mindmap conflict fork failed:', e); }
}

async function _forkTimeblockConflict(driveFile, dayKey) {
  try {
    const content = await driveClient.download(driveFile.id);
    const remoteData = JSON.parse(content);
    if (!remoteData || !remoteData.blocks) return;
    const copy = window.SyncAdapters.Timeblock.createConflictCopy({
      dayKey, blocks: remoteData.blocks, updatedAt: remoteData.updatedAt
    });
    if (typeof timeBlocks !== 'undefined') {
      timeBlocks[copy.dayKey] = copy.blocks;
      try { localStorage.setItem('mindflow_tb_blocks', JSON.stringify(timeBlocks)); } catch {}
      const meta = load('tb_meta', {});
      meta[copy.dayKey] = copy.updatedAt;
      try { localStorage.setItem('mindflow_tb_meta', JSON.stringify(meta)); } catch {}
    }
    driveConflictsCount++;
    driveConflictsThisSession.push({ type: 'timeblock', title: copy.dayKey });
    console.warn('[Sync] Timeblock conflict forked:', copy.dayKey);
  } catch (e) { console.warn('Timeblock conflict fork failed:', e); }
}

// =================== DRIVE CLEANUP / DEDUP TOOL ===================
// Audits Drive against local memos and:
//   1. Removes Drive duplicates (multiple files with same memoId — keep newest)
//   2. Removes Drive orphans (files we don't recognize anymore)
//   3. Merges memos with identical/similar content into one (locally) and pushes
//      the merge result, deleting the redundant Drive files
// Pre-cleanup backup is created automatically. Confirms before destructive ops.
async function cleanupDriveDuplicates() {
  if (!driveFolderId) { toast('먼저 Drive 연결하세요'); return; }
  if (!driveClient.hasValidToken()) {
    try { await driveClient.ensureToken(); }
    catch { toast('인증이 필요해요. 동기화 버튼을 먼저 눌러주세요', 'error'); return; }
  }
  toast('Drive 분석 중...');
  const { memoFiles } = await driveListAllFiles();

  // Group Drive files by memoId
  const groups = new Map();  // id → [files]
  const noIdFiles = [];
  for (const f of memoFiles) {
    const propId = f.appProperties?.memoId ? parseInt(f.appProperties.memoId) : null;
    const fnId = parseMemoIdFromFilename(f.name);
    const id = propId || fnId;
    if (!id) { noIdFiles.push(f); continue; }
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(f);
  }

  // Stats
  const localIds = new Set((memos || []).map(m => m.id));
  const driveDupes = [];   // extra files for an id (keep newest)
  const driveOrphans = []; // file's id is not in local memos
  for (const [id, fs] of groups) {
    fs.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
    if (!localIds.has(id)) {
      // Whole group is orphan
      fs.forEach(f => driveOrphans.push(f));
    } else {
      // Keep newest, rest are dupes
      for (let i = 1; i < fs.length; i++) driveDupes.push(fs[i]);
    }
  }

  // Find local memos with identical title+content (true duplicates)
  const fingerprintMap = new Map();
  const localDupes = [];  // memos to merge into another
  for (const m of memos || []) {
    const fp = (m.title || '').trim().toLowerCase() + '\n' + (m.content || '').trim();
    if (!fp.replace(/\s/g, '').length) continue; // skip empty
    if (fingerprintMap.has(fp)) {
      localDupes.push({ keep: fingerprintMap.get(fp), drop: m });
    } else {
      fingerprintMap.set(fp, m);
    }
  }

  // Find similar (same title) — for tag union
  const titleMap = new Map();
  const titleMerges = []; // {primary, others} — same title, different content
  for (const m of memos || []) {
    const t = (m.title || '').trim();
    if (!t) continue;
    if (!titleMap.has(t)) titleMap.set(t, []);
    titleMap.get(t).push(m);
  }
  for (const [, group] of titleMap) {
    if (group.length > 1) {
      // Already-counted exact dupes excluded; only those with different content
      const exactDropIds = new Set(localDupes.map(d => d.drop.id));
      const remaining = group.filter(g => !exactDropIds.has(g.id));
      if (remaining.length > 1) {
        titleMerges.push({ primary: remaining[0], others: remaining.slice(1) });
      }
    }
  }

  const summary =
    `🔍 Drive 분석 결과\n\n` +
    `Drive 파일: 총 ${memoFiles.length}개\n` +
    `  ├ ID 누락: ${noIdFiles.length}개\n` +
    `  ├ 중복 (같은 메모): ${driveDupes.length}개\n` +
    `  └ 고아 (로컬 없음): ${driveOrphans.length}개\n\n` +
    `로컬 메모 분석:\n` +
    `  ├ 완전 동일 메모: ${localDupes.length}쌍\n` +
    `  └ 같은 제목 다른 내용: ${titleMerges.length}그룹\n\n` +
    `자동 정리할 작업:\n` +
    `  • Drive 중복 ${driveDupes.length}개 삭제\n` +
    `  • Drive 고아 ${driveOrphans.length}개 삭제 (로컬에 없는 메모 파일)\n` +
    `  • 로컬 동일 메모 ${localDupes.length}쌍 합치기 (태그 union)\n` +
    `\n` +
    `같은 제목이지만 내용 다른 그룹은 자동 처리 안 합니다. 콘솔 출력으로 확인하세요.\n\n` +
    `진행할까요? (자동 백업 생성됩니다)`;

  console.log('=== Drive cleanup analysis ===');
  console.log('driveDupes:', driveDupes.map(f => f.name));
  console.log('driveOrphans:', driveOrphans.map(f => f.name));
  console.log('localDupes:', localDupes.map(d => `${d.drop.id} → ${d.keep.id} (${d.keep.title})`));
  console.log('titleMerges (수동 검토):', titleMerges.map(g => `"${g.primary.title}" — ${g.others.length}개 더 있음`));

  if (!confirm(summary)) return;

  // Pre-cleanup backup
  if (typeof BackupService !== 'undefined') {
    try { await BackupService.snapshot('pre-drive-cleanup'); } catch {}
  }

  let deletedDriveCount = 0;
  // Delete Drive dupes + orphans
  await batchAll([...driveDupes, ...driveOrphans], async f => {
    try { await driveClient.delete(f.id); deletedDriveCount++; }
    catch (e) { console.warn('Cleanup delete failed:', f.name, e.message); }
  });

  // Merge local exact-dupes (drop into keep, union tags)
  let mergedLocalCount = 0;
  const tombs = load('memo_tombstones', {});
  const now = new Date().toISOString();
  for (const { keep, drop } of localDupes) {
    keep.tags = Array.from(new Set([...(keep.tags || []), ...(drop.tags || [])]));
    touchMemo(keep);
    tombs[drop.id] = now;
    mergedLocalCount++;
  }
  if (mergedLocalCount > 0) {
    const dropIds = new Set(localDupes.map(d => d.drop.id));
    memos = memos.filter(m => !dropIds.has(m.id));
    save('memo_tombstones', tombs);
    saveMemos();
  }

  // Refresh UI
  if (window.SyncEvents) {
    SyncEvents.emit('itemsMerged', { types: ['memo'] });
  }

  toast(`Drive 정리: ${deletedDriveCount}개 삭제, 로컬 ${mergedLocalCount}쌍 합침. Drive 동기화 중...`, 'success');
  // Trigger push to propagate local changes (tag unions, memo merges) to Drive
  if (typeof scheduleDriveSave === 'function') scheduleDriveSave();
}

// User-facing cleanup tool: remove conflict copies that were spuriously created
// by the pre-fix sync bug. Identifies by:
//   - memos with #conflict tag OR title containing "(충돌"
//   - mindmaps with name containing "(충돌"
//   - timeblock days with "__conflict__" in dayKey
// After local cleanup, schedules a push so Drive matches.
async function cleanupSyncConflicts() {
  const memosToDelete = (memos || []).filter(m =>
    (m.tags || []).includes('conflict') || (m.title || '').includes('(충돌')
  );
  const mmsToDelete = (mindmaps || []).filter(mm => (mm.name || '').includes('(충돌'));
  const tbDaysToDelete = Object.keys(timeBlocks || {}).filter(d => d.includes('__conflict__'));
  const total = memosToDelete.length + mmsToDelete.length + tbDaysToDelete.length;
  if (total === 0) {
    toast('정리할 충돌 사본이 없어요', 'success');
    return;
  }
  const msg = `충돌 사본 정리:\n` +
    `• 메모 ${memosToDelete.length}개\n` +
    `• 마인드맵 ${mmsToDelete.length}개\n` +
    `• 타임블록 ${tbDaysToDelete.length}일\n\n` +
    `복원 가능한 백업이 자동 생성된 후 삭제됩니다. 계속하시겠습니까?`;
  if (!confirm(msg)) return;
  // Pre-cleanup backup
  if (typeof BackupService !== 'undefined') {
    try { await BackupService.snapshot('pre-cleanup'); } catch {}
  }
  // Delete memos via tombstone path (so Drive sync removes them too)
  const tombs = load('memo_tombstones', {});
  for (const m of memosToDelete) {
    tombs[m.id] = new Date().toISOString();
  }
  save('memo_tombstones', tombs);
  memos = (memos || []).filter(m => !memosToDelete.find(d => d.id === m.id));
  save('memos', memos);
  // Delete mindmaps
  if (mmsToDelete.length > 0) {
    mindmaps = (mindmaps || []).filter(mm => !mmsToDelete.find(d => d.id === mm.id));
    save('mindmaps', mindmaps);
    if (typeof bindActiveMap === 'function') bindActiveMap();
  }
  // Delete timeblock days
  for (const d of tbDaysToDelete) {
    delete timeBlocks[d];
    const meta = load('tb_meta', {});
    delete meta[d];
    save('tb_meta', meta);
  }
  if (tbDaysToDelete.length > 0) save('tb_blocks', timeBlocks);
  // Trigger sync to propagate deletions to Drive
  toast(`로컬 정리 완료 (${total}개) — Drive에 반영 중...`, 'success');
  if (typeof scheduleDriveSave === 'function') scheduleDriveSave();
  // UI refresh
  if (window.SyncEvents) {
    SyncEvents.emit('itemsMerged', { types: ['memo', 'mindmap', 'timeblock'] });
  }
}

function _flushConflictNotifications() {
  if (driveConflictsThisSession.length === 0) return;
  const n = driveConflictsThisSession.length;
  const types = [...new Set(driveConflictsThisSession.map(c => c.type))].join(', ');
  if (typeof toast === 'function') {
    toast(`⚠️ 충돌 ${n}개 감지 — 양쪽 버전 모두 보존했습니다 (${types})`, 'error');
  }
  driveConflictsThisSession = [];
}

async function drivePushAll() {
  if (!driveFolderId || isLoadingFromDrive || isPushingToDrive) {
    // Caller may have pre-set 'saving' (e.g. driveConnect). If we're skipping
    // here, don't leave the pill misrepresenting an in-flight operation.
    if (driveStatus === 'saving' && !isPushingToDrive) setDriveStatus('idle');
    return;
  }

  // Compute diff first — if nothing changed, skip the entire push (no API calls)
  const diff = computeDriveDirty();
  if (diff.isEmpty) {
    if (driveStatus === 'saving') setDriveStatus('idle');
    return;
  }

  // Safety net: snapshot localStorage before mutating Drive. Non-blocking — even
  // if backup fails the push still proceeds (we don't want to brick sync over a
  // backup issue). User can restore from this snapshot if push corrupts data.
  if (typeof BackupService !== 'undefined') {
    BackupService.safeSnapshot('pre-push').catch(() => {});
  }

  isPushingToDrive = true;
  try {
    setDriveStatus('saving');

    // Single listing — categorized by parent (root + per-type subfolders)
    const { rootFiles, memoFiles, mindmapFiles, timeblockFiles } = await driveListAllFiles();
    // byName maps singletons (journal.json, _mindflow-app.json, prefix-colors)
    const byName = new Map();
    for (const f of rootFiles) byName.set(f.name, f);
    // mindmapByName / timeblockByName look up files in their dedicated folders
    // (with fallback to root files of matching pattern, for half-migrated state)
    const mindmapByName = new Map();
    for (const f of mindmapFiles) {
      if (!mindmapByName.has(f.name)) mindmapByName.set(f.name, f);
    }
    const timeblockByName = new Map();
    for (const f of timeblockFiles) {
      if (!timeblockByName.has(f.name)) timeblockByName.set(f.name, f);
    }

    // Group memo files by id (memos/ subfolder + leaked root .md) to detect
    // Drive-side duplicates and clean them up. Prefers files inside memos/.
    // Use the same id-recovery chain as the parse layer (incl. stableMemoId
    // fallback) so orphan/external .md files still match push-time lookups —
    // otherwise push couldn't find them and would create a 2nd file.
    const idGroups = new Map();
    for (const f of memoFiles) {
      const id = recoverMemoIdFromFile(f);
      if (!id) continue;
      const inMemosFolder = (f.parents?.[0] === driveMemosFolderId);
      if (!idGroups.has(id)) idGroups.set(id, []);
      idGroups.get(id).push({ f, src: inMemosFolder ? 'memos' : 'root' });
    }
    const byMemoId = new Map();
    const driveDuplicates = []; // files queued for deletion as Drive-side dupes
    for (const [id, group] of idGroups) {
      if (group.length === 1) {
        byMemoId.set(id, group[0].f);
        continue;
      }
      // Multiple files claim same memo id → keep newest, prefer the one in
      // the canonical memos/ subfolder when timestamps tie.
      group.sort((a, b) => {
        const t = (b.f.modifiedTime || '').localeCompare(a.f.modifiedTime || '');
        if (t !== 0) return t;
        return (a.src === 'memos' ? -1 : 1) - (b.src === 'memos' ? -1 : 1);
      });
      byMemoId.set(id, group[0].f);
      for (let i = 1; i < group.length; i++) driveDuplicates.push(group[i].f);
    }

    // Track max modifiedTime returned from upload responses so we can update
    // the polling sentinel without an extra listing call after push.
    let maxMtime = '';
    const trackMtime = res => {
      if (res?.modifiedTime && res.modifiedTime > maxMtime) maxMtime = res.modifiedTime;
      pingDriveSavingProgress(); // extend watchdog while uploads are progressing
      if (driveProgress) {
        driveProgress.uploaded++;
        // Refresh pill so user sees the count tick up
        updateHeaderSyncPill();
      }
    };

    // Total items being uploaded — for "N/M" progress display
    const totalToUpload =
      (diff.journalDirty ? 1 : 0) +
      (diff.prefixDirty ? 1 : 0) +
      (diff.appDirty ? 1 : 0) +
      diff.dirtyMindmaps.length +
      diff.dirtyTbDays.length +
      diff.dirtyMemos.length;
    driveProgress = { uploaded: 0, total: totalToUpload };
    updateHeaderSyncPill();

    // Build the new snapshot incrementally as items upload successfully. Start
    // from the OLD snapshot — items we don't touch here keep their old recorded
    // mtimes. Each upload captures its actual uploaded mtime in the SAME
    // synchronous tick it reads content, so race-free by construction.
    const oldSnap = loadDriveSnapshot();
    const newSnap = {
      memos: { ...oldSnap.memos },
      mindmaps: { ...oldSnap.mindmaps },
      tbDays: { ...oldSnap.tbDays },
      journal: oldSnap.journal || '',
      prefix: oldSnap.prefix || '',
      app: oldSnap.app || '',
      driveMtimes: {
        memo: { ...(oldSnap.driveMtimes?.memo || {}) },
        mindmap: { ...(oldSnap.driveMtimes?.mindmap || {}) },
        timeblock: { ...(oldSnap.driveMtimes?.timeblock || {}) },
        journal: oldSnap.driveMtimes?.journal || '',
        prefix: oldSnap.driveMtimes?.prefix || '',
        app: oldSnap.driveMtimes?.app || ''
      }
    };

    // Journal — capture data + max mtime atomically
    if (diff.journalDirty) {
      const localJ = load('journal_entries', {});
      const newJournalMax = Object.values(localJ).reduce((acc, e) => {
        const u = e?.updatedAt || '';
        return u > acc ? u : acc;
      }, '');
      const journalData = JSON.stringify({ entries: localJ, exportedAt: new Date().toISOString() }, null, 2);
      const journalFile = byName.get('journal.json');
      const res = journalFile
        ? await driveUpdateFile(journalFile.id, journalData, 'application/json')
        : await driveUploadFile('journal.json', journalData, 'application/json', driveFolderId);
      trackMtime(res);
      newSnap.journal = newJournalMax;
      if (res?.modifiedTime) newSnap.driveMtimes.journal = res.modifiedTime;
    }

    // Prefix color mapping — capture stringified state atomically
    if (diff.prefixDirty) {
      const prefixStr = JSON.stringify(load('tb_prefix_colors', {}));
      const prefixFile = byName.get('tb-prefix-colors.json');
      const res = prefixFile
        ? await driveUpdateFile(prefixFile.id, prefixStr, 'application/json')
        : await driveUploadFile('tb-prefix-colors.json', prefixStr, 'application/json', driveFolderId);
      trackMtime(res);
      newSnap.prefix = prefixStr;
      if (res?.modifiedTime) newSnap.driveMtimes.prefix = res.modifiedTime;
    }

    // App meta — capture stringified state atomically
    if (diff.appDirty) {
      const appLive = {
        activeMindmapId: load('mm_active', null),
        settings: load('settings', {})
      };
      const appStr = JSON.stringify(appLive);
      const appData = { version: 3, app: 'mindflow', exportedAt: new Date().toISOString(), ...appLive };
      const appJson = JSON.stringify(appData, null, 2);
      const appFile = byName.get(DRIVE_APP_FILENAME);
      const res = appFile
        ? await driveUpdateFile(appFile.id, appJson, 'application/json')
        : await driveUploadFile(DRIVE_APP_FILENAME, appJson, 'application/json', driveFolderId);
      trackMtime(res);
      newSnap.app = appStr;
      if (res?.modifiedTime) newSnap.driveMtimes.app = res.modifiedTime;
    }

    // Mindmaps — uploaded into MindFlow/mindmaps/
    // 3-way conflict check: if Drive's modifiedTime differs from our last-known,
    // another writer was here. Fork their version as conflict copy before we overwrite.
    await batchAll(diff.dirtyMindmaps, async mm => {
      const capturedMtime = mm.updatedAt || '';
      const fname = `mindmap-${mm.id}.json`;
      const body = JSON.stringify(mm, null, 2);
      const existing = mindmapByName.get(fname);
      if (existing) {
        const lastDriveMtime = oldSnap.driveMtimes?.mindmap?.[mm.id];
        const isAlreadyConflict = (mm.name || '').includes('(충돌');
        if (!isAlreadyConflict && lastDriveMtime && existing.modifiedTime && existing.modifiedTime !== lastDriveMtime) {
          // Compare content first — skip fork if Drive's content matches local
          try {
            const remoteText = await driveClient.download(existing.id);
            if (remoteText.trim() !== body.trim()) {
              await _forkMindmapConflict(existing);
            }
          } catch (e) { console.warn('[Conflict mm] download failed:', e); }
        }
        const res = await driveUpdateFile(existing.id, body, 'application/json');
        trackMtime(res);
        if (res?.modifiedTime) newSnap.driveMtimes.mindmap[mm.id] = res.modifiedTime;
      } else {
        const res = await driveUploadFile(fname, body, 'application/json', driveMindmapsFolderId || driveFolderId);
        trackMtime(res);
        if (res?.modifiedTime) newSnap.driveMtimes.mindmap[mm.id] = res.modifiedTime;
      }
      newSnap.mindmaps[mm.id] = capturedMtime;
    });
    await batchAll(diff.deletedMindmapIds, async id => {
      const f = mindmapByName.get(`mindmap-${id}.json`);
      if (!f) {
        delete newSnap.mindmaps[id];
        delete newSnap.driveMtimes.mindmap[id];
        return;
      }
      try {
        await driveDeleteFile(f.id);
        delete newSnap.mindmaps[id];
        delete newSnap.driveMtimes.mindmap[id];
      } catch (e) {
        console.warn('[Sync] Mindmap delete failed for id', id, '— keeping in snapshot:', e.message);
      }
    });

    // Timeblocks — uploaded into MindFlow/timeblocks/
    await batchAll(diff.dirtyTbDays, async dayKey => {
      const capturedMtime = diff.localTbMeta[dayKey] || new Date().toISOString();
      const blocksSnapshot = diff.localTbBlocks[dayKey];
      const fname = `timeblock-${dayKey}.json`;
      const payload = JSON.stringify({ blocks: blocksSnapshot, updatedAt: capturedMtime }, null, 2);
      const existing = timeblockByName.get(fname);
      if (existing) {
        const lastDriveMtime = oldSnap.driveMtimes?.timeblock?.[dayKey];
        const isAlreadyConflict = dayKey.includes('__conflict__');
        if (!isAlreadyConflict && lastDriveMtime && existing.modifiedTime && existing.modifiedTime !== lastDriveMtime) {
          try {
            const remoteText = await driveClient.download(existing.id);
            if (remoteText.trim() !== payload.trim()) {
              await _forkTimeblockConflict(existing, dayKey);
            }
          } catch (e) { console.warn('[Conflict tb] download failed:', e); }
        }
        const res = await driveUpdateFile(existing.id, payload, 'application/json');
        trackMtime(res);
        if (res?.modifiedTime) newSnap.driveMtimes.timeblock[dayKey] = res.modifiedTime;
      } else {
        const res = await driveUploadFile(fname, payload, 'application/json', driveTimeblocksFolderId || driveFolderId);
        trackMtime(res);
        if (res?.modifiedTime) newSnap.driveMtimes.timeblock[dayKey] = res.modifiedTime;
      }
      newSnap.tbDays[dayKey] = capturedMtime;
    });
    await batchAll(diff.deletedTbDays, async day => {
      const f = timeblockByName.get(`timeblock-${day}.json`);
      if (!f) {
        delete newSnap.tbDays[day];
        delete newSnap.driveMtimes.timeblock[day];
        return;
      }
      try {
        await driveDeleteFile(f.id);
        delete newSnap.tbDays[day];
        delete newSnap.driveMtimes.timeblock[day];
      } catch (e) {
        console.warn('[Sync] Timeblock delete failed for', day, '— keeping in snapshot:', e.message);
      }
    });

    // Memos — build dedup'd filename map for the FULL memo set so dirty memos
    // get consistent rename targets even when their neighbors aren't being pushed
    const usedNames = new Set([DRIVE_APP_FILENAME, 'journal.json', 'tb-prefix-colors.json']);
    const memoFilenames = new Map();
    for (const memo of memos) {
      const base = sanitizeDriveName(memo.title);
      let fname = `${base}.md`;
      let n = 2;
      while (usedNames.has(fname)) { fname = `${base} (${n}).md`; n++; }
      usedNames.add(fname);
      memoFilenames.set(memo.id, fname);
    }

    await batchAll(diff.dirtyMemos, async memo => {
      // CRITICAL: capture updated and the body string in ONE synchronous tick.
      const capturedMtime = memo.updatedAt || memo.date || '';
      const fname = memoFilenames.get(memo.id);
      const tagsLine = (memo.tags && memo.tags.length)
        ? `\ntags: [${memo.tags.map(t => JSON.stringify(t)).join(', ')}]`
        : '';
      const content = `---\nid: ${memo.id}\ntitle: ${(memo.title || '').replace(/\n/g, ' ')}\ndate: ${memo.date}\nupdated: ${capturedMtime}${tagsLine}\n---\n\n${memo.content || ''}`;
      const existing = byMemoId.get(memo.id) || byName.get(fname);
      if (existing) {
        // 3-way conflict check: did another device edit this file between our
        // pushes? Compare Drive's modifiedTime to what we recorded on last push.
        // Skip fork if remote content is byte-identical (metadata-only Drive
        // change, e.g. our own previous PATCH bumped mtime without our seeing it).
        // Skip fork if this is a conflict copy already (avoid recursive forking).
        const isAlreadyConflict = (memo.tags || []).includes('conflict');
        const lastDriveMtime = oldSnap.driveMtimes?.memo?.[memo.id];
        if (!isAlreadyConflict && lastDriveMtime && existing.modifiedTime && existing.modifiedTime !== lastDriveMtime) {
          try {
            const remoteContent = await driveClient.download(existing.id);
            // Compare normalized content — if same, no real conflict
            if (_memoContentMatches(remoteContent, content, memo)) {
              // metadata-only drift, no fork needed
            } else {
              await _forkMemoConflict(existing, remoteContent);
            }
          } catch (e) { console.warn('[Conflict] download failed:', e); }
        }
        const res = await driveUpdateFile(existing.id, content, 'text/markdown');
        trackMtime(res);
        let finalMtime = res?.modifiedTime;
        const needsRename = existing.name !== fname;
        const needsProp = !existing.appProperties?.memoId;
        if (needsRename || needsProp) {
          const patch = {};
          if (needsRename) patch.name = fname;
          if (needsProp) patch.appProperties = { memoId: String(memo.id) };
          try {
            // CRITICAL: capture PATCH's modifiedTime — it bumps mtime higher than
            // the prior driveUpdateFile. Without this, next push sees a spurious
            // conflict and forks the file repeatedly → "duplicate every push" bug.
            const patchRes = await driveApi('PATCH', `/files/${existing.id}`, patch, { fields: 'id,modifiedTime' });
            if (patchRes?.modifiedTime) finalMtime = patchRes.modifiedTime;
          } catch (e) { console.warn('Metadata patch failed:', e); }
        }
        if (finalMtime) newSnap.driveMtimes.memo[memo.id] = finalMtime;
      } else {
        const res = await driveUploadFile(fname, content, 'text/markdown', driveMemosFolderId || driveFolderId, { memoId: String(memo.id) });
        trackMtime(res);
        if (res?.modifiedTime) newSnap.driveMtimes.memo[memo.id] = res.modifiedTime;
      }
      newSnap.memos[memo.id] = capturedMtime;
    });

    // Memo deletions — driven by snapshot diff (we know we previously pushed these).
    // Track which IDs actually got removed from Drive so we don't lie to the
    // snapshot/tombstone bookkeeping. Failed deletes stay in snap → next push retries.
    const successfullyDeletedMemoIds = new Set();
    await batchAll(diff.deletedMemoIds, async id => {
      const f = byMemoId.get(id);
      if (!f) {
        // File already absent on Drive — treat as deleted
        successfullyDeletedMemoIds.add(id);
        return;
      }
      try {
        await driveDeleteFile(f.id);
        successfullyDeletedMemoIds.add(id);
      } catch (e) {
        console.warn('[Sync] Memo delete failed for id', id, '— keeping in snapshot for retry:', e.message);
      }
    });
    for (const id of successfullyDeletedMemoIds) {
      delete newSnap.memos[id];
      delete newSnap.driveMtimes.memo[id];
    }

    // Drive-side duplicate cleanup: delete extra files that all map to the same
    // memo id. Failures get logged but don't break the push.
    if (driveDuplicates.length > 0) {
      console.log(`Cleaning up ${driveDuplicates.length} Drive duplicate file(s)`);
      await batchAll(driveDuplicates, async f => {
        try { await driveDeleteFile(f.id); }
        catch (e) { console.warn('[Sync] Duplicate cleanup failed:', f.name, e.message); }
      });
    }

    // Clear tombstones ONLY for memos whose Drive file deletion actually succeeded.
    // If a delete fails (network glitch, permission), keeping the tombstone protects
    // against the next pull resurrecting the memo from a Drive file that's still
    // present. Stale tombstones are tiny (just timestamps) — safe to keep.
    try {
      const tombs = load('memo_tombstones', {});
      let changed = false;
      for (const id of successfullyDeletedMemoIds) {
        if (tombs[id]) { delete tombs[id]; changed = true; }
      }
      if (changed) {
        localStorage.setItem('mindflow_memo_tombstones', JSON.stringify(tombs));
      }
    } catch {}

    driveLastPushAt = Date.now();
    driveLastSyncAt = driveLastPushAt;
    // Update polling sentinel from upload mtimes (no extra listing call)
    if (maxMtime && maxMtime > (driveLastModifiedTime || '')) driveLastModifiedTime = maxMtime;

    // Snapshot reflects the state we just pushed — used to compute next diff
    saveDriveSnapshot(newSnap);

    // Surface conflicts that were forked during this push (if any)
    _flushConflictNotifications();

    driveProgress = null;
    setDriveStatus('saved');
    setTimeout(() => { if (driveStatus === 'saved') setDriveStatus('idle') }, 1800);
  } catch (e) {
    console.error('Drive push failed:', e);
    driveProgress = null;
    setDriveStatus('error');
    toast('Drive 동기화 실패: ' + e.message, 'error');
    throw e;
  } finally {
    isPushingToDrive = false;
  }
}

async function applyDriveData(files) {
  // Safety net: snapshot localStorage before merging Drive data into local.
  // Independent from sync logic — non-blocking.
  if (typeof BackupService !== 'undefined') {
    BackupService.safeSnapshot('pre-pull').catch(() => {});
  }
  isLoadingFromDrive = true;
  try {
    // Capture focus so we can restore it after renders disrupt the DOM
    const focusedEl = document.activeElement;
    const focusSel = (focusedEl && focusedEl.setSelectionRange)
      ? { start: focusedEl.selectionStart, end: focusedEl.selectionEnd } : null;

    const ae = focusedEl;
    // The user is "editing" if focus is anywhere inside the memo editor — this
    // includes the CodeMirror live editor (a contenteditable <div>, not a
    // <textarea>), the raw textarea, the title input and the tag input.
    // Missing the contenteditable case caused the editor to be rebuilt
    // mid-typing on every sync — wiping the cursor / IME composition.
    const editingMemoId = (ae && ae.closest && ae.closest('.memo-editor'))
      ? activeMemoId : null;

    // Classify files by type
    const remoteMmFiles = files.filter(f => f.name.startsWith('mindmap-') && f.name.endsWith('.json'));
    const remoteTbFiles = files.filter(f => f.name.startsWith('timeblock-') && f.name.endsWith('.json'));
    const appFile = files.find(f => f.name === DRIVE_APP_FILENAME);
    const journalF = files.find(f => f.name === 'journal.json');
    const prefixF = files.find(f => f.name === 'tb-prefix-colors.json');
    const mdFiles = files.filter(f => f.name.toLowerCase().endsWith('.md'));

    // Download everything in batches of 8 concurrent — fast but rate-limit safe
    const [mmRaws, tbRaws, mdRaws, appParsed, journalParsed, prefixParsed] = await Promise.all([
      batchAll(remoteMmFiles, f =>
        driveDownloadFile(f.id).then(t => JSON.parse(t)).catch(() => null)),
      batchAll(remoteTbFiles, async f => {
        const dayKey = f.name.slice('timeblock-'.length, -'.json'.length);
        try { return { dayKey, ...JSON.parse(await driveDownloadFile(f.id)) }; } catch { return null; }
      }),
      batchAll(mdFiles, async f => {
        // Carry appProperties + filename so we can recover the memo id even if
        // the markdown frontmatter is missing/corrupt — prevents duplicate-memo
        // explosion when files lose their `id:` line.
        try { return { text: await driveDownloadFile(f.id), name: f.name, appProperties: f.appProperties, modifiedTime: f.modifiedTime }; } catch { return null; }
      }),
      appFile ? driveDownloadFile(appFile.id).then(t => JSON.parse(t)).catch(() => null) : Promise.resolve(null),
      journalF ? driveDownloadFile(journalF.id).then(t => JSON.parse(t)).catch(() => null) : Promise.resolve(null),
      prefixF ? driveDownloadFile(prefixF.id).then(t => JSON.parse(t)).catch(() => null) : Promise.resolve(null),
    ]);

    // Snapshot loaded once for all 3-way deletion detections below
    // (memo/mindmap/timeblock all read it). Must be declared BEFORE the merges
    // — earlier const TDZ caused every pull to ReferenceError silently, which
    // is what kept resurrecting "deleted" items across devices.
    const pullSnap = (typeof loadDriveSnapshot === 'function') ? loadDriveSnapshot() : { memos: {}, mindmaps: {}, tbDays: {} };

    // --- Mindmaps ---
    const legacyApp = (appParsed?.app === 'mindflow') ? appParsed : null;
    if (remoteMmFiles.length > 0) {
      // Shared mindmap merge — tombstone-equivalent (3-way deletion via snap)
      // + tag preservation when remote lacks the field (otherwise tags vanish
      // every time another device that doesn't carry tags wins the timestamp).
      mindmaps = mergeMindmaps(mmRaws.filter(r => r?.id), mindmaps, {
        pullSnapMm: pullSnap.mindmaps || {},
      });
      activeMindmapId = mindmaps.find(m => m.id === activeMindmapId)?.id ?? mindmaps[0]?.id ?? null;
      localStorage.setItem('mindflow_mindmaps', JSON.stringify(mindmaps));
      localStorage.setItem('mindflow_mm_active', JSON.stringify(activeMindmapId));
      bindActiveMap();
    } else if (legacyApp?.mindmaps) {
      mindmaps = legacyApp.mindmaps;
      activeMindmapId = legacyApp.activeMindmapId ?? mindmaps[0]?.id ?? null;
      localStorage.setItem('mindflow_mindmaps', JSON.stringify(mindmaps));
      localStorage.setItem('mindflow_mm_active', JSON.stringify(activeMindmapId));
      bindActiveMap();
    }

    // --- Timeblocks ---
    if (remoteTbFiles.length > 0) {
      const localTbMeta = load('tb_meta', {});
      const tbSnap = pullSnap.tbDays || {};
      const remoteTbDaySet = new Set(tbRaws.filter(r => r?.dayKey).map(r => r.dayKey));
      // Detect remote deletion: day was in snap but not in remote anymore
      for (const day of Object.keys(timeBlocks)) {
        if (!remoteTbDaySet.has(day) && (day in tbSnap)) {
          const snapAt = new Date(tbSnap[day] || 0).getTime();
          const localAt = new Date(localTbMeta[day] || 0).getTime();
          if (localAt <= snapAt) {
            // Another device deleted this day; local hasn't changed → accept
            delete timeBlocks[day];
            delete localTbMeta[day];
          }
        }
      }
      for (const r of tbRaws) {
        if (!r) continue;
        const lAt = localTbMeta[r.dayKey];
        if (!lAt || new Date(r.updatedAt || 0) >= new Date(lAt)) {
          timeBlocks[r.dayKey] = r.blocks;
          if (r.updatedAt) localTbMeta[r.dayKey] = r.updatedAt;
        }
      }
      localStorage.setItem('mindflow_tb_blocks', JSON.stringify(timeBlocks));
      save('tb_meta', localTbMeta);
    } else if (legacyApp?.timeBlocks) {
      timeBlocks = legacyApp.timeBlocks;
      localStorage.setItem('mindflow_tb_blocks', JSON.stringify(timeBlocks));
    }

    // --- Settings ---
    if (appParsed?.app === 'mindflow' && appParsed.settings) {
      try {
        save('settings', appParsed.settings);
        if (typeof appSettings !== 'undefined') {
          appSettings = appParsed.settings;
          if (typeof applySettings === 'function') applySettings();
        }
      } catch {}
    }

    // --- Memos ---
    // Parse remote .md files with the shared helper (id-recovery chain +
    // stable updatedAt fallback so id-less files don't churn every pull).
    const remoteMemos = [];
    for (const r of mdRaws) {
      if (!r) continue;
      try { remoteMemos.push(parseRemoteMemoFile(r)); }
      catch (e) { console.warn('Memo parse failed:', r.name, e); }
    }

    // Per-memo merge with all the protections collected in mergeMemos:
    // tombstones, 3-way deletion via pullSnap, tag preservation, and in-
    // progress edit preservation (so a sync mid-typing doesn't clobber).
    const newMemos = mergeMemos(remoteMemos, memos, {
      tombstones: load('memo_tombstones', {}),
      pullSnap,
      editingMemoId,
    });

    memos = newMemos;
    memoIdCounter = recomputeMemoIdCounter(memos);
    localStorage.setItem('mindflow_memos', JSON.stringify(memos));
    localStorage.setItem('mindflow_memo_idcounter', JSON.stringify(memoIdCounter));
    if (!memos.find(m => m.id === activeMemoId)) {
      activeMemoId = memos[0]?.id || null;
    }

    // --- Journal ---
    if (journalParsed?.entries) {
      try {
        const localJ = load('journal_entries', {});
        const mergedJ = { ...journalParsed.entries };
        Object.entries(localJ).forEach(([k, e]) => {
          const r = mergedJ[k];
          if (!r || new Date(e.updatedAt || 0) >= new Date(r.updatedAt || 0)) mergedJ[k] = e;
        });
        save('journal_entries', mergedJ);
        if (typeof journalEntries !== 'undefined') {
          Object.keys(journalEntries).forEach(k => delete journalEntries[k]);
          Object.assign(journalEntries, mergedJ);
        }
      } catch {}
    }

    // --- Prefix colors ---
    if (prefixParsed) {
      try {
        const local = load('tb_prefix_colors', {});
        const mergedP = { ...prefixParsed, ...local };
        save('tb_prefix_colors', mergedP);
        if (typeof tbPrefixColors !== 'undefined') Object.assign(tbPrefixColors, mergedP);
      } catch {}
    }

    // --- Snapshot update ---
    // Reflect the post-merge truth that "Drive has these mtimes". Any local
    // item with a higher mtime will be flagged dirty by the next push (correct).
    // Without this step, the very first push after pull would re-upload every
    // memo because the snapshot was stale.
    if (driveFolderId) {
      const snap = loadDriveSnapshot();
      // Index Drive files by id-with-our-fallback so we can pull file.modifiedTime
      const memoMtimeByFileId = new Map();
      mdFiles.forEach(f => memoMtimeByFileId.set(f.id, f.modifiedTime));
      // Memos: rebuild from remoteMemos (drops entries Drive no longer has)
      const newMemoSnap = {};
      const newMemoDriveMtimes = {};
      for (const m of remoteMemos) {
        if (m.id != null) newMemoSnap[m.id] = m.updatedAt || m.date || '';
        // Match by sourced fileId if we have it (we don't currently track per-memo file id;
        // fallback to scanning by appProperties or filename pattern)
      }
      // For driveMtimes we need (id → file.modifiedTime). Walk mdFiles using
      // the same id-recovery chain as the parse layer (incl. stableMemoId).
      // Without the stable fallback, orphan files had no mtime entry and the
      // 3-way conflict check for their memos was silently skipped.
      for (const f of mdFiles) {
        const id = recoverMemoIdFromFile(f);
        if (id && f.modifiedTime) newMemoDriveMtimes[id] = f.modifiedTime;
      }
      snap.memos = newMemoSnap;

      // Mindmaps
      const newMmSnap = {};
      const newMmDriveMtimes = {};
      for (const r of mmRaws) {
        if (r?.id != null) newMmSnap[r.id] = r.updatedAt || '';
      }
      for (const f of remoteMmFiles) {
        const m = (f.name || '').match(/^mindmap-(\d+)\.json$/i);
        if (m && f.modifiedTime) newMmDriveMtimes[parseInt(m[1])] = f.modifiedTime;
      }
      if (remoteMmFiles.length > 0) snap.mindmaps = newMmSnap;

      // Timeblocks
      const newTbSnap = {};
      const newTbDriveMtimes = {};
      for (const r of tbRaws) {
        if (r?.dayKey) newTbSnap[r.dayKey] = r.updatedAt || '';
      }
      for (const f of remoteTbFiles) {
        const m = (f.name || '').match(/^timeblock-(.+)\.json$/i);
        if (m && f.modifiedTime) newTbDriveMtimes[m[1]] = f.modifiedTime;
      }
      if (remoteTbFiles.length > 0) snap.tbDays = newTbSnap;

      // Journal: max remote entry mtime + Drive file modifiedTime
      if (journalParsed?.entries) {
        snap.journal = Object.values(journalParsed.entries).reduce((acc, e) => {
          const u = e?.updatedAt || '';
          return u > acc ? u : acc;
        }, '');
      }
      // Prefix: remote stringified
      if (prefixParsed) snap.prefix = JSON.stringify(prefixParsed);
      // App meta: remote stringified subset matching what we push
      if (appParsed?.app === 'mindflow') {
        snap.app = JSON.stringify({
          activeMindmapId: appParsed.activeMindmapId ?? null,
          settings: appParsed.settings ?? {}
        });
      }

      // Drive-side modifiedTimes (used for 3-way conflict detection on next push)
      snap.driveMtimes = snap.driveMtimes || { memo: {}, mindmap: {}, timeblock: {}, journal: '', prefix: '', app: '' };
      snap.driveMtimes.memo = newMemoDriveMtimes;
      if (remoteMmFiles.length > 0) snap.driveMtimes.mindmap = newMmDriveMtimes;
      if (remoteTbFiles.length > 0) snap.driveMtimes.timeblock = newTbDriveMtimes;
      if (journalF?.modifiedTime) snap.driveMtimes.journal = journalF.modifiedTime;
      if (prefixF?.modifiedTime) snap.driveMtimes.prefix = prefixF.modifiedTime;
      if (appFile?.modifiedTime) snap.driveMtimes.app = appFile.modifiedTime;

      saveDriveSnapshot(snap);
    }

    // --- Notify UI to re-render ---
    // Renders are now handled by main.js subscribers (SyncEvents.on('itemsMerged', ...))
    // so sync logic stays unaware of DOM. We pass editingMemoId so memo editor
    // skips redrawing the focused textarea (preserves typing position).
    SyncEvents.emit('itemsMerged', {
      types: ['mindmap', 'memo', 'timeblock', 'journal'],
      editingMemoId,
      focusedEl,
      focusSel
    });
  } finally {
    isLoadingFromDrive = false;
  }
}

async function drivePullAll(skipConfirm = false) {
  if (!driveFolderId) { toast('먼저 Drive를 연결하세요'); return; }
  if (!skipConfirm && !confirm('Drive 데이터를 가져와 병합합니다. (각 항목은 최신 수정 시각 기준) 계속하시겠습니까?')) return;

  try {
    setDriveStatus('saving');
    const { files, latestMtime } = await driveListAllFiles();
    await applyDriveData(files);
    driveLastSyncAt = Date.now();
    driveLastModifiedTime = latestMtime;
    setDriveStatus('saved');
    toast(`동기화 완료 (메모 ${memos.length}개)`, 'success');
    setTimeout(() => { if (driveStatus === 'saved') setDriveStatus('idle') }, 1800);
  } catch (e) {
    setDriveStatus('error');
    toast('가져오기 실패: ' + e.message, 'error');
  }
}

async function driveImportFromFolder() {
  if (!driveFolderId) { toast('먼저 Drive를 연결하세요'); return; }
  const folderName = prompt('가져올 폴더 이름 (MindFlow/ 안에 있거나 최상위 폴더)', 'memos');
  if (!folderName) return;

  try {
    setDriveStatus('saving');
    toast('폴더 검색 중...');

    // 1. Search inside MindFlow/ first
    let targetFolderId = null;
    const rootListing = await driveListInFolder(driveFolderId);
    const found = rootListing.files.find(f =>
      f.mimeType === 'application/vnd.google-apps.folder' &&
      f.name.toLowerCase() === folderName.toLowerCase()
    );
    if (found) {
      targetFolderId = found.id;
    } else {
      // 2. Search anywhere in Drive by name
      try { targetFolderId = await driveClient.findFolderAnywhere(folderName); }
      catch (e) { throw new Error('폴더 검색 실패: ' + e.message); }
    }

    if (!targetFolderId) { toast(`"${folderName}" 폴더를 찾을 수 없습니다`, 'error'); setDriveStatus('idle'); return; }

    // 3. List .md files in that folder
    const listing = await driveListInFolder(targetFolderId);
    const mdFiles = listing.files.filter(f =>
      f.mimeType !== 'application/vnd.google-apps.folder' &&
      f.name.toLowerCase().endsWith('.md')
    );
    if (!mdFiles.length) { toast(`"${folderName}" 폴더에 .md 파일이 없습니다`); setDriveStatus('idle'); return; }

    toast(`${mdFiles.length}개 파일 다운로드 중...`);

    // 4. Download all .md files
    const raws = await batchAll(mdFiles, async f => {
      try { return { text: await driveDownloadFile(f.id), name: f.name, appProperties: f.appProperties, modifiedTime: f.modifiedTime }; } catch { return null; }
    });

    // 5. Parse remote .md files via shared helper (consistent id-recovery +
    //    stable updatedAt fallback so id-less files don't churn).
    const remoteMemos = [];
    for (const r of raws) {
      if (!r) continue;
      try { remoteMemos.push(parseRemoteMemoFile(r)); }
      catch (e) { console.warn('Parse failed:', r.name, e); }
    }
    // Count new arrivals for the toast (anything not already in local memos
    // or whose remote-mtime beats local's).
    const _localIds = new Set(memos.map(m => m.id));
    const _localMtime = id => {
      const m = memos.find(x => x.id === id);
      return m ? new Date(m.updatedAt || m.date || 0).getTime() : 0;
    };
    const importedCount = remoteMemos.filter(r =>
      !_localIds.has(r.id) || new Date(r.updatedAt || r.date || 0).getTime() > _localMtime(r.id)
    ).length;

    // 6. Merge via the shared helper — same protections as auto-pull.
    memos = mergeMemos(remoteMemos, memos, {
      tombstones: load('memo_tombstones', {}),
    });
    memoIdCounter = recomputeMemoIdCounter(memos);
    saveMemos();
    renderMemoList();
    renderMemoEditor();

    driveDirty = true;
    scheduleDriveAutoSave();

    setDriveStatus('saved');
    toast(`${importedCount}개 메모 가져와서 Drive에 동기화 중...`, 'success');
    setTimeout(() => { if (driveStatus === 'saved') setDriveStatus('idle') }, 1800);
  } catch (e) {
    setDriveStatus('error');
    toast('가져오기 실패: ' + e.message, 'error');
  }
}

async function drivePoll(force = false) {
  if (!driveFolderId || isLoadingFromDrive || isPushingToDrive) return;
  // Token miss is often transient (proactive refresh hasn't fired yet,
  // network blip, tab was just unhidden). Skip this tick and let the next
  // 15s try again — do NOT killing the polling timer permanently, which
  // would silently stop background sync for the rest of the session.
  if (!hasValidDriveToken()) {
    setDriveStatus('error');
    return;
  }
  if (!force && driveDirty) return; // don't poll while we have unpushed local changes — would overwrite
  if (!force && document.hidden) return;
  if (!force && Date.now() - driveLastPushAt < 4000) return;
  if (!force) {
    // Block polling only when user is in a modal that holds uncommitted state by
    // index/reference into the underlying store (e.g. tb-modal tracks tbEditingIdx,
    // node-edit-popup tracks a node id). For text editors (memo TEXTAREA, journal
    // textarea, etc), applyDriveData preserves the editing memo and restores focus,
    // and per-item updatedAt merge ensures the latest edit wins — so polling is safe.
    const ae = document.activeElement;
    const inUnsafeModal = ae && ae.closest && (
      ae.closest('.tb-modal') ||
      ae.closest('.node-edit-popup')
    );
    if (inUnsafeModal) return;
  }
  try {
    // Cheap "anything new?" check via Changes API. If the change feed shows no
    // activity in our MindFlow folder, skip the listing entirely — the previous
    // approach listed every file every 15s.
    if (!force) {
      const { hasRelevant } = await driveFetchChanges();
      if (!hasRelevant) return;
    }
    const { files, latestMtime } = await driveListAllFiles();
    if (!force && driveLastModifiedTime && latestMtime === driveLastModifiedTime) return;
    await applyDriveData(files);
    driveLastModifiedTime = latestMtime;
    driveLastSyncAt = Date.now();
    setDriveStatus('saved');
    setTimeout(() => { if (driveStatus === 'saved') setDriveStatus('idle') }, 1500);
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
    clearTimeout(driveAutoSaveTimer); driveAutoSaveTimer = null;
    clearTimeout(driveMaxDelayTimer); driveMaxDelayTimer = null;
    toast('동기화 중...');
    // Manual click — silent refresh via worker if needed, or full redirect to
    // re-consent if the refresh_token was revoked.
    try {
      await driveClient.ensureToken({ silent: false });
    } catch (e) {
      if (e.message === 'NEEDS_AUTH') {
        toast('Google 재로그인이 필요해요 — 인증 페이지로 이동합니다');
        sessionStorage.setItem('mindflow_drive_connecting', '1');
        await driveClient.startAuthFlow(); // page redirects
        return;
      }
      throw e;
    }
    await drivePushAll();
    await drivePoll(true);
    if (!drivePollTimer) driveStartPolling();
    toast('동기화 완료', 'success');
  } catch (e) {
    toast('동기화 실패: ' + e.message, 'error');
  }
}

// Hybrid: 500ms trailing debounce (push shortly after user stops typing)
// PLUS 2000ms hard ceiling (force a flush every 2s during continuous typing)
// so a burst of 30s of typing pushes ~15 times instead of zero.
// Partial-push diff makes each flush cheap — only changed items upload.
const SAVE_DEBOUNCE_MS = 500;
const SAVE_MAX_DELAY_MS = 2000;
let driveMaxDelayTimer = null;

function scheduleDriveSave() {
  if (!driveFolderId || isLoadingFromDrive) return;
  if (!isOnline) {
    driveDirty = true;
    localStorage.setItem('mindflow_drive_dirty', '1');
    return;
  }
  driveDirty = true;
  localStorage.setItem('mindflow_drive_dirty', '1');

  const flush = async () => {
    clearTimeout(driveAutoSaveTimer); driveAutoSaveTimer = null;
    clearTimeout(driveMaxDelayTimer); driveMaxDelayTimer = null;
    // Background flush must not trigger OAuth popup. Leave dirty=true; user will
    // re-auth on next manual "동기화" click and we'll push then.
    if (!hasValidDriveToken()) {
      setDriveStatus('error');
      return;
    }
    try {
      await drivePushAll();
      // Only clear dirty if nothing left to push (covers in-flight conflict cases)
      if (computeDriveDirty().isEmpty) {
        driveDirty = false;
        driveRetryAttempt = 0;
        localStorage.removeItem('mindflow_drive_dirty');
      } else {
        // Push completed but more changes accumulated during it (typing-during-push).
        // Schedule another flush so the leftover edits don't get stranded in localStorage
        // when the user stops typing immediately after.
        scheduleDriveSave();
      }
    } catch (e) {
      console.warn('Drive push failed; scheduling retry:', e);
      scheduleDriveRetry();
    }
  };

  // Trailing debounce — resets on each call
  clearTimeout(driveAutoSaveTimer);
  driveAutoSaveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);

  // Max-delay ceiling — set once per burst, NOT reset on subsequent calls.
  // This is what makes continuous typing flush every ~2s instead of waiting for idle.
  if (!driveMaxDelayTimer) {
    driveMaxDelayTimer = setTimeout(flush, SAVE_MAX_DELAY_MS);
  }
}

function updateDriveStatus() {
  updateHeaderSyncPill();
  const el = document.getElementById('drive-status');
  if (!el) return;
  const reloadBtn = document.getElementById('drive-pull-btn');
  const disconnectBtn = document.getElementById('drive-disconnect-btn');
  const syncNowBtn = document.getElementById('drive-sync-now-btn');
  const importFolderRow = document.getElementById('drive-import-folder-row');
  const cleanupRow = document.getElementById('drive-cleanup-row');
  if (driveFolderId) {
    el.classList.add('connected');
    let statusText;
    if (driveStatus === 'saving') {
      const prog = driveProgress && driveProgress.total > 0
        ? ` (${driveProgress.uploaded}/${driveProgress.total})`
        : '';
      statusText = '<span class="save-pulse"></span>동기화 중' + prog + '...';
    }
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
    if (importFolderRow) importFolderRow.style.display = '';
    if (cleanupRow) cleanupRow.style.display = '';
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
    if (importFolderRow) importFolderRow.style.display = 'none';
    if (cleanupRow) cleanupRow.style.display = 'none';
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
    // Resume sync immediately — go through scheduleDriveSave so the throttle/diff path runs
    scheduleDriveSave();
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
    // Background retry — same rule, no popup. Wait for user gesture.
    if (!hasValidDriveToken()) { driveRetryAttempt = 0; return; }
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
    if (driveProgress && driveProgress.total > 0) {
      label.textContent = `동기화 중 ${driveProgress.uploaded}/${driveProgress.total}`;
    } else {
      label.textContent = '동기화 중';
    }
    if (banner) banner.classList.remove('show');
  } else if (status === 'error') {
    // 실패는 헤더 동기화 칩 색상으로만 조용히 표시 — 큰 배너는 띄우지 않음.
    // (자동 폴링이 15초마다 재시도하므로 일시적 실패는 곧 회복된다)
    pill.classList.add('error');
    label.textContent = '동기화 실패';
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
  // Step 1: if the page just came back from Google's consent screen, the URL
  // will carry ?code=... — exchange it for tokens via the worker before doing
  // anything else. This must run regardless of saved client_id state, because
  // ?code= is meaningless to leave sitting in the URL.
  driveClient.setClientId(driveClientId);
  try {
    const exchanged = await driveClient.handleOAuthCallback();
    if (exchanged) {
      const wasConnecting = sessionStorage.getItem('mindflow_drive_connecting') === '1';
      sessionStorage.removeItem('mindflow_drive_connecting');
      if (wasConnecting || !driveFolderId) {
        // First-time connect: bootstrap the folder structure and do the
        // initial push/pull. Returns here so we don't fall through to the
        // routine-session branch below (which would re-pull immediately).
        await driveCompleteConnection();
        return;
      }
      // Routine session re-auth (e.g. refresh_token was revoked, user
      // re-consented). Fall through to the normal restore path below.
    }
  } catch (e) {
    console.error('OAuth callback handling failed:', e);
    sessionStorage.removeItem('mindflow_drive_connecting');
    setDriveStatus('error');
    toast('Google 인증 실패: ' + e.message, 'error');
    return;
  }

  // Step 2: routine session restore. If we have a folder configured and either
  // a cached access token or a refresh_token at the worker, silently bring
  // sync back up — no popup, no redirect.
  if (driveClientId && driveFolderId) {
    updateDriveStatus();
    try {
      // ensureToken: cached → return; else silent refresh via worker. Throws
      // NEEDS_AUTH only if both cache miss AND no refresh_token — in which
      // case we leave the UI in 'error' state so the user clicks 동기화 to
      // re-consent (which then page-redirects).
      await driveClient.ensureToken({ silent: false });

      try {
        const about = await driveClient.getAbout();
        driveUserEmail = about.user?.emailAddress || null;
        if (driveUserEmail) {
          save('drive_user_email', driveUserEmail);
          driveClient.setLoginHint(driveUserEmail);
        }
      } catch {}

      try {
        await ensureDriveSubfolders();
        const migrated = await driveMigrateLegacyFiles();
        if (migrated > 0) toast(`Drive 폴더 정리: ${migrated}개 파일 이동`, 'success');
      } catch (e) {
        console.warn('Subfolder migration failed (continuing):', e);
      }

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
      if (e.message === 'NEEDS_AUTH') {
        // 진짜 재인증이 필요한 경우만 에러 상태로 — 사용자가 동기화 버튼을 눌러야 함
        setDriveStatus('error');
        toast('Drive 재인증 필요 — 동기화 버튼을 눌러주세요', 'error');
      } else {
        // 일시적 실패(네트워크 등) — 에러로 표시하지 않고 폴링으로 조용히 재시도
        driveStartPolling();
      }
    }
  }
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
      const remoteHasData = Object.keys(r.files || {}).some(n =>
        (n.toLowerCase().endsWith('.md') && n !== 'README.md') ||
        n === '_mindflow-app.json' ||
        (n.startsWith('mindmap-') && n.endsWith('.json')) ||
        (n.startsWith('timeblock-') && n.endsWith('.json'))
      );

      if (remoteHasData) {
        await gistPullAll(true); // 타임스탬프 기준 항목별 병합
      }
      await gistPushAll(); // 로컬에만 있는 항목 업로드
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
      version: 3,
      app: 'mindflow',
      exportedAt: new Date().toISOString(),
      activeMindmapId: load('mm_active', null),
      settings: load('settings', {})
    };

    // Get current gist files to know which old files to delete
    const current = await gistApi('GET', `/gists/${gistId}`);
    const currentMdFiles = Object.keys(current.files || {}).filter(n => n.toLowerCase().endsWith('.md') && n !== 'README.md');

    const files = {
      '_mindflow-app.json': { content: JSON.stringify(appData, null, 2) }
    };

    // Individual mindmap files
    const localMmFnames = new Set();
    for (const mm of load('mindmaps', [])) {
      const fname = `mindmap-${mm.id}.json`;
      localMmFnames.add(fname);
      files[fname] = { content: JSON.stringify(mm, null, 2) };
    }
    for (const fn of Object.keys(current.files || {})) {
      if (fn.startsWith('mindmap-') && fn.endsWith('.json') && !localMmFnames.has(fn))
        files[fn] = null;
    }

    // Individual timeblock day files
    const tbMetaGist = load('tb_meta', {});
    const localTbFnames = new Set();
    for (const [dayKey, blocks] of Object.entries(load('tb_blocks', {}))) {
      const fname = `timeblock-${dayKey}.json`;
      localTbFnames.add(fname);
      files[fname] = { content: JSON.stringify({ blocks, updatedAt: tbMetaGist[dayKey] || new Date().toISOString() }, null, 2) };
    }
    for (const fn of Object.keys(current.files || {})) {
      if (fn.startsWith('timeblock-') && fn.endsWith('.json') && !localTbFnames.has(fn))
        files[fn] = null;
    }

    const desiredMd = new Set();
    for (const memo of memos) {
      let base = sanitizeMdFilename(memo.title);
      let fname = base + '.md';
      let n = 2;
      while (desiredMd.has(fname)) { fname = `${base} (${n}).md`; n++; }
      desiredMd.add(fname);
      const updated = memo.updatedAt || memo.date;
      const fm = `---\nid: ${memo.id}\ntitle: ${(memo.title || '').replace(/\n/g, ' ')}\ndate: ${memo.date}\nupdated: ${updated}\n---\n\n${memo.content || ''}`;
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

    // Track which memo is being edited so we don't blow away the user's draft.
    // Any focus inside .memo-editor counts — incl. the CodeMirror live editor.
    const ae = document.activeElement;
    const editingMemoId = (ae && ae.closest && ae.closest('.memo-editor'))
      ? activeMemoId : null;

    // Mindmaps + timeblocks: per-file timestamp merge (newest wins per item)
    const mmEntries = Object.entries(fileMap).filter(([n]) => n.startsWith('mindmap-') && n.endsWith('.json'));
    const tbEntries = Object.entries(fileMap).filter(([n]) => n.startsWith('timeblock-') && n.endsWith('.json'));
    let legacyApp = null;
    if (fileMap['_mindflow-app.json'] && (mmEntries.length === 0 || tbEntries.length === 0)) {
      try { legacyApp = JSON.parse(fileMap['_mindflow-app.json'].content); } catch {}
    }

    if (mmEntries.length > 0) {
      const mmMap = new Map(mindmaps.map(m => [m.id, m]));
      for (const [, info] of mmEntries) {
        try {
          let content = info.content;
          if (info.truncated && info.raw_url) {
            const r = await fetch(info.raw_url);
            if (r.ok) content = await r.text();
          }
          const remote = JSON.parse(content);
          if (!remote.id) continue;
          const local = mmMap.get(remote.id);
          if (!local || new Date(remote.updatedAt || 0) >= new Date(local.updatedAt || 0))
            mmMap.set(remote.id, remote);
        } catch {}
      }
      mindmaps = [...mmMap.values()];
      activeMindmapId = mindmaps.find(m => m.id === activeMindmapId)?.id ?? mindmaps[0]?.id ?? null;
      localStorage.setItem('mindflow_mindmaps', JSON.stringify(mindmaps));
      localStorage.setItem('mindflow_mm_active', JSON.stringify(activeMindmapId));
      bindActiveMap();
    } else if (legacyApp?.app === 'mindflow' && legacyApp.mindmaps) {
      mindmaps = legacyApp.mindmaps;
      activeMindmapId = legacyApp.activeMindmapId ?? mindmaps[0]?.id ?? null;
      localStorage.setItem('mindflow_mindmaps', JSON.stringify(mindmaps));
      localStorage.setItem('mindflow_mm_active', JSON.stringify(activeMindmapId));
      bindActiveMap();
    }

    if (tbEntries.length > 0) {
      const localTbMeta = load('tb_meta', {});
      for (const [fname, info] of tbEntries) {
        const dayKey = fname.slice('timeblock-'.length, -'.json'.length);
        try {
          let content = info.content;
          if (info.truncated && info.raw_url) {
            const r = await fetch(info.raw_url);
            if (r.ok) content = await r.text();
          }
          const { blocks, updatedAt: rAt } = JSON.parse(content);
          const lAt = localTbMeta[dayKey];
          if (!lAt || new Date(rAt || 0) >= new Date(lAt)) {
            timeBlocks[dayKey] = blocks;
            if (rAt) localTbMeta[dayKey] = rAt;
          }
        } catch {}
      }
      localStorage.setItem('mindflow_tb_blocks', JSON.stringify(timeBlocks));
      save('tb_meta', localTbMeta);
    } else if (legacyApp?.app === 'mindflow' && legacyApp.timeBlocks) {
      timeBlocks = legacyApp.timeBlocks;
      localStorage.setItem('mindflow_tb_blocks', JSON.stringify(timeBlocks));
    }

    // Memos from .md files (preserve currently-edited memo from local)
    // Settings from meta file
    if (fileMap['_mindflow-app.json']?.content) {
      try {
        const meta = JSON.parse(fileMap['_mindflow-app.json'].content);
        if (meta?.app === 'mindflow' && meta.settings) {
          save('settings', meta.settings);
          if (typeof appSettings !== 'undefined') {
            appSettings = meta.settings;
            if (typeof applySettings === 'function') applySettings();
          }
        }
      } catch {}
    }

    // Memos from .md files
    const remoteMemos = [];
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
      if (!memo.id) memo.id = stableMemoIdFromName(filename);
      else if (memo.id > maxId) maxId = memo.id;
      remoteMemos.push(memo);
    }

    // Per-memo timestamp merge: keep whichever side has the later updatedAt
    const mtime = m => new Date(m.updatedAt || m.date || 0).getTime();
    const mergedMemos = new Map();
    for (const m of remoteMemos) mergedMemos.set(m.id, m);
    for (const m of memos) {
      const r = mergedMemos.get(m.id);
      if (!r || mtime(m) > mtime(r)) mergedMemos.set(m.id, m);
      if (m.id > maxId) maxId = m.id;
    }
    const newMemos = [...mergedMemos.values()];
    newMemos.sort((a, b) => mtime(b) - mtime(a));

    // Always preserve the in-progress edit
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
  if (!skipConfirm && !confirm('Gist 데이터를 가져와 병합합니다. (각 항목은 최신 수정 시각 기준) 계속하시겠습니까?')) return;

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
  let updatedAt = null;
  let id = null;
  let tags;  // undefined = "not present in frontmatter" (preserve local), [] = "explicitly empty"
  let content = text;
  if (fmMatch) {
    const fm = fmMatch[1];
    content = fmMatch[2];
    const titleM = fm.match(/^title:\s*(.+)$/m);
    const dateM = fm.match(/^date:\s*(.+)$/m);
    const updM = fm.match(/^updated:\s*(.+)$/m);
    const idM = fm.match(/^id:\s*(\d+)$/m);
    const tagsM = fm.match(/^tags:\s*\[(.*?)\]\s*$/m);
    if (titleM) title = titleM[1].trim().replace(/^["']|["']$/g, '');
    if (dateM) {
      const d = new Date(dateM[1].trim());
      if (!isNaN(d)) date = d.toISOString();
    }
    if (updM) {
      const d = new Date(updM[1].trim());
      if (!isNaN(d)) updatedAt = d.toISOString();
    }
    if (idM) id = parseInt(idM[1]);
    if (tagsM) {
      const inner = tagsM[1].trim();
      if (inner === '') {
        tags = [];
      } else {
        try {
          // Parse JSON-array form: ["a", "b"]
          tags = JSON.parse('[' + inner + ']');
          if (!Array.isArray(tags)) tags = undefined;
        } catch {
          // Fallback: comma-split, strip quotes
          tags = inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        }
      }
    }
  } else {
    const h1 = text.match(/^# (.+)$/m);
    if (h1) title = h1[1].trim();
  }
  // Fall back to date (which is mtime-derived for old memos without explicit updated)
  if (!updatedAt) updatedAt = date;
  const result = { id, title, content, date, updatedAt };
  // Only attach `tags` field if frontmatter actually carried it — that lets the
  // merge layer preserve local tags when remote file is from before this fix.
  if (tags !== undefined) result.tags = tags;
  return result;
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
          if (!memo.id) memo.id = stableMemoIdFromName(entry.name);
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
  const updated = memo.updatedAt || memo.date;
  const fm = `---\nid: ${memo.id}\ntitle: ${(memo.title || '').replace(/\n/g, ' ')}\ndate: ${memo.date}\nupdated: ${updated}\n---\n\n`;
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

