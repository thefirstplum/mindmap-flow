// =================== DRIVE CLIENT (Layer 1) ===================
// Pure low-level Drive API client. Knows nothing about MindFlow's data model,
// folder structure, or sync engine state — only HTTP, OAuth, and file ops.
//
// Folder ids, snapshot, polling, conflict resolution, etc. live at the
// SyncEngine level (sync.js). This separation lets us test/replace the API
// surface independently of business logic.

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_TOKEN_STORAGE_KEY = 'mindflow_drive_tok';

class DriveClient {
  constructor({ clientId, scope } = {}) {
    this.clientId = clientId || null;
    this.scope = scope || 'https://www.googleapis.com/auth/drive';
    this.accessToken = null;
    this.tokenExpires = 0;
    this._tokenClient = null;
    this._loginHint = null;
  }

  setClientId(id) {
    this.clientId = id;
    this._tokenClient = null;
  }

  setLoginHint(email) { this._loginHint = email || null; }

  // ========== Auth ==========

  async _ensureGsiLoaded() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      let attempts = 0;
      const check = setInterval(() => {
        if (window.google?.accounts?.oauth2) { clearInterval(check); resolve(); return; }
        if (++attempts > 80) { clearInterval(check); reject(new Error('Google 인증 라이브러리를 불러오지 못했습니다 (네트워크 확인)')); }
      }, 100);
    });
  }

  // Trigger OAuth flow. promptUser=true → popup with consent screen.
  // promptUser=false → may still popup if Google session expired (caller should
  // pre-check hasValidToken to avoid unwanted popups in background flows).
  async authenticate(promptUser = false) {
    if (!this.clientId) throw new Error('Client ID 미설정');
    await this._ensureGsiLoaded();
    return new Promise((resolve, reject) => {
      // 60s timeout — without this, an ignored popup leaves the caller hung
      // forever (which used to leave the sync pill stuck on '동기화 중').
      const timeout = setTimeout(() => reject(new Error('인증 시간 초과')), 60_000);
      try {
        this._tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: this.scope,
          prompt: promptUser ? 'consent' : '',
          login_hint: this._loginHint || undefined,
          callback: (resp) => {
            clearTimeout(timeout);
            if (resp.error) return reject(new Error(resp.error_description || resp.error));
            this.accessToken = resp.access_token;
            this.tokenExpires = Date.now() + (resp.expires_in - 60) * 1000;
            try {
              localStorage.setItem(DRIVE_TOKEN_STORAGE_KEY,
                JSON.stringify({ t: this.accessToken, e: this.tokenExpires }));
            } catch {}
            resolve();
          },
          error_callback: (err) => { clearTimeout(timeout); reject(new Error(err.message || '인증 거부됨')); }
        });
        this._tokenClient.requestAccessToken();
      } catch (e) { clearTimeout(timeout); reject(e); }
    });
  }

  // Synchronous, popup-free check. Restores cached token from localStorage
  // if available. Background paths (polling, auto-save) MUST gate on this
  // — never call ensureToken() from background or popup will appear.
  hasValidToken() {
    if (this.accessToken && Date.now() < this.tokenExpires) return true;
    try {
      const cached = JSON.parse(localStorage.getItem(DRIVE_TOKEN_STORAGE_KEY) || 'null');
      if (cached?.t && Date.now() < cached.e) {
        this.accessToken = cached.t;
        this.tokenExpires = cached.e;
        return true;
      }
    } catch {}
    return false;
  }

  // For interactive flows. Throws TOKEN_EXPIRED_SILENT if silent=true and no
  // valid token (caller should bail without popup).
  async ensureToken({ silent = false } = {}) {
    if (this.hasValidToken()) return;
    if (silent) throw new Error('TOKEN_EXPIRED_SILENT');
    await this.authenticate(false);
  }

  clearToken() {
    this.accessToken = null;
    this.tokenExpires = 0;
    try { localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY); } catch {}
  }

  // ========== Generic HTTP ==========

  async request(method, path, body, query = {}) {
    await this.ensureToken();
    const url = new URL(DRIVE_API_BASE + path);
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const headers = { 'Authorization': 'Bearer ' + this.accessToken };
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

  // ========== File ops ==========

  async download(fileId) {
    await this.ensureToken();
    const r = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
      headers: { 'Authorization': 'Bearer ' + this.accessToken }
    });
    if (!r.ok) throw new Error('다운로드 실패');
    return r.text();
  }

  async upload(name, content, mimeType, parentId, appProperties) {
    await this.ensureToken();
    const metadata = { name, mimeType };
    if (parentId) metadata.parents = [parentId];
    if (appProperties) metadata.appProperties = appProperties;
    const isBlob = content instanceof Blob;
    if (isBlob) {
      // Two-step for binary: create then PATCH media (simpler than multipart with binary)
      const created = await this.request('POST', '/files', metadata);
      const r = await fetch(`${DRIVE_UPLOAD_BASE}/files/${created.id}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + this.accessToken, 'Content-Type': mimeType },
        body: content
      });
      if (!r.ok) throw new Error('업로드 실패: ' + await r.text());
      return r.json();
    }
    const boundary = '----mfb' + Math.random().toString(36).slice(2);
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;
    const r = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,modifiedTime`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + this.accessToken, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    if (!r.ok) throw new Error('업로드 실패: ' + await r.text());
    return r.json();
  }

  async update(fileId, content, mimeType) {
    await this.ensureToken();
    const r = await fetch(`${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media&fields=id,name,modifiedTime`, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + this.accessToken, 'Content-Type': mimeType },
      body: content instanceof Blob ? content : new Blob([content], { type: mimeType })
    });
    if (!r.ok) throw new Error('수정 실패: ' + await r.text());
    return r.json();
  }

  async delete(fileId) {
    await this.ensureToken();
    await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + this.accessToken }
    });
  }

  // Used for parent moves (addParents / removeParents) and metadata-only updates.
  // body can be null when only query params change the file.
  async patch(fileId, body, query) {
    return this.request('PATCH', `/files/${fileId}`, body, query);
  }

  // ========== Folder / listing ==========

  async listInFolder(folderId) {
    return this.request('GET', '/files', null, {
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,modifiedTime,size,appProperties,parents)',
      pageSize: 1000
    });
  }

  // List files where parent is any of the supplied IDs. Single API call regardless
  // of how many parents. Returns the raw Drive response — caller categorizes.
  async listInParents(parentIds) {
    const ids = (parentIds || []).filter(Boolean);
    if (ids.length === 0) return { files: [] };
    const parentClause = ids.map(id => `'${id}' in parents`).join(' or ');
    return this.request('GET', '/files', null, {
      q: `(${parentClause}) and trashed = false`,
      fields: 'files(id,name,mimeType,modifiedTime,size,appProperties,parents)',
      pageSize: 1000
    });
  }

  async findOrCreateFolder(name, parentId) {
    const escaped = name.replace(/'/g, "\\'");
    const q = parentId
      ? `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`
      : `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`;
    const list = await this.request('GET', '/files', null, { q, fields: 'files(id,name)' });
    if (list.files.length > 0) return list.files[0].id;
    const folder = await this.request('POST', '/files', {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : []
    });
    return folder.id;
  }

  // Find a folder by name OR id, anywhere in the user's Drive (used by
  // driveImportFromFolder). Returns the first match's id, or null.
  async findFolderAnywhere(name) {
    const escaped = name.replace(/'/g, "\\'");
    const r = await this.request('GET', '/files', null, {
      q: `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 5
    });
    return r.files?.[0]?.id || null;
  }

  // ========== Changes API ==========

  async getStartPageToken() {
    const r = await this.request('GET', '/changes/startPageToken');
    return r.startPageToken;
  }

  async getChanges(pageToken, { pageSize = 100, fields } = {}) {
    return this.request('GET', '/changes', null, {
      pageToken,
      fields: fields || 'newStartPageToken,nextPageToken,changes(removed,file(parents,trashed))',
      pageSize,
      restrictToMyDrive: true
    });
  }

  // ========== Misc ==========

  async getAbout(fields = 'user(emailAddress,displayName)') {
    return this.request('GET', '/about', null, { fields });
  }

  async makePublic(fileId) {
    return this.request('POST', `/files/${fileId}/permissions`, { role: 'reader', type: 'anyone' });
  }
}

// Expose globally so sync.js can instantiate (deferred-script shared scope)
window.DriveClient = DriveClient;
