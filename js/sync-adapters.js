// =================== ITEM ADAPTERS (Layer 2) ===================
// Each adapter encapsulates type-specific concerns: how to serialize/parse,
// where its files live on Drive, how to detect conflicts, etc.
//
// SyncEngine (Layer 3) orchestrates push/pull but stays type-agnostic by
// delegating to these adapters.
//
// Adapter contract:
//   type            string identifier (used as snapshot key)
//   isSingleton     true for journal/prefix/app (one file, no per-id collection)
//   folderId(ctx)   which Drive folder its files live in
//   getLocalItems() current local data (collection adapters)
//   getLocalValue() current local value (singleton adapters)
//   getId(item)     extract stable id
//   getMtime(item)  extract updatedAt ISO
//   serialize(item) → { name, content, mime, appProperties }
//   parse(file, content)        → item parsed from Drive file
//   recoverId(file, parsedItem) → id (fallback chain for collections)
//   filterFiles(files)          → DriveFile[] this adapter cares about
//   merge(local, remote)        → 2-way merge winner
//   detectConflict(snap, remote, local) → 'noop' | 'push-only' | 'pull-only' | 'conflict'
//   createConflictCopy(remote)  → new item with name suffix + new id (collection only)

const _CONFLICT_TAG = 'conflict';

// ----- shared helpers -----
const _mtime = m => new Date((m && (m.updatedAt || m.date)) || 0).getTime();
function _conflictSuffix() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `(충돌 ${mm}-${dd} ${hh}:${mi})`;
}

// 3-way conflict detection. snap = "what we last pushed" mtime.
// Returns: 'noop' | 'push-only' | 'pull-only' | 'conflict'
function detectConflictByMtime(snapMtime, remoteMtime, localMtime) {
  const remoteChanged = !!remoteMtime && remoteMtime !== snapMtime;
  const localChanged = !!localMtime && localMtime !== snapMtime;
  if (!remoteChanged && !localChanged) return 'noop';
  if (!remoteChanged && localChanged) return 'push-only';
  if (remoteChanged && !localChanged) return 'pull-only';
  return 'conflict';
}

// =================== MEMO ADAPTER ===================
const MemoAdapter = {
  type: 'memo',
  isSingleton: false,

  folderId(ctx) { return ctx.memosFolderId || ctx.rootFolderId; },

  getLocalItems() { return (typeof memos !== 'undefined') ? memos : []; },

  getId(item) { return item.id; },
  getMtime(item) { return item.updatedAt || item.date || ''; },

  filterFiles(files) {
    return files.filter(f => f.name && f.name.toLowerCase().endsWith('.md'));
  },

  serialize(memo) {
    const updated = memo.updatedAt || memo.date || new Date().toISOString();
    const title = (memo.title || '').replace(/\n/g, ' ');
    const tagsLine = memo.tags && memo.tags.length ? `\ntags: [${memo.tags.map(t => JSON.stringify(t)).join(', ')}]` : '';
    const content = `---\nid: ${memo.id}\ntitle: ${title}\ndate: ${memo.date}\nupdated: ${updated}${tagsLine}\n---\n\n${memo.content || ''}`;
    // Filename dedup is engine's responsibility (it has all sibling memos)
    return { name: null, content, mime: 'text/markdown', appProperties: { memoId: String(memo.id) } };
  },

  parse(file, content) {
    if (typeof parseFrontmatter !== 'function') return null;
    const memo = parseFrontmatter(content, file.name, Date.now());
    return memo;
  },

  // Recovery chain: frontmatter id → appProperties.memoId → "{id}-..." filename
  recoverId(file, parsedMemo) {
    if (parsedMemo && parsedMemo.id) return parsedMemo.id;
    const propId = file.appProperties?.memoId ? parseInt(file.appProperties.memoId) : null;
    if (propId && !isNaN(propId)) return propId;
    const m = (file.name || '').match(/^(\d+)-/);
    return m ? parseInt(m[1]) : null;
  },

  merge(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return _mtime(local) > _mtime(remote) ? local : remote;
  },

  detectConflict(snap, remote, local) {
    return detectConflictByMtime(
      snap?.mtime || '',
      remote ? this.getMtime(remote) : '',
      local ? this.getMtime(local) : ''
    );
  },

  // Make a "conflict copy" of remote so local stays canonical and the user sees both.
  createConflictCopy(remote, ctx) {
    const newId = (ctx.nextMemoId && ctx.nextMemoId()) || (Date.now());
    const suffix = _conflictSuffix();
    const baseTitle = (remote.title || '').replace(/\s*\(충돌 [\d-]+ [\d:]+\)\s*$/, '');
    const tags = Array.from(new Set([...(remote.tags || []), _CONFLICT_TAG]));
    return {
      ...remote,
      id: newId,
      title: `${baseTitle} ${suffix}`.trim(),
      tags,
      updatedAt: new Date().toISOString(),
      date: remote.date || new Date().toISOString(),
    };
  },
};

