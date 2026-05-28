// =================== NOTES (memo + mindmap unified) ===================
let memos = load('memos', []);
let activeMemoId = null;
let memoIdCounter = load('memo_idcounter', 1);
let activeTagFilter = null;
let memoSortMode = load('memo_sort', 'updated');  // 'updated' | 'created' | 'title'
// Which kind of note the detail pane is showing: 'memo' (text) or 'mindmap'.
let activeNoteType = 'memo';

// Collect memos + mindmaps into one normalised list of "note" descriptors.
// memos[] and mindmaps[] stay separate on disk — this is a view-layer merge.
function getAllNotes() {
  const out = [];
  for (const m of memos) {
    out.push({
      type: 'memo', id: m.id,
      title: m.title || '',
      pinned: !!m.pinned,
      tags: m.tags || [],
      updatedAt: m.updatedAt || m.date,
      createdAt: m.date,
      searchText: ((m.title || '') + ' ' + (m.content || '')).toLowerCase(),
      content: m.content || '',
      ref: m
    });
  }
  if (typeof mindmaps !== 'undefined' && Array.isArray(mindmaps)) {
    for (const mm of mindmaps) {
      const nodeText = (mm.nodes || []).map(n => n.text || '').join(' ');
      out.push({
        type: 'mindmap', id: mm.id,
        title: mm.name || '',
        pinned: !!mm.pinned,
        tags: mm.tags || [],
        updatedAt: mm.updatedAt || mm.createdAt,
        createdAt: mm.createdAt,
        searchText: ((mm.name || '') + ' ' + nodeText).toLowerCase(),
        nodeCount: (mm.nodes || []).length,
        edgeCount: (mm.edges || []).length,
        ref: mm
      });
    }
  }
  return out;
}

// True when the notes view is the one on screen — tag-tree highlights only
// show then (otherwise the calendar page would look like it has a tag selected).
function notesViewActive() {
  return typeof currentPage === 'undefined' || currentPage === 'memo';
}

// Is this note the one currently open in the detail pane?
function isActiveNote(type, id) {
  if (type === 'mindmap') return activeNoteType === 'mindmap' && typeof activeMindmapId !== 'undefined' && id === activeMindmapId;
  return activeNoteType === 'memo' && id === activeMemoId;
}

// Open a note — routes to the text editor or the mindmap canvas by type.
function selectNote(type, id) {
  const page = document.getElementById('memo-page');
  if (type === 'mindmap') {
    activeNoteType = 'mindmap';
    activeMemoId = null;
    if (page) page.classList.add('note-mindmap', 'show-editor');
    if (typeof switchMindmap === 'function') switchMindmap(id);
    if (typeof renderMindmapTags === 'function') renderMindmapTags();
    renderMemoList();
    if (typeof resizeCanvas === 'function') setTimeout(resizeCanvas, 40);
    else if (typeof drawMindMap === 'function') drawMindMap();
  } else {
    activeNoteType = 'memo';
    activeMemoId = id;
    if (page) { page.classList.remove('note-mindmap'); page.classList.add('show-editor'); }
    renderMemoList();
    renderMemoEditor();
  }
}

// Delete a note by type — used by swipe-to-delete on the unified list.
function deleteNote(type, id) {
  if (type === 'mindmap') {
    if (typeof deleteMindmapById === 'function') deleteMindmapById(id);
    return;
  }
  deleteMemo(id);
}


// =================== HIERARCHICAL TAG TREE ===================
// Tags use "/" as a level separator (#work/proja). The notes list shows a
// collapsible tree; clicking a node filters to that tag and all its children.
let tagCollapsed = new Set(load('tag_collapsed', []));

function toggleTagNode(ev, path) {
  if (ev) ev.stopPropagation();
  if (tagCollapsed.has(path)) tagCollapsed.delete(path);
  else tagCollapsed.add(path);
  save('tag_collapsed', [...tagCollapsed]);
  renderMemoList();
}

// Build a nested tree out of every full tag found across all notes.
function buildTagTree(allNotes) {
  const fullTags = new Set();
  for (const n of allNotes) for (const t of (n.tags || [])) fullTags.add(t);
  const root = { children: new Map() };
  for (const full of fullTags) {
    const parts = full.split('/').filter(Boolean);
    let node = root, path = '';
    for (const part of parts) {
      path = path ? path + '/' + part : part;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path, children: new Map(), count: 0 });
      }
      node = node.children.get(part);
    }
  }
  // Count = distinct notes matching this tag OR any descendant tag
  const matches = (tags, path) => (tags || []).some(t => t === path || t.startsWith(path + '/'));
  (function fill(node) {
    for (const child of node.children.values()) {
      let c = 0;
      for (const n of allNotes) if (matches(n.tags, child.path)) c++;
      child.count = c;
      fill(child);
    }
  })(root);
  return root;
}

const _TAG_CHEVRON = '<span class="mi mi-sm">expand_more</span>';

