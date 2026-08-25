import { HandLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs';

const COLOR_OPTIONS = [
  { value: '#00f5ff', name: 'Cyan' },
  { value: '#ff00ff', name: 'Magenta' },
  { value: '#00ff88', name: 'Green' },
  { value: '#4488ff', name: 'Blue' },
  { value: '#ff4444', name: 'Red' },
  { value: '#ffdd00', name: 'Yellow' },
  { value: '#aa44ff', name: 'Purple' },
  { value: '#ffffff', name: 'White' },
];
const COLORS = COLOR_OPTIONS.map(option => option.value);
const MAX_HISTORY = 30;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 18;
const MIN_POINT_DISTANCE = 0.72;
const STROKE_POINT_STEP = 1.3;
const MAX_STROKE_JUMP = 72;
const DEFAULT_ERASE_RADIUS = 42;
const HIT_PADDING = 24;
const PINCH_COLOR = 'rgba(0, 245, 255, 0.88)';
const PINCH_COLOR_SOFT = 'rgba(0, 245, 255, 0.52)';
const DRAG_COLOR = 'rgba(255, 220, 0, 0.96)';
const DRAG_COLOR_SOFT = 'rgba(255, 220, 0, 0.56)';
const ZOOM_COLOR = 'rgba(255, 196, 64, 0.96)';
const ZOOM_COLOR_SOFT = 'rgba(255, 196, 64, 0.42)';
const TOOLBAR_EDGE_PADDING = 12;
const COLOR_SWATCH_HIT_PADDING = 14;
const HAND_COLOR_DWELL_MS = 420;
const SLIDER_HIT_PADDING_X = 12;
const SLIDER_HIT_PADDING_Y = 16;

let activeColor = COLORS[0];
let thickness = 6;
let glowAmount = 30;
let cameraVisible = true;
let handLandmarker = null;
let lastVideoTime = -1;
let currentGesture = 'idle';
let gestureCandidate = 'idle';
let gestureCandidateFrames = 0;
let strokes = [];
let historyStack = [];
let nextStrokeId = 1;
let selectedStrokeId = null;
let activeStroke = null;
let isDrawing = false;
let isErasing = false;
let eraseCommitted = false;
let isMovingSelection = false;
let selectionMoveCommitted = false;
let moveStartPoint = null;
let moveReferencePoints = null;
let smoothedTipPoint = null;
let smoothedPalmEraser = null;
let smoothedPinchPoint = null;
let smoothedZoomPinchPoints = [null, null];
let isTwoHandZooming = false;
let zoomGestureStartDistance = 0;
let zoomGestureStartScale = 1;
let zoomGestureWorldAnchor = null;
let zoomGestureDirection = 'steady';
let hoveredColorSwatch = null;
let lastHandColorPickAt = 0;
let hoveredColorStartedAt = 0;
let hoveredHandSlider = null;
let activeHandSliderType = null;
let toolbarDragPointerId = null;
let toolbarDragOffset = { x: 0, y: 0 };
let toolbarFloating = false;

const viewport = {
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
};

const viewState = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

const loadingEl = document.getElementById('loading');
const loaderFill = document.getElementById('loader-fill');
const loaderText = document.getElementById('loader-text');
const onboarding = document.getElementById('onboarding');
const toolbar = document.getElementById('toolbar');
const toolbarGrip = document.getElementById('toolbar-grip');
const canvasStack = document.querySelector('.canvas-stack');
const camCanvas = document.getElementById('camera-canvas');
const drawCanvas = document.getElementById('drawing-canvas');
const uiCanvas = document.getElementById('ui-canvas');
const camCtx = camCanvas.getContext('2d');
const drawCtx = drawCanvas.getContext('2d');
const uiCtx = uiCanvas.getContext('2d');
const hudIcon = document.getElementById('hud-icon');
const hudText = document.getElementById('hud-text');
const thickInput = document.getElementById('thickness');
const glowInput = document.getElementById('glow');
const thickVal = document.getElementById('thickness-val');
const glowVal = document.getElementById('glow-val');
const camToggle = document.getElementById('cam-toggle');
const selectionStatus = document.getElementById('selection-status');
const zoomOutBtn = document.getElementById('btn-zoom-out');
const zoomResetBtn = document.getElementById('btn-zoom-reset');
const zoomInBtn = document.getElementById('btn-zoom-in');
const colorGrid = document.getElementById('color-grid');

const video = document.createElement('video');
video.autoplay = true;
video.playsInline = true;
video.muted = true;

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17], [0, 17],
];

const HUD_MAP = {
  draw: { icon: 'DRAW', text: 'DRAWING' },
  erase: { icon: 'ERASE', text: 'ERASING' },
  pinch: { icon: 'MOVE', text: 'PINCH A STROKE' },
  color: { icon: 'COLOR', text: 'PINCH A SWATCH' },
  adjust: { icon: 'ADJUST', text: 'MOVE ON SLIDER' },
  zoom: { icon: 'ZOOM', text: 'SPREAD BOTH HANDS' },
  idle: { icon: 'IDLE', text: 'IDLE' },
};

function setActiveColor(color) {
  activeColor = color;
  document.querySelectorAll('.color-swatch').forEach(node => {
    node.classList.toggle('active', node.dataset.color === color);
  });
}

function setThicknessValue(value) {
  thickness = clamp(Number(value), Number(thickInput.min), Number(thickInput.max));
  thickInput.value = String(thickness);
  thickVal.textContent = thickness + 'px';
}

function setGlowValue(value) {
  glowAmount = clamp(Number(value), Number(glowInput.min), Number(glowInput.max));
  glowInput.value = String(glowAmount);
  glowVal.textContent = glowAmount;
}

COLOR_OPTIONS.forEach(({ value, name }) => {
  const swatch = document.createElement('div');
  swatch.className = 'color-swatch' + (value === activeColor ? ' active' : '');
  swatch.style.background = value;
  swatch.style.setProperty('--swatch-color', value);
  swatch.dataset.color = value;
  swatch.dataset.name = name;
  swatch.onclick = () => {
    setActiveColor(value);
  };
  colorGrid.appendChild(swatch);
});

thickInput.oninput = () => {
  setThicknessValue(Number(thickInput.value));
};

glowInput.oninput = () => {
  setGlowValue(Number(glowInput.value));
};

document.getElementById('btn-undo').onclick = undoLastChange;
document.getElementById('btn-clear').onclick = clearArtwork;
document.getElementById('btn-save').onclick = saveCompositeImage;

camToggle.onclick = () => {
  cameraVisible = !cameraVisible;
  camToggle.textContent = cameraVisible ? 'Camera ON' : 'Camera OFF';
};

zoomOutBtn.onclick = () => applyZoom(1 / 1.15);
zoomInBtn.onclick = () => applyZoom(1.15);
zoomResetBtn.onclick = () => setZoom(1, getZoomAnchor());

