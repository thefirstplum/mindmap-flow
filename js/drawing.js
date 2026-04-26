// =================== DRAWING (Apple Pencil / stylus / finger / mouse) ===================
let drawStrokes = [];
let drawCurrentStroke = null;
let drawTool = 'pen';
let drawColor = '#1f1a14';
let drawWidthBase = 2;
let drawCanvas = null;
let drawCtx = null;

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
  // Defer canvas init to ensure modal layout is done
  setTimeout(() => {
    drawCanvas = document.getElementById('drawing-canvas');
    if (!drawCanvas) return;
    drawCtx = drawCanvas.getContext('2d');
    resizeDrawingCanvas();
    setupDrawingPointer(drawCanvas);
    updateDrawEmptyHint();
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
  redrawAllStrokes();
}
window.addEventListener('resize', () => {
  if (document.getElementById('drawing-modal-overlay')?.classList.contains('show')) {
    resizeDrawingCanvas();
  }
});

function redrawAllStrokes() {
  if (!drawCtx) return;
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  drawCtx.clearRect(0, 0, w, h);
  for (const stroke of drawStrokes) renderStroke(stroke);
  if (drawCurrentStroke) renderStroke(drawCurrentStroke);
}

function renderStroke(stroke) {
  if (!stroke || !drawCtx || stroke.points.length < 1) return;
  drawCtx.save();
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  drawCtx.strokeStyle = stroke.color;
  drawCtx.fillStyle = stroke.color;
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    drawCtx.beginPath();
    drawCtx.arc(p.x, p.y, Math.max(1, stroke.width * (p.p || 0.5)), 0, Math.PI * 2);
    drawCtx.fill();
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      const p1 = stroke.points[i-1];
      const p2 = stroke.points[i];
      const w = Math.max(0.5, stroke.width * 1.5 * Math.max(0.3, ((p1.p || 0.5) + (p2.p || 0.5)) / 2));
      drawCtx.lineWidth = w;
      drawCtx.beginPath();
      drawCtx.moveTo(p1.x, p1.y);
      drawCtx.lineTo(p2.x, p2.y);
      drawCtx.stroke();
    }
  }
  drawCtx.restore();
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

  // ---- Palm rejection ----
  // If we ever see a pen (Apple Pencil) input on this canvas, we treat it as
  // "stylus mode" and reject all touch pointers (which are almost certainly
  // palm/wrist contact). The mode persists for a short buffer after the
  // last pen event so palm contacts that linger on lift-off still get
  // ignored. Touch-only devices (no Apple Pencil ever seen) keep working.
  let stylusModeActive = false;       // true while a pen pointer is down
  let lastPenAt = 0;                   // ms since epoch of last pen event
  let everSawPen = false;              // sticky: any pen seen this session?
  const PALM_BUFFER_MS = 1200;
  let activePenPointerId = null;

  function shouldRejectTouch() {
    if (stylusModeActive) return true;
    if (!everSawPen) return false; // no Apple Pencil device involved → finger drawing OK
    return (Date.now() - lastPenAt) < PALM_BUFFER_MS;
  }

  const start = (e) => {
    if (e.pointerType === 'touch' && shouldRejectTouch()) {
      // Palm / unintended touch — drop silently
      return;
    }
    if (e.pointerType === 'pen') {
      everSawPen = true;
      stylusModeActive = true;
      lastPenAt = Date.now();
      activePenPointerId = e.pointerId;
      // Cancel any in-progress finger stroke if pen takes over
      drawCurrentStroke = null;
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
      pointerType: e.pointerType
    };
    updateDrawEmptyHint();
  };

  const move = (e) => {
    if (!drawCurrentStroke) return;
    // Only accept moves from the same pointer that started the stroke
    if (e.pointerId !== drawCurrentStroke.pointerId) return;
    if (e.pointerType === 'pen') lastPenAt = Date.now();
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
    redrawAllStrokes();
  };

  const end = (e) => {
    // If a non-stroke pointer ends, ignore
    if (drawCurrentStroke && e.pointerId !== drawCurrentStroke.pointerId) return;
    if (e.pointerType === 'pen') {
      stylusModeActive = false;
      lastPenAt = Date.now();
      activePenPointerId = null;
    }
    if (!drawCurrentStroke) return;
    if (drawCurrentStroke.points.length > 0) drawStrokes.push(drawCurrentStroke);
    drawCurrentStroke = null;
    redrawAllStrokes();
    updateDrawEmptyHint();
  };

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);
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