function renderTagTree(node, depth) {
  const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  let html = '';
  for (const child of kids) {
    const hasKids = child.children.size > 0;
    const collapsed = tagCollapsed.has(child.path);
    const isActive = activeTagFilter === child.path && notesViewActive();
    const safe = JSON.stringify(child.path).replace(/"/g, '&quot;');
    const expander = hasKids
      ? `<button class="tag-expand${collapsed ? ' collapsed' : ''}" onclick="toggleTagNode(event, ${safe})" aria-label="펼치기/접기">${_TAG_CHEVRON}</button>`
      : '<span class="tag-expand-spacer"></span>';
    html += `<div class="tag-row${isActive ? ' active' : ''}" style="--tag-depth:${depth}" onclick="setTagFilter(${safe})">
      ${expander}
      <span class="tag-hash">#</span>
      <span class="tag-row-label">${escapeHtml(child.name)}</span>
      <span class="tag-row-count">${child.count}</span>
    </div>`;
    if (hasKids && !collapsed) html += renderTagTree(child, depth + 1);
  }
  return html;
}
const MEMO_SORT_LABELS = { updated: '수정일순', created: '생성일순', title: '제목순' };

// Note-type filter: 'all' | 'memo' | 'mindmap'
let noteTypeFilter = load('note_type_filter', 'all');

function cycleMemoSort() {
  const order = ['updated', 'created', 'title'];
  memoSortMode = order[(order.indexOf(memoSortMode) + 1) % order.length];
  save('memo_sort', memoSortMode);
  renderMemoList();
}

function setNoteTypeFilter(t) {
  noteTypeFilter = t;
  save('note_type_filter', t);
  renderMemoList();
}

function togglePinNote(type, id, ev) {
  if (ev) ev.stopPropagation();
  // 고정 토글은 수정시각을 바꾸지 않는다 (정렬 흔들림 방지)
  if (type === 'mindmap') {
    const mm = (typeof mindmaps !== 'undefined' ? mindmaps : []).find(x => x.id === id);
    if (!mm) return;
    mm.pinned = !mm.pinned;
    save('mindmaps', mindmaps);
  } else {
    const m = memos.find(x => x.id === id);
    if (!m) return;
    m.pinned = !m.pinned;
    saveMemos();
  }
  if (typeof haptic === 'function') haptic('light');
  renderMemoList();
}
// Back-compat alias for text memos
function togglePinMemo(id, ev) { togglePinNote('memo', id, ev); }

// =================== NOTE CONTEXT MENU (우클릭/long-press) ===================
// 메모/마인드맵 목록 항목 우클릭 시 액션 시트를 띄운다.
// 마인드맵은 기존 showMindmapMenu 재사용, 메모는 자체 시트.
let memoMenuTargetId = null;

function showNoteMenu(type, id, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (memoSelectMode) return; // 선택 모드에선 무시
  if (type === 'mindmap') {
    if (typeof showMindmapMenu === 'function') showMindmapMenu(id);
    return;
  }
  const m = memos.find(x => x.id === id);
  if (!m) return;
  memoMenuTargetId = id;
  document.getElementById('memo-action-title').textContent = m.title || '제목 없음';
  const pinBtn = document.getElementById('memo-action-pin');
  if (pinBtn) {
    const pinIcon = '<span class="mi mi-sm' + (m.pinned ? ' mi-fill' : '') + '">push_pin</span>';
    pinBtn.innerHTML = pinIcon + ' ' + (m.pinned ? '고정 해제' : '고정');
  }
  document.getElementById('memo-action-overlay').classList.add('show');
  document.getElementById('memo-action-sheet').classList.add('show');
}

function closeMemoMenu() {
  document.getElementById('memo-action-overlay').classList.remove('show');
  document.getElementById('memo-action-sheet').classList.remove('show');
  memoMenuTargetId = null;
}

function togglePinMemoActive() {
  const id = memoMenuTargetId;
  closeMemoMenu();
  togglePinNote('memo', id);
}

async function renameMemoActive() {
  const id = memoMenuTargetId;
  closeMemoMenu();
  const m = memos.find(x => x.id === id);
  if (!m) return;
  const name = await promptDialog('새 이름', m.title || '', { placeholder: '메모 제목' });
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  m.title = trimmed;
  m.updatedAt = new Date().toISOString();
  saveMemos();
  renderMemoList();
  if (activeMemoId === id) renderMemoEditor();
}

function duplicateMemoActive() {
  const id = memoMenuTargetId;
  closeMemoMenu();
  const m = memos.find(x => x.id === id);
  if (!m) return;
  const copy = JSON.parse(JSON.stringify(m));
  copy.id = memoIdCounter++;
  copy.title = (m.title || '제목 없음') + ' (복사)';
  const now = new Date().toISOString();
  copy.createdAt = now;
  copy.updatedAt = now;
  copy.date = now;
  copy.pinned = false;
  const insertIdx = memos.findIndex(x => x.id === id);
  memos.splice(insertIdx + 1, 0, copy);
  saveMemos();
  renderMemoList();
  toast(`"${copy.title}" 복제됨`, 'success');
}

function deleteMemoActive() {
  const id = memoMenuTargetId;
  closeMemoMenu();
  deleteMemo(id);
}

// 메모 → 현재 활성 마인드맵에 노드로 추가하고 양방향 연결
function addMemoToActiveMindmap() {
  const id = memoMenuTargetId;
  closeMemoMenu();
  const m = memos.find(x => x.id === id);
  if (!m) return;
  if (typeof mindmaps === 'undefined' || mindmaps.length === 0) {
    toast('먼저 마인드맵을 만드세요'); return;
  }
  const map = mindmaps.find(x => x.id === activeMindmapId) || mindmaps[0];
  if (!map) { toast('마인드맵을 찾을 수 없어요'); return; }
  // 화면 중앙 근처에 살짝 랜덤 위치
  const cx = 400 + Math.floor((Math.random() - 0.5) * 200);
  const cy = 300 + Math.floor((Math.random() - 0.5) * 200);
  const newNode = {
    id: (map.idCounter || 1),
    text: (m.title || '제목 없음').slice(0, 30),
    x: cx, y: cy,
    color: '#268bd2',
    noteId: m.id
  };
  map.nodes = map.nodes || [];
  map.nodes.push(newNode);
  map.idCounter = (map.idCounter || 1) + 1;
  map.updatedAt = new Date().toISOString();
  save('mindmaps', mindmaps);
  // 활성 마인드맵으로 이동
  activeMindmapId = map.id;
  save('mm_active', activeMindmapId);
  if (typeof bindActiveMap === 'function') bindActiveMap();
  if (typeof drawMindMap === 'function') drawMindMap();
  if (typeof navigateTo === 'function' && currentPage !== 'memo') navigateTo('memo', { updateHash: false });
  if (typeof selectNote === 'function') selectNote('mindmap', map.id);
  toast(`"${m.title || '제목'}" 마인드맵 "${map.name}"에 추가됨`, 'success');
}

function saveMemos() {
  save('memos', memos);
  save('memo_idcounter', memoIdCounter);
}

// =================== MULTI-SELECT MODE ===================
let memoSelectMode = false;
let memoSelectedIds = new Set();

function toggleMemoSelectMode() {
  memoSelectMode = !memoSelectMode;
  memoSelectedIds.clear();
  renderMemoList();
}

function exitMemoSelectMode() {
  memoSelectMode = false;
  memoSelectedIds.clear();
  renderMemoList();
}

function toggleMemoSelected(id, ev) {
  if (ev) { ev.stopPropagation(); }
  if (memoSelectedIds.has(id)) memoSelectedIds.delete(id);
  else memoSelectedIds.add(id);
  renderMemoList();
}

function selectAllMemosInView() {
  const search = (document.getElementById('memo-search')?.value || '').toLowerCase();
  const visible = memos.filter(m =>
    (m.title.toLowerCase().includes(search) || m.content.toLowerCase().includes(search)) &&
    (!activeTagFilter || (m.tags || []).includes(activeTagFilter))
  );
  visible.forEach(m => memoSelectedIds.add(m.id));
  renderMemoList();
}

async function bulkDeleteSelectedMemos() {
  if (memoSelectedIds.size === 0) { toast('선택된 메모가 없어요'); return; }
  const n = memoSelectedIds.size;
  if (!(await confirmDialog(`선택한 ${n}개 메모를 삭제할까요?\n(백업이 자동 생성됩니다)`, { danger: true, okText: '삭제' }))) return;
  // Pre-bulk backup
  if (typeof BackupService !== 'undefined') {
    BackupService.safeSnapshot('pre-bulk-delete').catch(() => {});
  }
  const tombs = load('memo_tombstones', {});
  const now = new Date().toISOString();
  for (const id of memoSelectedIds) tombs[id] = now;
  save('memo_tombstones', tombs);
  memos = memos.filter(m => !memoSelectedIds.has(m.id));
  if (memoSelectedIds.has(activeMemoId)) activeMemoId = null;
  saveMemos();
  exitMemoSelectMode();
  renderMemoEditor();
  backToList();
  toast(`${n}개 메모 삭제됨`, 'success');
}

async function bulkAddTagToSelectedMemos() {
  if (memoSelectedIds.size === 0) { toast('선택된 메모가 없어요'); return; }
  const tag = await promptDialog('추가할 태그 (쉼표로 여러 개 가능)', '', { placeholder: '예: work, idea' });
  if (!tag) return;
  const tags = tag.split(',').map(t => t.trim()).filter(Boolean);
  if (tags.length === 0) return;
  let count = 0;
  for (const m of memos) {
    if (!memoSelectedIds.has(m.id)) continue;
    if (!m.tags) m.tags = [];
    let added = false;
    for (const t of tags) {
      if (!m.tags.includes(t)) { m.tags.push(t); added = true; }
    }
    if (added) { touchMemo(m); count++; }
  }
  saveMemos();
  renderMemoList();
  toast(`${count}개 메모에 태그 추가됨`, 'success');
}

async function bulkRemoveTagFromSelectedMemos() {
  if (memoSelectedIds.size === 0) { toast('선택된 메모가 없어요'); return; }
  // Build the union of tags across selected memos for a picker
  const sel = memos.filter(m => memoSelectedIds.has(m.id));
  const allTags = [...new Set(sel.flatMap(m => m.tags || []))].sort();
  if (allTags.length === 0) { toast('선택된 메모에 태그가 없어요'); return; }
  const tag = await promptDialog(`삭제할 태그`, '', { placeholder: `예: ${allTags.slice(0, 3).join(', ')}` });
  if (!tag) return;
  const t = tag.trim();
  let count = 0;
  for (const m of memos) {
    if (!memoSelectedIds.has(m.id)) continue;
    if (m.tags && m.tags.includes(t)) {
      m.tags = m.tags.filter(x => x !== t);
      touchMemo(m);
      count++;
    }
  }
  saveMemos();
  renderMemoList();
  toast(`${count}개 메모에서 "${t}" 태그 제거됨`, 'success');
}

// Bump modification time. Sync uses updatedAt to decide which side wins
// during merge; date stays in sync for backward-compat with old memos and
// for the existing list UI that formats "오늘 hh:mm" etc.
function touchMemo(memo) {
  const now = new Date().toISOString();
  memo.updatedAt = now;
  memo.date = now;
}

// =================== INLINE HASHTAG (Bear-style) ===================
// Source of truth = memo.content. memo.tags is always derived from extraction.
// + button inserts "#tag" into content; ✕ removes "#tag" from content;
// editing content directly (typing/deleting #tag) updates the chip list.
// Hierarchical tags: "#work/proja" — '/' separates levels (Bear-style).
const HASHTAG_RE = /(?:^|[\s,.;:!?(){}\[\]"'`])#([가-힣a-zA-Z][가-힣\w-]*(?:\/[가-힣\w-]+)*)/g;
const _BOUNDARY_SET = `[\\s,.;:!?(){}\\[\\]"'\`]`;

function extractHashtags(content) {
  if (!content) return [];
  const found = new Set();
  for (const m of content.matchAll(HASHTAG_RE)) {
    found.add(m[1]);
  }
  return [...found];
}

function _escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function _hasInlineTag(content, tag) {
  if (!content || !tag) return false;
  const re = new RegExp(`(?:^|${_BOUNDARY_SET})#${_escapeRe(tag)}(?=$|${_BOUNDARY_SET})`);
  return re.test(content);
}

function _addInlineTag(content, tag) {
  if (_hasInlineTag(content, tag)) return content;
  const c = content || '';
  const sep = c.length === 0 ? '' : (c.endsWith('\n') ? '' : '\n');
  return c + sep + '#' + tag;
}

function _removeInlineTag(content, tag) {
  if (!content) return '';
  // Match leading boundary char so we can preserve word separators around the tag.
  const re = new RegExp(`(^|${_BOUNDARY_SET})#${_escapeRe(tag)}(?=$|${_BOUNDARY_SET})`, 'g');
  let out = content.replace(re, '$1');
  // If a leading newline was the boundary, we may have left "\n\n" — collapse trailing whitespace cleanly
  out = out.replace(/[ \t]+\n/g, '\n');
  return out;
}

// Re-derive memo.tags from current content. Returns true if tags actually changed.
function syncMemoHashtags(memo) {
  const inline = extractHashtags(memo.content || '');
  const old = memo.tags || [];
  const oldSet = new Set(old);
  const newSet = new Set(inline);
  const same = oldSet.size === newSet.size && [...newSet].every(t => oldSet.has(t));
  if (same) return false;
  memo.tags = inline;
  return true;
}

// One-time migration: ensure every existing tag has its inline #tag in content,
// then re-derive tags. After this runs, content is the source of truth.
// Idempotent via localStorage flag.
function migrateHashtagsFromContent() {
  const KEY = 'mindflow_hashtag_migration_v2';
  try { if (localStorage.getItem(KEY)) return; } catch { return; }
  if (typeof memos === 'undefined' || !Array.isArray(memos)) return;
  let touchedCount = 0;
  for (const m of memos) {
    const oldContent = m.content || '';
    let content = oldContent;
    // Ensure every existing tag is represented inline
    for (const t of (m.tags || [])) {
      if (!_hasInlineTag(content, t)) content = _addInlineTag(content, t);
    }
    const contentChanged = content !== oldContent;
    if (contentChanged) m.content = content;
    const tagsChanged = syncMemoHashtags(m);
    if (contentChanged || tagsChanged) {
      touchMemo(m);
      touchedCount++;
    }
  }
  if (touchedCount > 0) {
    saveMemos();
    if (typeof renderMemoList === 'function') renderMemoList();
    if (typeof renderMemoEditor === 'function') renderMemoEditor();
    if (typeof toast === 'function') {
      toast(`${touchedCount}개 메모의 태그를 본문에 동기화했어요`, 'success');
    }
    console.log(`[Migration] Synced ${touchedCount} memos: tags ↔ content`);
  }
  try { localStorage.setItem(KEY, '1'); } catch {}
}

function createMemo() {
  const now = new Date().toISOString();
  const memo = { id: memoIdCounter++, title: '새 메모', content: '', date: now, updatedAt: now, tags: [] };
  memos.unshift(memo);
  activeNoteType = 'memo';
  activeMemoId = memo.id;
  // New memos open in live mode so user gets Bear-style inline editing
  memoMode = 'live';
  save('memo_mode', 'live');
  saveMemos();
  renderMemoList();
  renderMemoEditor();
  const page = document.getElementById('memo-page');
  page.classList.remove('note-mindmap');
  page.classList.add('show-editor');
  setTimeout(() => {
    const inp = document.querySelector('.memo-editor-header input');
    if (inp) { inp.focus(); inp.select(); }
  }, 100);
}

function selectMemo(id) {
  selectNote('memo', id);
}

function backToList() {
  document.getElementById('memo-page').classList.remove('show-editor');
}

async function deleteMemo(id) {
  if (!(await confirmDialog('이 메모를 삭제하시겠습니까?', { danger: true, okText: '삭제' }))) return;
  // Record deletion so Drive pull can't resurrect it
  const tombs = load('memo_tombstones', {});
  tombs[id] = new Date().toISOString();
  save('memo_tombstones', tombs);
  memos = memos.filter(m => m.id !== id);
  if (activeMemoId === id) activeMemoId = null;
  saveMemos();
  renderMemoList();
  renderMemoEditor();
  backToList();
  toast('삭제되었습니다');
}

// =================== SEARCH QUERY PARSER ===================
// Bear-style search operators on top of substring matching:
//   tag:work        — has tag (or descendant of, slash-hierarchy)
//   type:memo|mindmap
//   is:pinned|untagged|conflict
//   "exact phrase"  — substring with spaces
//   -foo            — must NOT contain
//   bare word       — substring
function parseSearchQuery(raw) {
  const tokens = [];
  if (!raw) return tokens;
  // Split respecting "quoted" segments and -negation prefix and key:value
  const re = /(-?)((?:tag|type|is):)?(?:"([^"]*)"|(\S+))/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const neg = m[1] === '-';
    const key = m[2] ? m[2].slice(0, -1).toLowerCase() : null; // strip ':'
    const val = (m[3] !== undefined ? m[3] : m[4] || '').toLowerCase();
    if (!val && !key) continue;
    tokens.push({ neg, key, val });
  }
  return tokens;
}

function evalSearchQuery(note, tokens) {
  if (!tokens.length) return true;
  const text = (note.searchText || ((note.title || '') + ' ' + (note.content || '')).toLowerCase());
  for (const t of tokens) {
    let pass;
    if (t.key === 'tag') {
      const tag = t.val.replace(/^#/, '');
      pass = (note.tags || []).some(x => {
        const lx = (x || '').toLowerCase();
        return lx === tag || lx.startsWith(tag + '/');
      });
    } else if (t.key === 'type') {
      pass = note.type === t.val;
    } else if (t.key === 'is') {
      if (t.val === 'pinned') pass = !!note.pinned;
      else if (t.val === 'untagged') pass = (note.tags || []).length === 0;
      else if (t.val === 'conflict') {
        pass = (note.tags || []).includes('conflict') ||
               ((note.title || note.name || '').includes('(충돌'));
      } else pass = false;
    } else {
      pass = text.includes(t.val);
    }
    if (t.neg) pass = !pass;
    if (!pass) return false;
  }
  return true;
}

function _escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Build a preview snippet centered around the first matched bare token
function previewSnippetWithMatch(content, tokens) {
  const text = content.replace(/^#+\s+.*$/gm, '').replace(/[*_`>#]/g, '').replace(/\n+/g, ' ');
  const word = tokens.find(t => !t.key && !t.neg && t.val)?.val;
  if (!word) return text.trim().slice(0, 90);
  const idx = text.toLowerCase().indexOf(word);
  if (idx < 0) return text.trim().slice(0, 90);
  const start = Math.max(0, idx - 25);
  const end = Math.min(text.length, idx + word.length + 65);
  return (start > 0 ? '… ' : '') + text.slice(start, end).trim() + (end < text.length ? ' …' : '');
}

function highlightSearchMatch(html, tokens) {
  if (!tokens.length) return html;
  let out = html;
  for (const t of tokens) {
    if (t.key || t.neg || !t.val) continue;
    out = out.replace(new RegExp(`(${_escapeRegex(t.val)})`, 'gi'), '<mark>$1</mark>');
  }
  return out;
}

function renderMemoList() {
  const searchRaw = document.getElementById('memo-search').value;
  const search = searchRaw.toLowerCase();
  const searchTokens = parseSearchQuery(searchRaw);
  const allNotes = getAllNotes();

  // Tag filter — hierarchical tree (Bear-style). Mindmaps carry no tags so
  // they always fall under "태그 없음".
  let untaggedCount = 0;
  for (const n of allNotes) {
    if ((n.tags || []).length === 0) untaggedCount++;
  }
  const tagTree = buildTagTree(allNotes);

  // Sort control + note-type filter — lives in the note list panel
  const sortBar = document.getElementById('memo-sort-bar');
  if (sortBar) {
    const typeSeg = `<div class="note-type-seg">
      <button class="${noteTypeFilter === 'all' ? 'active' : ''}" onclick="setNoteTypeFilter('all')">전체</button>
      <button class="${noteTypeFilter === 'memo' ? 'active' : ''}" onclick="setNoteTypeFilter('memo')">메모</button>
      <button class="${noteTypeFilter === 'mindmap' ? 'active' : ''}" onclick="setNoteTypeFilter('mindmap')">마인드맵</button>
    </div>`;
    sortBar.innerHTML = `<div class="memo-sort-row">${typeSeg}<button class="memo-sort-btn" onclick="cycleMemoSort()" title="정렬 기준 변경">
      <span class="mi mi-sm">swap_vert</span>
      <span>${MEMO_SORT_LABELS[memoSortMode]}</span></button></div>`;
  }

  // Tag tree — lives in the sidebar: "전체 노트" + 계층형 #태그 + "태그 없음"
  const tagBar = document.getElementById('memo-tag-bar');
  if (tagBar) {
    const allRow = `<div class="tag-row tag-row-special${(!activeTagFilter && notesViewActive()) ? ' active' : ''}" onclick="setTagFilter(null)">
      <span class="tag-expand-spacer"></span>
      <span class="tag-row-label">전체 노트</span>
      <span class="tag-row-count">${allNotes.length}</span>
    </div>`;
    const untaggedRow = untaggedCount > 0
      ? `<div class="tag-row tag-row-special${(activeTagFilter === '__untagged__' && notesViewActive()) ? ' active' : ''}" onclick="setTagFilter('__untagged__')">
          <span class="tag-expand-spacer"></span>
          <span class="tag-row-label">태그 없음</span>
          <span class="tag-row-count">${untaggedCount}</span>
        </div>`
      : '';
    const tagsLabel = tagTree.children.size > 0 ? `<div class="tag-tree-label">태그</div>` : '';
    tagBar.innerHTML = `${allRow}${untaggedRow}${tagsLabel}<div class="tag-tree">${renderTagTree(tagTree, 0)}</div>`;
  }

  const filtered = allNotes.filter(n => {
    if (noteTypeFilter !== 'all' && n.type !== noteTypeFilter) return false;
    if (searchTokens.length && !evalSearchQuery(n, searchTokens)) return false;
    if (!activeTagFilter) return true;
    if (activeTagFilter === '__untagged__') return (n.tags || []).length === 0;
    // Selecting a parent tag also matches all of its child tags
    return (n.tags || []).some(t => t === activeTagFilter || t.startsWith(activeTagFilter + '/'));
  }).sort((a, b) => {
    // 고정 노트는 항상 위로
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (memoSortMode === 'title') {
      return (a.title || '').localeCompare(b.title || '', 'ko');
    }
    if (memoSortMode === 'created') {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    }
    // 'updated' (기본) — 수정 최신순
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
  const container = document.getElementById('memo-items');
  const countEl = document.getElementById('memo-count');
  if (countEl) countEl.textContent = allNotes.length;

  // Render select-mode toolbar (multi-select applies to text memos only)
  const toolbar = document.getElementById('memo-select-toolbar');
  if (toolbar) {
    if (memoSelectMode) {
      const n = memoSelectedIds.size;
      toolbar.style.display = '';
      toolbar.innerHTML = `
        <div class="memo-select-bar">
          <span class="memo-select-count">${n}개 선택</span>
          <button class="memo-select-btn" onclick="selectAllMemosInView()">전체</button>
          <button class="memo-select-btn" onclick="bulkAddTagToSelectedMemos()" ${n===0?'disabled':''}><span class="mi mi-sm">label</span> 태그추가</button>
          <button class="memo-select-btn" onclick="bulkRemoveTagFromSelectedMemos()" ${n===0?'disabled':''}><span class="mi mi-sm">label_off</span> 태그제거</button>
          <button class="memo-select-btn danger" onclick="bulkDeleteSelectedMemos()" ${n===0?'disabled':''}><span class="mi mi-sm">delete</span> 삭제</button>
          <button class="memo-select-btn" onclick="exitMemoSelectMode()">완료</button>
        </div>`;
    } else {
      toolbar.style.display = 'none';
      toolbar.innerHTML = '';
    }
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="memo-empty">
      <span class="mi big-icon">edit_note</span>
      ${allNotes.length === 0 ? '아직 노트가 없습니다<br>+ 버튼을 눌러 시작하세요' : '검색 결과가 없습니다'}
    </div>`;
    return;
  }
  const now = new Date();
  container.innerHTML = filtered.map(n => {
    const date = new Date(n.updatedAt || n.createdAt);
    let dateStr;
    if (isSameDay(date, now)) {
      dateStr = `오늘 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    } else {
      const dayDiff = Math.floor((now - date) / (1000*60*60*24));
      if (dayDiff < 7) dateStr = `${dayDiff}일 전`;
      else dateStr = `${date.getMonth()+1}월 ${date.getDate()}일`;
    }
    let preview, metaRight;
    if (n.type === 'mindmap') {
      preview = `노드 ${n.nodeCount}개 · 연결 ${n.edgeCount}개`;
      metaRight = '마인드맵';
    } else {
      preview = previewSnippetWithMatch(n.content, searchTokens) || '내용 없음';
      metaRight = `${n.content.length}자`;
    }
    // Escape, then apply <mark> highlight — safe because highlight only wraps user-supplied tokens.
    const titleHtml = highlightSearchMatch(escapeHtml(n.title) || '제목 없음', searchTokens);
    const previewHtml = highlightSearchMatch(escapeHtml(preview), searchTokens);
    const isActive = isActiveNote(n.type, n.id) && !memoSelectMode;
    const selectable = n.type === 'memo';
    const isSelected = selectable && memoSelectedIds.has(n.id);
    const checkbox = (memoSelectMode && selectable)
      ? `<span class="memo-select-check ${isSelected ? 'checked' : ''}" onclick="toggleMemoSelected(${n.id}, event)">${isSelected ? '✓' : ''}</span>`
      : '';
    const onClick = (memoSelectMode && selectable)
      ? `toggleMemoSelected(${n.id}, event)`
      : `selectNote('${n.type}', ${n.id})`;
    const pinBtn = memoSelectMode ? '' :
      `<button class="memo-pin-btn ${n.pinned ? 'pinned' : ''}" onclick="togglePinNote('${n.type}', ${n.id}, event)" title="${n.pinned ? '고정 해제' : '고정'}" aria-label="고정">
        <span class="mi mi-sm${n.pinned ? ' mi-fill' : ''}">push_pin</span>
      </button>`;
    const typeIcon = n.type === 'mindmap' ? 'account_tree' : 'edit_note';
    return `<div class="swipe-row" data-id="${n.id}" data-note-type="${n.type}">
      <div class="memo-item swipe-content ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${n.pinned ? 'is-pinned' : ''}" onclick="${onClick}" oncontextmenu="showNoteMenu('${n.type}', ${n.id}, event); return false;">
        ${checkbox}
        <span class="note-type-badge mi mi-sm" aria-hidden="true">${typeIcon}</span>
        <div class="memo-item-body">
          <div class="memo-item-title">${titleHtml}</div>
          <div class="memo-item-preview">${previewHtml}</div>
          <div class="memo-item-meta">
            <span>${dateStr}</span>
            <span class="dot"></span>
            <span>${metaRight}</span>
          </div>
        </div>
        ${pinBtn}
      </div>
      <button class="swipe-action" aria-label="삭제"><span class="mi mi-sm">delete</span> 삭제</button>
    </div>`;
  }).join('');
  // (이전 호출 위치) ↓/↑ 단축키가 사용하는 리스트 — DOM에서 읽음
  // 별도 캐시 안 두는 이유: filter/정렬/검색이 바뀔 때 무효화 부담 없음

  // Wire swipe-to-delete + long-press → context menu (only when not in select mode)
  if (!container.dataset.swipeReady) {
    attachSwipeToDelete(container, {
      resolveId: (row) => parseInt(row.dataset.id),
      onDelete: (id, row) => {
        if (memoSelectMode) return;
        deleteNote(row.dataset.noteType, id);
      },
      onLongPress: (id, row) => {
        if (memoSelectMode) return;
        showNoteMenu(row.dataset.noteType, id, null);
      }
    });
    container.dataset.swipeReady = '1';
  }
}

// ↑/↓ 단축키용 — 현재 보이는 메모 리스트 안에서 활성 항목 ±1 이동
function navigateMemoList(delta) {
  const items = document.querySelectorAll('#memo-items .swipe-row');
  if (!items.length) return;
  const arr = Array.from(items).map(r => ({
    el: r,
    id: parseInt(r.dataset.id),
    type: r.dataset.noteType
  }));
  const curIdx = arr.findIndex(x => isActiveNote(x.type, x.id));
  let next = curIdx + delta;
  if (curIdx === -1) next = delta > 0 ? 0 : arr.length - 1;
  if (next < 0) next = 0;
  if (next >= arr.length) next = arr.length - 1;
  const t = arr[next];
  if (!t) return;
  selectNote(t.type, t.id);
  // 스크롤 맞춤 (목록 안에서만)
  t.el.scrollIntoView({ block: 'nearest' });
}

// 메모 메타정보 한 번에 계산 (에디터 표시용)
function computeMemoMeta(memo) {
  const content = memo.content || '';
  const charCount = content.length;
  // 한국어 기준 읽기 속도 ~250자/분
  const readMin = Math.max(1, Math.round(charCount / 250));
  // 이미지 마크다운 + base64 data: URI 둘 다 카운트
  const imageCount = (content.match(/!\[[^\]]*\]\(/g) || []).length;
  const lineCount = content ? content.split('\n').length : 0;
  return {
    charCount, readMin, imageCount, lineCount,
    createdRel: relativeTime(memo.date || memo.createdAt || memo.updatedAt),
    updatedRel: relativeTime(memo.updatedAt || memo.date),
  };
}

// "5분 전", "오늘 14:30", "3일 전", "5월 28일" 같은 상대시간 표기
function relativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return '방금';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (isSameDay(d, now)) return `오늘 ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  if (diffH < 24 * 7) return `${Math.floor(diffH / 24)}일 전`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth()+1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`;
}

function renderMemoEditor() {
  const editor = document.getElementById('memo-editor');
  // Capture decoded images before the DOM is replaced so we can
  // transplant them back after — prevents iOS re-decode flicker.
  const _imgCache = new Map();
  editor.querySelectorAll('.markdown-body img').forEach(img => {
    if (img.complete && img.naturalWidth > 0) _imgCache.set(img.src, img);
  });
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) {
    const mod = (navigator.platform || '').toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
    editor.innerHTML = `<div class="memo-editor-empty">
      <span class="mi big">edit_note</span>
      <div style="font-size:16px;font-weight:600;color:var(--text-dim);">메모를 선택하거나 새로 만드세요</div>
      <div class="hint">목록에서 메모를 선택하거나 + 버튼을 눌러 새 메모를 만드세요</div>
      <div class="shortcuts">
        <div style="font-weight:600;color:var(--text);margin-bottom:6px;">단축키</div>
        <code>${mod}+N</code> 새 메모 ·  <code>${mod}+F</code> 검색 ·  <code>${mod}+P</code> 핀<br>
        <code>↑/↓</code> 메모 이동 ·  <code>${mod}+⌫</code> 삭제<br>
        <div style="font-weight:600;color:var(--text);margin:10px 0 6px;">마크다운 단축 문법</div>
        <code># </code> 큰 제목 ·  <code>## </code> 중제목<br>
        <code>**굵게**</code> ·  <code>*기울임*</code> ·  <code>~~취소~~</code><br>
        <code>- </code> 목록 ·  <code>- [ ] </code> 체크박스<br>
        <code>\`코드\`</code> ·  <code>&gt; </code> 인용문 ·  <code>---</code> 구분선
      </div>
    </div>`;
    return;
  }
  // 풍부한 메타정보 — 생성/수정 둘 다 + 읽기시간 + 이미지·줄·태그
  const meta = computeMemoMeta(memo);

  // Three editor modes:
  //   'view' — read-only rendered HTML (tap body to enter live)
  //   'live' — Bear-style contenteditable: markdown renders inline as you type
  //   'edit' — raw textarea (fastest on mobile, plain source)
  const renderedHtml = memo.content.trim() ? md2html(memo.content) : '<div class="markdown-empty">내용을 추가하려면 라이브뷰 또는 편집 모드로 전환하세요</div>';

  // Bear-style only — always render the inline live editor (view/edit modes removed)
  const bodyHtml = `<div class="memo-body-wrap edit-only"><div class="bear-editor" id="memo-live-editor"></div></div>`;

  // Don't blow away the DOM if the user is actively typing in this editor
  if (document.activeElement && editor.contains(document.activeElement)) return;

  editor.innerHTML = `
    <div class="memo-editor-toolbar">
      <button class="panel-reopen-btn" onclick="togglePanel('memo-page')" title="목록 열기">
        <span class="mi mi-sm">chevron_right</span>
      </button>
      <button class="memo-back" onclick="backToList()" aria-label="뒤로">‹</button>
      <div class="memo-toolbar-spacer"></div>
      <button class="memo-icon-btn" onclick="openDrawingModal()" title="드로잉 (Apple Pencil)">
        <span class="mi mi-sm">brush</span>
      </button>
      <button class="memo-icon-btn" onclick="triggerImageUpload()" title="이미지 업로드 (또는 메모에 붙여넣기/드래그)">
        <span class="mi mi-sm">image</span>
      </button>
      <button class="memo-icon-btn" onclick="openVersionHistory()" title="버전 히스토리">
        <span class="mi mi-sm">history</span>
      </button>
      <button class="memo-icon-btn danger" onclick="deleteMemo(${memo.id})" title="메모 삭제">
        <span class="mi mi-sm">delete</span>
      </button>
    </div>
    <div class="memo-editor-header">
      <input type="text" value="${escapeHtml(memo.title)}" oninput="updateMemoTitle(this.value)" placeholder="제목 없음">
    </div>
    <div class="memo-meta">
      <span title="수정 시각">수정 ${meta.updatedRel}</span>
      <span class="dot"></span>
      <span title="작성 시각">작성 ${meta.createdRel}</span>
      <span class="dot"></span>
      <span>${meta.charCount}자</span>
      <span class="dot"></span>
      <span>읽기 ${meta.readMin}분</span>
      ${meta.imageCount > 0 ? `<span class="dot"></span><span>이미지 ${meta.imageCount}</span>` : ''}
      ${(memo.tags || []).length > 0 ? `<span class="dot"></span><span>태그 ${(memo.tags || []).length}</span>` : ''}
    </div>
    <div class="memo-tags-row">
      <div id="memo-tag-chips">
        ${(memo.tags || []).map(t => `<span class="memo-tag-chip">${escapeHtml(t)}<button onclick="removeMemoTag(${JSON.stringify(t).replace(/"/g, '&quot;')})" class="memo-tag-del">✕</button></span>`).join('')}
      </div>
      <button class="memo-tag-add-btn" onclick="focusMemoTagInput()">+ 태그</button>
      <input type="text" id="memo-tag-input" class="memo-tag-input" placeholder="태그명..."
        onkeydown="if(event.key==='Enter'&&!event.isComposing){addMemoTagFromInput();} if(event.key==='Escape'){hideMemoTagInput();}"
        onblur="setTimeout(hideMemoTagInput,150)">
    </div>
    ${bodyHtml}
    ${_renderBacklinkPanel(memo)}
  `;

  // Restore decoded images to avoid iOS re-decode flicker
  _patchImagesAfterRender(editor, _imgCache);

  // Always mount the CodeMirror live editor (Bear-style)
  const bearEl = document.getElementById('memo-live-editor');
  if (bearEl && window.CM6) {
    if (window._cm6View) { try { window._cm6View.destroy(); } catch {} window._cm6View = null; }
    window._cm6View = window.CM6.createEditor(bearEl, memo.content, (text) => updateMemoContent(text));
    setTimeout(() => { try { window._cm6View.focus(); } catch {} }, 30);
  }

  // Mark cached images as loaded so the skeleton shimmer goes away
  setTimeout(markLoadedImages, 0);
}

// =================== BEAR-STYLE LIVE EDITOR ===================
function bearRenderLine(text) {
  if (!text) return '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Block-level: headers, bullets, quote
  let m;
  if (m = text.match(/^(#{1,3}) (.*)$/)) {
    const level = m[1].length;
    return `<span class="md-marker">${m[1]} </span><span class="md-h${level}">${bearInline(esc(m[2]))}</span>`;
  }
  if (m = text.match(/^([-*+]) (.*)$/)) {
    return `<span class="md-bullet" data-md="">•</span><span class="md-marker md-list-marker">${esc(m[1])} </span>${bearInline(esc(m[2]))}`;
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
  // Image first via placeholder so subsequent regexes don't match into the URL
  const imgs = [];
  html = html.replace(/!\[([^\]\n]*)\]\(([^)\s\n]+)\)/g, (_m, alt, url) => {
    imgs.push({ alt, url });
    return `IMG${imgs.length - 1}`;
  });

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
  // Link [text](url) — won't match images (they were tokenized)
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<span class="md-marker">[</span><span class="md-link">$1</span><span class="md-marker">](</span><span class="md-marker">$2</span><span class="md-marker">)</span>');

  // Restore image tokens. Wrap the entire image (markers + img) in a
  // contenteditable=false block so the user cannot accidentally type INTO
  // a marker span. Previously, clicking inside the URL marker and typing
  // would silently corrupt the data URL and the image would vanish on
  // re-render. Caret can still land BEFORE or AFTER the wrapper, and
  // backspace deletes the whole block atomically.
  html = html.replace(/IMG(\d+)/g, (_m, idx) => {
    const t = imgs[parseInt(idx)];
    const _attrEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const safeUrl = _attrEsc(t.url);
    const dataMd = _attrEsc(`![${t.alt}](${t.url})`);
    return `<span class="md-image-block" contenteditable="false" data-md="${dataMd}">` +
           `<img class="md-img" src="${safeUrl}" alt="${_attrEsc(t.alt)}" loading="lazy">` +
           `</span>`;
  });
  return html;
}

function bearRenderContent(text) {
  return text.split('\n').map(line => {
    let kind = '';
    if (/^#{1,3} /.test(line)) kind = ' data-kind="heading"';
    else if (/^[-*+] /.test(line) || /^\d+\. /.test(line)) kind = ' data-kind="list"';
    else if (/^(&gt;|>) /.test(line)) kind = ' data-kind="quote"';
    else if (/^---$|^\*\*\*$|^___$/.test(line.trim())) kind = ' data-kind="hr"';
    return `<div data-line${kind}>${bearRenderLine(line)}</div>`;
  }).join('');
}

// Text/offset model: each direct child of the editor is a "line".
// Total text = children.map(textContent).join('\n'). Offset is computed
// the same way — counting +1 per block boundary. This is fully
// deterministic and doesn't depend on browser-specific Range.toString()
// quirks around <br>/block-element line breaks.
// Walk a line div and reconstruct the markdown source. Elements that carry
// a data-md attribute (image blocks, etc.) contribute their stored source
// instead of textContent — this preserves the markdown even when the live
// DOM doesn't render the markers as text.
function bearLineToSource(div) {
  let source = '';
  function walk(node) {
    if (node.nodeType === 1) {
      if (node.dataset && node.dataset.md != null) {
        source += node.dataset.md;
        return;
      }
      for (const child of node.childNodes) walk(child);
    } else if (node.nodeType === 3) {
      source += node.textContent || '';
    }
  }
  walk(div);
  return source.replace(/​/g, '');
}

function bearGetText(editor) {
  if (!editor.children.length) return editor.textContent.replace(/​/g, '');
  return [...editor.children].map(bearLineToSource).join('\n');
}

function bearGetCaretOffset(editor) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return 0;

  function sourceUpTo(div, endContainer, endOffset) {
    let source = '';
    let stopped = false;
    function walk(node) {
      if (stopped) return;
      if (node === endContainer) {
        if (node.nodeType === 3) source += (node.textContent || '').slice(0, endOffset);
        stopped = true;
        return;
      }
      if (node.nodeType === 1) {
        if (node.dataset && node.dataset.md != null) {
          source += node.dataset.md;
          return;
        }
        for (const c of node.childNodes) { walk(c); if (stopped) return; }
        return;
      }
      if (node.nodeType === 3) source += node.textContent || '';
    }
    walk(div);
    return source.replace(/​/g, '').length;
  }

  let pos = 0;
  for (const child of editor.children) {
    if (child === range.startContainer || child.contains(range.startContainer)) {
      return pos + sourceUpTo(child, range.startContainer, range.startOffset);
    }
    pos += bearLineToSource(child).length + 1;
  }
  return Math.max(0, pos - 1);
}

function bearSetCaretOffset(editor, target) {
  const sel = window.getSelection();
  if (!editor.children.length) {
    const r = document.createRange();
    r.setStart(editor, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }
  let pos = 0;
  for (const child of editor.children) {
    const childSourceLen = bearLineToSource(child).length;
    if (target <= pos + childSourceLen) {
      placeCaretInLine(child, target - pos);
      return;
    }
    pos += childSourceLen + 1;
  }
  // Past end
  const r = document.createRange();
  r.selectNodeContents(editor);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

// Place caret at a source-character offset within a line div, treating
// elements with data-md as atomic units (caret can land before/after,
// not inside).
function placeCaretInLine(div, target) {
  const sel = window.getSelection();
  let chars = 0;
  let placed = false;
  function walk(node) {
    if (placed) return;
    if (node.nodeType === 1) {
      if (node.dataset && node.dataset.md != null) {
        const len = node.dataset.md.length;
        if (target <= chars) {
          const r = document.createRange();
          r.setStartBefore(node);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          placed = true;
          return;
        }
        if (target <= chars + len) {
          const r = document.createRange();
          r.setStartAfter(node);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          placed = true;
          return;
        }
        chars += len;
        return;
      }
      for (const c of node.childNodes) { walk(c); if (placed) return; }
      return;
    }
    if (node.nodeType === 3) {
      const len = node.length;
      if (chars + len >= target) {
        const r = document.createRange();
        r.setStart(node, Math.max(0, Math.min(len, target - chars)));
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        placed = true;
        return;
      }
      chars += len;
    }
  }
  for (const c of div.childNodes) { walk(c); if (placed) return; }
  if (!placed) {
    const r = document.createRange();
    r.selectNodeContents(div);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

// Typora-style per-line editor: only the line under the cursor is plain text;
// all other lines are rendered HTML. No full-editor innerHTML replacement on
// each keystroke → no cursor jumping.
function setupBearEditor(editor, content, onChange) {
  try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch {}

  editor.innerHTML = bearRenderContent(content || '');
  if (!editor.children.length) {
    const div = document.createElement('div');
    div.setAttribute('data-line', '');
    editor.appendChild(div);
  }

  let activeLine = null;  // the one data-line div currently in plain-text mode
  let composing = false;
  let _scLocked = false;  // blocks re-entrant selectionchange during DOM mutations

  function _updateKind(el, src) {
    el.removeAttribute('data-kind');
    if (/^#{1,3} /.test(src)) el.setAttribute('data-kind', 'heading');
    else if (/^[-*+] /.test(src) || /^\d+\. /.test(src)) el.setAttribute('data-kind', 'list');
    else if (/^(&gt;|>) /.test(src)) el.setAttribute('data-kind', 'quote');
    else if (/^---$|^\*\*\*$|^___$/.test(src.trim())) el.setAttribute('data-kind', 'hr');
  }

  // Render a line (leave plain-text editing mode)
  function _commit(el) {
    if (!el || !el.isConnected) return;
    const src = bearLineToSource(el);
    el.innerHTML = bearRenderLine(src) || '<br>';
    _updateKind(el, src);
    if (activeLine === el) activeLine = null;
  }

  // Convert a line to plain text (enter editing mode)
  function _activate(el) {
    el.textContent = bearLineToSource(el);
    activeLine = el;
  }

  // Source-character offset of caret within el (works for both rendered & plain)
  function _caretInEl(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return 0;
    let chars = 0, done = false;
    function walk(n) {
      if (done) return;
      if (n === range.startContainer) {
        if (n.nodeType === 3) chars += range.startOffset;
        done = true;
        return;
      }
      if (n.nodeType === 1) {
        if (n.dataset?.md != null) { chars += n.dataset.md.length; return; }
        for (const c of n.childNodes) { walk(c); if (done) return; }
        return;
      }
      if (n.nodeType === 3) chars += n.length;
    }
    walk(el);
    return chars;
  }

  // Place caret at source-char offset in a plain-text line div
  function _placeAt(el, offset) {
    const sel = window.getSelection();
    const r = document.createRange();
    const tn = el.firstChild?.nodeType === 3 ? el.firstChild : null;
    if (tn) r.setStart(tn, Math.min(offset, tn.length));
    else r.setStart(el, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // selectionchange: commit old active line, activate whichever line gained cursor
  function onSelChange() {
    if (!editor.isConnected) { document.removeEventListener('selectionchange', onSelChange); return; }
    if (composing || _scLocked) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const node = sel.anchorNode;
    if (!node || !editor.contains(node)) return;
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el.parentElement !== editor) el = el.parentElement;
    if (!el || !el.hasAttribute('data-line')) return;
    if (el === activeLine) return;

    _scLocked = true;
    const offset = _caretInEl(el);
    if (activeLine?.isConnected) _commit(activeLine);
    _activate(el);
    onChange(bearGetText(editor));
    requestAnimationFrame(() => { _placeAt(el, offset); _scLocked = false; });
  }
  document.addEventListener('selectionchange', onSelChange);

  editor.addEventListener('input', () => { if (!composing) onChange(bearGetText(editor)); });
  editor.addEventListener('compositionstart', () => { composing = true; });
  editor.addEventListener('compositionend', () => { composing = false; onChange(bearGetText(editor)); });

  // Commit active line when focus leaves editor
  editor.addEventListener('focusout', (e) => {
    if (editor.contains(e.relatedTarget)) return;
    if (activeLine?.isConnected) _commit(activeLine);
    activeLine = null;
  });

  editor.addEventListener('keydown', (e) => {
    if (composing) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!activeLine) return;
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) range.deleteContents();

      const src = bearLineToSource(activeLine);
      const pos = _caretInEl(activeLine);
      const before = src.slice(0, pos);
      const after = src.slice(pos);

      // Commit current line with text before cursor
      activeLine.innerHTML = bearRenderLine(before) || '<br>';
      _updateKind(activeLine, before);

      // New line with text after cursor → becomes active (stays plain text)
      const nd = document.createElement('div');
      nd.setAttribute('data-line', '');
      nd.textContent = after;
      activeLine.parentNode.insertBefore(nd, activeLine.nextSibling);
      activeLine = nd;

      onChange(bearGetText(editor));
      requestAnimationFrame(() => _placeAt(nd, 0));
      return;
    }

    if (e.key === 'Backspace') {
      if (!activeLine) return;
      const sel = window.getSelection();
      if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return;
      if (_caretInEl(activeLine) > 0) return;  // not at line start — let browser handle
      const prev = activeLine.previousElementSibling;
      if (!prev) return;  // already first line
      e.preventDefault();

      const prevSrc = bearLineToSource(prev);
      const curSrc = bearLineToSource(activeLine);
      const mergeAt = prevSrc.length;

      activeLine.remove();
      prev.textContent = prevSrc + curSrc;
      activeLine = prev;

      onChange(bearGetText(editor));
      requestAnimationFrame(() => _placeAt(prev, mergeAt));
      return;
    }
  });

  editor.addEventListener('paste', (e) => {
    if (e.clipboardData?.types?.includes('Files')) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    if (!activeLine) return;

    const lines = text.split('\n');
    if (lines.length === 1) {
      document.execCommand('insertText', false, text);
      onChange(bearGetText(editor));
      return;
    }

    // Multi-line paste: split into proper data-line divs
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    if (!sel.getRangeAt(0).collapsed) sel.getRangeAt(0).deleteContents();
    const pos = _caretInEl(activeLine);
    const src = bearLineToSource(activeLine);
    const before = src.slice(0, pos);
    const after = src.slice(pos);
    const all = [before + lines[0], ...lines.slice(1, -1), lines[lines.length - 1] + after];

    activeLine.innerHTML = bearRenderLine(all[0]) || '<br>';
    _updateKind(activeLine, all[0]);

    let ref = activeLine;
    let lastDiv = null;
    for (let i = 1; i < all.length; i++) {
      const div = document.createElement('div');
      div.setAttribute('data-line', '');
      if (i === all.length - 1) { div.textContent = all[i]; lastDiv = div; }
      else { div.innerHTML = bearRenderLine(all[i]) || '<br>'; _updateKind(div, all[i]); }
      ref.parentNode.insertBefore(div, ref.nextSibling);
      ref = div;
    }
    activeLine = lastDiv || activeLine;
    onChange(bearGetText(editor));
    const endOff = all[all.length - 1].length - after.length;
    requestAnimationFrame(() => _placeAt(activeLine, Math.max(0, endOff)));
  });
}

// Bear-style only — view/edit modes removed. The variable is kept to satisfy
// older references; it's always 'live' now. setMemoMode is a no-op-ish helper
// that just re-renders (still called from a few legacy paths).
let memoMode = 'live';
function setMemoMode(_mode) {
  memoMode = 'live';
  renderMemoEditor();
}

// Sync scroll between textarea and preview in split mode (proportional)
function setupSplitScrollSync() {
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
    touchMemo(memo);
    saveMemos();
    renderMemoList();
  }
}

function updateMemoContent(val) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return;
  memo.content = val;
  // Re-derive tags from content (adds new #tags AND removes deleted ones).
  // Refresh the chip strip too so deleted hashtags vanish from the UI.
  syncMemoHashtags(memo);
  _refreshMemoTagChips();
  touchMemo(memo);
  saveMemos();
  // Update char/word count in meta row without re-rendering the editor
  const meta = document.querySelector('.memo-meta');
  if (meta) {
    const date = new Date(memo.date);
    const dateStr = `${date.getFullYear()}년 ${date.getMonth()+1}월 ${date.getDate()}일 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    const wc = val.trim().split(/\s+/).filter(Boolean).length;
    const spans = meta.querySelectorAll('span');
    if (spans[0]) spans[0].textContent = dateStr;
    if (spans[2]) spans[2].textContent = `${val.length}자 · ${wc}단어`;
  }
  // Live preview in desktop split mode — preserve decoded images
  const preview = document.querySelector('.memo-body-wrap.split #memo-preview');
  if (preview) {
    const _previewCache = new Map();
    preview.querySelectorAll('img').forEach(img => {
      if (img.complete && img.naturalWidth > 0) _previewCache.set(img.src, img);
    });
    preview.innerHTML = val.trim() ? md2html(val) : '<div class="markdown-empty">미리볼 내용이 없습니다</div>';
    _patchImagesAfterRender(preview, _previewCache);
    setTimeout(markLoadedImages, 0);
  }
  clearTimeout(window._memoListTimer);
  window._memoListTimer = setTimeout(renderMemoList, 500);
}

