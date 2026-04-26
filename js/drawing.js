// =================== DRAWING (Apple Pencil / stylus / finger / mouse) ===================
let drawStrokes = [];
let drawCurrentStroke = null;
let drawTool = 'pen';
let drawColor = '#1f1a14';
let drawWidthBase = 2;
let drawCanvas = null;
let drawCtx = null;
// Offscreen baked canvas: holds all completed strokes already rendered.
// On every pointermove we just blit this image, then draw the current stroke
// on top — instead of replaying every previous stroke. Keeps drawing smooth
// even after dozens of strokes.
let drawBaked = null;
let drawBakedCtx = null;
// Palm rejection mode: 'auto' starts permissive then becomes pen-only as
// soon as a pen pointer is seen; 'pen-only' rejects touch from the start;
// 'allow-touch' never rejects.
let drawPalmMode = 'auto';

function openDrawingModal() {
  if (!activeMemoId) { toast('먼저 메모를 선택하세요'); return; }
  drawStrokes = [];
  drawCurrentStroke = null;
  drawTool = 'pen';
  drawColor = '#1f1a14';
  drawWidthBase = 2;
  document.querySelectorAll('.draw-color').forEach(c => c.classList.toggle('active', c.dataset.color === drawColor));
  document.getElementById('tool-pen').classList.add('active');
  document.getElementById('tool-eraser').classList.remove('active');
  document.getElementById('draw-width').value = '2';
  document.getElementById('draw-width-display').textContent = '2';

  document.getElementById('drawing-modal-overlay').classList.add('show');
  setTimeout(() => {
    drawCanvas = document.getElementById('drawing-canvas');
    if (!drawCanvas) return;
    drawCtx = drawCanvas.getContext('2d');
    drawBaked = document.createElement('canvas');
    drawBakedCtx = drawBaked.getContext('2d');
    resizeDrawingCanvas();
    setupDrawingPointer(drawCanvas);
    updateDrawEmptyHint();
    updatePalmModeButton();
  }, 30);
}

function closeDrawingModal() {
  document.getElementById('drawing-modal-overlay').classList.remove('show');
}