// =================== MINDMAP ADAPTER ===================
const MindmapAdapter = {
  type: 'mindmap',
  isSingleton: false,

  folderId(ctx) { return ctx.mindmapsFolderId || ctx.rootFolderId; },

  getLocalItems() { return (typeof mindmaps !== 'undefined') ? mindmaps : []; },

  getId(item) { return item.id; },
  getMtime(item) { return item.updatedAt || ''; },

  filterFiles(files) {
    return files.filter(f => {
      const n = (f.name || '').toLowerCase();
      return n.startsWith('mindmap-') && n.endsWith('.json');
    });
  },

  serialize(mm) {
    const fname = `mindmap-${mm.id}.json`;
    const content = JSON.stringify(mm, null, 2);
    return { name: fname, content, mime: 'application/json', appProperties: null };
  },

  parse(file, content) {
    try { return JSON.parse(content); } catch { return null; }
  },

  recoverId(file, parsed) {
    if (parsed && parsed.id) return parsed.id;
    const m = (file.name || '').match(/^mindmap-(\d+)\.json$/i);
    return m ? parseInt(m[1]) : null;
  },

  merge(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return _mtime(local) > _mtime(remote) ? local : remote;
  },

  detectConflict(snap, remote, local) {
    return detectConflictByMtime(
      snap?.mtime || '',
      remote ? this.getMtime(remote) : '',
      local ? this.getMtime(local) : ''
    );
  },

  createConflictCopy(remote, ctx) {
    const newId = Date.now() + Math.floor(Math.random() * 1000);
    const suffix = _conflictSuffix();
    return {
      ...remote,
      id: newId,
      name: `${remote.name || '마인드맵'} ${suffix}`,
      updatedAt: new Date().toISOString(),
    };
  },
};

// =================== TIMEBLOCK ADAPTER (per-day) ===================
const TimeblockAdapter = {
  type: 'timeblock',
  isSingleton: false,

  folderId(ctx) { return ctx.timeblocksFolderId || ctx.rootFolderId; },

  // Local items: array of { dayKey, blocks, updatedAt } records
  getLocalItems() {
    const blocks = (typeof load === 'function') ? load('tb_blocks', {}) : {};
    const meta = (typeof load === 'function') ? load('tb_meta', {}) : {};
    return Object.keys(blocks).map(day => ({
      id: day,
      dayKey: day,
      blocks: blocks[day],
      updatedAt: meta[day] || ''
    }));
  },

  getId(item) { return item.dayKey || item.id; },
  getMtime(item) { return item.updatedAt || ''; },

  filterFiles(files) {
    return files.filter(f => {
      const n = (f.name || '').toLowerCase();
      return n.startsWith('timeblock-') && n.endsWith('.json');
    });
  },

  serialize(item) {
    const fname = `timeblock-${item.dayKey}.json`;
    const payload = JSON.stringify({
      blocks: item.blocks,
      updatedAt: item.updatedAt || new Date().toISOString()
    }, null, 2);
    return { name: fname, content: payload, mime: 'application/json', appProperties: null };
  },

  parse(file, content) {
    const m = (file.name || '').match(/^timeblock-(.+)\.json$/i);
    if (!m) return null;
    try {
      const data = JSON.parse(content);
      return { id: m[1], dayKey: m[1], blocks: data.blocks || [], updatedAt: data.updatedAt || '' };
    } catch { return null; }
  },

  recoverId(file, parsed) {
    if (parsed && parsed.dayKey) return parsed.dayKey;
    const m = (file.name || '').match(/^timeblock-(.+)\.json$/i);
    return m ? m[1] : null;
  },

  // Per-day merge: blocks-level union if no time conflicts, otherwise LWW.
  merge(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return _mtime(local) > _mtime(remote) ? local : remote;
  },

  detectConflict(snap, remote, local) {
    return detectConflictByMtime(
      snap?.mtime || '',
      remote ? this.getMtime(remote) : '',
      local ? this.getMtime(local) : ''
    );
  },

  createConflictCopy(remote) {
    // Conflict day cloned to "{day}__conflict__YYYYMMDD-HHMM" — separate dayKey
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
    const newKey = `${remote.dayKey}__conflict__${stamp}`;
    return { id: newKey, dayKey: newKey, blocks: remote.blocks, updatedAt: new Date().toISOString() };
  },
};