function filterMemos() { renderMemoList(); }

function setTagFilter(tag) {
  activeTagFilter = tag;
  // Tags live in the sidebar now — picking one jumps to the notes view.
  // navigateTo() re-renders the list/tag-tree, so no explicit render here.
  if (typeof navigateTo === 'function') navigateTo('memo');
  else renderMemoList();
  if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
}

function _refreshMemoTagChips() {
  const memo = memos.find(m => m.id === activeMemoId);
  const chipsEl = document.getElementById('memo-tag-chips');
  if (!chipsEl || !memo) return;
  chipsEl.innerHTML = (memo.tags || []).map(t =>
    `<span class="memo-tag-chip">${escapeHtml(t)}<button onclick="removeMemoTag(${JSON.stringify(t).replace(/"/g, '&quot;')})" class="memo-tag-del">✕</button></span>`
  ).join('');
}

function addMemoTag(tag) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return;
  tag = tag.trim().replace(/^#/, '');  // accept "#회의" or "회의"
  if (!tag) return;
  // Source of truth = content. Insert "#tag" into body if not present, then re-derive.
  if (!_hasInlineTag(memo.content, tag)) {
    memo.content = _addInlineTag(memo.content || '', tag);
  }
  syncMemoHashtags(memo);
  touchMemo(memo);
  saveMemos();
  _refreshMemoTagChips();
  renderMemoList();
  // Re-render editor so the appended #tag becomes visible (and CodeMirror state stays in sync)
  if (typeof renderMemoEditor === 'function') renderMemoEditor();
}

