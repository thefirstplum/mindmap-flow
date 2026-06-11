// =================== DRAWING (Apple Pencil / stylus / finger / mouse) ===================
// 사장님 요청 (2026-06-11): Wacom Bamboo Paper 스타일 필기 도구
//
// 펜 종류 7가지 (각 도구별로 stroke 렌더링 달리):
//   fine        — 일정 굵기, 압력 무시 (라이너)
//   ink         — 압력에 비례 굵기 변화 (기본 펜)
//   pencil      — 얇고 약간 거칠게, 회색 톤
//   fountain    — 압력 + 다른 굵기 곡선 (만년필 느낌)
//   marker      — 두꺼운 일정 굵기, 반투명
//   highlighter — 매우 두껍고 매우 투명, 강조용
//   brush       — 압력 따라 큰 굵기 변화, 살짝 번짐
let drawStrokes = [];
let drawRedoStack = [];      // Phase 6 — Redo 스택
let drawCurrentStroke = null;
let drawTool = 'ink';         // 'ink' | 'fine' | 'pencil' | 'fountain' | 'marker' | 'highlighter' | 'brush' | 'eraser'
let drawEraserMode = 'pixel'; // 'pixel'(부분 지우개) | 'stroke'(스트로크 단위 삭제)
let drawColor = '#1f1a14';
let drawWidthBase = 2;
let drawCanvas = null;
let drawCtx = null;
// Offscreen baked canvas: holds all completed strokes already rendered.
let drawBaked = null;
let drawBakedCtx = null;
let drawPalmMode = 'auto';

// Phase 3 — 종이 배경 (캔버스 배경 패턴)
// 'blank' | 'lined' | 'grid' | 'dot' | 'cream' | 'sepia'
let drawPaper = load('draw_paper', 'blank');

// Phase 2 — 최근 사용 색상 (팔레트 popup용)
let drawRecentColors = load('draw_recent_colors', ['#1d1a14']);
const DRAW_PALETTE_COLORS = [
  // 9개 큐레이션 (3 × 3) Bamboo 톤
  '#1d1a14', '#475569', '#7c5c3a',  // 검정·슬레이트·갈색
  '#dc322f', '#cb4b16', '#b58900',  // 레드·오렌지·옐로우
  '#859900', '#268bd2', '#7c3aed',  // 그린·블루·퍼플
];

// Tool spec — 각 도구별 굵기·투명도·압력 곡선
const DRAW_TOOLS = {
  ink:         { widthMul: 1.5, alpha: 1.00, pMin: 0.35, pMax: 1.10, jitter: 0,    composite: 'source-over' },
  fine:        { widthMul: 1.0, alpha: 1.00, pMin: 1.00, pMax: 1.00, jitter: 0,    composite: 'source-over' },
  pencil:      { widthMul: 0.9, alpha: 0.78, pMin: 0.50, pMax: 0.95, jitter: 0.6,  composite: 'source-over' },
  fountain:    { widthMul: 2.0, alpha: 1.00, pMin: 0.20, pMax: 1.45, jitter: 0,    composite: 'source-over' },
  marker:      { widthMul: 3.0, alpha: 0.55, pMin: 0.90, pMax: 1.05, jitter: 0,    composite: 'source-over' },
  highlighter: { widthMul: 7.0, alpha: 0.32, pMin: 1.00, pMax: 1.00, jitter: 0,    composite: 'multiply'    },
  brush:       { widthMul: 2.2, alpha: 0.92, pMin: 0.30, pMax: 1.50, jitter: 0,    composite: 'source-over' },
};

function openDrawingModal() {
  if (!activeMemoId) { toast('먼저 메모를 선택하세요'); return; }
  drawStrokes = [];
  drawRedoStack = [];
  drawCurrentStroke = null;
  drawTool = 'ink';
  drawColor = '#1f1a14';
  drawWidthBase = 2.5;
  document.querySelectorAll('.draw-color').forEach(c => c.classList.toggle('active', c.dataset.color === drawColor));
  // 모든 도구 active 초기화 후 ink만 active
  document.querySelectorAll('.draw-tool').forEach(b => b.classList.remove('active'));
  document.getElementById('tool-ink')?.classList.add('active');
  const slider = document.getElementById('draw-width');
  if (slider) slider.value = '2.5';
  const disp = document.getElementById('draw-width-display');
  if (disp) disp.textContent = '2';

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
  applyPaperBg();
  rebakeAll();
}