canvasStack.addEventListener('wheel', event => {
  event.preventDefault();
  const rect = canvasStack.getBoundingClientRect();
  const anchor = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  setZoom(viewState.scale * factor, anchor);
}, { passive: false });

window.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat) return;
  const activeElement = document.activeElement;
  const isTypingTarget = activeElement && (
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA' ||
    activeElement.isContentEditable
  );
  if (isTypingTarget) return;

  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    applyZoom(1.15);
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    applyZoom(1 / 1.15);
  } else if (event.key === '0') {
    event.preventDefault();
    setZoom(1, getZoomAnchor());
  }
});

function getToolbarBounds() {
  return toolbar.getBoundingClientRect();
}

function clampToolbarPosition(left, top) {
  const rect = getToolbarBounds();
  const maxLeft = Math.max(TOOLBAR_EDGE_PADDING, viewport.width - rect.width - TOOLBAR_EDGE_PADDING);
  const maxTop = Math.max(TOOLBAR_EDGE_PADDING, viewport.height - rect.height - TOOLBAR_EDGE_PADDING);

  return {
    left: clamp(left, TOOLBAR_EDGE_PADDING, maxLeft),
    top: clamp(top, TOOLBAR_EDGE_PADDING, maxTop),
  };
}

function setToolbarPosition(left, top) {
  const next = clampToolbarPosition(left, top);
  toolbar.style.left = `${next.left}px`;
  toolbar.style.top = `${next.top}px`;
  toolbar.style.right = 'auto';
  toolbar.style.bottom = 'auto';
  toolbar.style.transform = 'none';
  toolbarFloating = true;
}

function releaseToolbarPointer(pointerId) {
  if (pointerId == null) return;
  try {
    toolbarGrip.releasePointerCapture(pointerId);
  } catch {
    // Ignore capture release errors when the pointer is already gone.
  }
}

toolbarGrip.addEventListener('pointerdown', event => {
  const rect = getToolbarBounds();
  toolbarDragPointerId = event.pointerId;
  toolbarDragOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  toolbarGrip.setPointerCapture(event.pointerId);
  setToolbarPosition(rect.left, rect.top);
});

toolbarGrip.addEventListener('pointermove', event => {
  if (event.pointerId !== toolbarDragPointerId) return;
  event.preventDefault();
  setToolbarPosition(event.clientX - toolbarDragOffset.x, event.clientY - toolbarDragOffset.y);
});

function endToolbarDrag(event) {
  if (event.pointerId !== toolbarDragPointerId) return;
  releaseToolbarPointer(toolbarDragPointerId);
  toolbarDragPointerId = null;
}

toolbarGrip.addEventListener('pointerup', endToolbarDrag);
toolbarGrip.addEventListener('pointercancel', endToolbarDrag);

function setHoveredColorSwatch(swatch) {
  if (hoveredColorSwatch === swatch) return;
  hoveredColorSwatch?.classList.remove('hand-hover');
  hoveredColorSwatch = swatch;
  hoveredColorStartedAt = swatch ? performance.now() : 0;
  hoveredColorSwatch?.classList.add('hand-hover');
}

function clearHoveredColorSwatch() {
  setHoveredColorSwatch(null);
}

function setHoveredHandSlider(slider) {
  if (hoveredHandSlider === slider) return;
  hoveredHandSlider?.classList.remove('hand-slider-active');
  hoveredHandSlider = slider;
  activeHandSliderType =
    slider === thickInput ? 'thickness' :
    slider === glowInput ? 'glow' :
    null;
  hoveredHandSlider?.classList.add('hand-slider-active');
}

function clearHoveredHandSlider() {
  setHoveredHandSlider(null);
}

function findColorSwatchAtPoint(point) {
  if (!point) return null;

  let bestSwatch = null;
  let bestDistance = Infinity;

  for (const swatch of colorGrid.querySelectorAll('.color-swatch')) {
    const rect = swatch.getBoundingClientRect();
    const left = rect.left - COLOR_SWATCH_HIT_PADDING;
    const right = rect.right + COLOR_SWATCH_HIT_PADDING;
    const top = rect.top - COLOR_SWATCH_HIT_PADDING;
    const bottom = rect.bottom + COLOR_SWATCH_HIT_PADDING;

    if (point.x < left || point.x > right || point.y < top || point.y > bottom) continue;

    const centerX = (rect.left + rect.right) / 2;
    const centerY = (rect.top + rect.bottom) / 2;
    const distance = Math.hypot(point.x - centerX, point.y - centerY);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestSwatch = swatch;
    }
  }

  return bestSwatch;
}

function findSliderAtPoint(point) {
  if (!point) return null;

  const sliders = [thickInput, glowInput];
  let bestSlider = null;
  let bestDistance = Infinity;

  for (const slider of sliders) {
    const rect = slider.getBoundingClientRect();
    const left = rect.left - SLIDER_HIT_PADDING_X;
    const right = rect.right + SLIDER_HIT_PADDING_X;
    const top = rect.top - SLIDER_HIT_PADDING_Y;
    const bottom = rect.bottom + SLIDER_HIT_PADDING_Y;

    if (point.x < left || point.x > right || point.y < top || point.y > bottom) continue;

    const centerY = (rect.top + rect.bottom) / 2;
    const distance = Math.abs(point.y - centerY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSlider = slider;
    }
  }

  return bestSlider;
}

