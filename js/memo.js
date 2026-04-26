// =================== MEMO ===================
let memos = load('memos', []);
let activeMemoId = null;
let memoIdCounter = load('memo_idcounter', 1);

function saveMemos() {
  save('memos', memos);
  save('memo_idcounter', memoIdCounter);
}

function createMemo() {
  const memo = { id: memoIdCounter++, title: '새 메모', content: '', date: new Date().toISOString() };
  memos.unshift(memo);
  activeMemoId = memo.id;
  saveMemos();
  renderMemoList();
  renderMemoEditor();
  document.getElementById('memo-page').classList.add('show-editor');
  setTimeout(() => {
    const inp = document.querySelector('.memo-editor-header input');
    if (inp) { inp.focus(); inp.select(); }
  }, 100);
}

function selectMemo(id) {
  activeMemoId = id;
  renderMemoList();
  renderMemoEditor();
  document.getElementById('memo-page').classList.add('show-editor');
}

function backToList() {
  document.getElementById('memo-page').classList.remove('show-editor');
}

function deleteMemo(id) {
  if (!confirm('이 메모를 삭제하시겠습니까?')) return;
  memos = memos.filter(m => m.id !== id);
  if (activeMemoId === id) activeMemoId = null;
  saveMemos();
  renderMemoList();
  renderMemoEditor();
  backToList();
  toast('삭제되었습니다');
}

