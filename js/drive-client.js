// =================== DRIVE CLIENT (Layer 1) ===================
// Pure low-level Drive API client. Knows nothing about MindFlow's data model,
// folder structure, or sync engine state — only HTTP, OAuth, and file ops.
//
// Auth: Authorization Code + PKCE via a Cloudflare Worker proxy. The Worker
// holds the OAuth client_secret and the refresh_token in KV, so the browser
// only ever sees short-lived access_tokens. Once the user grants consent
// (one full-page redirect), every later session silently refreshes via the
// worker — no popup, no re-login.

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_TOKEN_STORAGE_KEY = 'mindflow_drive_tok';
const DRIVE_CONNECTED_KEY = 'mindflow_drive_connected';
const DRIVE_PKCE_VERIFIER_KEY = 'mindflow_drive_pkce_v';
const DRIVE_AUTH_STATE_KEY = 'mindflow_drive_auth_state';

// Cloudflare Worker that proxies the OAuth token endpoints and holds the
// refresh_token. See worker source in the repo root.
const DRIVE_WORKER_URL = 'https://mindflow-drive-token.thefirstplum.workers.dev';

class DriveClient {
  constructor({ clientId, scope } = {}) {
    this.clientId = clientId || null;
    this.scope = scope || 'https://www.googleapis.com/auth/drive';
    this.accessToken = null;
    this.tokenExpires = 0;
    this._refreshTimer = null;
    this._refreshInFlight = null;
  }

  setClientId(id) { this.clientId = id; }

  // Kept for API compatibility with the old GIS flow; login_hint was used to
  // pre-fill the Google account chooser. The Authorization Code + PKCE flow
  // accepts the same parameter but it's optional, so we just remember it.
  setLoginHint(email) { this._loginHint = email || null; }

  get redirectUri() {
    // Must exactly match an entry in the OAuth client's "Authorized redirect URIs".
    // We use the page itself as the redirect target — on return we detect `?code=`
    // and exchange it for tokens via the worker.
    return window.location.origin + window.location.pathname;
  }

  // ========== PKCE helpers ==========