function isPointInsideToolbar(point) {
  if (!point) return false;
  const rect = getToolbarBounds();
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function tryHandColorSelection(point, commit = false) {
  const swatch = findColorSwatchAtPoint(point);
  setHoveredColorSwatch(swatch);

  if (!swatch) return false;
  const dwellReady = performance.now() - hoveredColorStartedAt >= HAND_COLOR_DWELL_MS;
  if (!commit && !dwellReady) return true;

  const now = performance.now();
  if (now - lastHandColorPickAt < 280) return true;

  setActiveColor(swatch.dataset.color);
  lastHandColorPickAt = now;
  selectionStatus.textContent = `${swatch.dataset.name} selected. Point to draw with the new color.`;
  return true;
}

function setToolbarHandMode(isActive) {
  toolbar.classList.toggle('hand-under', isActive);
}

function applySliderValueFromPoint(slider, point) {
  const rect = slider.getBoundingClientRect();
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const step = Number(slider.step || 1);
  const ratio = clamp((point.x - rect.left) / rect.width, 0, 1);
  const rawValue = min + ratio * (max - min);
  const quantized = min + Math.round((rawValue - min) / step) * step;
  const nextValue = clamp(quantized, min, max);

  if (slider === thickInput) {
    setThicknessValue(nextValue);
  } else if (slider === glowInput) {
    setGlowValue(nextValue);
  }
}

function tryHandSliderAdjustment(point) {
  const slider = findSliderAtPoint(point);
  setHoveredHandSlider(slider);

  if (!slider) return false;

  applySliderValueFromPoint(slider, point);
  return true;
}

function getPrecisionTipPoint(landmarks) {
  return toCanvasPoint({
    x: landmarks[8].x * 0.74 + landmarks[7].x * 0.18 + landmarks[6].x * 0.08,
    y: landmarks[8].y * 0.74 + landmarks[7].y * 0.18 + landmarks[6].y * 0.08,
  });
}

function configureCanvas(canvas, ctx) {
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  canvas.width = Math.round(viewport.width * viewport.dpr);
  canvas.height = Math.round(viewport.height * viewport.dpr);
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function cloneStroke(stroke) {
  return {
    id: stroke.id,
    color: stroke.color,
    thickness: stroke.thickness,
    glow: stroke.glow,
    points: stroke.points.map(clonePoint),
    bounds: { ...stroke.bounds },
  };
}

function cloneHistoryEntry(entry) {
  return {
    nextStrokeId: entry.nextStrokeId,
    selectedStrokeId: entry.selectedStrokeId,
    strokes: entry.strokes.map(cloneStroke),
  };
}

function getStrokeBounds(points) {
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  return { minX, minY, maxX, maxY };
}

function updateStrokeBounds(stroke) {
  stroke.bounds = getStrokeBounds(stroke.points);
}

function createStroke(points, base = {}) {
  const stroke = {
    id: nextStrokeId++,
    color: base.color ?? activeColor,
    thickness: base.thickness ?? thickness,
    glow: base.glow ?? glowAmount,
    points: points.map(clonePoint),
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
  updateStrokeBounds(stroke);
  return stroke;
}

function getSelectedStroke() {
  return strokes.find(stroke => stroke.id === selectedStrokeId) || null;
}

function getStrokeCenter(stroke) {
  return {
    x: (stroke.bounds.minX + stroke.bounds.maxX) / 2,
    y: (stroke.bounds.minY + stroke.bounds.maxY) / 2,
  };
}

function pushHistory() {
  historyStack.push({
    nextStrokeId,
    selectedStrokeId,
    strokes: strokes.map(cloneStroke),
  });

  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
  }
}

function syncSelection() {
  if (selectedStrokeId && !getSelectedStroke()) {
    selectedStrokeId = null;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function worldToScreen(point) {
  return {
    x: point.x * viewState.scale + viewState.offsetX,
    y: point.y * viewState.scale + viewState.offsetY,
  };
}

function screenToWorld(point) {
  return {
    x: (point.x - viewState.offsetX) / viewState.scale,
    y: (point.y - viewState.offsetY) / viewState.scale,
  };
}

function scaleStroke(stroke, scaleX, scaleY) {
  stroke.points = stroke.points.map(point => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
  }));
  updateStrokeBounds(stroke);
  return stroke;
}

function scaleHistory(scaleX, scaleY) {
  historyStack = historyStack.map(entry => ({
    ...entry,
    strokes: entry.strokes.map(stroke => scaleStroke(cloneStroke(stroke), scaleX, scaleY)),
  }));
}

function scaleScene(scaleX, scaleY) {
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return;
  if (scaleX === 1 && scaleY === 1) return;

  strokes.forEach(stroke => scaleStroke(stroke, scaleX, scaleY));
  scaleHistory(scaleX, scaleY);

  if (moveReferencePoints) {
    moveReferencePoints = moveReferencePoints.map(point => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    }));
  }

  if (moveStartPoint) {
    moveStartPoint = {
      x: moveStartPoint.x * scaleX,
      y: moveStartPoint.y * scaleY,
    };
  }

  viewState.offsetX *= scaleX;
  viewState.offsetY *= scaleY;
}

function resizeCanvases() {
  const prevWidth = viewport.width;
  const prevHeight = viewport.height;

  viewport.width = window.innerWidth;
  viewport.height = window.innerHeight;
  viewport.dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (prevWidth > 0 && prevHeight > 0) {
    scaleScene(viewport.width / prevWidth, viewport.height / prevHeight);
  }

  configureCanvas(camCanvas, camCtx);
  configureCanvas(drawCanvas, drawCtx);
  configureCanvas(uiCanvas, uiCtx);
  if (toolbarFloating) {
    const rect = getToolbarBounds();
    setToolbarPosition(rect.left, rect.top);
  }
  renderArtwork();
  renderOverlay(null, currentGesture);
  updateZoomUI();
}

window.addEventListener('resize', resizeCanvases);

function updateZoomUI() {
  zoomResetBtn.textContent = `${Math.round(viewState.scale * 100)}%`;
}

function getZoomAnchor() {
  const selectedStroke = getSelectedStroke();
  return selectedStroke
    ? worldToScreen(getStrokeCenter(selectedStroke))
    : { x: viewport.width / 2, y: viewport.height / 2 };
}

function setZoom(nextScale, anchorPoint = { x: viewport.width / 2, y: viewport.height / 2 }) {
  setZoomWithWorldAnchor(nextScale, anchorPoint, screenToWorld(anchorPoint));
}

function setZoomWithWorldAnchor(
  nextScale,
  anchorPoint,
  worldAnchor,
  { renderOverlayNow = true, overlayGesture = currentGesture } = {},
) {
  const clampedScale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
  viewState.scale = clampedScale;
  viewState.offsetX = anchorPoint.x - worldAnchor.x * viewState.scale;
  viewState.offsetY = anchorPoint.y - worldAnchor.y * viewState.scale;
  renderArtwork();
  if (renderOverlayNow) {
    renderOverlay(null, overlayGesture);
  }
  updateZoomUI();
}

function applyZoom(factor) {
  setZoom(viewState.scale * factor, getZoomAnchor());
}

function restoreHistoryEntry(entry) {
  const snapshot = cloneHistoryEntry(entry);
  strokes = snapshot.strokes;
  nextStrokeId = snapshot.nextStrokeId;
  selectedStrokeId = snapshot.selectedStrokeId;
  activeStroke = null;
  isDrawing = false;
  finishEraseSession();
  finishSelectionMove();
  syncSelection();
  renderArtwork();
  renderOverlay(null, 'idle');
  updateSelectionStatus();
}

function undoLastChange() {
  const previous = historyStack.pop();
  if (!previous) return;
  restoreHistoryEntry(previous);
}

function clearArtwork() {
  if (!strokes.length) return;
  pushHistory();
  strokes = [];
  activeStroke = null;
  selectedStrokeId = null;
  finishEraseSession();
  finishSelectionMove();
  renderArtwork();
  renderOverlay(null, 'idle');
  updateSelectionStatus();
}