function removeMemoTag(tag) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return;
  // Strip every "#tag" occurrence from content, then re-derive tags
  memo.content = _removeInlineTag(memo.content || '', tag);
  syncMemoHashtags(memo);
  touchMemo(memo);
  saveMemos();
  _refreshMemoTagChips();
  renderMemoList();
  if (typeof renderMemoEditor === 'function') renderMemoEditor();
}

function focusMemoTagInput() {
  const input = document.getElementById('memo-tag-input');
  if (!input) return;
  input.classList.add('visible');
  input.focus();
}

function addMemoTagFromInput() {
  const input = document.getElementById('memo-tag-input');
  if (!input) return;
  addMemoTag(input.value);
  input.value = '';
  hideMemoTagInput();
}

function hideMemoTagInput() {
  const input = document.getElementById('memo-tag-input');
  if (!input || document.activeElement === input) return;
  input.classList.remove('visible');
  input.value = '';
}

renderMemoList();
renderMemoEditor();


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
    // Use lh3 CDN URL — much faster than drive.google.com/thumbnail
    // (CDN-edge cached, no on-demand thumbnail generation). Request 2560px
    // to support retina displays at full memo width.
    const url = `https://lh3.googleusercontent.com/d/${file.id}=w2560`;
    toast('이미지 업로드 완료', 'success');
    return { url, id: file.id, name };
  } catch (e) {
    toast('업로드 실패: ' + e.message, 'error');
    return null;
  }
}

