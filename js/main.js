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

// (옛 "Prevent iOS bounce" touchmove 핸들러 제거 — passive:true + preventDefault
//  호출 없음 = dead code. html/body의 `overscroll-behavior: none` 한 줄이 이미
//  바운스를 막고 있음.)

// Apply settings (show/hide ledger tab etc.) and init ledger renderer
applySettings();

// One-time: extract inline hashtags from existing memo content into tag chips
if (typeof migrateHashtagsFromContent === 'function') {
  try { migrateHashtagsFromContent(); } catch (e) { console.warn('hashtag migration failed:', e); }
}

// Daily backup (idle, runs at most once per 24h)
if (typeof BackupService !== 'undefined') {
  BackupService.maybeDaily().catch(() => {});
}

// Ask browser for persistent storage — without this, iOS Safari may evict
// localStorage after 7 days idle, silently losing data. No-op on browsers
// that don't support the API.
if (typeof requestPersistentStorage === 'function') {
  requestPersistentStorage().catch(() => {});
}

// =================== URL PARAMS — PWA shortcuts & share target ===================
// manifest.json declares shortcuts (?action=new-memo, ?page=calendar) and a
// share_target (?share_title=…&share_text=…). Resolve them on cold boot.
(function handleLaunchParams() {
  try {
    const u = new URL(location.href);
    const action = u.searchParams.get('action');
    const page = u.searchParams.get('page');
    const shareTitle = u.searchParams.get('share_title');
    const shareText = u.searchParams.get('share_text');
    const shareUrl = u.searchParams.get('share_url');
    let handled = false;
    if (action === 'new-memo' || shareText || shareTitle || shareUrl) {
      // Defer a tick so memo.js is fully wired (createMemo + active memo edit)
      setTimeout(() => {
        if (typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
        if (typeof createMemo === 'function') {
          createMemo();
          if (shareText || shareTitle || shareUrl) {
            const m = memos.find(x => x.id === activeMemoId);
            if (m) {
              if (shareTitle) m.title = shareTitle;
              const bodyParts = [];
              if (shareText) bodyParts.push(shareText);
              if (shareUrl) bodyParts.push(shareUrl);
              if (bodyParts.length) m.content = bodyParts.join('\n\n');
              saveMemos();
              renderMemoEditor();
              renderMemoList();
            }
          }
        }
      }, 30);
      handled = true;
    } else if (action === 'new-mindmap') {
      setTimeout(() => {
        if (typeof navigateTo === 'function') navigateTo('memo', { updateHash: false });
        if (typeof createMindmap === 'function') createMindmap();
      }, 30);
      handled = true;
    } else if (page) {
      setTimeout(() => {
        if (typeof navigateTo === 'function') navigateTo(page, { updateHash: false });
      }, 30);
      handled = true;
    }
    if (handled) {
      // Clean the URL so a refresh doesn't re-trigger the action
      const clean = location.pathname + location.hash;
      history.replaceState(null, '', clean);
    }
  } catch (e) { console.warn('launch param handler:', e); }
})();

// =================== SERVICE WORKER (PWA instant-update) ===================
// Network-first SW + auto skipWaiting + auto reload → 새 배포가 즉시 적용됨.
// 이전엔 새 SW가 waiting 상태로 머물러 다음 새로고침까지 옛 버전을 보여줬음.
if ('serviceWorker' in navigator) {
  // Use ./service-worker.js so it works on GitHub Pages subpath
  navigator.serviceWorker.register('./service-worker.js').then((reg) => {
    // 페이지 로드 직후 이미 waiting 중인 SW가 있으면 즉시 활성화
    if (reg.waiting && navigator.serviceWorker.controller) {
      reg.waiting.postMessage('SKIP_WAITING');
    }

    // 새 SW 설치되는 순간 → 즉시 활성화 요청 (사용자 액션 대기 X)
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          sw.postMessage('SKIP_WAITING');
        }
      });
    });

    // 컨트롤러 교체 = 새 SW가 페이지를 잡음 → 1회 자동 reload
    let _reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_reloaded) return;
      _reloaded = true;
      // 입력 중이면 blur까지 잠깐 미룸 — 커서 위치 잃지 않게.
      // (메모 본문은 입력 즉시 localStorage에 저장되므로 데이터 손실은 없음)
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) {
        if (typeof toast === 'function') toast('새 버전 대기 중 — 입력 끝나면 자동 적용', 'success');
        const reload = () => location.reload();
        el.addEventListener('blur', reload, { once: true });
        setTimeout(reload, 30000); // 안전망: 30초 후엔 무조건 reload
      } else {
        location.reload();
      }
    });

    // 적극적 업데이트 체크 — 브라우저 기본은 24h 주기라 standalone PWA에선 너무 늦음.
    // 탭이 다시 보일 때/포커스 잡힐 때마다 서버에 새 버전 확인 → install→activate→reload 자동
    const checkUpdate = () => { try { reg.update(); } catch {} };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkUpdate();
    });
    window.addEventListener('focus', checkUpdate);
    // 페이지 로드 시 즉시 한번 — 옛 SW가 캐시 잡고 있는 케이스 대응
    checkUpdate();
  }).catch((e) => console.warn('SW register failed:', e));

  // 새 SW가 보내는 강제 reload 시그널 수신 — 컨트롤러 교체 못 잡는 케이스 안전망
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SW_RELOAD') {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (!typing) {
        setTimeout(() => location.reload(), 100);
      }
    }
  });
}