function saveCompositeImage() {
  const merged = document.createElement('canvas');
  merged.width = drawCanvas.width;
  merged.height = drawCanvas.height;
  const mergedCtx = merged.getContext('2d');
  mergedCtx.drawImage(camCanvas, 0, 0);
  mergedCtx.drawImage(drawCanvas, 0, 0);
  const link = document.createElement('a');
  link.href = merged.toDataURL('image/png');
  link.download = 'air-draw.png';
  link.click();
}

function toCanvasPoint(point) {
  return {
    x: (1 - point.x) * viewport.width,
    y: point.y * viewport.height,
  };
}

function distanceOnCanvas(a, b) {
  const dx = (a.x - b.x) * viewport.width;
  const dy = (a.y - b.y) * viewport.height;
  return Math.hypot(dx, dy);
}

function normalizedDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getPalmEraser(landmarks) {
  const palmPoints = [landmarks[0], landmarks[5], landmarks[9], landmarks[13], landmarks[17]];
  const center = palmPoints.reduce((acc, point) => {
    acc.x += point.x;
    acc.y += point.y;
    return acc;
  }, { x: 0, y: 0 });

  center.x /= palmPoints.length;
  center.y /= palmPoints.length;

  const palmWidth = distanceOnCanvas(landmarks[5], landmarks[17]);
  const palmHeight = distanceOnCanvas(landmarks[0], landmarks[9]);
  const radius = clamp((palmWidth + palmHeight) * 0.38, DEFAULT_ERASE_RADIUS, 120);

  return {
    ...toCanvasPoint(center),
    radius,
  };
}

function getPinchPoint(landmarks) {
  return toCanvasPoint({
    x: (landmarks[4].x + landmarks[8].x) / 2,
    y: (landmarks[4].y + landmarks[8].y) / 2,
  });
}

function getHandMetrics(landmarks) {
  const palmSpan = Math.max(0.08, normalizedDistance(landmarks[5], landmarks[17]));
  const palmHeight = Math.max(0.08, normalizedDistance(landmarks[0], landmarks[9]));
  const handSize = (palmSpan + palmHeight) / 2;

  return {
    handSize,
    pinchRatio: normalizedDistance(landmarks[4], landmarks[8]) / handSize,
    thumbOpen: normalizedDistance(landmarks[4], landmarks[2]) > handSize * 0.45,
  };
}

function smoothPoint(previous, next, minFactor = 0.18, maxFactor = 0.5) {
  if (!next) return null;
  if (!previous) return { ...next };
  const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
  const factor = clamp(minFactor + distance / 90, minFactor, maxFactor);
  return {
    x: previous.x + (next.x - previous.x) * factor,
    y: previous.y + (next.y - previous.y) * factor,
  };
}

function smoothPalmEraser(previous, next) {
  if (!next) return null;
  if (!previous) return { ...next };
  const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
  const factor = clamp(0.2 + distance / 120, 0.2, 0.48);
  return {
    x: previous.x + (next.x - previous.x) * factor,
    y: previous.y + (next.y - previous.y) * factor,
    radius: previous.radius + (next.radius - previous.radius) * 0.28,
  };
}

function getTrackingFactors(mode) {
  const zoomBlend = clamp((viewState.scale - 1) / 4, 0, 1);

  if (mode === 'zoom') {
    return {
      minFactor: 0.18 - zoomBlend * 0.04,
      maxFactor: 0.34 - zoomBlend * 0.08,
    };
  }

  if (mode === 'pinch') {
    return {
      minFactor: 0.16 - zoomBlend * 0.05,
      maxFactor: 0.3 - zoomBlend * 0.1,
    };
  }

  return {
    minFactor: 0.1 - zoomBlend * 0.04,
    maxFactor: 0.28 - zoomBlend * 0.1,
  };
}

function resetTrackingSmoothing() {
  smoothedTipPoint = null;
  smoothedPalmEraser = null;
  smoothedPinchPoint = null;
  smoothedZoomPinchPoints = [null, null];
}

function fingerExtended(landmarks, tip, dip, pip, mcp) {
  const tipPoint = landmarks[tip];
  const dipPoint = landmarks[dip];
  const pipPoint = landmarks[pip];
  const mcpPoint = landmarks[mcp];
  const fingerLength = normalizedDistance(tipPoint, pipPoint);
  const baseLength = normalizedDistance(pipPoint, mcpPoint);
  return tipPoint.y < pipPoint.y - 0.015 && dipPoint.y < mcpPoint.y - 0.01 && fingerLength > baseLength * 0.88;
}

function detectGesture(landmarks) {
  const indexUp = fingerExtended(landmarks, 8, 7, 6, 5);
  const middleUp = fingerExtended(landmarks, 12, 11, 10, 9);
  const ringUp = fingerExtended(landmarks, 16, 15, 14, 13);
  const pinkyUp = fingerExtended(landmarks, 20, 19, 18, 17);
  const raisedFingerCount = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;
  const { pinchRatio, thumbOpen } = getHandMetrics(landmarks);

  if (pinchRatio < 0.42) return 'pinch';
  if (indexUp && middleUp && ringUp && pinkyUp && thumbOpen) return 'erase';
  if (indexUp && raisedFingerCount <= 2 && pinchRatio > 0.6) return 'draw';
  return 'idle';
}