// Insert markdown at cursor. In live mode, append to the Bear editor's content.
function insertIntoActiveMemo(insertText) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return false;

  // Raw textarea (edit mode)
  const ta = document.getElementById('memo-textarea');
  if (ta && memoMode === 'edit') {
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + insertText + ta.value.slice(end);
    const caret = start + insertText.length;
    try { ta.setSelectionRange(caret, caret); } catch {}
    ta.focus();
    updateMemoContent(ta.value);
    return true;
  }

  // CM6 live editor — insert at cursor (or end if no selection)
  if (window._cm6View && memoMode === 'live') {
    const view = window._cm6View;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
    });
    view.focus();
    return true;
  }

  // View mode — switch to live and append
  memo.content = (memo.content || '') + insertText;
  touchMemo(memo);
  saveMemos();
  setMemoMode('live');
  return true;
}

// Resize a large image down to a reasonable size before upload/embed.
// iPhone photos are 4032px @ 12MP and 2-5MB. Resize to 2560px max dim
// at JPEG q=0.92 → typically 600KB-1.2MB. 2560px is enough for retina
// displays at full memo width without looking soft.
async function resizeImage(blob, maxDim = 2560, quality = 0.92) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxDim || h > maxDim) {
        const scale = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => {
        URL.revokeObjectURL(url);
        if (b) resolve(b);
        else reject(new Error('이미지 변환 실패'));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 로드 실패 (지원하지 않는 형식일 수 있음)'));
    };
    img.src = url;
  });
}

