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
  // New memos open in live mode so user gets Bear-style inline editing
  memoMode = 'live';
  save('memo_mode', 'live');
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
  // Capture decoded images before the DOM is replaced so we can
  // transplant them back after — prevents iOS re-decode flicker.
  const _imgCache = new Map();
  editor.querySelectorAll('.markdown-body img').forEach(img => {
    if (img.complete && img.naturalWidth > 0) _imgCache.set(img.src, img);
  });
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

  // Three editor modes:
  //   'view' — read-only rendered HTML (tap body to enter live)
  //   'live' — Bear-style contenteditable: markdown renders inline as you type
  //   'edit' — raw textarea (fastest on mobile, plain source)
  const renderedHtml = memo.content.trim() ? md2html(memo.content) : '<div class="markdown-empty">내용을 추가하려면 라이브뷰 또는 편집 모드로 전환하세요</div>';

  let bodyHtml;
  if (memoMode === 'view') {
    bodyHtml = `<div class="memo-body-wrap"><div class="markdown-body view-clickable" id="memo-preview" onclick="if(!event.target.closest('a, img'))setMemoMode('live')">${renderedHtml}</div></div>`;
  } else if (memoMode === 'live') {
    // contenteditable Bear editor — setup happens after innerHTML is set
    bodyHtml = `<div class="memo-body-wrap edit-only"><div class="bear-editor" id="memo-live-editor" contenteditable="true" spellcheck="false"></div></div>`;
  } else {
    bodyHtml = `<div class="memo-body-wrap edit-only">
      <textarea id="memo-textarea" oninput="updateMemoContent(this.value)" placeholder="메모를 입력하세요... (마크다운 지원)" spellcheck="false">${escapeHtml(memo.content)}</textarea>
    </div>`;
  }

  // 3-way segmented mode control icons
  const viewIcon = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const liveIcon = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/><circle cx="18" cy="5" r="0" fill="currentColor"/></svg>`;
  const editIcon = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`;

  editor.innerHTML = `
    <div class="memo-editor-toolbar">
      <button class="panel-reopen-btn" onclick="togglePanel('memo-page')" title="목록 열기">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <button class="memo-back" onclick="backToList()" aria-label="뒤로">‹</button>
      <div class="memo-toolbar-spacer"></div>
      <div class="memo-mode-seg" role="group" aria-label="편집 모드">
        <button class="${memoMode === 'view' ? 'active' : ''}" onclick="setMemoMode('view')" title="뷰어">${viewIcon}</button>
        <button class="${memoMode === 'live' ? 'active' : ''}" onclick="setMemoMode('live')" title="라이브뷰">${liveIcon}</button>
        <button class="${memoMode === 'edit' ? 'active' : ''}" onclick="setMemoMode('edit')" title="편집">${editIcon}</button>
      </div>
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
    </div>
    ${bodyHtml}
  `;

  // Restore decoded images to avoid iOS re-decode flicker
  _patchImagesAfterRender(editor, _imgCache);

  if (memoMode === 'live') {
    const bearEl = document.getElementById('memo-live-editor');
    if (bearEl) {
      setupBearEditor(bearEl, memo.content, (text) => updateMemoContent(text));
      setTimeout(() => { try { bearEl.focus(); } catch {} }, 30);
    }
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

// Three modes: 'view' (rendered), 'live' (split textarea+preview), 'edit' (textarea only).
// Migrate old values from prior builds: 'split'/'preview' → 'live'.
let memoMode = load('memo_mode', 'view');
if (!['view', 'live', 'edit'].includes(memoMode)) {
  memoMode = (memoMode === 'split') ? 'live' : 'view';
}
function setMemoMode(mode) {
  memoMode = mode;
  save('memo_mode', mode);
  renderMemoEditor();
  // Focus is handled inside renderMemoEditor for live mode;
  // for edit mode focus the textarea here.
  if (mode === 'edit') {
    setTimeout(() => {
      const ta = document.getElementById('memo-textarea');
      if (ta) {
        ta.focus();
        try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
      }
    }, 30);
  }
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
    memo.date = new Date().toISOString();
    saveMemos();
    renderMemoList();
  }
}

function updateMemoContent(val) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return;
  memo.content = val;
  memo.date = new Date().toISOString();
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

  // Bear live editor — append at end and re-init
  const bearEl = document.getElementById('memo-live-editor');
  if (bearEl && memoMode === 'live') {
    memo.content = (memo.content || '') + insertText;
    memo.date = new Date().toISOString();
    saveMemos();
    setupBearEditor(bearEl, memo.content, (text) => updateMemoContent(text));
    setTimeout(() => { try { bearEl.focus(); } catch {} }, 30);
    return true;
  }

  // View mode — switch to live and append
  memo.content = (memo.content || '') + insertText;
  memo.date = new Date().toISOString();
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