// Phase 3 — 종이 배경 패턴 (CSS 데이터-URL svg 패턴)
function _paperPatternUrl(type) {
  // 32px grid 기준 패턴
  const patterns = {
    lined: `<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='32'><line x1='0' y1='31.5' x2='100%' y2='31.5' stroke='%23D9C9B4' stroke-width='1'/></svg>`,
    grid:  `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><path d='M 32 0 L 0 0 0 32' fill='none' stroke='%23DCC9B3' stroke-width='0.6'/></svg>`,
    dot:   `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='1' fill='%23C4B095'/></svg>`,
  };
  return patterns[type] ? `url("data:image/svg+xml;utf8,${patterns[type]}")` : 'none';
}
function applyPaperBg() {
  if (!drawCanvas) return;
  const wrap = drawCanvas.parentElement;
  if (!wrap) return;
  const bgColors = {
    blank:  '#FFFFFF',
    lined:  '#FFFCF2',
    grid:   '#FFFDF5',
    dot:    '#FAF6EB',
    cream:  '#F7EFD8',
    sepia:  '#F4E7C7',
  };
  wrap.style.background = bgColors[drawPaper] || '#FFFFFF';
  const url = _paperPatternUrl(drawPaper);
  wrap.style.backgroundImage = url;
  wrap.style.backgroundSize = drawPaper === 'lined' ? '100% 32px' : 'auto';
  wrap.style.backgroundRepeat = 'repeat';
}
function setPaper(type) {
  drawPaper = type;
  save('draw_paper', type);
  applyPaperBg();
  document.querySelectorAll('.paper-pick').forEach(b =>
    b.classList.toggle('active', b.dataset.paper === type));
  closePaperPicker();
}
function togglePaperPicker(e) {
  e?.stopPropagation();
  const pop = document.getElementById('draw-paper-picker');
  if (!pop) return;
  pop.classList.toggle('show');
  if (pop.classList.contains('show')) {
    setTimeout(() => document.addEventListener('click', _paperOutside, { once: true }), 0);
  }
}
function _paperOutside(e) {
  const pop = document.getElementById('draw-paper-picker');
  if (pop && !pop.contains(e.target)) closePaperPicker();
}
function closePaperPicker() {
  document.getElementById('draw-paper-picker')?.classList.remove('show');
  document.removeEventListener('click', _paperOutside);
}
window.setPaper = setPaper;
window.togglePaperPicker = togglePaperPicker;
window.closePaperPicker = closePaperPicker;
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

// 각 도구별 stroke 한 세그먼트 렌더 — Bamboo Paper 톤 다양한 펜
function _renderSegment(ctx, p1, p2, stroke, spec) {
  const pAvg = ((p1.p || 0.5) + (p2.p || 0.5)) / 2;
  const pNorm = spec.pMin + (spec.pMax - spec.pMin) * Math.max(0, Math.min(1, pAvg));
  const w = Math.max(0.4, stroke.width * spec.widthMul * pNorm);
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  // 연필 — 옆에 작은 노이즈 점 (질감)
  if (spec.jitter && Math.random() < spec.jitter) {
    const dx = (Math.random() - 0.5) * w * 0.8;
    const dy = (Math.random() - 0.5) * w * 0.8;
    ctx.fillRect((p1.x + p2.x) / 2 + dx, (p1.y + p2.y) / 2 + dy, 0.6, 0.6);
  }
}

function _setupStrokeCtx(ctx, stroke) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    return DRAW_TOOLS.fine;  // 지우개도 fine 톤 width
  }
  const spec = DRAW_TOOLS[stroke.tool] || DRAW_TOOLS.ink;
  ctx.globalCompositeOperation = spec.composite || 'source-over';
  ctx.globalAlpha = spec.alpha;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  return spec;
}

function renderStrokeOn(ctx, stroke) {
  if (!stroke || !ctx || stroke.points.length < 1) return;
  ctx.save();
  const spec = _setupStrokeCtx(ctx, stroke);
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    const r = Math.max(1, stroke.width * spec.widthMul * spec.pMax * (p.p || 0.5));
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      _renderSegment(ctx, stroke.points[i-1], stroke.points[i], stroke, spec);
    }
  }
  ctx.restore();
}