function getStableGesture(rawGesture) {
  if (rawGesture === currentGesture) {
    gestureCandidate = rawGesture;
    gestureCandidateFrames = 0;
    return currentGesture;
  }

  if (rawGesture === gestureCandidate) {
    gestureCandidateFrames += 1;
  } else {
    gestureCandidate = rawGesture;
    gestureCandidateFrames = 1;
  }

  const framesNeeded =
    rawGesture === 'draw' ? 1 :
    rawGesture === 'pinch' ? 2 :
    rawGesture === 'erase' ? 3 :
    2;
  if (gestureCandidateFrames >= framesNeeded) {
    currentGesture = rawGesture;
    gestureCandidateFrames = 0;
  }

  return currentGesture;
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function traceSmoothPath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const control = points[index];
    const target = midpoint(points[index], points[index + 1]);
    ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function renderStroke(ctx, stroke) {
  if (!stroke.points.length) return;

  const screenPoints = stroke.points.map(worldToScreen);
  const scaledThickness = Math.max(1.5, stroke.thickness * viewState.scale);
  const scaledGlow = clamp(stroke.glow * Math.max(0.9, viewState.scale), 0, 90);

  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = scaledThickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = stroke.color;

  if (screenPoints.length === 1) {
    ctx.beginPath();
    ctx.arc(screenPoints[0].x, screenPoints[0].y, Math.max(2, scaledThickness / 2), 0, Math.PI * 2);
    ctx.shadowBlur = scaledGlow * 1.2;
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.globalAlpha = 0.65;
  ctx.shadowBlur = scaledGlow * 1.8;
  traceSmoothPath(ctx, screenPoints);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.shadowBlur = scaledGlow;
  traceSmoothPath(ctx, screenPoints);
  ctx.stroke();
  ctx.restore();
}

function renderArtwork() {
  drawCtx.clearRect(0, 0, viewport.width, viewport.height);
  for (const stroke of strokes) {
    renderStroke(drawCtx, stroke);
  }
}

function drawSelectionHighlight(stroke) {
  const screenPoints = stroke.points.map(worldToScreen);
  const accentColor = isMovingSelection ? DRAG_COLOR : 'rgba(255, 255, 255, 0.92)';
  const haloWidth = clamp((stroke.thickness + 9) * viewState.scale, 10, 26);

  uiCtx.save();
  uiCtx.strokeStyle = accentColor;
  uiCtx.fillStyle = accentColor;
  uiCtx.lineWidth = haloWidth;
  uiCtx.lineCap = 'round';
  uiCtx.lineJoin = 'round';
  uiCtx.globalAlpha = isMovingSelection ? 0.22 : 0.16;
  uiCtx.shadowColor = isMovingSelection ? DRAG_COLOR_SOFT : 'rgba(255, 255, 255, 0.2)';
  uiCtx.shadowBlur = isMovingSelection ? 22 : 16;

  if (screenPoints.length === 1) {
    uiCtx.beginPath();
    uiCtx.arc(screenPoints[0].x, screenPoints[0].y, haloWidth * 0.55, 0, Math.PI * 2);
    uiCtx.fill();
  } else {
    traceSmoothPath(uiCtx, screenPoints);
    uiCtx.stroke();
  }

  uiCtx.restore();
}

function drawHandSkeleton(landmarks, gesture) {
  const toX = point => (1 - point.x) * viewport.width;
  const toY = point => point.y * viewport.height;

  HAND_CONNECTIONS.forEach(([a, b]) => {
    uiCtx.save();
    uiCtx.beginPath();
    uiCtx.moveTo(toX(landmarks[a]), toY(landmarks[a]));
    uiCtx.lineTo(toX(landmarks[b]), toY(landmarks[b]));
    uiCtx.strokeStyle =
      gesture === 'draw' ? 'rgba(0, 245, 255, 0.55)' :
      gesture === 'erase' ? 'rgba(255, 100, 100, 0.55)' :
      gesture === 'zoom' ? ZOOM_COLOR_SOFT :
      gesture === 'pinch' ? (isMovingSelection ? DRAG_COLOR_SOFT : PINCH_COLOR_SOFT) :
      'rgba(255, 255, 255, 0.28)';
    uiCtx.lineWidth = 1.5;
    uiCtx.stroke();
    uiCtx.restore();
  });

  landmarks.forEach((point, index) => {
    const x = toX(point);
    const y = toY(point);
    const isTip = [4, 8, 12, 16, 20].includes(index);

    uiCtx.save();
    uiCtx.beginPath();
    uiCtx.arc(x, y, isTip ? 5 : 3, 0, Math.PI * 2);

    if (isTip) {
      uiCtx.fillStyle =
        gesture === 'draw' ? activeColor :
        gesture === 'erase' ? 'rgba(255, 100, 100, 0.92)' :
        gesture === 'zoom' ? ZOOM_COLOR :
        gesture === 'pinch' ? (isMovingSelection ? DRAG_COLOR : PINCH_COLOR) :
        'rgba(255, 255, 255, 0.75)';
      uiCtx.shadowColor = gesture === 'draw' ? activeColor : 'transparent';
      uiCtx.shadowBlur = gesture === 'draw' ? 10 : 0;
    } else {
      uiCtx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    }

    uiCtx.fill();
    uiCtx.restore();
  });
}

function drawTwoHandZoomOverlay(zoomGesture) {
  const { points, midpoint: center, direction } = zoomGesture;

  uiCtx.save();
  uiCtx.strokeStyle = ZOOM_COLOR;
  uiCtx.lineWidth = 2.5;
  uiCtx.setLineDash([10, 8]);
  uiCtx.shadowColor = ZOOM_COLOR_SOFT;
  uiCtx.shadowBlur = 18;
  uiCtx.beginPath();
  uiCtx.moveTo(points[0].x, points[0].y);
  uiCtx.lineTo(points[1].x, points[1].y);
  uiCtx.stroke();
  uiCtx.restore();

  points.forEach(point => {
    uiCtx.save();
    uiCtx.beginPath();
    uiCtx.arc(point.x, point.y, 20, 0, Math.PI * 2);
    uiCtx.strokeStyle = ZOOM_COLOR;
    uiCtx.lineWidth = 2;
    uiCtx.setLineDash([6, 5]);
    uiCtx.shadowColor = ZOOM_COLOR_SOFT;
    uiCtx.shadowBlur = 14;
    uiCtx.stroke();
    uiCtx.restore();
  });

  uiCtx.save();
  uiCtx.beginPath();
  uiCtx.arc(center.x, center.y, 30, 0, Math.PI * 2);
  uiCtx.strokeStyle = 'rgba(255, 235, 170, 0.94)';
  uiCtx.lineWidth = 2;
  uiCtx.shadowColor = ZOOM_COLOR_SOFT;
  uiCtx.shadowBlur = 16;
  uiCtx.stroke();

  uiCtx.beginPath();
  uiCtx.moveTo(center.x - 12, center.y);
  uiCtx.lineTo(center.x + 12, center.y);
  uiCtx.moveTo(center.x, center.y - 12);
  uiCtx.lineTo(center.x, center.y + 12);
  uiCtx.strokeStyle = 'rgba(255, 220, 130, 0.9)';
  uiCtx.lineWidth = 1.5;
  uiCtx.stroke();

  uiCtx.fillStyle = 'rgba(255, 245, 200, 0.96)';
  uiCtx.font = "600 12px 'Space Grotesk', sans-serif";
  uiCtx.textAlign = 'center';
  uiCtx.textBaseline = 'middle';
  uiCtx.fillText(
    direction === 'in' ? 'ZOOM IN' : direction === 'out' ? 'ZOOM OUT' : 'ZOOM',
    center.x,
    center.y - 40,
  );
  uiCtx.restore();
}

function renderOverlay(
  cursorPoint = null,
  gesture = 'idle',
  landmarks = null,
  eraseCursor = null,
  secondaryLandmarks = null,
  secondaryGesture = 'idle',
  zoomGesture = null,
) {
  uiCtx.clearRect(0, 0, viewport.width, viewport.height);

  const selectedStroke = getSelectedStroke();
  if (selectedStroke) {
    drawSelectionHighlight(selectedStroke);
  }

  if (landmarks) {
    drawHandSkeleton(landmarks, gesture);
  }

  if (secondaryLandmarks) {
    drawHandSkeleton(secondaryLandmarks, secondaryGesture);
  }

  if (zoomGesture) {
    drawTwoHandZoomOverlay(zoomGesture);
  }

  if (!cursorPoint) return;

  const { x, y } = cursorPoint;

  if (gesture === 'draw') {
    uiCtx.save();
    uiCtx.beginPath();
    uiCtx.arc(x, y, thickness / 2 + 8, 0, Math.PI * 2);
    uiCtx.strokeStyle = activeColor;
    uiCtx.lineWidth = 2.5;
    uiCtx.shadowColor = activeColor;
    uiCtx.shadowBlur = 18;
    uiCtx.stroke();
    uiCtx.restore();

    uiCtx.save();
    uiCtx.beginPath();
    uiCtx.arc(x, y, 4, 0, Math.PI * 2);
    uiCtx.fillStyle = activeColor;
    uiCtx.shadowColor = activeColor;
    uiCtx.shadowBlur = 14;
    uiCtx.fill();
    uiCtx.restore();
    return;
  }

  if (gesture === 'erase' && eraseCursor) {
    uiCtx.save();
    uiCtx.beginPath();
    uiCtx.arc(eraseCursor.x, eraseCursor.y, eraseCursor.radius, 0, Math.PI * 2);
    uiCtx.strokeStyle = 'rgba(255, 100, 100, 0.88)';
    uiCtx.lineWidth = 2.5;
    uiCtx.setLineDash([8, 6]);
    uiCtx.shadowColor = 'rgba(255, 100, 100, 0.5)';
    uiCtx.shadowBlur = 16;
    uiCtx.stroke();
    uiCtx.restore();
    return;
  }

  if (gesture === 'pinch') {
    uiCtx.save();
    uiCtx.beginPath();
    uiCtx.arc(x, y, 18, 0, Math.PI * 2);
    uiCtx.strokeStyle = isMovingSelection ? DRAG_COLOR : PINCH_COLOR;
    uiCtx.lineWidth = 2.5;
    uiCtx.setLineDash([5, 4]);
    uiCtx.shadowColor = isMovingSelection ? DRAG_COLOR_SOFT : PINCH_COLOR_SOFT;
    uiCtx.shadowBlur = 14;
    uiCtx.stroke();
    uiCtx.restore();
    return;
  }

  uiCtx.save();
  uiCtx.beginPath();
  uiCtx.arc(x, y, 8, 0, Math.PI * 2);
  uiCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  uiCtx.lineWidth = 1.5;
  uiCtx.stroke();
  uiCtx.restore();
}

function updateSelectionStatus() {
  if (isTwoHandZooming) {
    selectionStatus.textContent =
      zoomGestureDirection === 'in'
        ? 'Two-hand zoom active. Spread both pinch fingers to zoom in.'
        : zoomGestureDirection === 'out'
          ? 'Two-hand zoom active. Bring both pinch fingers inward to zoom out.'
          : 'Two-hand zoom active. Pinch with both hands, then spread or close.';
    return;
  }

  if (!strokes.length) {
    selectionStatus.textContent = 'Draw a stroke, use your hand on color, thickness, glow, or use two hands for deep zoom.';
    return;
  }

  if (isMovingSelection) {
    selectionStatus.textContent = 'Moving selected stroke. Release pinch to place it.';
    return;
  }

  if (selectedStrokeId && getSelectedStroke()) {
    selectionStatus.textContent = 'Selected stroke ready. Pinch to move it. Use hand sliders or two hands for deep zoom.';
    return;
  }

  selectionStatus.textContent = 'Pinch a stroke to move it. Use your hand on color, thickness, glow, or zoom.';
}

function updateHUD(gesture) {
  const hudState = HUD_MAP[gesture] || HUD_MAP.idle;
  let text = hudState.text;

  if (gesture === 'zoom') {
    if (zoomGestureDirection === 'in') {
      text = 'ZOOMING IN';
    } else if (zoomGestureDirection === 'out') {
      text = 'ZOOMING OUT';
    } else {
      text = 'SPREAD OR PINCH';
    }
  } else if (gesture === 'pinch') {
    if (!strokes.length) {
      text = 'NOTHING TO MOVE';
    } else if (isMovingSelection) {
      text = 'MOVING OBJECT';
    } else if (selectedStrokeId) {
      text = 'OBJECT READY';
    } else {
      text = 'PINCH A STROKE';
    }
  } else if (gesture === 'adjust') {
    if (activeHandSliderType === 'thickness') {
      text = `THICKNESS ${thickness}px`;
    } else if (activeHandSliderType === 'glow') {
      text = `GLOW ${glowAmount}`;
    }
  } else if (gesture === 'idle' && selectedStrokeId) {
    text = 'OBJECT SELECTED';
  }

  hudIcon.textContent = hudState.icon;
  hudText.textContent = text;
}

function finishTwoHandZoom() {
  if (!isTwoHandZooming && !smoothedZoomPinchPoints[0] && !smoothedZoomPinchPoints[1]) return;
  isTwoHandZooming = false;
  zoomGestureStartDistance = 0;
  zoomGestureStartScale = viewState.scale;
  zoomGestureWorldAnchor = null;
  zoomGestureDirection = 'steady';
  smoothedZoomPinchPoints = [null, null];
  updateSelectionStatus();
}

function updateTwoHandZoom(points) {
  const midpointPoint = midpoint(points[0], points[1]);
  const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));

  if (!isTwoHandZooming) {
    isTwoHandZooming = true;
    zoomGestureStartDistance = distance;
    zoomGestureStartScale = viewState.scale;
    zoomGestureWorldAnchor = screenToWorld(midpointPoint);
    zoomGestureDirection = 'steady';
  }

  const previousScale = viewState.scale;
  const nextScale = zoomGestureStartScale * (distance / zoomGestureStartDistance);
  setZoomWithWorldAnchor(nextScale, midpointPoint, zoomGestureWorldAnchor, {
    renderOverlayNow: false,
    overlayGesture: 'zoom',
  });

  if (Math.abs(viewState.scale - previousScale) > 0.01) {
    zoomGestureDirection = viewState.scale > previousScale ? 'in' : 'out';
  } else {
    zoomGestureDirection = 'steady';
  }

  updateSelectionStatus();

  return {
    points,
    midpoint: midpointPoint,
    direction: zoomGestureDirection,
  };
}

