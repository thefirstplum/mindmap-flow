// =================== BACKUP SERVICE ===================
// IndexedDB-backed automatic snapshots of localStorage state. Independent of the
// Drive sync layer — exists so that even if sync logic ever loses data, the user
// can restore from a recent local backup.
//
// Trigger points:
//   - Before each Drive push (potential mutation of remote)
//   - Before each Drive pull (potential overwrite of local)
//   - Once per day (idle daily snapshot, in case of long quiet periods)
//   - On user demand (manual export)
//
// Storage: IndexedDB, separate database from any other state. Capped at the
// most recent BACKUP_KEEP_COUNT entries; older ones auto-pruned.

const BACKUP_DB_NAME = 'mindflow-backups';
const BACKUP_DB_VERSION = 1;
const BACKUP_STORE = 'snapshots';
const BACKUP_KEEP_COUNT = 10;
const BACKUP_DAILY_KEY = 'mindflow_backup_last_daily';

function _backupOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        const store = db.createObjectStore(BACKUP_STORE, { keyPath: 'timestamp' });
        store.createIndex('reason', 'reason', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Capture every mindflow_* key from localStorage into a single object
function _collectLocalState() {
  const state = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('mindflow_')) continue;
    // Skip internal sync metadata that has no user-data value AND would be
    // confusing to restore (e.g. drive token, dirty flag, snapshot)
    if (key === 'mindflow_drive_tok') continue;
    if (key === 'mindflow_drive_dirty') continue;
    if (key === 'mindflow_drive_push_snapshot') continue;
    if (key === 'mindflow_drive_changes_token') continue;
    state[key] = localStorage.getItem(key);
  }
  return state;
}

function _summarize(state) {
  const summary = {};
  try {
    const memos = JSON.parse(state['mindflow_memos'] || '[]');
    summary.memoCount = Array.isArray(memos) ? memos.length : 0;
  } catch { summary.memoCount = 0; }
  try {
    const mindmaps = JSON.parse(state['mindflow_mindmaps'] || '[]');
    summary.mindmapCount = Array.isArray(mindmaps) ? mindmaps.length : 0;
  } catch { summary.mindmapCount = 0; }
  try {
    const tb = JSON.parse(state['mindflow_tb_blocks'] || '{}');
    summary.timeblockDays = Object.keys(tb || {}).length;
  } catch { summary.timeblockDays = 0; }
  try {
    const j = JSON.parse(state['mindflow_journal_entries'] || '{}');
    summary.journalDays = Object.keys(j || {}).length;
  } catch { summary.journalDays = 0; }
  return summary;
}

const BackupService = {
  // Capture a snapshot of all user data. Optionally tag with a reason string.
  // Returns the timestamp (ISO) of the saved record.
  async snapshot(reason = 'manual') {
    const state = _collectLocalState();
    const summary = _summarize(state);
    const record = {
      timestamp: new Date().toISOString(),
      reason,
      summary,
      state,
      version: 1
    };
    try {
      const db = await _backupOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE, 'readwrite');
        tx.objectStore(BACKUP_STORE).put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      // Prune oldest if over keep-count
      await BackupService.cleanup();
      return record.timestamp;
    } catch (e) {
      console.warn('[Backup] snapshot failed:', e);
      throw e;
    }
  },

  // Take a daily snapshot at most once per 24 hours. Cheap to call frequently.
  async maybeDaily() {
    try {
      const last = localStorage.getItem(BACKUP_DAILY_KEY);
      const lastMs = last ? new Date(last).getTime() : 0;
      if (Date.now() - lastMs < 24 * 60 * 60 * 1000) return null;
      const ts = await BackupService.snapshot('daily');
      localStorage.setItem(BACKUP_DAILY_KEY, ts);
      return ts;
    } catch (e) {
      console.warn('[Backup] daily snapshot failed:', e);
      return null;
    }
  },

  // Newest first. Returns metadata only (no full state) — fast for UI list.
  async list() {
    try {
      const db = await _backupOpen();
      const records = await new Promise((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE, 'readonly');
        const req = tx.objectStore(BACKUP_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      return records
        .map(r => ({ timestamp: r.timestamp, reason: r.reason, summary: r.summary }))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } catch (e) {
      console.warn('[Backup] list failed:', e);
      return [];
    }
  },

  // Get full state of a backup (for restore or export)
  async get(timestamp) {
    const db = await _backupOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE, 'readonly');
      const req = tx.objectStore(BACKUP_STORE).get(timestamp);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  // Restore localStorage from a backup. Takes a fresh "pre-restore" snapshot
  // first so the user can undo. Reloads page to make in-memory state consistent.
  async restore(timestamp) {
    const record = await BackupService.get(timestamp);
    if (!record) throw new Error('백업을 찾을 수 없습니다');
    // Safety net: snapshot current state before overwriting it
    await BackupService.snapshot('pre-restore');
    // Replace mindflow_* keys with backed-up values. Keep auth tokens etc.
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('mindflow_')) continue;
      if (key === 'mindflow_drive_tok') continue;
      keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    Object.entries(record.state).forEach(([k, v]) => {
      try { localStorage.setItem(k, v); } catch (e) { console.warn('restore set failed:', k, e); }
    });
    return record;
  },

  // Download a backup as JSON file (manual escape hatch)
  async export(timestamp) {
    const record = await BackupService.get(timestamp);
    if (!record) throw new Error('백업을 찾을 수 없습니다');
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mindflow-backup-${record.timestamp.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  },

  async delete(timestamp) {
    const db = await _backupOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE, 'readwrite');
      tx.objectStore(BACKUP_STORE).delete(timestamp);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  // Drop oldest entries when over BACKUP_KEEP_COUNT
  async cleanup() {
    const records = await BackupService.list();
    if (records.length <= BACKUP_KEEP_COUNT) return 0;
    const toDelete = records.slice(BACKUP_KEEP_COUNT);
    for (const r of toDelete) {
      try { await BackupService.delete(r.timestamp); } catch {}
    }
    return toDelete.length;
  },

  // Run pre-push/pre-pull snapshot but never block the sync if it fails.
  // Sync layer should call this without await blocking on errors.
  async safeSnapshot(reason) {
    try { return await BackupService.snapshot(reason); }
    catch (e) { console.warn(`[Backup] ${reason} snapshot failed:`, e); return null; }
  }
};

// Expose globally so sync.js and UI can call it without an import
window.BackupService = BackupService;
