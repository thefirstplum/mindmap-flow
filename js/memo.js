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
  // New memos open in edit mode so the user can start typing immediately
  memoMode = 'edit';
  save('memo_mode', 'edit');
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

  // Mode-based editor: 'view' (default, rendered markdown) or 'edit'
  // (desktop = split textarea+preview, mobile = textarea only).
  // This replaces the contenteditable live editor — native textarea is
  // reliable for cursor position, undo/redo, and avoids the image-flicker
  // problem caused by re-rendering on every keystroke.
  const isMobile = window.innerWidth < 769;
  const isEdit = memoMode === 'edit';
  const renderedHtml = memo.content.trim() ? md2html(memo.content) : '<div class="markdown-empty">내용을 추가하려면 편집 모드로 전환하세요</div>';

  let bodyHtml;
  if (!isEdit) {
    // Click anywhere on the rendered body switches to edit mode (unless
    // clicking a link). Matches Bear's "tap to edit" behavior.
    bodyHtml = `<div class="memo-body-wrap"><div class="markdown-body view-clickable" id="memo-preview" onclick="if(!event.target.closest('a, img'))setMemoMode('edit')">${renderedHtml}</div></div>`;
  } else if (isMobile) {
    bodyHtml = `<div class="memo-body-wrap edit-only">
      <textarea id="memo-textarea" oninput="updateMemoContent(this.value)" placeholder="메모를 입력하세요... (마크다운 지원)" spellcheck="false">${escapeHtml(memo.content)}</textarea>
    </div>`;
  } else {
    bodyHtml = `<div class="memo-body-wrap split">
      <textarea id="memo-textarea" oninput="updateMemoContent(this.value)" placeholder="메모를 입력하세요... (마크다운 지원)" spellcheck="false">${escapeHtml(memo.content)}</textarea>
      <div class="markdown-body" id="memo-preview">${renderedHtml}</div>
    </div>`;
  }

  const editLabel = isEdit ? '뷰어' : '편집';
  // Cleaner SF Symbols-style icons: square.and.pencil for edit, doc.text for view
  const editIcon = isEdit
    ? `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`
    : `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h6"/><path d="M18.375 2.625a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.375-9.375z"/></svg>`;

  editor.innerHTML = `
    <div class="memo-editor-toolbar">
      <button class="panel-reopen-btn" onclick="togglePanel('memo-page')" title="목록 열기">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <button class="memo-back" onclick="backToList()" aria-label="뒤로">‹</button>
      <div class="memo-toolbar-spacer"></div>
      <button class="memo-icon-btn ${isEdit ? 'active' : ''}" onclick="toggleMemoMode()" title="${editLabel} 모드">
        ${editIcon}
        <span class="label-text">${editLabel}</span>
      </button>
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

  if (isEdit) setupSplitScrollSync();
}

// Toggle between viewer and edit. View is default; first-time tap on the
// edit button enters edit mode. From edit, tap "뷰어" to render.
function toggleMemoMode() {
  setMemoMode(memoMode === 'edit' ? 'view' : 'edit');
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
  return text.split('\n').map(line =>
    `<div data-line>${bearRenderLine(line)}</div>`
  ).join('');
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

function setupBearEditor(editor, content, onChange) {
  // Always force divs (not <br> or <p>) for new paragraphs across browsers
  try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch {}

  editor.innerHTML = bearRenderContent(content || '​');
  // Ensure each child is a data-line div; if the editor renders empty,
  // give it a single empty line so the caret has somewhere to live.
  if (!editor.children.length) {
    const div = document.createElement('div');
    div.setAttribute('data-line', '');
    editor.appendChild(div);
  }

  let composing = false;
  let renderTimer = null;

  function normalizeBlocks() {
    // Convert any direct child that ISN'T a data-line div (e.g. a plain
    // <div> the browser inserted on Enter, or a stray <br>) into
    // <div data-line>...</div>. Ensures our coordinate model holds.
    const children = [...editor.childNodes];
    for (const node of children) {
      if (node.nodeType === 1 && node.tagName === 'DIV' && node.hasAttribute('data-line')) continue;
      if (node.nodeType === 3) {
        // Wrap text node in a data-line div
        const wrap = document.createElement('div');
        wrap.setAttribute('data-line', '');
        node.parentNode.insertBefore(wrap, node);
        wrap.appendChild(node);
      } else if (node.nodeType === 1 && node.tagName === 'DIV') {
        // Plain div from browser — just add data-line attribute
        node.setAttribute('data-line', '');
      } else if (node.nodeType === 1 && node.tagName === 'BR') {
        // A stray <br> at editor root — wrap into a data-line div
        const wrap = document.createElement('div');
        wrap.setAttribute('data-line', '');
        node.parentNode.insertBefore(wrap, node);
        wrap.appendChild(node);
      }
    }
  }

  function rerender() {
    if (composing) return;
    normalizeBlocks();
    const offset = bearGetCaretOffset(editor);
    const text = bearGetText(editor);
    onChange(text);
    // Re-render with our markup
    const newHtml = bearRenderContent(text);
    if (newHtml !== editor.innerHTML) {
      editor.innerHTML = newHtml;
      bearSetCaretOffset(editor, offset);
    }
  }

  editor.addEventListener('compositionstart', () => { composing = true; });
  editor.addEventListener('compositionend', () => {
    composing = false;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(rerender, 80);
  });

  editor.addEventListener('input', () => {
    if (composing) {
      onChange(bearGetText(editor));
      return;
    }
    // Always normalize structure first (cheap), so the caret model stays valid
    // even before the debounced rerender runs.
    normalizeBlocks();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(rerender, 140);
  });

  // Manually handle Enter to guarantee a new <div data-line> is created.
  // Browser default behavior varies: Chrome/Safari may leave a plain <div>,
  // Firefox prefers <br>, and on iOS the keyboard sometimes emits a textInput
  // with embedded \n. By taking control we always produce a clean data-line.
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || composing) return;
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) range.deleteContents();

    // Find the data-line ancestor that holds the caret
    let cur = range.startContainer;
    while (cur && cur !== editor && !(cur.nodeType === 1 && cur.parentElement === editor)) {
      cur = cur.parentNode;
    }
    if (!cur || cur === editor) {
      // Nothing to split; just append a new line
      const newDiv = document.createElement('div');
      newDiv.setAttribute('data-line', '');
      newDiv.appendChild(document.createElement('br'));
      editor.appendChild(newDiv);
      const r = document.createRange();
      r.setStart(newDiv, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } else {
      // Split current block at caret
      const beforeR = document.createRange();
      beforeR.selectNodeContents(cur);
      beforeR.setEnd(range.startContainer, range.startOffset);
      const beforeText = beforeR.toString().replace(/​/g, '');

      const afterR = document.createRange();
      afterR.selectNodeContents(cur);
      afterR.setStart(range.startContainer, range.startOffset);
      const afterText = afterR.toString().replace(/​/g, '');

      cur.innerHTML = bearRenderLine(beforeText) || '<br>';

      const newDiv = document.createElement('div');
      newDiv.setAttribute('data-line', '');
      newDiv.innerHTML = bearRenderLine(afterText) || '<br>';
      cur.parentNode.insertBefore(newDiv, cur.nextSibling);

      // Place caret at start of newDiv (or first text node inside)
      const r = document.createRange();
      const firstText = newDiv.querySelector('br') ? newDiv : (
        document.createTreeWalker(newDiv, NodeFilter.SHOW_TEXT, null).nextNode() || newDiv
      );
      if (firstText.nodeType === 3) r.setStart(firstText, 0);
      else r.setStart(newDiv, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }

    // Notify save (skip rerender — we just made a clean structural edit)
    onChange(bearGetText(editor));
    clearTimeout(renderTimer);
    // Schedule a deferred rerender so any markdown-style triggers (e.g.
    // closing a list item) get re-styled, but at low priority.
    renderTimer = setTimeout(rerender, 200);
  });

  // Plain-text paste — strip HTML so styled paste doesn't corrupt structure
  editor.addEventListener('paste', (e) => {
    if (e.clipboardData?.types?.includes('Files')) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  });
}

// Default mode is 'view' — markdown is rendered. Toggling enters 'edit'
// mode (split on desktop, textarea-only on mobile). Migrate any prior
// 'live' / 'split' / 'preview' values from older builds.
let memoMode = load('memo_mode', 'view');
if (memoMode !== 'view' && memoMode !== 'edit') memoMode = 'view';
function setMemoMode(mode) {
  memoMode = mode;
  save('memo_mode', mode);
  renderMemoEditor();
  // When entering edit mode, focus the textarea so the keyboard pops on mobile
  if (mode === 'edit') {
    setTimeout(() => {
      const ta = document.getElementById('memo-textarea');
      if (ta) {
        ta.focus();
        // Move caret to end so the user can keep typing
        const len = ta.value.length;
        try { ta.setSelectionRange(len, len); } catch {}
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
  // Live preview in desktop split mode
  const preview = document.querySelector('.memo-body-wrap.split #memo-preview');
  if (preview) {
    preview.innerHTML = val.trim() ? md2html(val) : '<div class="markdown-empty">미리볼 내용이 없습니다</div>';
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
    // Use thumbnail URL for reliable hotlinking; size up to ~2000px
    const url = `https://drive.google.com/thumbnail?id=${file.id}&sz=w2000`;
    toast('이미지 업로드 완료', 'success');
    return { url, id: file.id, name };
  } catch (e) {
    toast('업로드 실패: ' + e.message, 'error');
    return null;
  }
}