function resizeDrawingCanvas() {
  if (!drawCanvas || !drawCtx) return;
  const wrap = drawCanvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  drawCanvas.width = rect.width * dpr;
  drawCanvas.height = rect.height * dpr;
  drawCanvas.style.width = rect.width + 'px';
  drawCanvas.style.height = rect.height + 'px';
  drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (drawBaked) {
    drawBaked.width = drawCanvas.width;
    drawBaked.height = drawCanvas.height;
    drawBakedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  rebakeAll();
}
window.addEventListener('resize', () => {
  if (document.getElementById('drawing-modal-overlay')?.classList.contains('show')) {
    resizeDrawingCanvas();
  }
});

function clearVisibleCanvas() {
  if (!drawCtx) return;
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  drawCtx.clearRect(0, 0, w, h);
}

function clearBakedCanvas() {
  if (!drawBakedCtx) return;
  const w = drawBaked.width / (window.devicePixelRatio || 1);
  const h = drawBaked.height / (window.devicePixelRatio || 1);
  drawBakedCtx.clearRect(0, 0, w, h);
}

function renderStrokeOn(ctx, stroke) {
  if (!stroke || !ctx || stroke.points.length < 1) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1, stroke.width * (p.p || 0.5)), 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      const p1 = stroke.points[i-1];
      const p2 = stroke.points[i];
      const w = Math.max(0.5, stroke.width * 1.5 * Math.max(0.3, ((p1.p || 0.5) + (p2.p || 0.5)) / 2));
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Append only the latest segment of the current stroke to the visible canvas
// (so we don't re-render previous segments — that's where the lag came from).
function paintLatestSegment(stroke, fromIdx) {
  if (!drawCtx || !stroke || stroke.points.length <= fromIdx) return;
  drawCtx.save();
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  drawCtx.strokeStyle = stroke.color;
  drawCtx.fillStyle = stroke.color;
  for (let i = Math.max(1, fromIdx); i < stroke.points.length; i++) {
    const p1 = stroke.points[i-1];
    const p2 = stroke.points[i];
    const w = Math.max(0.5, stroke.width * 1.5 * Math.max(0.3, ((p1.p || 0.5) + (p2.p || 0.5)) / 2));
    drawCtx.lineWidth = w;
    drawCtx.beginPath();
    drawCtx.moveTo(p1.x, p1.y);
    drawCtx.lineTo(p2.x, p2.y);
    drawCtx.stroke();
  }
  drawCtx.restore();
}

function rebakeAll() {
  if (!drawBakedCtx) return;
  clearBakedCanvas();
  for (const stroke of drawStrokes) renderStrokeOn(drawBakedCtx, stroke);
  drawCompositeFromBaked();
}

function drawCompositeFromBaked() {
  if (!drawCtx || !drawBaked) return;
  clearVisibleCanvas();
  drawCtx.save();
  drawCtx.setTransform(1, 0, 0, 1, 0, 0); // drawImage uses raw px
  drawCtx.drawImage(drawBaked, 0, 0);
  drawCtx.restore();
  if (drawCurrentStroke) renderStrokeOn(drawCtx, drawCurrentStroke);
}

// Public redraw entry point used by undo / clear / resize
function redrawAllStrokes() {
  rebakeAll();
}

function setDrawTool(tool) {
  drawTool = tool;
  document.getElementById('tool-pen').classList.toggle('active', tool === 'pen');
  document.getElementById('tool-eraser').classList.toggle('active', tool === 'eraser');
  if (drawCanvas) drawCanvas.classList.toggle('eraser-mode', tool === 'eraser');
}

function setDrawColor(color, el) {
  drawColor = color;
  document.querySelectorAll('.draw-color').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  // Switch to pen when a color is picked
  setDrawTool('pen');
}

function updateDrawWidth(v) {
  drawWidthBase = parseFloat(v) || 2;
  document.getElementById('draw-width-display').textContent = String(Math.round(drawWidthBase));
}

function undoDraw() {
  drawStrokes.pop();
  redrawAllStrokes();
  updateDrawEmptyHint();
}

function clearDraw() {
  if (drawStrokes.length === 0) return;
  if (!confirm('모두 지우시겠습니까?')) return;
  drawStrokes = [];
  redrawAllStrokes();
  updateDrawEmptyHint();
}

function updateDrawEmptyHint() {
  const hint = document.getElementById('draw-empty-hint');
  if (hint) hint.classList.toggle('hidden', drawStrokes.length > 0 || !!drawCurrentStroke);
}

function setupDrawingPointer(canvas) {
  if (canvas.dataset.drawReady) return;
  canvas.dataset.drawReady = '1';

  // ---- Palm rejection state (per-modal session) ----
  let stylusActive = false;
  let lastPenAt = 0;
  let everSawPen = false;
  const PALM_BUFFER_MS = 1500;

  function shouldRejectTouch() {
    if (drawPalmMode === 'allow-touch') return false;
    if (drawPalmMode === 'pen-only') return true;          // strict: always reject finger
    // 'auto' mode:
    if (stylusActive) return true;
    if (!everSawPen) return false;
    return (Date.now() - lastPenAt) < PALM_BUFFER_MS;
  }

  // We listen at document level for pointerdown so that palm contact OUTSIDE
  // the canvas (e.g. on the toolbar) doesn't "miss" being a hint that the
  // pencil is in use — but we also want to detect a pen hover BEFORE
  // pointerdown so palm-down-then-pen sequences don't briefly draw a palm
  // stroke. pointerover with pointerType=pen does fire on iPad before any
  // touch from the palm in many cases.
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'pen') {
      everSawPen = true;
      lastPenAt = Date.now();
      // Retroactively cancel any palm stroke that just started
      if (drawCurrentStroke && drawCurrentStroke.pointerType === 'touch') {
        drawCurrentStroke = null;
        drawCompositeFromBaked();
        updateDrawEmptyHint();
      }
    }
  });

  const start = (e) => {
    if (e.pointerType === 'touch' && shouldRejectTouch()) return;
    if (e.pointerType === 'pen') {
      everSawPen = true;
      stylusActive = true;
      lastPenAt = Date.now();
      // Cancel any concurrent palm stroke
      if (drawCurrentStroke && drawCurrentStroke.pointerType === 'touch') {
        drawCurrentStroke = null;
        drawCompositeFromBaked();
      }
    }
    e.preventDefault();
    if (e.pointerId != null) {
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    drawCurrentStroke = {
      tool: drawTool,
      color: drawColor,
      width: drawWidthBase,
      points: [{ x, y, p: e.pressure > 0 ? e.pressure : 0.5 }],
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      paintedUpTo: 1 // index of next point to paint
    };
    // Paint the initial dot immediately so dot-strokes work and the user
    // sees something on first touch
    drawCompositeFromBaked();
    updateDrawEmptyHint();
  };

  const move = (e) => {
    if (!drawCurrentStroke) return;
    if (e.pointerId !== drawCurrentStroke.pointerId) return;
    if (e.pointerType === 'pen') { lastPenAt = Date.now(); }
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      drawCurrentStroke.points.push({
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
        p: ev.pressure > 0 ? ev.pressure : 0.5
      });
    }
    // Paint only the new segments on top of the visible canvas — no rebake
    paintLatestSegment(drawCurrentStroke, drawCurrentStroke.paintedUpTo);
    drawCurrentStroke.paintedUpTo = drawCurrentStroke.points.length;
  };

  const end = (e) => {
    if (drawCurrentStroke && e.pointerId !== drawCurrentStroke.pointerId) return;
    if (e.pointerType === 'pen') {
      stylusActive = false;
      lastPenAt = Date.now();
    }
    if (!drawCurrentStroke) return;
    if (drawCurrentStroke.points.length > 0) {
      drawStrokes.push(drawCurrentStroke);
      // Bake the completed stroke into the offscreen canvas so future moves
      // can blit instead of replaying it.
      renderStrokeOn(drawBakedCtx, drawCurrentStroke);
    }
    drawCurrentStroke = null;
    // Refresh visible canvas from baked (current stroke painted in place
    // matches the baked version exactly, so this is essentially a no-op)
    drawCompositeFromBaked();
    updateDrawEmptyHint();
  };

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);
}