function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  const projectionX = start.x + dx * t;
  const projectionY = start.y + dy * t;
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

function pointNearBounds(point, bounds, padding) {
  return (
    point.x >= bounds.minX - padding &&
    point.x <= bounds.maxX + padding &&
    point.y >= bounds.minY - padding &&
    point.y <= bounds.maxY + padding
  );
}

function distancePointToStroke(point, stroke) {
  if (stroke.points.length === 1) {
    return Math.hypot(point.x - stroke.points[0].x, point.y - stroke.points[0].y);
  }

  let bestDistance = Infinity;
  for (let index = 0; index < stroke.points.length - 1; index += 1) {
    const distance = distancePointToSegment(point, stroke.points[index], stroke.points[index + 1]);
    if (distance < bestDistance) {
      bestDistance = distance;
    }
  }
  return bestDistance;
}

function findStrokeAtPoint(point) {
  let bestStroke = null;
  let bestDistance = Infinity;

  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const stroke = strokes[index];
    const threshold = Math.max((HIT_PADDING - 4) / viewState.scale, stroke.thickness * 1.35);
    if (!pointNearBounds(point, stroke.bounds, threshold)) continue;

    const distance = distancePointToStroke(point, stroke);
    if (distance <= threshold && distance <= bestDistance) {
      bestDistance = distance;
      bestStroke = stroke;
    }
  }

  return bestStroke;
}

