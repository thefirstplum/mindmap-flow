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

// Hardcoded default Client ID — published OAuth client for this app.
// Public-by-design: identifies the app, not the user. User data lives in
// each user's own Drive (drive.file scope). Override is still possible
// via the (now-hidden) input field if someone forks the repo.
const DEFAULT_DRIVE_CLIENT_ID = '47507563684-o5p5kjliou3bpddn6ae3ksabekjc6nlp.apps.googleusercontent.com';
let driveClientId = load('drive_client_id', null) || DEFAULT_DRIVE_CLIENT_ID;
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