async function handleImageInsert(blob) {
  if (!activeMemoId) { toast('먼저 메모를 선택하세요'); return; }

  // Always shrink large/HEIC images before upload or embed
  let workingBlob = blob;
  try {
    // Always resize HEIC/HEIF (Safari can't render those inline). Otherwise
    // only resize photos > 1.5 MB so smaller PNG screenshots stay sharp.
    if (blob.size > 1_500_000 || /image\/(heic|heif)/i.test(blob.type)) {
      toast('이미지 처리 중...');
      workingBlob = await resizeImage(blob, 2560, 0.92);
    }
  } catch (e) {
    console.warn('Resize failed, using original:', e);
  }

  let insertText;
  if (driveAssetsFolderId) {
    const result = await uploadImageToDrive(workingBlob);
    if (!result) return;
    insertText = `\n![${result.name}](${result.url})\n`;
  } else {
    // Inline base64 — after resize, typical photo fits in ~500KB
    if (workingBlob.size > 1_500_000) {
      toast('이미지가 너무 큽니다. Drive를 연결하면 자동 업로드돼요', 'error');
      return;
    }
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(workingBlob);
    });
    insertText = `\n![image](${dataUrl})\n`;
    toast('인라인 이미지로 삽입됨 (Drive 연결하면 자동 업로드)', 'success');
  }
  insertIntoActiveMemo(insertText);
}