function setPalmMode(mode) {
  drawPalmMode = mode;
  updatePalmModeButton();
}
function updatePalmModeButton() {
  const btn = document.getElementById('tool-palm');
  if (!btn) return;
  const labels = { 'auto': '🤖 자동', 'pen-only': '🖋 펜만', 'allow-touch': '✋ 손가락 OK' };
  btn.title = `팜 리젝션: ${labels[drawPalmMode] || drawPalmMode}`;
  btn.dataset.mode = drawPalmMode;
}
function cyclePalmMode() {
  const order = ['auto', 'pen-only', 'allow-touch'];
  const idx = order.indexOf(drawPalmMode);
  setPalmMode(order[(idx + 1) % order.length]);
  toast({ 'auto': '팜 리젝션: 자동', 'pen-only': '팜 리젝션: 펜만 받기', 'allow-touch': '팜 리젝션: 손가락도 받기' }[drawPalmMode]);
}

// Generate compact SVG from stroke history
function strokesToSVG() {
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  // Apply eraser strokes as a separate transparent layer using mask
  // Simpler approach: bake erased strokes by skipping pixels covered by eraser path
  // For first version: just emit pen strokes; eraser is applied client-side preview only
  // (To preserve eraser, we'd need a full canvas → PNG path. Falls back to that if eraser used.)
  const hasEraser = drawStrokes.some(s => s.tool === 'eraser');
  if (hasEraser) {
    // Use canvas snapshot for accuracy when eraser is involved
    return null;
  }
  const f = (n) => Math.round(n * 10) / 10;
  let paths = '';
  for (const stroke of drawStrokes) {
    if (stroke.points.length < 1) continue;
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      paths += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(Math.max(1, stroke.width * (p.p || 0.5)))}" fill="${stroke.color}"/>`;
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        const p1 = stroke.points[i-1];
        const p2 = stroke.points[i];
        const sw = f(Math.max(0.5, stroke.width * 1.5 * Math.max(0.3, ((p1.p || 0.5) + (p2.p || 0.5)) / 2)));
        paths += `<line x1="${f(p1.x)}" y1="${f(p1.y)}" x2="${f(p2.x)}" y2="${f(p2.y)}" stroke="${stroke.color}" stroke-width="${sw}" stroke-linecap="round"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}">${paths}</svg>`;
}

async function insertDrawing() {
  if (drawStrokes.length === 0) {
    toast('그림이 비어있습니다');
    return;
  }
  let blob, mimeType, filename;

  const svg = strokesToSVG();
  if (svg) {
    blob = new Blob([svg], { type: 'image/svg+xml' });
    mimeType = 'image/svg+xml';
    filename = `drawing-${Date.now()}.svg`;
  } else {
    // Fallback: PNG (covers eraser case where SVG composition is complex)
    const pngBlob = await new Promise(resolve => drawCanvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) { toast('이미지 생성 실패', 'error'); return; }
    blob = pngBlob;
    mimeType = 'image/png';
    filename = `drawing-${Date.now()}.png`;
  }

  let insertText;
  if (driveAssetsFolderId) {
    try {
      toast('드로잉 업로드 중...');
      const file = await driveUploadFile(filename, blob, mimeType, driveAssetsFolderId);
      await driveMakePublic(file.id);
      const url = `https://drive.google.com/thumbnail?id=${file.id}&sz=w2000`;
      insertText = `\n![drawing](${url})\n`;
      toast('드로잉이 메모에 삽입됨', 'success');
    } catch (e) {
      console.warn('Drive upload failed; falling back to inline:', e);
      const dataUrl = await blobToDataUrl(blob);
      insertText = `\n![drawing](${dataUrl})\n`;
    }
  } else {
    const dataUrl = await blobToDataUrl(blob);
    insertText = `\n![drawing](${dataUrl})\n`;
  }

  // Append to memo content
  const memo = memos.find(m => m.id === activeMemoId);
  if (memo) {
    memo.content = (memo.content || '') + insertText;
    memo.date = new Date().toISOString();
    saveMemos();
    renderMemoEditor();
  }

  closeDrawingModal();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Cmd/Ctrl+Z while drawing modal open → undo last stroke
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('drawing-modal-overlay')?.classList.contains('show')) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undoDraw(); }
  if (e.key === 'Escape') { e.preventDefault(); closeDrawingModal(); }
});