// Append only the latest segment of the current stroke to the visible canvas
function paintLatestSegment(stroke, fromIdx) {
  if (!drawCtx || !stroke || stroke.points.length <= fromIdx) return;
  drawCtx.save();
  const spec = _setupStrokeCtx(drawCtx, stroke);
  for (let i = Math.max(1, fromIdx); i < stroke.points.length; i++) {
    _renderSegment(drawCtx, stroke.points[i-1], stroke.points[i], stroke, spec);
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
  // 모든 도구 버튼 active 토글 — 펜 7종 + 지우개
  const tools = ['ink', 'fine', 'pencil', 'fountain', 'marker', 'highlighter', 'brush', 'eraser'];
  for (const t of tools) {
    const btn = document.getElementById('tool-' + t);
    if (btn) btn.classList.toggle('active', tool === t);
  }
  if (drawCanvas) drawCanvas.classList.toggle('eraser-mode', tool === 'eraser');
  // 도구 선택 시 권장 width 자동 (기존 width 유지하고 싶으면 주석 처리)
  const recommendedWidth = {
    ink: 2.5, fine: 1.5, pencil: 1.5, fountain: 2.5,
    marker: 5, highlighter: 12, brush: 4, eraser: 8,
  }[tool];
  if (recommendedWidth) {
    drawWidthBase = recommendedWidth;
    const slider = document.getElementById('draw-width');
    if (slider) slider.value = recommendedWidth;
    const disp = document.getElementById('draw-width-display');
    if (disp) disp.textContent = String(Math.round(recommendedWidth));
  }
}

function setDrawColor(color, el) {
  drawColor = color;
  document.querySelectorAll('.draw-color').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  // 트리거 동그라미 색 갱신
  const trigger = document.getElementById('color-picker-trigger');
  if (trigger) trigger.style.background = color;
  // 최근 사용 색 기록 (앞으로 + 중복 제거 + 최대 6개)
  drawRecentColors = [color, ...drawRecentColors.filter(c => c !== color)].slice(0, 6);
  save('draw_recent_colors', drawRecentColors);
  // 지우개 모드면 ink로 (사용자가 그리기 의도)
  if (drawTool === 'eraser') setDrawTool('ink');
  closeColorPicker();
}

// Phase 2 — 색상 팔레트 popup
function toggleColorPicker(e) {
  e?.stopPropagation();
  const pop = document.getElementById('draw-color-picker');
  if (!pop) return;
  // 최근 색 + 큐레이션 다시 렌더
  _renderColorPicker();
  pop.classList.toggle('show');
  if (pop.classList.contains('show')) {
    setTimeout(() => document.addEventListener('click', _colorOutside, { once: true }), 0);
  }
}
function _colorOutside(e) {
  const pop = document.getElementById('draw-color-picker');
  if (pop && !pop.contains(e.target)) closeColorPicker();
}
function closeColorPicker() {
  document.getElementById('draw-color-picker')?.classList.remove('show');
  document.removeEventListener('click', _colorOutside);
}
function _renderColorPicker() {
  const pop = document.getElementById('draw-color-picker');
  if (!pop) return;
  const recent = drawRecentColors.length > 0
    ? `<div class="cp-section-title">최근</div>
       <div class="cp-grid recent">${drawRecentColors.map(c =>
         `<div class="draw-color${c === drawColor ? ' active' : ''}" data-color="${c}" style="background:${c}" onclick="setDrawColor('${c}', this)"></div>`
       ).join('')}</div>`
    : '';
  const palette = `<div class="cp-section-title">팔레트</div>
    <div class="cp-grid">${DRAW_PALETTE_COLORS.map(c =>
      `<div class="draw-color${c === drawColor ? ' active' : ''}" data-color="${c}" style="background:${c}" onclick="setDrawColor('${c}', this)"></div>`
    ).join('')}</div>
    <div class="cp-custom-row">
      <input type="color" id="draw-custom-color" value="${drawColor}" onchange="setDrawColor(this.value, this)" title="사용자 정의 색">
      <span style="font-size:11px;color:var(--text-mute);">사용자 정의</span>
    </div>`;
  pop.innerHTML = recent + palette;
}
window.toggleColorPicker = toggleColorPicker;
window.closeColorPicker = closeColorPicker;

function updateDrawWidth(v) {
  drawWidthBase = parseFloat(v) || 2;
  document.getElementById('draw-width-display').textContent = String(Math.round(drawWidthBase));
}

// 지우개 모드 토글 — 픽셀 vs 스트로크
function setEraserMode(mode) {
  drawEraserMode = (mode === 'stroke') ? 'stroke' : 'pixel';
  document.querySelectorAll('.eraser-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === drawEraserMode));
  if (typeof toast === 'function') {
    toast(drawEraserMode === 'stroke' ? '지우개: 스트로크 단위' : '지우개: 부분 (픽셀)');
  }
}
window.setEraserMode = setEraserMode;

// 스트로크 단위 지우개 — 클릭한 위치에 닿은 stroke 전체 삭제
function _strokeHitTest(x, y, radius) {
  // 끝에서부터 검사 (위에 그려진 게 먼저 지워짐)
  for (let i = drawStrokes.length - 1; i >= 0; i--) {
    const s = drawStrokes[i];
    if (s.tool === 'eraser') continue;
    for (const p of s.points) {
      const dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < radius * radius) return i;
    }
  }
  return -1;
}

function undoDraw() {
  if (drawStrokes.length === 0) return;
  const last = drawStrokes.pop();
  drawRedoStack.push(last);
  redrawAllStrokes();
  updateDrawEmptyHint();
}

// Phase 6 — Redo
function redoDraw() {
  if (drawRedoStack.length === 0) return;
  const s = drawRedoStack.pop();
  drawStrokes.push(s);
  redrawAllStrokes();
  updateDrawEmptyHint();
}
window.redoDraw = redoDraw;

function clearDraw() {
  if (drawStrokes.length === 0) return;
  if (!confirm('모두 지우시겠습니까?')) return;
  drawStrokes = [];
  drawRedoStack = [];
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

    // Phase 6 — stroke 단위 지우개: 클릭한 위치의 stroke 삭제
    if (drawTool === 'eraser' && drawEraserMode === 'stroke') {
      const hitIdx = _strokeHitTest(x, y, Math.max(8, drawWidthBase * 2));
      if (hitIdx >= 0) {
        drawStrokes.splice(hitIdx, 1);
        drawRedoStack = [];  // 새 액션 → redo 초기화
        redrawAllStrokes();
        updateDrawEmptyHint();
      }
      return;
    }

    // 새 스트로크 시작 — redo stack 초기화
    drawRedoStack = [];
    drawCurrentStroke = {
      tool: drawTool,
      color: drawColor,
      width: drawWidthBase,
      points: [{ x, y, p: e.pressure > 0 ? e.pressure : 0.5 }],
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      paintedUpTo: 1 // index of next point to paint
    };
    drawCompositeFromBaked();
    updateDrawEmptyHint();
  };

  const move = (e) => {
    // Phase 6 — stroke 단위 지우개: 드래그하면서 닿은 stroke 제거
    if (drawTool === 'eraser' && drawEraserMode === 'stroke' && !drawCurrentStroke) {
      if (e.pointerType === 'touch' && shouldRejectTouch()) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hitIdx = _strokeHitTest(x, y, Math.max(8, drawWidthBase * 2));
      if (hitIdx >= 0) {
        drawStrokes.splice(hitIdx, 1);
        redrawAllStrokes();
        updateDrawEmptyHint();
      }
      return;
    }

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

// Generate compact SVG from stroke history — 다양한 도구 alpha/width 반영
// 복잡한 도구(pencil jitter, highlighter multiply 등) 있으면 SVG 표현 한계 → PNG fallback
function strokesToSVG() {
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  const hasEraser = drawStrokes.some(s => s.tool === 'eraser');
  const hasComplex = drawStrokes.some(s => {
    const t = s.tool;
    return t === 'pencil' || t === 'highlighter' || t === 'brush';
  });
  if (hasEraser || hasComplex) return null;  // PNG fallback (정확)

  const f = (n) => Math.round(n * 10) / 10;
  let paths = '';
  for (const stroke of drawStrokes) {
    if (stroke.points.length < 1) continue;
    const spec = DRAW_TOOLS[stroke.tool] || DRAW_TOOLS.ink;
    const op = spec.alpha < 1 ? ` stroke-opacity="${spec.alpha}" fill-opacity="${spec.alpha}"` : '';
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      const r = f(Math.max(1, stroke.width * spec.widthMul * spec.pMax * (p.p || 0.5)));
      paths += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${r}" fill="${stroke.color}"${op}/>`;
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        const p1 = stroke.points[i-1];
        const p2 = stroke.points[i];
        const pAvg = ((p1.p || 0.5) + (p2.p || 0.5)) / 2;
        const pNorm = spec.pMin + (spec.pMax - spec.pMin) * Math.max(0, Math.min(1, pAvg));
        const sw = f(Math.max(0.4, stroke.width * spec.widthMul * pNorm));
        paths += `<line x1="${f(p1.x)}" y1="${f(p1.y)}" x2="${f(p2.x)}" y2="${f(p2.y)}" stroke="${stroke.color}" stroke-width="${sw}" stroke-linecap="round"${op}/>`;
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
    touchMemo(memo);
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

// Cmd/Ctrl+Z → undo, Cmd/Ctrl+Shift+Z → redo (modal 열려있을 때만)
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('drawing-modal-overlay')?.classList.contains('show')) return;
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redoDraw(); else undoDraw();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redoDraw(); return; }
  if (e.key === 'Escape') { e.preventDefault(); closeDrawingModal(); }
  // 도구 단축키 (1-7)
  const toolKeys = { '1': 'ink', '2': 'fine', '3': 'pencil', '4': 'fountain', '5': 'marker', '6': 'highlighter', '7': 'brush', 'e': 'eraser', 'E': 'eraser' };
  if (toolKeys[e.key] && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    setDrawTool(toolKeys[e.key]);
  }
});