document.addEventListener('paste', (e) => {
  const ae = document.activeElement;
  const inEditor = ae && ae.tagName === 'TEXTAREA' && ae.closest('.memo-editor');
  if (!inEditor) return;
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
  // iOS / iPadOS won't open the photo picker reliably for a detached input
  // — append to DOM, click, then clean up. Also explicitly list common
  // mobile image MIME types in addition to image/* so iPadOS surfaces the
  // "사진 보관함" option alongside file browser & camera.
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,image/jpeg,image/png,image/heic,image/heif,image/webp,image/gif';
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.style.top = '-9999px';
  input.style.opacity = '0';
  input.onchange = (e) => {
    const f = e.target.files?.[0];
    if (f) handleImageInsert(f);
    setTimeout(() => { try { input.remove(); } catch {} }, 200);
  };
  document.body.appendChild(input);
  input.click();
}

// =================== IMAGE DOM PRESERVATION ===================
// Transplant already-decoded <img> nodes from the previous DOM into the
// freshly-set innerHTML. On iOS Safari this avoids the browser discarding
// the decoded pixel data and re-fetching/re-decoding on every re-render,
// which caused images to flicker or momentarily disappear.
// imgCache: Map<src string → img element> captured BEFORE innerHTML replace.
function _patchImagesAfterRender(container, imgCache) {
  if (!imgCache || imgCache.size === 0) return;
  container.querySelectorAll('img').forEach(newImg => {
    const old = imgCache.get(newImg.src);
    if (old && !old.isConnected) {
      old.className = newImg.className;
      newImg.parentNode.replaceChild(old, newImg);
    }
  });
}

// =================== IMAGE LIGHTBOX ===================
// Click any image in the rendered markdown view → full-screen modal.
// Tap outside / press Esc / pinch-out (browser default) to close.
function openImageLightbox(src, alt) {
  let lb = document.getElementById('image-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'image-lightbox';
    lb.className = 'image-lightbox';
    lb.innerHTML = `
      <button class="lightbox-close" aria-label="닫기">×</button>
      <img class="lightbox-img" alt="">
    `;
    document.body.appendChild(lb);
    lb.addEventListener('click', (e) => {
      if (e.target === lb || e.target.classList.contains('lightbox-close')) {
        closeImageLightbox();
      }
    });
  }
  const img = lb.querySelector('.lightbox-img');
  img.src = src;
  img.alt = alt || '';
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeImageLightbox() {
  const lb = document.getElementById('image-lightbox');
  if (!lb) return;
  lb.classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeImageLightbox();
});
// Delegated click on any rendered markdown image. stopPropagation so the
// parent .view-clickable handler doesn't also fire (which would flip into
// edit mode). For Drive CDN URLs, request the original (=w0) for the
// lightbox so the zoomed view is high-res.
document.addEventListener('click', (e) => {
  const img = e.target.closest('.markdown-body img');
  if (!img) return;
  e.stopPropagation();
  e.preventDefault();
  let fullSrc = img.src;
  const m = fullSrc.match(/^(https:\/\/lh3\.googleusercontent\.com\/d\/[^=]+)=w\d+/);
  if (m) fullSrc = m[1] + '=w0';
  openImageLightbox(fullSrc, img.alt);
});

// Fade-in once each rendered image finishes loading. The .loaded class
// removes the shimmer skeleton bg and stops the animation. Capture-phase
// listener catches load events for images inserted via innerHTML.
document.addEventListener('load', (e) => {
  if (e.target?.tagName === 'IMG' && e.target.closest('.markdown-body')) {
    e.target.classList.add('loaded');
  }
}, true);
// Mark images that were already cached/complete before our listener
// could see them (happens on memo switch when the browser already has
// the image in its cache). Called from renderMemoEditor + updateMemoContent.
function markLoadedImages() {
  document.querySelectorAll('.markdown-body img').forEach(img => {
    if (img.complete && img.naturalWidth > 0) img.classList.add('loaded');
  });
}

// =================== PER-NOTE VERSION HISTORY (IndexedDB) ===================
// BackupService는 '전체 상태' 단위. per-note history는 다른 메모를 안 건드리고
// 한 메모의 직전 버전들만 복원. 5분 throttle + selectNote 시 flush.
const MH_DB = 'mindflow-memo-history';
const MH_STORE = 'versions';
const MH_VERSIONS_PER_MEMO = 10;
const MH_THROTTLE_MS = 5 * 60_000;
const _mhLastPushAt = {};

function _mhOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MH_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MH_STORE)) {
        const s = db.createObjectStore(MH_STORE, { keyPath: 'key' });
        s.createIndex('memoId', 'memoId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function mhGetVersionsForMemo(memoId) {
  try {
    const db = await _mhOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MH_STORE, 'readonly');
      const idx = tx.objectStore(MH_STORE).index('memoId');
      const req = idx.getAll(memoId);
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.ts - a.ts));
      req.onerror = () => reject(req.error);
    });
  } catch (e) { console.warn('mh get:', e); return []; }
}

async function mhPushVersion(memo, opts) {
  if (!memo) return;
  opts = opts || {};
  const now = Date.now();
  if (!opts.force && _mhLastPushAt[memo.id] && now - _mhLastPushAt[memo.id] < MH_THROTTLE_MS) return;
  try {
    const existing = await mhGetVersionsForMemo(memo.id);
    // 동일 내용이면 skip (디바운스만 통과해도 의미 없음)
    if (existing.length && existing[0].content === (memo.content || '') && existing[0].title === (memo.title || '')) return;
    _mhLastPushAt[memo.id] = now;
    const db = await _mhOpen();
    const tx = db.transaction(MH_STORE, 'readwrite');
    const store = tx.objectStore(MH_STORE);
    store.put({
      key: `${memo.id}:${now}`,
      memoId: memo.id,
      ts: now,
      title: memo.title || '',
      content: memo.content || '',
      tags: memo.tags || []
    });
    // 오래된 버전 정리
    if (existing.length >= MH_VERSIONS_PER_MEMO) {
      for (const v of existing.slice(MH_VERSIONS_PER_MEMO - 1)) store.delete(v.key);
    }
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) { console.warn('mh push:', e); }
}

async function mhDeleteAllForMemo(memoId) {
  try {
    const versions = await mhGetVersionsForMemo(memoId);
    if (versions.length === 0) return;
    const db = await _mhOpen();
    const tx = db.transaction(MH_STORE, 'readwrite');
    const store = tx.objectStore(MH_STORE);
    for (const v of versions) store.delete(v.key);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch {}
}

// ===== UI: 버전 히스토리 모달 =====
async function openVersionHistory() {
  if (!activeMemoId) { toast('메모를 먼저 선택하세요'); return; }
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return;
  // 현재 버전도 한 번 강제 푸시 (직전 스냅샷 보장)
  await mhPushVersion(memo, { force: true });
  const versions = await mhGetVersionsForMemo(memo.id);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show app-dialog-overlay version-history-overlay';
  const body = document.createElement('div');
  body.className = 'modal version-history-modal';
  body.innerHTML = `
    <div class="vh-header">
      <span class="mi mi-sm">history</span>
      <span>버전 히스토리 — ${escapeHtml(memo.title || '제목 없음')}</span>
      <button class="vh-close" onclick="this.closest('.modal-overlay').remove()" aria-label="닫기">
        <span class="mi mi-sm">close</span>
      </button>
    </div>
    <div class="vh-body">
      ${versions.length === 0
        ? '<div class="vh-empty">아직 저장된 버전이 없어요. 5분 이상 텀을 두고 편집하면 자동 기록됩니다.</div>'
        : `<div class="vh-list">${versions.map((v, i) => `
            <div class="vh-item ${i === 0 ? 'active' : ''}" data-vk="${v.key}">
              <div class="vh-item-time">${_vhRelTime(v.ts)} ${i === 0 ? '<span class="vh-current">현재</span>' : ''}</div>
              <div class="vh-item-title">${escapeHtml(v.title || '제목 없음')}</div>
              <div class="vh-item-sub">${v.content.length}자</div>
            </div>`).join('')}</div>
          <div class="vh-preview" id="vh-preview"></div>`}
    </div>
    <div class="vh-actions">
      <button class="app-dialog-btn cancel" onclick="this.closest('.modal-overlay').remove()">닫기</button>
      ${versions.length > 0 ? '<button class="app-dialog-btn primary" id="vh-restore-btn">선택한 버전으로 복원</button>' : ''}
    </div>`;
  overlay.appendChild(body);
  document.body.appendChild(overlay);
  if (versions.length === 0) return;

  // 첫 번째 = 현재 버전 미리보기
  let selectedVk = versions[0].key;
  const setPreview = (key) => {
    const v = versions.find(x => x.key === key);
    if (!v) return;
    selectedVk = key;
    document.querySelectorAll('.vh-item').forEach(el => el.classList.toggle('selected', el.dataset.vk === key));
    document.getElementById('vh-preview').innerHTML = `
      <div class="vh-preview-title">${escapeHtml(v.title || '제목 없음')}</div>
      <div class="vh-preview-meta">${_vhFullTime(v.ts)} · ${v.content.length}자 · 태그 ${(v.tags || []).length}개</div>
      <div class="vh-preview-body markdown-body">${md2html(v.content || '')}</div>`;
  };
  setPreview(versions[0].key);
  overlay.querySelectorAll('.vh-item').forEach(el => {
    el.addEventListener('click', () => setPreview(el.dataset.vk));
  });
  const restoreBtn = overlay.querySelector('#vh-restore-btn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', async () => {
      const v = versions.find(x => x.key === selectedVk);
      if (!v) return;
      const ok = await confirmDialog(`이 버전으로 복원하시겠어요?\n(현재 버전은 히스토리에 백업됩니다)`, { okText: '복원' });
      if (!ok) return;
      // 현재 버전을 백업
      await mhPushVersion(memo, { force: true });
      // 복원
      memo.title = v.title;
      memo.content = v.content;
      memo.tags = v.tags || [];
      memo.updatedAt = new Date().toISOString();
      saveMemos();
      renderMemoEditor();
      renderMemoList();
      overlay.remove();
      toast('버전 복원됨', 'success');
    });
  }
}

function _vhRelTime(ts) {
  const d = new Date(ts);
  return (typeof relativeTime === 'function') ? relativeTime(d.toISOString()) : d.toLocaleString();
}
function _vhFullTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// === 자동 버전 푸시 훅 ===
// selectNote가 다른 메모로 갈 때 직전 메모 한 번 스냅샷
const _origSelectNote = typeof selectNote === 'function' ? selectNote : null;
if (_origSelectNote) {
  window.selectNote = function(type, id) {
    if (activeMemoId && activeMemoId !== id) {
      const prev = memos.find(m => m.id === activeMemoId);
      if (prev) mhPushVersion(prev); // 자동 5분 throttle
    }
    return _origSelectNote(type, id);
  };
}
// 메모 삭제 시 히스토리도 정리
const _origDeleteMemo = typeof deleteMemo === 'function' ? deleteMemo : null;
if (_origDeleteMemo) {
  window.deleteMemo = async function(id) {
    const res = await _origDeleteMemo(id);
    mhDeleteAllForMemo(id).catch(() => {});
    return res;
  };
}