  _randomVerifier(len = 64) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return this._base64url(arr).slice(0, len);
  }

  async _sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return this._base64url(new Uint8Array(hash));
  }

  _base64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ========== Auth: outbound redirect ==========

  // Builds the Google OAuth URL and navigates the page to it. Stores the PKCE
  // verifier + a random state in sessionStorage so we can validate the callback.
  // NOTE: this never returns — the browser leaves the page.
  async startAuthFlow() {
    if (!this.clientId) throw new Error('Client ID 미설정');
    const verifier = this._randomVerifier(64);
    const challenge = await this._sha256(verifier);
    const state = this._randomVerifier(16);
    try {
      sessionStorage.setItem(DRIVE_PKCE_VERIFIER_KEY, verifier);
      sessionStorage.setItem(DRIVE_AUTH_STATE_KEY, state);
    } catch (e) {
      throw new Error('sessionStorage 사용 불가 — 시크릿 모드 확인');
    }
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.scope);
    // access_type=offline + prompt=consent → guarantees Google issues a
    // refresh_token. Without prompt=consent, a re-auth for the same user may
    // skip the consent screen AND skip refresh_token issuance.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    if (this._loginHint) url.searchParams.set('login_hint', this._loginHint);
    window.location.href = url.toString();
  }

  // ========== Auth: inbound callback (?code=...) ==========

  // Detect the OAuth callback in the current URL. Returns true if a code was
  // found and successfully exchanged. Idempotent on URL with no code. Cleans
  // the URL on success so a reload doesn't re-trigger the exchange.
  async handleOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const stateParam = params.get('state');
    const error = params.get('error');
    if (error) {
      this._cleanUrl();
      throw new Error('Google 인증 거부됨: ' + error);
    }
    if (!code) return false;

    const verifier = sessionStorage.getItem(DRIVE_PKCE_VERIFIER_KEY);
    const expectedState = sessionStorage.getItem(DRIVE_AUTH_STATE_KEY);
    sessionStorage.removeItem(DRIVE_PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(DRIVE_AUTH_STATE_KEY);
    this._cleanUrl();

    if (!verifier) throw new Error('PKCE verifier 누락 — 새 탭에서 인증을 시작했나요?');
    if (expectedState && stateParam !== expectedState) {
      throw new Error('OAuth state 불일치 — 보안상 중단');
    }

    const r = await fetch(DRIVE_WORKER_URL + '/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        redirect_uri: this.redirectUri,
        code_verifier: verifier
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('토큰 교환 실패: ' + (data.error || r.status));
    this._saveToken(data.access_token, data.expires_in);
    try { localStorage.setItem(DRIVE_CONNECTED_KEY, '1'); } catch {}
    return true;
  }

  _cleanUrl() {
    try {
      const u = new URL(window.location.href);
      ['code', 'state', 'scope', 'error', 'authuser', 'prompt', 'hd'].forEach(k => u.searchParams.delete(k));
      const clean = u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash;
      window.history.replaceState({}, '', clean);
    } catch {}
  }

  // ========== Auth: silent refresh ==========

  // Asks the worker for a fresh access_token using the stored refresh_token.
  // Single-flight: concurrent callers share the in-flight promise.
  async refreshAccessToken() {
    if (this._refreshInFlight) return this._refreshInFlight;
    this._refreshInFlight = (async () => {
      const r = await fetch(DRIVE_WORKER_URL + '/refresh', { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 401 || data.error === 'invalid_grant' || data.error === 'no_refresh_token') {
          // Refresh token gone / revoked — force the user to re-consent.
          try { localStorage.removeItem(DRIVE_CONNECTED_KEY); } catch {}
        }
        throw new Error('토큰 갱신 실패: ' + (data.error || r.status));
      }
      this._saveToken(data.access_token, data.expires_in);
    })();
    try { return await this._refreshInFlight; }
    finally { this._refreshInFlight = null; }
  }

  _saveToken(accessToken, expiresIn) {
    this.accessToken = accessToken;
    this.tokenExpires = Date.now() + (Math.max(60, expiresIn || 3600) - 60) * 1000;
    try {
      localStorage.setItem(DRIVE_TOKEN_STORAGE_KEY,
        JSON.stringify({ t: this.accessToken, e: this.tokenExpires }));
    } catch {}
    this._scheduleProactiveRefresh();
  }

  // Refresh ~5 min before expiry while the page is open, so token transitions
  // are invisible — any in-flight Drive request never hits an expired token.
  _scheduleProactiveRefresh() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    const lead = 5 * 60 * 1000;
    const delay = this.tokenExpires - Date.now() - lead;
    // 이미 만료가 임박(또는 경과)했다면 예전엔 그냥 return이라 타이머가 아예
    // 안 잡혔고, 그 뒤로는 아무도 갱신을 시도하지 않아 만료 상태로 남았다.
    // 기기가 자고 일어난 뒤가 딱 이 경우다. 곧바로 한 번 갱신한다.
    if (delay <= 0) {
      this.refreshAccessToken().catch(e => console.warn('Immediate refresh failed:', e));
      return;
    }
    this._refreshTimer = setTimeout(() => {
      // Best effort; failure here is non-fatal because ensureToken will retry
      // synchronously the next time a request happens.
      this.refreshAccessToken().catch(e => console.warn('Proactive refresh failed:', e));
    }, delay);
  }

  // Synchronous, popup-free check. Restores cached token from localStorage
  // if available. Use this to gate background work without triggering auth UI.
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

  hasRefreshToken() {
    try { return !!localStorage.getItem(DRIVE_CONNECTED_KEY); } catch { return false; }
  }

  // Ensure we have a usable access token. Behaviour:
  //   - Token cached + valid → return immediately
  //   - We have a refresh_token at the worker → silent refresh, return
  //   - silent=true and no refresh path → throw TOKEN_EXPIRED_SILENT (caller bails)
  //   - silent=false and no refresh path → throw NEEDS_AUTH (caller starts redirect)
  async ensureToken({ silent = false } = {}) {
    if (this.hasValidToken()) return;
    if (this.hasRefreshToken()) {
      try { await this.refreshAccessToken(); return; }
      catch (e) {
        if (silent) throw new Error('TOKEN_EXPIRED_SILENT');
        // fall through to re-consent
      }
    }
    if (silent) throw new Error('TOKEN_EXPIRED_SILENT');
    throw new Error('NEEDS_AUTH');
  }

  // Back-compat shim. The old engine called authenticate(true) to mean "open
  // the consent popup" and authenticate(false) to mean "silent refresh." We
  // map that onto: true → full redirect, false → silent refresh.
  async authenticate(promptUser = false) {
    if (promptUser) return this.startAuthFlow(); // never returns
    return this.ensureToken({ silent: false });
  }

  async clearToken() {
    this.accessToken = null;
    this.tokenExpires = 0;
    if (this._refreshTimer) { clearTimeout(this._refreshTimer); this._refreshTimer = null; }
    try { localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY); } catch {}
    try { localStorage.removeItem(DRIVE_CONNECTED_KEY); } catch {}
    // Tell the worker to revoke + delete the refresh_token in KV. Best effort;
    // if the network fails the user can still re-connect later.
    try {
      await fetch(DRIVE_WORKER_URL + '/revoke', { method: 'POST' });
    } catch (e) { console.warn('Drive revoke failed:', e); }
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
      // 401 from Drive means the access token was rejected mid-flight (e.g.
      // server-side revoke). Try one silent refresh + retry before failing.
      if (r.status === 401 && this.hasRefreshToken()) {
        this.tokenExpires = 0;
        await this.refreshAccessToken();
        const headers2 = { ...headers, 'Authorization': 'Bearer ' + this.accessToken };
        const r2 = await fetch(url, { method, headers: headers2, body: bodyToSend });
        if (r2.ok) {
          if (r2.status === 204) return null;
          return r2.json();
        }
      }
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
    const r = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + this.accessToken }
    });
    // 404 means the file is already gone — treat as success (idempotent delete).
    // Any other non-ok = real failure; throw so caller can retry / preserve state.
    if (!r.ok && r.status !== 404) {
      let msg = `Drive 삭제 실패 (${r.status})`;
      try { const j = await r.json(); if (j.error?.message) msg = j.error.message; } catch {}
      throw new Error(msg);
    }
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