// =================== SYNC EVENTS → UI WIRE-UP ===================
// Sync engine emits domain events; the UI listens here. This keeps sync logic
// unaware of which renderers exist — easier to test, less coupling.
if (window.SyncEvents) {
  SyncEvents.on('itemsMerged', ({ types, editingMemoId, focusedEl, focusSel }) => {
    if (types.includes('mindmap')) {
      if (typeof renderMindmapList === 'function') renderMindmapList();
      if (typeof drawMindMap === 'function') drawMindMap();
      // Refresh the open mindmap's tag chips (a merge may have changed them).
      // Skip if the user is focused in the tag input mid-typing.
      const ae = document.activeElement;
      if (typeof renderMindmapTags === 'function' && !(ae && ae.id === 'mm-tag-input')) {
        renderMindmapTags();
      }
    }
    if (types.includes('memo')) {
      if (typeof renderMemoList === 'function') renderMemoList();
      // Skip editor redraw if user is actively editing — would clobber cursor
      if (editingMemoId == null && typeof renderMemoEditor === 'function') renderMemoEditor();
    }
    // 홈은 메모·마인드맵을 모두 읽으므로 둘 중 하나만 바뀌어도 다시 그린다.
    // (홈에 머무는 동안 동기화가 도착하는 경우 — navigateTo는 안 불리므로 여기서)
    const notesChanged = types.includes('memo') || types.includes('mindmap');
    if (currentPage === 'home' && typeof renderHome === 'function' && notesChanged) {
      renderHome();
    }
    // 캘린더도 노트 수정일을 흔적으로 표시하므로 같이 갱신한다
    if (currentPage === 'calendar' && typeof renderCalendar === 'function' && notesChanged) {
      renderCalendar();
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

// Initialize Drive sync (silently re-auths and pulls if connected before)
// 유일한 동기화 경로. 폴더 vault(initFolder)와 Gist(initGist)는 제거됨.
initDrive();
// Initial header pill render
updateHeaderSyncPill();

// Restore the page from the URL hash (e.g. after a PWA reload). Runs here —
// not in navigation.js — so every page renderer is already defined.
if (typeof initRoute === 'function') initRoute();

// (폴더 vault 자동 복원 tryRestoreFolder 제거 — 폴더 동기화 기능 자체가 삭제됨.
//  참고로 이 함수는 initFolder()를 await하지 않아 folderHandle이 채워지기 전에
//  검사가 끝났고, 부팅 시 한 번도 실제로 동작한 적이 없었다.)