// =================== WIKILINKS [[]] + 백링크 ===================
// 위키링크 클릭 시 호출 — 제목 매칭 메모로 점프. 없으면 자동 생성.
function openMemoByTitle(title) {
  if (!title) return;
  const t = String(title).trim();
  let m = memos.find(x => (x.title || '').trim() === t);
  if (!m) {
    // Auto-create — Obsidian/Roam 표준 동작 (위키링크는 새 노트 진입로)
    const now = new Date().toISOString();
    m = { id: memoIdCounter++, title: t, content: '', date: now, updatedAt: now, tags: [] };
    memos.unshift(m);
    saveMemos();
    toast(`새 메모 "${t}" 생성됨`, 'success');
  }
  if (typeof navigateTo === 'function' && currentPage !== 'memo') {
    navigateTo('memo', { updateHash: false });
  }
  selectNote('memo', m.id);
}

// 이 메모를 본문에서 [[제목]]으로 가리키는 다른 메모 목록
function findBacklinks(memo) {
  if (!memo || !memo.title) return [];
  const t = memo.title.trim();
  if (!t) return [];
  // Case-insensitive, exact title match — 빈 제목/충돌 사본 제외
  const re = new RegExp('\\[\\[\\s*' + _escapeRegex(t) + '(?:\\|[^\\]\\n]+)?\\s*\\]\\]', 'i');
  return memos.filter(other => other.id !== memo.id && re.test(other.content || ''));
}

// 이 메모를 noteId로 가리키는 마인드맵 노드 목록
function findMindmapNodesLinkingTo(memoId) {
  if (typeof mindmaps === 'undefined') return [];
  const out = [];
  for (const mm of mindmaps) {
    for (const n of (mm.nodes || [])) {
      if (n.noteId === memoId) out.push({ mindmapId: mm.id, mindmapName: mm.name, nodeId: n.id, nodeText: n.text });
    }
  }
  return out;
}

// 백링크 패널 HTML — 에디터 본문 아래에 붙음. 백링크 없으면 빈 문자열.
function _renderBacklinkPanel(memo) {
  if (!memo) return '';
  const links = findBacklinks(memo);
  const mmLinks = findMindmapNodesLinkingTo(memo.id);
  if (links.length === 0 && mmLinks.length === 0) return '';
  const items = links.map(l => {
    // 매칭 위치 주변 짧은 스니펫
    const re = new RegExp('\\[\\[\\s*' + _escapeRegex(memo.title.trim()) + '(?:\\|[^\\]\\n]+)?\\s*\\]\\]', 'i');
    const idx = (l.content || '').search(re);
    let snip = '';
    if (idx >= 0) {
      const start = Math.max(0, idx - 30);
      const end = Math.min((l.content || '').length, idx + 60);
      snip = ((start > 0 ? '… ' : '') + l.content.slice(start, end).replace(/\n+/g, ' ') + (end < l.content.length ? ' …' : ''));
    }
    return `<div class="backlink-item" onclick="selectNote('memo', ${l.id})">
      <div class="backlink-title">${escapeHtml(l.title) || '제목 없음'}</div>
      ${snip ? `<div class="backlink-snippet">${escapeHtml(snip)}</div>` : ''}
    </div>`;
  }).join('');
  // 마인드맵 노드에서 가리키는 경우 (역방향)
  const mmItems = mmLinks.map(x => `<div class="backlink-item" onclick="selectNote('mindmap', ${x.mindmapId})">
    <div class="backlink-title"><span class="mi mi-sm" style="vertical-align:-3px;">account_tree</span> ${escapeHtml(x.mindmapName)}</div>
    <div class="backlink-snippet">노드 "${escapeHtml(x.nodeText)}"</div>
  </div>`).join('');
  return `<div class="backlink-panel">
    ${links.length > 0 ? `<div class="backlink-header">
      <span class="mi mi-sm">north_east</span>
      <span>이 메모를 참조하는 노트 ${links.length}개</span>
    </div>
    <div class="backlink-list">${items}</div>` : ''}
    ${mmLinks.length > 0 ? `<div class="backlink-header" style="${links.length > 0 ? 'margin-top:14px;' : ''}">
      <span class="mi mi-sm">account_tree</span>
      <span>이 메모와 연결된 마인드맵 노드 ${mmLinks.length}개</span>
    </div>
    <div class="backlink-list">${mmItems}</div>` : ''}
  </div>`;
}

// =================== COMMAND PALETTE (⌘K) ===================
// Notes + tags + quick actions in one fuzzy search.
let _cmdActiveIdx = 0;
let _cmdResults = [];

function openCmdPalette() {
  const o = document.getElementById('cmd-palette-overlay');
  if (!o) return;
  o.classList.add('show');
  const inp = document.getElementById('cmd-palette-input');
  inp.value = '';
  _cmdActiveIdx = 0;
  renderCmdPaletteResults('');
  setTimeout(() => inp.focus(), 30);
}
function closeCmdPalette() {
  const o = document.getElementById('cmd-palette-overlay');
  if (o) o.classList.remove('show');
}
function _cmdActions() {
  return [
    { key: 'new-memo',     label: '새 메모',        icon: 'edit_note',    fn: () => { closeCmdPalette(); createMemo(); } },
    { key: 'new-mindmap',  label: '새 마인드맵',    icon: 'account_tree', fn: () => { closeCmdPalette(); createMindmap(); } },
    { key: 'go-calendar',  label: '캘린더로 이동',  icon: 'calendar_month', fn: () => { closeCmdPalette(); navigateTo('calendar'); } },
    { key: 'go-routine',   label: '루틴으로 이동',  icon: 'fitness_center', fn: () => { closeCmdPalette(); navigateTo('routine'); } },
    { key: 'sync-now',     label: '지금 동기화',    icon: 'sync',         fn: () => { closeCmdPalette(); if (typeof openSyncModal === 'function') openSyncModal(); } },
    { key: 'theme',        label: '테마 선택',      icon: 'palette',      fn: () => { closeCmdPalette(); if (typeof openThemePicker === 'function') openThemePicker(); } },
  ];
}
function renderCmdPaletteResults(q) {
  const cont = document.getElementById('cmd-palette-results');
  if (!cont) return;
  const ql = (q || '').toLowerCase().trim();
  const tokens = parseSearchQuery(q);
  // 1) Notes (memos + mindmaps), filtered by tokens, max 15
  const notes = getAllNotes()
    .filter(n => !tokens.length || evalSearchQuery(n, tokens))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 15);
  // 2) Tags matching
  const allTags = new Set();
  for (const n of memos) for (const t of (n.tags || [])) allTags.add(t);
  const tags = [...allTags]
    .filter(t => !ql || t.toLowerCase().includes(ql.replace(/^#/, '')) || ('#' + t).toLowerCase().includes(ql))
    .slice(0, 8);
  // 3) Actions matching label
  const acts = _cmdActions().filter(a => !ql || a.label.toLowerCase().includes(ql));

  _cmdResults = [];
  let html = '';
  if (notes.length) {
    html += `<div class="cmd-palette-section">노트 (${notes.length})</div>`;
    for (const n of notes) {
      _cmdResults.push({ kind: 'note', noteType: n.type, id: n.id });
      const titleHl = highlightSearchMatch(escapeHtml(n.title || '제목 없음'), tokens);
      const subText = n.type === 'mindmap'
        ? `마인드맵 · 노드 ${n.nodeCount}개`
        : (previewSnippetWithMatch(n.content || '', tokens) || '내용 없음');
      const subHl = highlightSearchMatch(escapeHtml(subText), tokens);
      const icon = n.type === 'mindmap' ? 'account_tree' : 'edit_note';
      html += `<div class="cmd-palette-item" data-cmd-idx="${_cmdResults.length - 1}">
        <span class="mi mi-sm">${icon}</span>
        <div class="cmd-palette-item-main">
          <div class="cmd-palette-item-title">${titleHl}</div>
          <div class="cmd-palette-item-sub">${subHl}</div>
        </div>
      </div>`;
    }
  }
  if (tags.length) {
    html += `<div class="cmd-palette-section">태그 (${tags.length})</div>`;
    for (const t of tags) {
      _cmdResults.push({ kind: 'tag', tag: t });
      html += `<div class="cmd-palette-item" data-cmd-idx="${_cmdResults.length - 1}">
        <span class="mi mi-sm">label</span>
        <div class="cmd-palette-item-main">
          <div class="cmd-palette-item-title">#${escapeHtml(t)}</div>
          <div class="cmd-palette-item-sub">이 태그로 필터링</div>
        </div>
      </div>`;
    }
  }
  if (acts.length) {
    html += `<div class="cmd-palette-section">액션 (${acts.length})</div>`;
    for (const a of acts) {
      _cmdResults.push({ kind: 'action', action: a });
      html += `<div class="cmd-palette-item" data-cmd-idx="${_cmdResults.length - 1}">
        <span class="mi mi-sm">${a.icon}</span>
        <div class="cmd-palette-item-main">
          <div class="cmd-palette-item-title">${escapeHtml(a.label)}</div>
        </div>
      </div>`;
    }
  }
  if (!_cmdResults.length) html = '<div class="cmd-palette-empty">검색 결과 없음</div>';
  cont.innerHTML = html;
  _cmdActiveIdx = 0;
  _highlightCmdActive();
  cont.querySelectorAll('.cmd-palette-item').forEach((el) => {
    el.addEventListener('click', () => {
      _cmdActiveIdx = parseInt(el.dataset.cmdIdx);
      _runActiveCmd();
    });
  });
}
function _highlightCmdActive() {
  const cont = document.getElementById('cmd-palette-results');
  if (!cont) return;
  cont.querySelectorAll('.cmd-palette-item').forEach((el, i) => {
    el.classList.toggle('active', i === _cmdActiveIdx);
  });
  const active = cont.querySelector('.cmd-palette-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}
function _runActiveCmd() {
  const r = _cmdResults[_cmdActiveIdx];
  if (!r) return;
  if (r.kind === 'note') {
    closeCmdPalette();
    if (currentPage !== 'memo' && typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
    selectNote(r.noteType, r.id);
  } else if (r.kind === 'tag') {
    closeCmdPalette();
    if (currentPage !== 'memo' && typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
    setTagFilter(r.tag);
  } else if (r.kind === 'action') {
    r.action.fn();
  }
}
// Wire palette input
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('cmd-palette-input');
  if (!inp) return;
  inp.addEventListener('input', (e) => renderCmdPaletteResults(e.target.value));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _cmdActiveIdx = Math.min(_cmdResults.length - 1, _cmdActiveIdx + 1); _highlightCmdActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _cmdActiveIdx = Math.max(0, _cmdActiveIdx - 1); _highlightCmdActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); _runActiveCmd(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCmdPalette(); }
  });
});