// =================== JOURNAL ADAPTER (singleton file, per-entry mtime) ===================
const JournalAdapter = {
  type: 'journal',
  isSingleton: true,

  folderId(ctx) { return ctx.rootFolderId; },

  getFilename() { return 'journal.json'; },

  // For singletons, "value" is the whole object. mtime is max entry updatedAt.
  getLocalValue() {
    return (typeof load === 'function') ? load('journal_entries', {}) : {};
  },

  getMtimeFromValue(entries) {
    return Object.values(entries || {}).reduce((acc, e) => {
      const u = (e && e.updatedAt) || '';
      return u > acc ? u : acc;
    }, '');
  },

  filterFiles(files) {
    return files.filter(f => f.name === 'journal.json');
  },

  serialize(entries) {
    const content = JSON.stringify({ entries, exportedAt: new Date().toISOString() }, null, 2);
    return { name: 'journal.json', content, mime: 'application/json', appProperties: null };
  },

  parse(file, content) {
    try { return JSON.parse(content)?.entries || {}; } catch { return null; }
  },

  // Per-entry merge by updatedAt
  merge(local, remote) {
    const out = { ...(remote || {}) };
    Object.entries(local || {}).forEach(([k, e]) => {
      const r = out[k];
      if (!r || _mtime(e) >= _mtime(r)) out[k] = e;
    });
    return out;
  },

  detectConflict(snap, remoteValue, localValue) {
    const remoteMtime = this.getMtimeFromValue(remoteValue);
    const localMtime = this.getMtimeFromValue(localValue);
    return detectConflictByMtime(snap?.mtime || '', remoteMtime, localMtime);
  },

  // For singleton conflict: merge by entry instead of duplicating files. Per-entry
  // LWW handles most cases; we don't make conflict copies for journal because the
  // merge function above already preserves both sides safely.
  createConflictCopy() { return null; },
};

// =================== PREFIX-COLORS ADAPTER (small singleton) ===================
const PrefixAdapter = {
  type: 'prefix',
  isSingleton: true,

  folderId(ctx) { return ctx.rootFolderId; },
  getFilename() { return 'tb-prefix-colors.json'; },

  getLocalValue() {
    return (typeof load === 'function') ? load('tb_prefix_colors', {}) : {};
  },

  // Hash by stringification (small dictionary)
  getMtimeFromValue(value) { return JSON.stringify(value); },

  filterFiles(files) { return files.filter(f => f.name === 'tb-prefix-colors.json'); },

  serialize(value) {
    return { name: 'tb-prefix-colors.json', content: JSON.stringify(value), mime: 'application/json', appProperties: null };
  },

  parse(file, content) {
    try { return JSON.parse(content); } catch { return null; }
  },

  // Union merge — both sides' keys preserved
  merge(local, remote) {
    return { ...(remote || {}), ...(local || {}) };
  },

  detectConflict(snap, remoteValue, localValue) {
    const remoteHash = this.getMtimeFromValue(remoteValue);
    const localHash = this.getMtimeFromValue(localValue);
    return detectConflictByMtime(snap?.hash || '', remoteHash, localHash);
  },

  createConflictCopy() { return null; },
};

// =================== APP-META ADAPTER (singleton) ===================
const AppMetaAdapter = {
  type: 'app',
  isSingleton: true,

  folderId(ctx) { return ctx.rootFolderId; },
  getFilename() { return '_mindflow-app.json'; },

  getLocalValue() {
    return {
      activeMindmapId: (typeof load === 'function') ? load('mm_active', null) : null,
      settings: (typeof load === 'function') ? load('settings', {}) : {}
    };
  },

  getMtimeFromValue(value) { return JSON.stringify(value); },

  filterFiles(files) { return files.filter(f => f.name === '_mindflow-app.json'); },

  serialize(value) {
    const data = { version: 3, app: 'mindflow', exportedAt: new Date().toISOString(), ...value };
    return { name: '_mindflow-app.json', content: JSON.stringify(data, null, 2), mime: 'application/json', appProperties: null };
  },

  parse(file, content) {
    try {
      const parsed = JSON.parse(content);
      if (parsed?.app !== 'mindflow') return null;
      return { activeMindmapId: parsed.activeMindmapId ?? null, settings: parsed.settings || {} };
    } catch { return null; }
  },

  // LWW (low stakes)
  merge(local, remote) { return remote || local; },

  detectConflict(snap, remoteValue, localValue) {
    const remoteHash = this.getMtimeFromValue(remoteValue);
    const localHash = this.getMtimeFromValue(localValue);
    return detectConflictByMtime(snap?.hash || '', remoteHash, localHash);
  },

  createConflictCopy() { return null; },
};

// =================== EXPORT ===================
window.SyncAdapters = {
  Memo: MemoAdapter,
  Mindmap: MindmapAdapter,
  Timeblock: TimeblockAdapter,
  Journal: JournalAdapter,
  Prefix: PrefixAdapter,
  AppMeta: AppMetaAdapter,
  // Helpers exposed for engine
  detectConflictByMtime,
  conflictSuffix: _conflictSuffix,
  CONFLICT_TAG: _CONFLICT_TAG,
};