function beginStroke(worldPoint) {
  pushHistory();
  activeStroke = createStroke([worldPoint]);
  strokes.push(activeStroke);
  selectedStrokeId = activeStroke.id;
  isDrawing = true;
  renderArtwork();
  updateSelectionStatus();
}

function addInterpolatedPoints(stroke, nextPoint) {
  const lastPoint = stroke.points[stroke.points.length - 1];
  const distance = Math.hypot(nextPoint.x - lastPoint.x, nextPoint.y - lastPoint.y);

  if (distance < MIN_POINT_DISTANCE) {
    return;
  }

  if (distance > MAX_STROKE_JUMP) {
    activeStroke = createStroke([nextPoint], {
      color: stroke.color,
      thickness: stroke.thickness,
      glow: stroke.glow,
    });
    strokes.push(activeStroke);
    selectedStrokeId = activeStroke.id;
    return;
  }

  const steps = Math.max(1, Math.ceil(distance / STROKE_POINT_STEP));
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    stroke.points.push({
      x: lastPoint.x + (nextPoint.x - lastPoint.x) * ratio,
      y: lastPoint.y + (nextPoint.y - lastPoint.y) * ratio,
    });
  }

  updateStrokeBounds(stroke);
}

function extendStroke(worldPoint) {
  if (!activeStroke) {
    beginStroke(worldPoint);
    return;
  }

  addInterpolatedPoints(activeStroke, worldPoint);
  updateStrokeBounds(activeStroke);
  renderArtwork();
}

function finishStroke() {
  if (!isDrawing) return;
  isDrawing = false;
  activeStroke = null;
}

function beginSelectionMove(worldPoint) {
  const targetStroke = findStrokeAtPoint(worldPoint);
  if (!targetStroke) {
    return false;
  }

  selectedStrokeId = targetStroke.id;
  moveStartPoint = clonePoint(worldPoint);
  moveReferencePoints = targetStroke.points.map(clonePoint);
  isMovingSelection = true;
  selectionMoveCommitted = false;
  updateSelectionStatus();
  return true;
}

function updateSelectionMove(worldPoint) {
  if (!isMovingSelection && !beginSelectionMove(worldPoint)) {
    updateSelectionStatus();
    return;
  }

  const selectedStroke = getSelectedStroke();
  if (!selectedStroke || !moveStartPoint || !moveReferencePoints) return;

  const dx = worldPoint.x - moveStartPoint.x;
  const dy = worldPoint.y - moveStartPoint.y;

  const commitDistance = Math.max(0.8, 1.35 / viewState.scale);
  if (!selectionMoveCommitted && Math.hypot(dx, dy) > commitDistance) {
    pushHistory();
    selectionMoveCommitted = true;
  }

  if (!selectionMoveCommitted) return;

  selectedStroke.points = moveReferencePoints.map(point => ({
    x: point.x + dx,
    y: point.y + dy,
  }));
  updateStrokeBounds(selectedStroke);
  renderArtwork();
  updateSelectionStatus();
}

function finishSelectionMove() {
  if (!isMovingSelection && !moveStartPoint && !moveReferencePoints) return;
  isMovingSelection = false;
  selectionMoveCommitted = false;
  moveStartPoint = null;
  moveReferencePoints = null;
  updateSelectionStatus();
}

function eraseStroke(stroke, center, radius) {
  const threshold = radius + stroke.thickness * 0.7;
  if (!pointNearBounds(center, stroke.bounds, threshold)) {
    return { changed: false, fragments: [stroke] };
  }

  const fragments = [];
  let currentFragment = [];
  let changed = false;

  for (const point of stroke.points) {
    const inside = Math.hypot(point.x - center.x, point.y - center.y) <= threshold;
    if (inside) {
      changed = true;
      if (currentFragment.length) {
        fragments.push(currentFragment);
        currentFragment = [];
      }
    } else {
      currentFragment.push(clonePoint(point));
    }
  }

  if (currentFragment.length) {
    fragments.push(currentFragment);
  }

  if (!changed) {
    return { changed: false, fragments: [stroke] };
  }

  return {
    changed: true,
    fragments: fragments.map(points => createStroke(points, stroke)),
  };
}

function eraseAt(worldPoint, radius) {
  if (!strokes.length) return;

  const nextStrokes = [];
  let didChange = false;

  for (const stroke of strokes) {
    const result = eraseStroke(stroke, worldPoint, radius);
    if (result.changed) didChange = true;
    nextStrokes.push(...result.fragments);
  }

  if (!didChange) return;

  if (!eraseCommitted) {
    pushHistory();
    eraseCommitted = true;
  }

  strokes = nextStrokes;
  isErasing = true;

  if (selectedStrokeId && !getSelectedStroke()) {
    selectedStrokeId = null;
  }

  renderArtwork();
  updateSelectionStatus();
}

function finishEraseSession() {
  if (!isErasing && !eraseCommitted) return;
  isErasing = false;
  eraseCommitted = false;
}

function drawCameraFrame() {
  camCtx.clearRect(0, 0, viewport.width, viewport.height);

  if (!cameraVisible || video.readyState < 2) {
    camCtx.fillStyle = '#0a0a0f';
    camCtx.fillRect(0, 0, viewport.width, viewport.height);
    return;
  }

  camCtx.save();
  camCtx.translate(viewport.width, 0);
  camCtx.scale(-1, 1);
  camCtx.drawImage(video, 0, 0, viewport.width, viewport.height);
  camCtx.restore();
}

function stopActiveGesture() {
  finishStroke();
  finishSelectionMove();
  finishEraseSession();
  finishTwoHandZoom();
  clearHoveredColorSwatch();
  clearHoveredHandSlider();
  setToolbarHandMode(false);
  currentGesture = 'idle';
  gestureCandidate = 'idle';
  gestureCandidateFrames = 0;
  resetTrackingSmoothing();
  renderOverlay(null, 'idle');
  updateHUD('idle');
}

