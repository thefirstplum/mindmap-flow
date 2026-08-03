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
  // 모달 reset — 이전 close 시 inline style 남거나 modal animation이 끝 상태로
  // 굳어서 두 번째 open에서 dimm만 보이고 본체 안 뜨는 경우 방지 (사장님 보고)
  const _ov = document.getElementById('sync-modal');
  if (_ov) {
    _ov.style.display = '';
    _ov.style.opacity = '';
    _ov.classList.remove('show');
    void _ov.offsetWidth;  // 강제 reflow → CSS animation 재실행 보장
    const _mod = _ov.querySelector('.modal');
    if (_mod) {
      _mod.style.animation = 'none';
      _mod.style.opacity = '';
      _mod.style.transform = '';
      void _mod.offsetWidth;
      _mod.style.animation = '';
    }
  }
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

  // Update Drive status
  updateDriveStatus();
  refreshBackupList();
  refreshStorageUsage();
  // Google Calendar 섹션 상태 동기화
  if (typeof renderGCalSection === 'function') renderGCalSection();

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

// =================== GOOGLE DRIVE + CALENDAR SYNC ===================
// scope를 Drive + Calendar로 확장 (2026-06-05). 사장님 요청: Google Calendar 일정
// 양방향 sync. calendar scope 하나로 list/CRUD 모두 처리 가능.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar';
const DRIVE_SCOPE_VER = 'v3'; // bump when scope changes so old tokens are invalidated
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
const driveClient = new DriveClient({ clientId: driveClientId, scope: DRIVE_SCOPE });
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

// =================== DRIVE DOWNLOAD CACHE ===================
// Every pull re-downloaded all of memos/*.md + mindmaps/*.json + timeblocks/*.json,
// even on a cold boot where nothing had changed. With N memos that is N HTTPS
// round trips per launch (8 at a time) — the main reason startup felt slow.
//
// Drive bumps modifiedTime whenever a file's content changes, so (fileId,
// modifiedTime) is a sound content key: a hit guarantees identical bytes.
//
// SCOPE — this is a *transport* cache and nothing more. Callers still receive the
// exact text the network would have returned, so applyDriveData's merge sees
// byte-identical input and its semantics are completely untouched. Do NOT extend
// this into "skip the file entirely": mergeMemos reads a memo's absence from the
// remote list as "deleted on another device" and would drop it locally.
const DL_CACHE_DB = 'mindflow-dlcache';
const DL_CACHE_STORE = 'files';

function dlCacheOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DL_CACHE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DL_CACHE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// All cache helpers swallow their own errors — a broken/blocked IndexedDB must
// degrade to plain network fetches, never break sync.
async function dlCacheGet(key) {
  try {
    const db = await dlCacheOpen();
    return await new Promise((resolve) => {
      const tx = db.transaction(DL_CACHE_STORE, 'readonly');
      const req = tx.objectStore(DL_CACHE_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}

async function dlCachePut(key, text) {
  try {
    const db = await dlCacheOpen();
    await new Promise((resolve) => {
      const tx = db.transaction(DL_CACHE_STORE, 'readwrite');
      tx.objectStore(DL_CACHE_STORE).put(text, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

// Drop entries not present in the current listing. Without this the store grows
// forever as files are edited (each edit mints a new modifiedTime → new key).
async function dlCachePrune(validKeys) {
  try {
    const db = await dlCacheOpen();
    await new Promise((resolve) => {
      const tx = db.transaction(DL_CACHE_STORE, 'readwrite');
      const store = tx.objectStore(DL_CACHE_STORE);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const k of (req.result || [])) {
          if (!validKeys.has(k)) store.delete(k);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

function dlCacheKey(f) {
  return f && f.id && f.modifiedTime ? `${f.id}@${f.modifiedTime}` : null;
}

// Download `f` (a Drive file object with id + modifiedTime), reusing the cached
// body when this exact revision was fetched before. Falls back to a direct
// download whenever the key can't be formed or the cache misses.
async function driveDownloadCached(f) {
  const key = dlCacheKey(f);
  if (!key) return driveDownloadFile(f.id);
  const hit = await dlCacheGet(key);
  if (typeof hit === 'string') return hit;
  const text = await driveDownloadFile(f.id);
  if (typeof text === 'string') dlCachePut(key, text).catch(() => {});
  return text;
}
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

// Parse a memo .md file (YAML frontmatter + body) into a memo object.
// Lived in the folder-sync section until that feature was removed; the Drive
// path depends on it (parseRemoteMemoFile, the conflict forker, MemoAdapter).
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

// Parse a remote .md file (Drive) into a memo with a stable id
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

// CRDT-lite node-level merge of two mindmap snapshots.
// Both sides alive → union nodes/edges by id, per-node mtime wins on conflicts,
// node tombstones (mm.deletedNodes) prevent resurrection of explicit deletions.
// pan/zoom = local view state (not synced). idCounter = max.
function _mergeMindmapPair(remote, local) {
  const remoteAt = new Date(remote.updatedAt || 0).getTime();
  const localAt = new Date(local.updatedAt || 0).getTime();
  // Mindmap-level metadata (name/tags/pinned) → newer wins
  const winner = remoteAt >= localAt ? remote : local;
  const result = {
    ...winner,
    // Preserve local view state — pan/zoom is per-device
    pan: local.pan || winner.pan,
    zoom: local.zoom != null ? local.zoom : winner.zoom,
    idCounter: Math.max(remote.idCounter || 1, local.idCounter || 1, 1),
    // Tombstones: union, keep newest timestamp per id
    deletedNodes: _unionTombstones(remote.deletedNodes, local.deletedNodes),
  };
  // Preserve tags from loser if winner doesn't carry them at all
  const loser = winner === remote ? local : remote;
  if (!('tags' in winner) && loser && Array.isArray(loser.tags) && loser.tags.length > 0) {
    result.tags = loser.tags;
  }
  // Nodes: id-keyed union with mtime tiebreak + tombstone filter
  const tombs = result.deletedNodes;
  const nodeMtime = n => new Date(n.updatedAt || 0).getTime() || (n === remote ? remoteAt : localAt);
  const nodeMap = new Map();
  const consider = (n, fallbackAt) => {
    if (!n || n.id == null) return;
    const tombAt = tombs[n.id] ? new Date(tombs[n.id]).getTime() : 0;
    const nAt = new Date(n.updatedAt || 0).getTime() || fallbackAt;
    if (tombAt && tombAt >= nAt) return; // tombstone wins → node stays deleted
    const prev = nodeMap.get(n.id);
    if (!prev) { nodeMap.set(n.id, n); return; }
    const prevAt = new Date(prev.updatedAt || 0).getTime() || (prev._side === 'r' ? remoteAt : localAt);
    if (nAt >= prevAt) nodeMap.set(n.id, n);
  };
  for (const n of (local.nodes || [])) { n._side = 'l'; consider(n, localAt); }
  for (const n of (remote.nodes || [])) { n._side = 'r'; consider(n, remoteAt); }
  // Strip the _side tag we added for tiebreak (don't leak into Drive)
  result.nodes = [...nodeMap.values()].map(n => { const { _side, ...rest } = n; return rest; });
  // Edges: union by directed key "from-to". If both endpoints survived, keep edge.
  const liveIds = new Set(result.nodes.map(n => n.id));
  const edgeKey = e => `${e.from}-${e.to}`;
  const edgeMap = new Map();
  for (const e of (local.edges || [])) if (liveIds.has(e.from) && liveIds.has(e.to)) edgeMap.set(edgeKey(e), e);
  for (const e of (remote.edges || [])) if (liveIds.has(e.from) && liveIds.has(e.to)) edgeMap.set(edgeKey(e), e);
  result.edges = [...edgeMap.values()];
  return result;
}

function _unionTombstones(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (!out[k] || new Date(v).getTime() > new Date(out[k]).getTime()) out[k] = v;
  }
  return out;
}

// Merge remote mindmaps into local mindmaps. Mirrors mergeMemos' protections
// PLUS node-level CRDT-lite merge (above) so concurrent edits on the SAME
// mindmap no longer fork conflict copies — both edits survive.
function mergeMindmaps(remoteMms, localMms, opts) {
  opts = opts || {};
  const pullSnapMm = opts.pullSnapMm || {};
  const tombstones = opts.tombstones || {};
  const remoteIdSet = new Set(remoteMms.map(m => m && m.id).filter(Boolean));
  const mtime = mm => new Date(mm.updatedAt || 0).getTime();
  const map = new Map();
  for (const m of localMms) {
    if (!remoteIdSet.has(m.id) && (m.id in pullSnapMm)) {
      const snapAt = new Date(pullSnapMm[m.id] || 0).getTime();
      if (mtime(m) <= snapAt) continue; // accept remote deletion
    }
    map.set(m.id, m);
  }
  for (const remote of remoteMms) {
    if (!remote?.id) continue;
    // Tombstone wins over remote-alive if the local deletion is newer than the
    // remote update — protects against resurrection when snapshot was wiped.
    const deletedAt = tombstones[remote.id];
    if (deletedAt && new Date(deletedAt).getTime() >= mtime(remote)) {
      map.delete(remote.id);
      continue;
    }
    const local = map.get(remote.id);
    if (!local) {
      map.set(remote.id, remote);
    } else {
      // Both sides alive → node-level merge (no more whole-mindmap last-write-wins)
      map.set(remote.id, _mergeMindmapPair(remote, local));
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
    journal: '', prefix: '', app: '', routine: '',
    driveMtimes: { memo: {}, mindmap: {}, timeblock: {}, journal: '', prefix: '', app: '', routine: '' }
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
  // Include tombstoned ids too — snapshot can be empty after schema bump / fresh
  // device / ITP eviction. Without this, mindmaps deleted on device A would not
  // get pushed (= still present on Drive) and device B would resurrect them.
  const mmTombs = load('mindmap_tombstones', {});
  const deletedMindmapIds = Array.from(new Set([
    ...Object.keys(snap.mindmaps).map(s => parseInt(s)),
    ...Object.keys(mmTombs).map(s => parseInt(s)),
  ])).filter(id => !localMmIds.has(id));

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

  // Routine: small singleton bundle (config + checks + updatedAt)
  const routineStr = (typeof getRoutinePayload === 'function')
    ? JSON.stringify(getRoutinePayload()) : '';
  const routineDirty = !!routineStr && routineStr !== snap.routine;

  const isEmpty =
    !dirtyMemos.length && !deletedMemoIds.length &&
    !dirtyMindmaps.length && !deletedMindmapIds.length &&
    !dirtyTbDays.length && !deletedTbDays.length &&
    !journalDirty && !prefixDirty && !appDirty && !routineDirty;

  return {
    dirtyMemos, deletedMemoIds,
    dirtyMindmaps, deletedMindmapIds,
    dirtyTbDays, deletedTbDays,
    journalDirty, journalMax,
    prefixDirty, prefixStr,
    appDirty, appStr,
    routineDirty, routineStr,
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
    // fork copy의 ID도 timestamp+random — 멀티 기기 race 회피
    const nextId = (typeof newMemoId === 'function') ? newMemoId
      : () => Date.now() * 10000 + Math.floor(Math.random() * 10000);
    const copy = window.SyncAdapters.Memo.createConflictCopy(remoteMemo, {
      nextMemoId: nextId
    });
    if (typeof memos !== 'undefined' && Array.isArray(memos)) {
      memos.unshift(copy);
      try {
        localStorage.setItem('mindflow_memos', JSON.stringify(memos));
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
      (diff.routineDirty ? 1 : 0) +
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
      routine: oldSnap.routine || '',
      driveMtimes: {
        memo: { ...(oldSnap.driveMtimes?.memo || {}) },
        mindmap: { ...(oldSnap.driveMtimes?.mindmap || {}) },
        timeblock: { ...(oldSnap.driveMtimes?.timeblock || {}) },
        journal: oldSnap.driveMtimes?.journal || '',
        prefix: oldSnap.driveMtimes?.prefix || '',
        app: oldSnap.driveMtimes?.app || '',
        routine: oldSnap.driveMtimes?.routine || ''
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

    // Routine — config + checks + updatedAt bundle, single small file
    if (diff.routineDirty) {
      const routineFile = byName.get('routine.json');
      const res = routineFile
        ? await driveUpdateFile(routineFile.id, diff.routineStr, 'application/json')
        : await driveUploadFile('routine.json', diff.routineStr, 'application/json', driveFolderId);
      trackMtime(res);
      newSnap.routine = diff.routineStr;
      if (res?.modifiedTime) newSnap.driveMtimes.routine = res.modifiedTime;
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
    // 마인드맵 push는 fork 안 함. pull 시 mergeMindmaps가 노드 단위 union CRDT-lite
    // 머지로 양쪽 편집을 모두 보존하기 때문 (850라인 코멘트 참조). 사장님 보고:
    // 마인드맵에서 충돌 사본이 많이 발생 → push에서 한 번 더 fork하던 게 양산 원인.
    await batchAll(diff.dirtyMindmaps, async mm => {
      const capturedMtime = mm.updatedAt || '';
      const fname = `mindmap-${mm.id}.json`;
      const body = JSON.stringify(mm, null, 2);
      const existing = mindmapByName.get(fname);
      if (existing) {
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
    const mmDeleteSuccess = [];
    await batchAll(diff.deletedMindmapIds, async id => {
      const f = mindmapByName.get(`mindmap-${id}.json`);
      if (!f) {
        delete newSnap.mindmaps[id];
        delete newSnap.driveMtimes.mindmap[id];
        mmDeleteSuccess.push(id);
        return;
      }
      try {
        await driveDeleteFile(f.id);
        delete newSnap.mindmaps[id];
        delete newSnap.driveMtimes.mindmap[id];
        mmDeleteSuccess.push(id);
      } catch (e) {
        console.warn('[Sync] Mindmap delete failed for id', id, '— keeping in snapshot:', e.message);
      }
    });
    // Clear mindmap tombstones for successful deletions only (mirror memo path).
    // Failed deletes keep their tombstone so they retry next push.
    if (mmDeleteSuccess.length) {
      const mmTombsCur = load('mindmap_tombstones', {});
      let changed = false;
      for (const id of mmDeleteSuccess) {
        if (id in mmTombsCur) { delete mmTombsCur[id]; changed = true; }
      }
      if (changed) localStorage.setItem('mindflow_mindmap_tombstones', JSON.stringify(mmTombsCur));
    }

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
    // get consistent rename targets even when their neighbors aren't being pushed.
    //
    // 파일명 형식: `${id}-${sanitizeDriveName(title)}.md`
    // — ID prefix가 항상 들어가서 "제목 없음" 등 같은 제목 메모 여러 개 있어도
    //   파일명이 겹치지 않음. parseMemoIdFromFilename(^(\d+)-) 패턴 기존 지원.
    // — 사장님이 보고: 빈 제목 메모가 다른 기기 빈 제목과 같은 이름이 되어
    //   sync가 "기존 파일 덮어쓰기"로 판단 → 충돌 사본 양산. 이 해결.
    const usedNames = new Set([DRIVE_APP_FILENAME, 'journal.json', 'tb-prefix-colors.json', 'routine.json']);
    const memoFilenames = new Map();
    for (const memo of memos) {
      const base = sanitizeDriveName(memo.title);
      // ID prefix 포함 (같은 제목 메모 여러 개 있어도 unique)
      let fname = `${memo.id}-${base}.md`;
      // 만약의 이름 충돌(거의 없음)에 대비
      let n = 2;
      while (usedNames.has(fname)) { fname = `${memo.id}-${base} (${n}).md`; n++; }
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
      // ⚠️ ID 매칭만 사용 — byName fallback은 위험 (다른 ID인데 같은 파일명이면
      //    다른 메모를 덮어쓸 위험). 옛 파일 (ID prefix 없음)은 첫 push 때
      //    rename으로 정규화됨.
      const existing = byMemoId.get(memo.id);
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
        // 신규 업로드. 이름 충돌이 있으면(드물지만 — ID prefix 덕에 거의 없음) (2) suffix
        let uploadName = fname;
        if (byName.has(uploadName)) {
          const base = uploadName.replace(/\.md$/, '');
          let n = 2;
          while (byName.has(`${base} (${n}).md`)) n++;
          uploadName = `${base} (${n}).md`;
        }
        const res = await driveUploadFile(uploadName, content, 'text/markdown', driveMemosFolderId || driveFolderId, { memoId: String(memo.id) });
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
    // Pre-merge fingerprints. Every pull used to emit itemsMerged for all four
    // types unconditionally, so the UI re-rendered on every poll even when Drive
    // returned byte-identical data — that's the "화면이 늦게 툭 바뀐다" symptom.
    // We compare the stored JSON before/after the merge and only notify for the
    // domains that actually moved. Read-only: this cannot alter merge results.
    const _before = {
      memo: localStorage.getItem('mindflow_memos'),
      mindmap: localStorage.getItem('mindflow_mindmaps'),
      timeblock: localStorage.getItem('mindflow_tb_blocks'),
      journal: localStorage.getItem('mindflow_journal_entries'),
    };

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
    const routineF = files.find(f => f.name === 'routine.json');
    const mdFiles = files.filter(f => f.name.toLowerCase().endsWith('.md'));

    // Download everything in batches of 8 concurrent — fast but rate-limit safe.
    // driveDownloadCached serves unchanged revisions from IndexedDB, so a boot
    // where nothing moved on Drive costs one listing call instead of N downloads.
    // Every merge below still receives the true remote bytes either way.
    const [mmRaws, tbRaws, mdRaws, appParsed, journalParsed, prefixParsed, routineParsed] = await Promise.all([
      batchAll(remoteMmFiles, f =>
        driveDownloadCached(f).then(t => JSON.parse(t)).catch(() => null)),
      batchAll(remoteTbFiles, async f => {
        const dayKey = f.name.slice('timeblock-'.length, -'.json'.length);
        try { return { dayKey, ...JSON.parse(await driveDownloadCached(f)) }; } catch { return null; }
      }),
      batchAll(mdFiles, async f => {
        // Carry appProperties + filename so we can recover the memo id even if
        // the markdown frontmatter is missing/corrupt — prevents duplicate-memo
        // explosion when files lose their `id:` line.
        try { return { text: await driveDownloadCached(f), name: f.name, appProperties: f.appProperties, modifiedTime: f.modifiedTime }; } catch { return null; }
      }),
      appFile ? driveDownloadCached(appFile).then(t => JSON.parse(t)).catch(() => null) : Promise.resolve(null),
      journalF ? driveDownloadCached(journalF).then(t => JSON.parse(t)).catch(() => null) : Promise.resolve(null),
      prefixF ? driveDownloadCached(prefixF).then(t => JSON.parse(t)).catch(() => null) : Promise.resolve(null),
      routineF ? driveDownloadCached(routineF).then(t => JSON.parse(t)).catch(() => null) : Promise.resolve(null),
    ]);

    // Evict revisions Drive no longer lists (superseded edits, deleted files).
    // Fire-and-forget: pruning must never delay or fail the merge below.
    dlCachePrune(new Set(files.map(dlCacheKey).filter(Boolean))).catch(() => {});

    // Snapshot loaded once for all 3-way deletion detections below
    // (memo/mindmap/timeblock all read it). Must be declared BEFORE the merges
    // — earlier const TDZ caused every pull to ReferenceError silently, which
    // is what kept resurrecting "deleted" items across devices.
    const pullSnap = (typeof loadDriveSnapshot === 'function') ? loadDriveSnapshot() : { memos: {}, mindmaps: {}, tbDays: {} };

    // --- Mindmaps ---
    const legacyApp = (appParsed?.app === 'mindflow') ? appParsed : null;
    if (remoteMmFiles.length > 0) {
      // Shared mindmap merge — tombstones + 3-way deletion via snap + tag
      // preservation when remote lacks the field (otherwise tags vanish every
      // time another device that doesn't carry tags wins the timestamp).
      mindmaps = mergeMindmaps(mmRaws.filter(r => r?.id), mindmaps, {
        pullSnapMm: pullSnap.mindmaps || {},
        tombstones: load('mindmap_tombstones', {}),
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

    // --- Routine ---
    // Merge bundled config + per-day checks. applyRoutinePayload uses an
    // updatedAt tie-break — newer wins; older remote is ignored.
    if (routineParsed && typeof applyRoutinePayload === 'function') {
      try { applyRoutinePayload(routineParsed); }
      catch (e) { console.warn('Routine merge failed:', e); }
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
      // Routine: remote stringified (matches what we'd push if local equals remote)
      if (routineParsed) snap.routine = JSON.stringify(routineParsed);
      // App meta: remote stringified subset matching what we push
      if (appParsed?.app === 'mindflow') {
        snap.app = JSON.stringify({
          activeMindmapId: appParsed.activeMindmapId ?? null,
          settings: appParsed.settings ?? {}
        });
      }

      // Drive-side modifiedTimes (used for 3-way conflict detection on next push)
      snap.driveMtimes = snap.driveMtimes || { memo: {}, mindmap: {}, timeblock: {}, journal: '', prefix: '', app: '', routine: '' };
      snap.driveMtimes.memo = newMemoDriveMtimes;
      if (remoteMmFiles.length > 0) snap.driveMtimes.mindmap = newMmDriveMtimes;
      if (remoteTbFiles.length > 0) snap.driveMtimes.timeblock = newTbDriveMtimes;
      if (journalF?.modifiedTime) snap.driveMtimes.journal = journalF.modifiedTime;
      if (prefixF?.modifiedTime) snap.driveMtimes.prefix = prefixF.modifiedTime;
      if (appFile?.modifiedTime) snap.driveMtimes.app = appFile.modifiedTime;
      if (routineF?.modifiedTime) snap.driveMtimes.routine = routineF.modifiedTime;

      saveDriveSnapshot(snap);
    }

    // --- Notify UI to re-render ---
    // Renders are handled by main.js subscribers (SyncEvents.on('itemsMerged', ...))
    // so sync logic stays unaware of DOM. We pass editingMemoId so the memo editor
    // skips redrawing the focused textarea (preserves typing position).
    //
    // Only the domains whose stored JSON actually changed are announced. A poll
    // that merges to an identical result now emits nothing at all, so the screen
    // stays put instead of flashing a full re-render every 15s.
    const changedTypes = [];
    if (localStorage.getItem('mindflow_memos') !== _before.memo) changedTypes.push('memo');
    if (localStorage.getItem('mindflow_mindmaps') !== _before.mindmap) changedTypes.push('mindmap');
    if (localStorage.getItem('mindflow_tb_blocks') !== _before.timeblock) changedTypes.push('timeblock');
    if (localStorage.getItem('mindflow_journal_entries') !== _before.journal) changedTypes.push('journal');

    if (changedTypes.length > 0) {
      SyncEvents.emit('itemsMerged', {
        types: changedTypes,
        editingMemoId,
        focusedEl,
        focusSel
      });
    }
    return { changedTypes };
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
    const res = await applyDriveData(files);
    driveLastSyncAt = Date.now();
    driveLastModifiedTime = latestMtime;
    setDriveStatus('saved');
    // Only announce when something actually arrived. A silent boot pull that
    // changes nothing shouldn't interrupt with a toast — the header pill already
    // showed 동기화 중 → 동기화됨. Manual pulls always confirm, so the user knows
    // their button press did something.
    const changed = res?.changedTypes?.length > 0;
    if (changed) toast(`동기화 완료 (메모 ${memos.length}개)`, 'success');
    else if (!skipConfirm) toast('이미 최신 상태예요', 'success');
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

// 백그라운드에서 조용히 토큰만 새로 받아온다. 성공하면 true.
// OAuth 팝업/리다이렉트는 절대 띄우지 않는다 — 사용자가 아무것도 안 하고
// 있는데 인증 화면이 뜨면 안 되므로 silent 모드로만 시도한다.
// 진짜로 재인증이 필요한 경우(refresh_token 없음/폐기)에만 false를 돌려준다.
async function _driveTrySilentRefresh() {
  if (typeof driveClient === 'undefined') return false;
  try {
    await driveClient.ensureToken({ silent: true });
    return driveClient.hasValidToken();
  } catch {
    return false;
  }
}

async function drivePoll(force = false) {
  if (!driveFolderId || isLoadingFromDrive || isPushingToDrive) return;
  // 토큰이 없는 건 대개 일시적이다 — 선제 갱신 타이머가 아직 안 돌았거나,
  // 기기가 자고 일어나 setTimeout이 씹혔거나(iOS PWA에서 흔함), 네트워크가 잠깐
  // 끊겼을 때. refresh_token이 있으면 조용히 새로 받아오면 되는 상황인데
  // 예전엔 갱신을 시도하지도 않고 바로 error로 만들어, 15초마다 도는 폴링이
  // "동기화 실패"를 깜빡이게 했다. 실제로는 아무 문제도 없는 경우가 대부분이다.
  if (!hasValidDriveToken()) {
    if (!(await _driveTrySilentRefresh())) setDriveStatus('error');
    return;   // 갱신했어도 이번 틱은 넘기고 다음 15초에 정상 경로로 돈다
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
    // 다만 토큰 만료는 조용히 갱신하면 대부분 해결된다 — 갱신조차 실패할 때만
    // 실패로 표시한다. (예전엔 만료되자마자 error라서 "동기화 실패"가 떴다)
    if (!hasValidDriveToken() && !(await _driveTrySilentRefresh())) {
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
    // 여기서도 만료면 조용히 갱신을 먼저 시도한다. 예전엔 바로 포기하면서
    // 재시도 카운터까지 리셋해, 밀린 변경이 계속 안 올라가는 상태가 됐다.
    if (!hasValidDriveToken() && !(await _driveTrySilentRefresh())) {
      driveRetryAttempt = 0; return;
    }
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

  // Google Drive is the only sync method (Gist / 폴더 vault는 제거됨)
  const driveActive = !!driveFolderId;
  const status = driveActive ? driveStatus : 'idle';
  const lastSync = driveActive ? driveLastSyncAt : null;

  if (!driveActive) {
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


// =================== SAFE-AREA 진단 ===================
// iOS(특히 iPad)에서 상단 상태바 겹침 / 하단 잔여 여백을 진단하기 위한 패널.
// 별도 테스트 페이지 대신 앱 안에 두는 이유:
//   1) manifest scope가 './' 라서 같은 경로의 별도 HTML을 열면 iOS가 설치된
//      PWA를 대신 띄워버려 페이지가 안 열린다.
//   2) 여기서 재면 복사본이 아니라 실제 앱의 실제 CSS가 적용된 값이 나온다.
//      특히 .app의 computed padding과 탭바 높이는 수정이 먹었는지 직접 보여준다.
function _saInsets() {
  // env(safe-area-inset-*)는 JS에서 직접 못 읽으므로 probe 엘리먼트의 padding으로 환산
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;'
    + 'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);'
    + 'padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);';
  document.body.appendChild(p);
  const s = getComputedStyle(p);
  const v = {
    top: parseFloat(s.paddingTop) || 0,
    bottom: parseFloat(s.paddingBottom) || 0,
    left: parseFloat(s.paddingLeft) || 0,
    right: parseFloat(s.paddingRight) || 0,
  };
  p.remove();
  return v;
}

// 지정한 CSS 길이가 실제 몇 px로 해석되는지 실측 (100dvh 등)
function _measureLen(cssHeight) {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;visibility:hidden;height:' + cssHeight;
  document.body.appendChild(d);
  const h = d.getBoundingClientRect().height;
  d.remove();
  return h;
}

function renderAreaDiag() {
  const out = document.getElementById('area-diag-out');
  if (!out) return;
  const ins = _saInsets();
  const app = document.querySelector('.app');
  const tabs = document.getElementById('m-bottom-tabs');
  const hdr = document.querySelector('.header');
  const appCS = app ? getComputedStyle(app) : null;
  const tabsCS = tabs ? getComputedStyle(tabs) : null;
  const hdrCS = hdr ? getComputedStyle(hdr) : null;
  const standalone = navigator.standalone === true
    || matchMedia('(display-mode: standalone)').matches;

  const dvh = _measureLen('100dvh');
  const vh = _measureLen('100vh');
  const fill = _measureLen('-webkit-fill-available');
  const appRect = app ? app.getBoundingClientRect() : null;

  const rows = [
    ['SEC', 'safe-area 인셋 (실측)'],
    ['상단', ins.top + ' px'],
    ['하단', ins.bottom + ' px'],
    ['좌 / 우', ins.left + ' / ' + ins.right + ' px'],

    ['SEC', '.app 에 실제 적용된 padding'],
    ['padding-top', appCS ? appCS.paddingTop : '—'],
    ['padding-bottom', appCS ? appCS.paddingBottom : '—'],
    ['.app 실제 높이', appRect ? appRect.height.toFixed(1) + ' px' : '—'],
    ['.app 하단 y좌표', appRect ? appRect.bottom.toFixed(1) + ' px' : '—'],

    ['SEC', '뷰포트 높이 — 서로 다르면 원인'],
    ['innerHeight', window.innerHeight + ' px'],
    ['100dvh', dvh.toFixed(1) + ' px'],
    ['100vh', vh.toFixed(1) + ' px'],
    ['-webkit-fill-available', fill.toFixed(1) + ' px'],
    ['visualViewport.height', window.visualViewport ? window.visualViewport.height.toFixed(1) + ' px' : '—'],

    ['SEC', '헤더 — 상태바 영역을 덮는가'],
    ['높이', hdr ? hdr.getBoundingClientRect().height.toFixed(1) + ' px' : '—'],
    ['padding-top', hdrCS ? hdrCS.paddingTop : '—'],
    ['상단 y좌표', hdr ? hdr.getBoundingClientRect().top.toFixed(1) + ' px' : '—'],
    ['배경색', hdrCS ? hdrCS.backgroundColor : '—'],

    ['SEC', '하단 탭바'],
    ['표시 여부', tabsCS ? tabsCS.display : '—'],
    ['높이', tabs ? tabs.getBoundingClientRect().height.toFixed(1) + ' px' : '—'],
    ['padding-bottom', tabsCS ? tabsCS.paddingBottom : '—'],

    ['SEC', '환경'],
    ['화면 크기', window.innerWidth + ' × ' + window.innerHeight],
    ['PWA 앱으로 실행?', standalone ? '예' : '아니오 (Safari 탭)'],
    ['≤768px 규칙 적용?', matchMedia('(max-width: 768px)').matches ? '예' : '아니오'],
  ];

  // 자동 판정 — 수치가 모순되는 지점을 직접 지목
  const warn = [];
  if (!standalone) warn.push('홈화면 앱으로 열어야 정확합니다 (지금은 Safari 탭)');
  if (Math.abs(fill - dvh) > 1) {
    warn.push(`-webkit-fill-available(${fill.toFixed(0)}) ≠ 100dvh(${dvh.toFixed(0)}) — .app의 min-height가 height를 이겨 화면보다 길어질 수 있음`);
  }
  if (appRect && Math.abs(appRect.bottom - window.innerHeight) > 1) {
    warn.push(`.app 하단(${appRect.bottom.toFixed(0)})이 innerHeight(${window.innerHeight})와 어긋남 — 하단 여백의 직접 원인`);
  }
  if (standalone && ins.bottom === 0 && ins.top === 0) {
    warn.push('인셋이 모두 0 — viewport-fit=cover가 안 먹는 중일 수 있음');
  }
  // 헤더가 상태바 자리를 자기 배경으로 덮고 있는지 (색 다른 띠의 원인)
  if (hdr && ins.top > 0 && matchMedia('(max-width: 768px)').matches) {
    const r = hdr.getBoundingClientRect();
    if (r.top > 1) {
      warn.push(`헤더 상단이 y=${r.top.toFixed(0)} — 상태바 자리(${ins.top}px)를 헤더가 안 덮어 색이 다른 띠가 보임`);
    } else if (parseFloat(hdrCS.paddingTop) < ins.top - 1) {
      warn.push(`헤더 padding-top(${hdrCS.paddingTop})이 인셋(${ins.top}px)보다 작음 — 컨트롤이 상태바에 겹칠 수 있음`);
    }
  }

  let h = '<table style="width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;">';
  for (const [k, v] of rows) {
    if (k === 'SEC') {
      h += `</table><div style="margin-top:12px;font-size:11px;color:var(--accent2);font-weight:800;letter-spacing:.06em;">${v}</div>`
         + '<table style="width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;">';
      continue;
    }
    h += `<tr><td style="padding:4px 4px;border-bottom:1px solid var(--border-light);color:var(--text-mute);">${k}</td>`
       + `<td style="padding:4px 4px;border-bottom:1px solid var(--border-light);text-align:right;font-weight:700;">${v}</td></tr>`;
  }
  h += '</table>';
  h += `<div style="margin-top:12px;font-size:11px;color:var(--accent2);font-weight:800;letter-spacing:.06em;">자동 판정</div>`;
  h += warn.length
    ? '<div style="margin-top:6px;font-size:11.5px;line-height:1.6;color:var(--orange);">⚠️ ' + warn.join('<br>⚠️ ') + '</div>'
    : '<div style="margin-top:6px;font-size:11.5px;color:var(--green);">✅ 수치상 어긋난 곳 없음</div>';
  out.innerHTML = h;
}

// safe-area 영역과 화면 최상/최하단을 색으로 덮어 눈으로 확인 (토글)
function toggleAreaOverlay() {
  const id = 'area-diag-overlay';
  const cur = document.getElementById(id);
  if (cur) { cur.remove(); return; }
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;';
  el.innerHTML = `
    <div style="position:fixed;top:0;left:0;right:0;height:env(safe-area-inset-top,0px);background:rgba(255,214,10,.45);"></div>
    <div style="position:fixed;bottom:0;left:0;right:0;height:env(safe-area-inset-bottom,0px);background:rgba(255,214,10,.45);"></div>
    <div style="position:fixed;top:0;left:0;right:0;height:3px;background:#ff5f56;"></div>
    <div style="position:fixed;bottom:0;left:0;right:0;height:3px;background:#27c93f;"></div>`;
  document.body.appendChild(el);
  if (typeof toast === 'function') toast('노랑=safe-area · 빨강=최상단 · 초록=최하단 (다시 누르면 끄기)');
}

// =================== STORAGE USAGE PANEL ===================
// 동기화 모달의 저장공간 사용량 시각화. navigator.storage.estimate()는 전체
// origin 합계 (IDB + LS + Cache 등 모두 포함). 항목별 내역은 직접 계산해서
// "메모 X.X MB · 마인드맵 Y.Y MB" 형태로 분해 표시.
async function refreshStorageUsage() {
  const bar = document.getElementById('storage-usage-bar-fill');
  const txt = document.getElementById('storage-usage-text');
  if (!bar || !txt) return;
  txt.textContent = '측정 중…';

  // 1) 항목별 사이즈 — IDB(_kvCache)에서 직렬화 후 측정 (정확)
  const mb = (n) => (n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 3 : 2);
  const kb = (n) => (n / 1024).toFixed(1);
  const fmt = (n) => n >= 1024 * 1024 ? `${mb(n)} MB` : `${kb(n)} KB`;
  const byteSize = (v) => {
    try { return new Blob([typeof v === 'string' ? v : JSON.stringify(v)]).size; }
    catch { return 0; }
  };
  // 캐시에서 키별 사이즈 집계
  const breakdown = [];
  let totalKv = 0;
  if (typeof _kvCache !== 'undefined') {
    const groups = { memos: 0, mindmaps: 0, timeblocks: 0, journal: 0, routine: 0, etc: 0 };
    for (const [k, v] of _kvCache) {
      const sz = byteSize(v);
      totalKv += sz;
      if (k === 'memos' || k.startsWith('memo_')) groups.memos += sz;
      else if (k === 'mindmaps' || k.startsWith('mm_') || k.startsWith('mindmap_')) groups.mindmaps += sz;
      else if (k === 'tb_blocks' || k.startsWith('tb_')) groups.timeblocks += sz;
      else if (k.startsWith('journal')) groups.journal += sz;
      else if (k.startsWith('routine')) groups.routine += sz;
      else groups.etc += sz;
    }
    const items = [
      { l: '📝 메모', s: groups.memos },
      { l: '🧠 마인드맵', s: groups.mindmaps },
      { l: '📅 타임블록', s: groups.timeblocks },
      { l: '📔 일기', s: groups.journal },
      { l: '🔁 루틴', s: groups.routine },
      { l: '⚙️ 기타', s: groups.etc },
    ].filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    for (const x of items) breakdown.push(`${x.l} ${fmt(x.s)}`);
  }

  // 2) IDB 백업·버전 히스토리 등 별도 DB 사이즈는 estimate에 포함됨
  let estLine = '';
  let pct = 0;
  if (navigator.storage?.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (usage && quota) {
        pct = (usage / quota) * 100;
        estLine = `<strong>${mb(usage)} MB</strong> / ${(quota / 1024 / 1024 / 1024).toFixed(1)} GB (${pct.toFixed(2)}%)`;
      }
    } catch {}
  }

  bar.style.width = Math.min(100, pct).toFixed(1) + '%';
  bar.style.background = pct > 95 ? 'var(--red, #dc3545)'
                       : pct > 80 ? 'var(--yellow, #f5b400)'
                       : 'var(--accent)';

  txt.innerHTML = `
    <div style="margin-bottom:6px;">
      ${estLine || `<strong>${fmt(totalKv)}</strong> (브라우저 estimate 미지원)`}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--text-dim);">
      ${breakdown.map(x => `<span>${x}</span>`).join('')}
    </div>
    <div style="margin-top:6px;color:var(--text-mute);font-size:10.5px;">
      ${pct > 95 ? '⚠️ 한계 임박 — 안 쓰는 메모·마인드맵 정리 권장'
       : pct > 80 ? '⚠️ 사용량 많음 — 모니터링 필요'
       : '✅ 여유 충분 (IDB primary, 디스크의 ~60% 사용 가능)'}
      · 백업·버전 히스토리·이미지 포함 전체 합계
    </div>`;
}