function renderMemoList() {
  const search = document.getElementById('memo-search').value.toLowerCase();
  const filtered = memos.filter(m => m.title.toLowerCase().includes(search) || m.content.toLowerCase().includes(search));
  const container = document.getElementById('memo-items');
  const countEl = document.getElementById('memo-count');
  if (countEl) countEl.textContent = memos.length;
  if (filtered.length === 0) {
    container.innerHTML = `<div class="memo-empty">
      <div class="big-icon">📝</div>
      ${memos.length === 0 ? '아직 메모가 없습니다<br>+ 버튼을 눌러 시작하세요' : '검색 결과가 없습니다'}
    </div>`;
    return;
  }
  container.innerHTML = filtered.map(m => {
    const date = new Date(m.date);
    const now = new Date();
    let dateStr;
    if (isSameDay(date, now)) {
      dateStr = `오늘 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    } else {
      const dayDiff = Math.floor((now - date) / (1000*60*60*24));
      if (dayDiff < 7) dateStr = `${dayDiff}일 전`;
      else dateStr = `${date.getMonth()+1}월 ${date.getDate()}일`;
    }
    const preview = m.content.replace(/^#+\s+.*$/gm, '').replace(/[*_`>#]/g, '').replace(/\n+/g, ' ').trim().slice(0, 90) || '내용 없음';
    const wordCount = m.content.length;
    return `<div class="swipe-row" data-id="${m.id}">
      <div class="memo-item swipe-content ${m.id === activeMemoId ? 'active' : ''}" onclick="selectMemo(${m.id})">
        <div class="memo-item-title">${escapeHtml(m.title) || '제목 없음'}</div>
        <div class="memo-item-preview">${escapeHtml(preview)}</div>
        <div class="memo-item-meta">
          <span>${dateStr}</span>
          <span class="dot"></span>
          <span>${wordCount}자</span>
        </div>
      </div>
      <button class="swipe-action" aria-label="삭제">🗑 삭제</button>
    </div>`;
  }).join('');
  // Wire swipe-to-delete (idempotent — handler attached once via flag)
  if (!container.dataset.swipeReady) {
    attachSwipeToDelete(container, {
      resolveId: (row) => parseInt(row.dataset.id),
      onDelete: (id) => deleteMemo(id)
    });
    container.dataset.swipeReady = '1';
  }
}

function renderMemoEditor() {
  const editor = document.getElementById('memo-editor');
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) {
    editor.innerHTML = `<div class="memo-editor-empty">
      <div class="big">📝</div>
      <div style="font-size:16px;font-weight:600;color:var(--text-dim);">메모를 선택하거나 새로 만드세요</div>
      <div class="hint">목록에서 메모를 선택하거나 + 버튼을 눌러 새 메모를 만드세요</div>
      <div class="shortcuts">
        <div style="font-weight:600;color:var(--text);margin-bottom:6px;">마크다운 단축 문법</div>
        <code># </code> 큰 제목 ·  <code>## </code> 중제목<br>
        <code>**굵게**</code> ·  <code>*기울임*</code> ·  <code>~~취소~~</code><br>
        <code>- </code> 목록 ·  <code>- [ ] </code> 체크박스<br>
        <code>\`코드\`</code> ·  <code>&gt; </code> 인용문 ·  <code>---</code> 구분선
      </div>
    </div>`;
    return;
  }
  const date = new Date(memo.date);
  const dateStr = `${date.getFullYear()}년 ${date.getMonth()+1}월 ${date.getDate()}일 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
  const charCount = memo.content.length;
  const wordCount = memo.content.trim().split(/\s+/).filter(Boolean).length;

  const editPart = `<textarea placeholder="# 제목\n\n마크다운으로 자유롭게 작성하세요..." oninput="updateMemoContent(this.value)">${escapeHtml(memo.content)}</textarea>`;
  const previewPart = `<div class="markdown-body">${memo.content.trim() ? md2html(memo.content) : '<div class="markdown-empty">미리볼 내용이 없습니다</div>'}</div>`;
  const livePart = `<div class="bear-editor" contenteditable="true" id="bear-editor-${memo.id}" spellcheck="false"></div>`;

  let bodyHtml = '';
  if (memoMode === 'live') bodyHtml = `<div class="memo-body-wrap">${livePart}</div>`;
  else if (memoMode === 'edit') bodyHtml = `<div class="memo-body-wrap">${editPart}</div>`;
  else if (memoMode === 'preview') bodyHtml = `<div class="memo-body-wrap">${previewPart}</div>`;
  else bodyHtml = `<div class="memo-body-wrap split">${editPart}${previewPart}</div>`;

  const liveIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
  const splitIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`;
  const eyeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

  editor.innerHTML = `
    <div class="memo-editor-toolbar">
      <button class="panel-reopen-btn" onclick="togglePanel('memo-page')" title="목록 열기">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <button class="memo-back" onclick="backToList()" aria-label="뒤로">‹</button>
      <div class="memo-mode-toggle">
        <button class="${memoMode==='live'?'active':''}" onclick="setMemoMode('live')" title="라이브 (Bear 스타일)">${liveIcon}<span class="label-text">라이브</span></button>
        <button class="${memoMode==='split'?'active':''}" onclick="setMemoMode('split')" title="분할">${splitIcon}<span class="label-text">분할</span></button>
        <button class="${memoMode==='preview'?'active':''}" onclick="setMemoMode('preview')" title="미리보기">${eyeIcon}<span class="label-text">미리보기</span></button>
      </div>
      <div class="memo-toolbar-spacer"></div>
      <button class="memo-icon-btn" onclick="openDrawingModal()" title="드로잉 (Apple Pencil)">
        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
      </button>
      <button class="memo-icon-btn" onclick="triggerImageUpload()" title="이미지 업로드 (또는 메모에 붙여넣기/드래그)">
        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </button>
      <button class="memo-icon-btn danger" onclick="deleteMemo(${memo.id})" title="메모 삭제">
        <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/></svg>
      </button>
    </div>
    <div class="memo-editor-header">
      <input type="text" value="${escapeHtml(memo.title)}" oninput="updateMemoTitle(this.value)" placeholder="제목 없음">
    </div>
    <div class="memo-meta">
      <span>${dateStr}</span>
      <span class="dot"></span>
      <span>${charCount}자 · ${wordCount}단어</span>
      <span class="dot"></span>
      <span class="badge">MARKDOWN</span>
    </div>
    ${bodyHtml}
  `;
  // Wire interactions once the new DOM exists
  setTimeout(() => {
    if (memoMode === 'split') setupSplitScrollSync();
    if (memoMode === 'live') {
      const ed = document.getElementById('bear-editor-' + memo.id);
      if (ed) {
        setupBearEditor(ed, memo.content, (newContent) => {
          memo.content = newContent;
          memo.date = new Date().toISOString();
          saveMemos();
          // Live char-count update in meta (optional)
          const meta = document.querySelector('.memo-meta');
          if (meta) {
            const date = new Date(memo.date);
            const dateStr = `${date.getFullYear()}년 ${date.getMonth()+1}월 ${date.getDate()}일 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
            const wc = newContent.trim().split(/\s+/).filter(Boolean).length;
            meta.querySelector('span:nth-child(1)').textContent = dateStr;
            meta.querySelector('span:nth-child(3)').textContent = `${newContent.length}자 · ${wc}단어`;
          }
          clearTimeout(window._memoListTimer);
          window._memoListTimer = setTimeout(renderMemoList, 500);
        });
      }
    }
  }, 0);
}


// =================== BEAR-STYLE LIVE EDITOR ===================
function bearRenderLine(text) {
  if (!text) return '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Block-level: headers, bullets, quote
  let m;
  if (m = text.match(/^(#{1,3}) (.*)$/)) {
    const level = m[1].length;
    return `<span class="md-marker">${m[1]} </span><span class="md-h${level}">${esc(m[2])}</span>`;
  }
  if (m = text.match(/^([-*+]) (.*)$/)) {
    return `<span class="md-bullet">•</span><span class="md-marker">${esc(m[1])} </span>${bearInline(esc(m[2]))}`;
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
  // Link [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<span class="md-marker">[</span><span class="md-link">$1</span><span class="md-marker">](</span><span class="md-marker">$2</span><span class="md-marker">)</span>');
  return html;
}

function bearRenderContent(text) {
  return text.split('\n').map(line =>
    `<div data-line>${bearRenderLine(line)}</div>`
  ).join('');
}

// All offset/text functions use Range.toString() so block boundaries count
// as \n consistently. Critically, set-caret walks BLOCKS (not just text
// nodes) so the caret can land on an empty line (whose div has no text
// node) — that's the case after pressing Enter at end of a line.
function bearGetCaretOffset(editor) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return 0;
  const tempRange = document.createRange();
  tempRange.selectNodeContents(editor);
  tempRange.setEnd(range.startContainer, range.startOffset);
  return tempRange.toString().length;
}

function bearSetCaretOffset(editor, target) {
  const blocks = [...editor.children];
  if (blocks.length === 0) {
    // Place caret in editor itself
    const r = document.createRange();
    const sel = window.getSelection();
    r.setStart(editor, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return;
  }

  // Find the LAST block whose start position <= target. That's the block
  // the caret should live in. Using LAST handles the boundary case where
  // target equals the position right after a \n separator (start of next
  // block), not the end of the previous block.
  let containingIdx = 0;
  let containingStart = 0;
  for (let i = 0; i < blocks.length; i++) {
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.setEndBefore(blocks[i]);
    const startPos = r.toString().length;
    if (startPos <= target) {
      containingIdx = i;
      containingStart = startPos;
    } else {
      break;
    }
  }

  const block = blocks[containingIdx];
  const offsetInBlock = target - containingStart;

  // Walk text nodes within the block to place caret at offsetInBlock
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
  let chars = 0;
  let node;
  let lastNode = null;
  while ((node = walker.nextNode())) {
    lastNode = node;
    if (chars + node.length >= offsetInBlock) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, Math.max(0, Math.min(node.length, offsetInBlock - chars)));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    chars += node.length;
  }
  // No text nodes in block (empty line): place caret at the start of the
  // block element itself — the browser renders it on the empty line.
  const sel = window.getSelection();
  const r = document.createRange();
  if (lastNode) {
    r.setStart(lastNode, lastNode.length);
  } else {
    r.setStart(block, 0);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function bearGetText(editor) {
  // Range.toString() of full contents gives \n-separated text consistently,
  // even when the browser inserted plain <div> blocks (e.g. after Enter).
  const range = document.createRange();
  range.selectNodeContents(editor);
  return range.toString().replace(/​/g, '');
}

function setupBearEditor(editor, content, onChange) {
  editor.innerHTML = bearRenderContent(content || '');
  let composing = false;
  let renderTimer = null;

  function rerender() {
    if (composing) return;
    const offset = bearGetCaretOffset(editor);
    const text = bearGetText(editor);
    onChange(text);
    editor.innerHTML = bearRenderContent(text);
    bearSetCaretOffset(editor, offset);
  }

  editor.addEventListener('compositionstart', () => { composing = true; });
  editor.addEventListener('compositionend', () => {
    composing = false;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(rerender, 80);
  });

  editor.addEventListener('input', () => {
    if (composing) {
      // Still notify changes during composition for autosave (no rerender)
      onChange(bearGetText(editor));
      return;
    }
    clearTimeout(renderTimer);
    renderTimer = setTimeout(rerender, 120);
  });

  // Plain-text paste: avoid pasting styled HTML which could break our layout
  editor.addEventListener('paste', (e) => {
    if (e.clipboardData?.types?.includes('Files')) return; // image paste handled elsewhere
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  });
}

let memoMode = load('memo_mode', 'live'); // live (Bear-style WYSIWYG) | split | preview
function setMemoMode(mode) {
  memoMode = mode;
  save('memo_mode', mode);
  renderMemoEditor();
}

// Sync scroll between textarea and preview in split mode (proportional)
function setupSplitScrollSync() {
  if (memoMode !== 'split') return;
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
    memo.date = new Date().toISOString();
    saveMemos();
    renderMemoList();
  }
}

function updateMemoContent(val) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (memo) {
    memo.content = val;
    memo.date = new Date().toISOString();
    saveMemos();
    const meta = document.querySelector('.memo-meta');
    if (meta) {
      const date = new Date(memo.date);
      const dateStr = `${date.getFullYear()}.${(date.getMonth()+1).toString().padStart(2,'0')}.${date.getDate().toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
      meta.textContent = `${dateStr} · ${val.length}자 · 마크다운 (.md)`;
    }
    // Live preview in split mode
    if (memoMode === 'split') {
      const preview = document.querySelector('.memo-body-wrap.split .markdown-body');
      if (preview) preview.innerHTML = val.trim() ? md2html(val) : '<div class="markdown-empty">미리볼 내용이 없습니다</div>';
    }
    clearTimeout(window._memoListTimer);
    window._memoListTimer = setTimeout(renderMemoList, 500);
  }
}

function filterMemos() { renderMemoList(); }

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
    // Use thumbnail URL for reliable hotlinking; size up to ~2000px
    const url = `https://drive.google.com/thumbnail?id=${file.id}&sz=w2000`;
    toast('이미지 업로드 완료', 'success');
    return { url, id: file.id, name };
  } catch (e) {
    toast('업로드 실패: ' + e.message, 'error');
    return null;
  }
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + text + after;
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  // Trigger input event so updateMemoContent runs
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

async function handleImageInsert(blob) {
  const ta = document.querySelector('.memo-editor textarea');
  if (!ta) return;
  if (driveAssetsFolderId) {
    const result = await uploadImageToDrive(blob);
    if (result) insertAtCursor(ta, `\n![${result.name}](${result.url})\n`);
  } else {
    // Fallback: base64 inline (small images only)
    if (blob.size > 800_000) {
      toast('Drive 미연결 + 파일 800KB 초과 → 업로드 불가', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      insertAtCursor(ta, `\n![image](${reader.result})\n`);
      toast('인라인 이미지로 삽입됨 (Drive 연결하면 자동 업로드)', 'success');
    };
    reader.readAsDataURL(blob);
  }
}

document.addEventListener('paste', (e) => {
  const ta = document.activeElement;
  if (!ta || ta.tagName !== 'TEXTAREA' || !ta.closest('.memo-editor')) return;
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
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const f = e.target.files?.[0];
    if (f) handleImageInsert(f);
  };
  input.click();
}