async function detect() {
  if (!handLandmarker) {
    requestAnimationFrame(detect);
    return;
  }

  drawCameraFrame();

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const results = handLandmarker.detectForVideo(video, performance.now());

    if (results.landmarks && results.landmarks.length > 0) {
      const handInfos = results.landmarks
        .map(landmarks => ({
          landmarks,
          rawGesture: detectGesture(landmarks),
          rawTipPoint: getPrecisionTipPoint(landmarks),
          rawPalmEraser: getPalmEraser(landmarks),
          rawPinchPoint: getPinchPoint(landmarks),
        }))
        .sort((a, b) => a.rawPinchPoint.x - b.rawPinchPoint.x);

      const handOnToolbar = handInfos.some(info =>
        isPointInsideToolbar(info.rawTipPoint) ||
        isPointInsideToolbar(info.rawPinchPoint) ||
        isPointInsideToolbar(info.rawPalmEraser),
      );
      setToolbarHandMode(handOnToolbar);

      const zoomHands = handInfos.length >= 2 &&
        handInfos[0].rawGesture === 'pinch' &&
        handInfos[1].rawGesture === 'pinch';

      if (zoomHands) {
        clearHoveredColorSwatch();
        clearHoveredHandSlider();
        const zoomTracking = getTrackingFactors('zoom');
        const rawZoomPoints = [handInfos[0].rawPinchPoint, handInfos[1].rawPinchPoint];
        smoothedZoomPinchPoints = rawZoomPoints.map((point, index) =>
          smoothPoint(smoothedZoomPinchPoints[index], point, zoomTracking.minFactor, zoomTracking.maxFactor),
        );
        const zoomPoints = smoothedZoomPinchPoints.map((point, index) => point || rawZoomPoints[index]);
        const zoomGesture = updateTwoHandZoom(zoomPoints);

        finishStroke();
        finishEraseSession();
        finishSelectionMove();

        currentGesture = 'zoom';
        gestureCandidate = 'zoom';
        gestureCandidateFrames = 0;

        renderOverlay(null, 'zoom', handInfos[0].landmarks, null, handInfos[1].landmarks, 'zoom', zoomGesture);
        updateHUD('zoom');
      } else {
        finishTwoHandZoom();

        const primaryHand = handInfos.find(info => info.rawGesture !== 'idle') || handInfos[0];
        const { landmarks, rawGesture, rawTipPoint, rawPalmEraser, rawPinchPoint } = primaryHand;
        const gesture = getStableGesture(rawGesture);
        const tipTracking = getTrackingFactors('tip');
        const pinchTracking = getTrackingFactors('pinch');

        smoothedTipPoint = smoothPoint(smoothedTipPoint, rawTipPoint, tipTracking.minFactor, tipTracking.maxFactor);
        smoothedPalmEraser = smoothPalmEraser(smoothedPalmEraser, rawPalmEraser);
        smoothedPinchPoint = smoothPoint(smoothedPinchPoint, rawPinchPoint, pinchTracking.minFactor, pinchTracking.maxFactor);

        const tipPoint = smoothedTipPoint || rawTipPoint;
        const pinchPoint = smoothedPinchPoint || rawPinchPoint;
        const palmEraser = gesture === 'erase' ? (smoothedPalmEraser || rawPalmEraser) : null;
        const cursorPoint = gesture === 'pinch' ? pinchPoint : tipPoint;
        const toolbarActionPoint = gesture === 'erase' && palmEraser ? palmEraser : cursorPoint;
        const hadSliderActive = Boolean(activeHandSliderType);
        let sliderUiActive = false;
        let colorUiActive = false;
        if (gesture === 'erase') {
          clearHoveredColorSwatch();
          clearHoveredHandSlider();
        } else {
          sliderUiActive = tryHandSliderAdjustment(cursorPoint);
          if (sliderUiActive) {
            clearHoveredColorSwatch();
          } else {
            colorUiActive = tryHandColorSelection(tipPoint, false);
            if (gesture === 'pinch') {
              colorUiActive = tryHandColorSelection(pinchPoint, true) || colorUiActive;
            }
          }
        }
        const interactingWithToolbar = isPointInsideToolbar(toolbarActionPoint);
        const hudGesture = sliderUiActive ? 'adjust' : colorUiActive ? 'color' : gesture;

        renderOverlay(cursorPoint, gesture, landmarks, palmEraser);
        updateHUD(hudGesture);

        if (sliderUiActive) {
          selectionStatus.textContent =
            activeHandSliderType === 'thickness'
              ? `Hand thickness control active: ${thickness}px. Move left or right to adjust.`
              : `Hand glow control active: ${glowAmount}. Move left or right to adjust.`;
        } else if (hadSliderActive) {
          updateSelectionStatus();
        }

        if (gesture !== 'draw') finishStroke();
        if (gesture !== 'erase') finishEraseSession();
        if (gesture !== 'pinch') finishSelectionMove();

        if (interactingWithToolbar) {
          finishStroke();
          finishEraseSession();
          finishSelectionMove();
        } else if (gesture === 'draw') {
          extendStroke(screenToWorld(tipPoint));
        } else if (gesture === 'erase' && palmEraser) {
          eraseAt(screenToWorld(palmEraser), palmEraser.radius / viewState.scale);
        } else if (gesture === 'pinch') {
          updateSelectionMove(screenToWorld(pinchPoint));
        }
      }
    } else {
      setToolbarHandMode(false);
      stopActiveGesture();
    }
  }

  requestAnimationFrame(detect);
}

resizeCanvases();
updateSelectionStatus();
updateZoomUI();
renderArtwork();
renderOverlay(null, 'idle');
updateHUD('idle');

async function init() {
  loaderFill.style.width = '20%';
  loaderText.textContent = 'Loading MediaPipe...';

  const fileset = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
  );

  loaderFill.style.width = '55%';
  loaderText.textContent = 'Loading hand model...';

  handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.72,
    minHandPresenceConfidence: 0.72,
    minTrackingConfidence: 0.82,
  });

  loaderFill.style.width = '80%';
  loaderText.textContent = 'Starting camera...';

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60, min: 30 },
    },
  });

  video.srcObject = stream;
  await video.play();

  loaderFill.style.width = '100%';
  loaderText.textContent = 'Ready!';
  await new Promise(resolve => setTimeout(resolve, 500));

  loadingEl.classList.add('hidden');
  onboarding.classList.remove('hidden');

  document.getElementById('btn-go').onclick = () => {
    onboarding.classList.add('hidden');
    detect();
  };
}

init().catch(error => {
  loaderText.textContent = 'Error: ' + error.message;
  console.error(error);
});