// Insert markdown into the active memo at the textarea caret. If the user
// is in viewer mode, switch to edit mode and append at the end.
function insertIntoActiveMemo(insertText) {
  const memo = memos.find(m => m.id === activeMemoId);
  if (!memo) return false;
  const ta = document.getElementById('memo-textarea');
  if (ta && memoMode === 'edit') {
    // Native insert preserves undo history
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    ta.value = before + insertText + after;
    const caret = start + insertText.length;
    try { ta.setSelectionRange(caret, caret); } catch {}
    ta.focus();
    updateMemoContent(ta.value);
    return true;
  }
  // Viewer mode (or no textarea yet) — append and re-render in edit mode
  memo.content = (memo.content || '') + insertText;
  memo.date = new Date().toISOString();
  saveMemos();
  setMemoMode('edit');
  setTimeout(() => {
    const newTa = document.getElementById('memo-textarea');
    if (newTa) {
      const len = newTa.value.length;
      try { newTa.setSelectionRange(len, len); } catch {}
      newTa.focus();
    }
  }, 50);
  return true;
}

// Resize a large image down to a reasonable size before upload/embed.
// iPhone photos are typically 2–5MB which would blow past localStorage and
// hit Drive quotas. Resize to 1600px max dim at JPEG q=0.85 → usually 200–500KB.
async function resizeImage(blob, maxDim = 1600, quality = 0.85) {
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
    if (blob.size > 600_000 || /image\/(heic|heif)/i.test(blob.type)) {
      toast('이미지 처리 중...');
      workingBlob = await resizeImage(blob, 1600, 0.85);
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
// edit mode).
document.addEventListener('click', (e) => {
  const img = e.target.closest('.markdown-body img');
  if (!img) return;
  e.stopPropagation();
  e.preventDefault();
  openImageLightbox(img.src, img.alt);
});

