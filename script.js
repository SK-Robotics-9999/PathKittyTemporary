const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');

const fieldImg = new Image();
fieldImg.src = 'images/FE-2026-_REBUILT_Playing_Field_With_Fuel_With_Background.png';
fieldImg.onload = () => draw();

let poses = [];
let selected = null;
let selectedSegment = null;
let mode = 'add';
let pathMode = 'bezier';
let view = { x: 0, y: 0, scale: 1 };
let dragging = null;
let panning = false;
let panStart = null;
let idCounter = 0;
let pathDirty = true;
let pathSamples = [];
let pathDuration = 0;
let animation = {
  active: false,
  currentTime: 0,
  playbackRate: 1,
  lastTime: 0,
  loop: true
};

const systemConstraints = {
  maxVel: 4.5,
  maxAccel: 7.0,
  maxAngularVel: 720,
  maxAngularAccel: 1440
};

const FIELD_W = 16.54;
const FIELD_H = 8.21;
const PPM = 60;

function resize() {
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  draw();
}

function resetView() {
  const fw = FIELD_W * PPM;
  const fh = FIELD_H * PPM;
  const s = Math.min((canvas.width - 40) / fw, (canvas.height - 40) / fh);

  view.scale = s;
  view.x = (canvas.width - fw * s) / 2;
  view.y = (canvas.height - fh * s) / 2;

  draw();
}

function zoom(f) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  view.x = cx + (view.x - cx) * f;
  view.y = cy + (view.y - cy) * f;
  view.scale *= f;

  draw();
}

function toCanvas(fx, fy) {
  return {
    x: view.x + fx * PPM * view.scale,
    y: view.y + (FIELD_H - fy) * PPM * view.scale
  };
}

function toField(cx, cy) {
  return {
    x: (cx - view.x) / (PPM * view.scale),
    y: FIELD_H - (cy - view.y) / (PPM * view.scale)
  };
}

function setMode(m) {
  mode = m;

  ['add', 'select', 'pan'].forEach(k => {
    document.getElementById('btn-' + k).classList.toggle('active', k === m);
  });

  canvas.style.cursor = m === 'pan' ? 'grab' : 'crosshair';
}

function setPathMode(m) {
  pathMode = m;
  markPathDirty();

  document.getElementById('pm-bezier-s').classList.toggle('active', m === 'bezier');
  document.getElementById('pm-linear-s').classList.toggle('active', m === 'linear');

  draw();
}

function clearAll() {
  if (poses.length === 0 || confirm('Clear all poses?')) {
    poses = [];
    selected = null;
    selectedSegment = null;
    markPathDirty();
    animation.active = false;
    animation.currentTime = 0;
    document.getElementById('btn-play').textContent = '▶ Play';
    updateSidebar();
    draw();
  }
}

function refreshTypes() {
  poses.forEach((p, i) => {
    p.type = i === 0 ? 'start' : i === poses.length - 1 ? 'end' : 'waypoint';

    if (poses.length === 1) {
      p.type = 'start';
    }
  });
}

function applySystemConstraintsToSegment(index) {
  const p = poses[index];
  if (!p) return;
  if (p.maxVel == null) p.maxVel = systemConstraints.maxVel;
  if (p.maxAccel == null) p.maxAccel = systemConstraints.maxAccel;
  if (p.maxAngularVel == null) p.maxAngularVel = systemConstraints.maxAngularVel;
  if (p.maxAngularAccel == null) p.maxAngularAccel = systemConstraints.maxAngularAccel;
}

function getSegmentConstraints(index) {
  const p = poses[index];
  return {
    maxVel: p?.maxVel != null ? p.maxVel : systemConstraints.maxVel,
    maxAccel: p?.maxAccel != null ? p.maxAccel : systemConstraints.maxAccel,
    maxAngularVel: p?.maxAngularVel != null ? p.maxAngularVel : systemConstraints.maxAngularVel,
    maxAngularAccel: p?.maxAngularAccel != null ? p.maxAngularAccel : systemConstraints.maxAngularAccel
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeAngle(angle) {
  const TWO_PI = Math.PI * 2;
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

function angleDelta(a, b) {
  const delta = normalizeAngle(b) - normalizeAngle(a);
  return ((delta + Math.PI) % (Math.PI * 2)) - Math.PI;
}

function motionTime(distance, maxVel, maxAccel) {
  if (maxVel <= 0 || maxAccel <= 0) {
    return 0;
  }

  const tToMax = maxVel / maxAccel;
  const distAccel = 0.5 * maxAccel * tToMax * tToMax;

  if (distance <= 2 * distAccel) {
    return 2 * Math.sqrt(distance / maxAccel);
  }

  return 2 * tToMax + (distance - 2 * distAccel) / maxVel;
}

function angularMotionTime(angleRadians, maxAngularVelDeg, maxAngularAccelDeg) {
  const maxVel = (maxAngularVelDeg * Math.PI) / 180;
  const maxAccel = (maxAngularAccelDeg * Math.PI) / 180;
  return motionTime(Math.abs(angleRadians), maxVel, maxAccel);
}

function addPose(fx, fy) {
  if (poses.length > 0) {
    applySystemConstraintsToSegment(poses.length - 1);
  }

  const p = {
    id: idCounter++,
    x: fx,
    y: fy,
    heading: 0,
    name: `Pose ${idCounter}`,
    type: 'waypoint',

    // These control path shape.
    // They are intentionally separate from robot heading.
    inHandle: null,
    outHandle: null,

    // Physical constraints for the segment after this pose.
    maxVel: null,
    maxAccel: null,
    maxAngularVel: null,
    maxAngularAccel: null
  };

  poses.push(p);
  refreshTypes();
  markPathDirty();

  selected = p.id;
  selectedSegment = null;

  updateSidebar();
  draw();
}

function deletePose(id) {
  poses = poses.filter(p => p.id !== id);
  refreshTypes();
  markPathDirty();

  if (selected === id) {
    selected = null;
  }
  selectedSegment = null;

  updateSidebar();
  draw();
}

function getPoseAt(cx, cy, r = 18) {
  for (let i = poses.length - 1; i >= 0; i--) {
    const p = poses[i];
    const c = toCanvas(p.x, p.y);

    if (Math.hypot(cx - c.x, cy - c.y) < r) {
      return p;
    }
  }

  return null;
}

function makeDefaultHandles(p0, p1) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;

  if (!p0.outHandle) {
    p0.outHandle = {
      x: dx * 0.4,
      y: dy * 0.4
    };
  }

  if (!p1.inHandle) {
    p1.inHandle = {
      x: -dx * 0.4,
      y: -dy * 0.4
    };
  }
}

function markPathDirty() {
  pathDirty = true;
}

function cubicPoint(p0, c0, c1, p1, t) {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const x = uu * u * p0.x + 3 * uu * t * c0.x + 3 * u * tt * c1.x + tt * t * p1.x;
  const y = uu * u * p0.y + 3 * uu * t * c0.y + 3 * u * tt * c1.y + tt * t * p1.y;
  return { x, y };
}

function cubicDerivative(p0, c0, c1, p1, t) {
  const u = 1 - t;
  const dx = 3 * u * u * (c0.x - p0.x) + 6 * u * t * (c1.x - c0.x) + 3 * t * t * (p1.x - c1.x);
  const dy = 3 * u * u * (c0.y - p0.y) + 6 * u * t * (c1.y - c0.y) + 3 * t * t * (p1.y - c1.y);
  return { dx, dy };
}

function rebuildPathSamples() {
  if (poses.length < 2) {
    pathSamples = [];
    pathDuration = 0;
    return;
  }

  const samples = [];
  const steps = pathMode === 'linear' ? 40 : 120;
  let totalTime = 0;

  for (let i = 0; i < poses.length - 1; i++) {
    const p0 = poses[i];
    const p1 = poses[i + 1];
    const constraints = getSegmentConstraints(i);
    const headingDelta = angleDelta(p0.heading, p1.heading);
    const rotationTime = angularMotionTime(headingDelta, constraints.maxAngularVel, constraints.maxAngularAccel);

    const segmentSamples = [];
    let segmentDist = 0;
    let prevPos = null;

    if (pathMode === 'linear') {
      for (let j = 0; j <= steps; j++) {
        const t = j / steps;
        const x = p0.x + (p1.x - p0.x) * t;
        const y = p0.y + (p1.y - p0.y) * t;
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const heading = Math.atan2(dy, dx);
        const pos = { x, y, heading, segmentIdx: i, t };
        if (prevPos) {
          segmentDist += distance(prevPos, pos);
        }
        prevPos = pos;
        segmentSamples.push(pos);
      }
    } else {
      const cp = cpFor(p0, p1);
      const c0 = { x: cp.cp0x, y: cp.cp0y };
      const c1 = { x: cp.cp1x, y: cp.cp1y };

      for (let j = 0; j <= steps; j++) {
        const t = j / steps;
        const pos = cubicPoint(p0, c0, c1, p1, t);
        const deriv = cubicDerivative(p0, c0, c1, p1, t);
        const heading = Math.atan2(deriv.dy, deriv.dx);
        const sample = { x: pos.x, y: pos.y, heading, segmentIdx: i, t };
        if (prevPos) {
          segmentDist += distance(prevPos, sample);
        }
        prevPos = sample;
        segmentSamples.push(sample);
      }
    }

    const translationTime = motionTime(segmentDist, constraints.maxVel, constraints.maxAccel);
    const segmentTime = Math.max(translationTime, rotationTime, 0.001);
    let cumulative = 0;

    for (let j = 0; j < segmentSamples.length; j++) {
      if (j > 0) {
        cumulative += distance(segmentSamples[j - 1], segmentSamples[j]);
      }
      const sample = segmentSamples[j];
      sample.segmentDistance = segmentDist;
      sample.segmentElapsed = segmentDist > 0 ? cumulative / segmentDist : 0;
      sample.time = totalTime + segmentTime * (segmentDist > 0 ? cumulative / segmentDist : 0);
      sample.segmentDuration = segmentTime;
    }

    totalTime += segmentTime;
    samples.push(...segmentSamples);
    if (i < poses.length - 2) {
      samples.pop();
    }
  }

  pathSamples = samples;
  pathDuration = totalTime;
}

function ensurePathSamples() {
  if (pathDirty) {
    rebuildPathSamples();
    pathDirty = false;
    animation.currentTime = Math.min(animation.currentTime, pathDuration);
  }
}

function normalizeAngle(angle) {
  const TWO_PI = Math.PI * 2;
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

function interpolateHeading(a, b, t) {
  const TWO_PI = Math.PI * 2;
  const start = normalizeAngle(a);
  const end = normalizeAngle(b);
  const delta = ((end - start + Math.PI + TWO_PI) % TWO_PI) - Math.PI;
  return start + delta * t;
}

function drawOverlay() {
  if (pathSamples.length < 2 || poses.length < 2 || pathDuration <= 0) {
    return;
  }

  const currentTime = Math.min(animation.currentTime, pathDuration);
  let index = 0;
  while (index < pathSamples.length - 1 && pathSamples[index].time < currentTime) {
    index++;
  }
  const current = pathSamples[index];

  const toCanvasPoint = p => toCanvas(p.x, p.y);
  const trail = pathSamples.slice(0, index + 1).map(toCanvasPoint);

  if (trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#a78bfa99';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(trail[0].x, trail[0].y);
    for (let i = 1; i < trail.length; i++) {
      ctx.lineTo(trail[i].x, trail[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  const bot = toCanvas(current.x, current.y);
  const size = 12 * view.scale;
  const startHeading = poses[current.segmentIdx]?.heading || 0;
  const endHeading = poses[current.segmentIdx + 1]?.heading || startHeading;
  const displayHeading = interpolateHeading(startHeading, endHeading, current.segmentElapsed);

  ctx.save();
  ctx.translate(bot.x, bot.y);
  ctx.rotate(-displayHeading);

  const halfSize = size;
  ctx.fillStyle = '#fef08a';
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(-halfSize, -halfSize, halfSize * 2, halfSize * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(halfSize * 1.2, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(halfSize * 1.2, 0);
  ctx.lineTo(halfSize * 0.9, -halfSize * 0.4);
  ctx.lineTo(halfSize * 0.9, halfSize * 0.4);
  ctx.closePath();
  ctx.fillStyle = '#111827';
  ctx.fill();

  ctx.restore();
}

function animateFrame(timestamp) {
  if (!animation.active) {
    animation.lastTime = 0;
    return;
  }

  ensurePathSamples();
  if (pathSamples.length < 2 || pathDuration <= 0) {
    animation.active = false;
    animation.lastTime = 0;
    document.getElementById('btn-play').textContent = '▶ Play';
    return;
  }

  if (!animation.lastTime) {
    animation.lastTime = timestamp;
  }

  const delta = timestamp - animation.lastTime;
  animation.lastTime = timestamp;
  animation.currentTime += (delta / 1000) * animation.playbackRate;

  if (animation.loop) {
    animation.currentTime %= pathDuration;
  } else if (animation.currentTime >= pathDuration) {
    animation.currentTime = pathDuration;
    animation.active = false;
    document.getElementById('btn-play').textContent = '▶ Play';
  }

  draw();
  if (animation.active) {
    requestAnimationFrame(animateFrame);
  }
}

function toggleAnimation() {
  if (pathSamples.length < 2) {
    return;
  }

  animation.active = !animation.active;
  const button = document.getElementById('btn-play');
  if (animation.active) {
    button.textContent = '❚❚ Pause';
    animation.lastTime = 0;
    requestAnimationFrame(animateFrame);
  } else {
    button.textContent = '▶ Play';
  }
}

function resetAnimation() {
  animation.currentTime = 0;
  animation.lastTime = 0;
  draw();
}

function cpFor(p0, p1) {
  makeDefaultHandles(p0, p1);

  return {
    cp0x: p0.x + p0.outHandle.x,
    cp0y: p0.y + p0.outHandle.y,
    cp1x: p1.x + p1.inHandle.x,
    cp1y: p1.y + p1.inHandle.y
  };
}

function getControlPointAt(cx, cy, r = 8) {
  if ((pathMode !== 'bezier' && pathMode !== 'cubic') || poses.length < 2) {
    return null;
  }

  for (let i = 0; i < poses.length - 1; i++) {
    const cp = cpFor(poses[i], poses[i + 1]);

    const a = toCanvas(cp.cp0x, cp.cp0y);
    const b = toCanvas(cp.cp1x, cp.cp1y);

    if (Math.hypot(cx - a.x, cy - a.y) < r) {
      return {
        type: 'outHandle',
        segmentIdx: i,
        poseIdx: i
      };
    }

    if (Math.hypot(cx - b.x, cy - b.y) < r) {
      return {
        type: 'inHandle',
        segmentIdx: i,
        poseIdx: i + 1
      };
    }
  }

  return null;
}

function drawPath() {
  if (poses.length < 2) {
    return;
  }

  ctx.save();

  ctx.strokeStyle = '#f472b6';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = '#f472b6aa';
  ctx.shadowBlur = 10;

  ctx.beginPath();

  const c0 = toCanvas(poses[0].x, poses[0].y);
  ctx.moveTo(c0.x, c0.y);

  for (let i = 0; i < poses.length - 1; i++) {
    const next = toCanvas(poses[i + 1].x, poses[i + 1].y);

    if (pathMode === 'linear') {
      ctx.lineTo(next.x, next.y);
    } else {
      const cp = cpFor(poses[i], poses[i + 1]);
      const a = toCanvas(cp.cp0x, cp.cp0y);
      const b = toCanvas(cp.cp1x, cp.cp1y);

      ctx.bezierCurveTo(a.x, a.y, b.x, b.y, next.x, next.y);
    }
  }

  ctx.stroke();
  ctx.restore();
}

function drawBezierHandles() {
  if ((pathMode !== 'bezier' && pathMode !== 'cubic') || poses.length < 2) {
    return;
  }

  for (let i = 0; i < poses.length - 1; i++) {
    const cp = cpFor(poses[i], poses[i + 1]);

    const a = toCanvas(cp.cp0x, cp.cp0y);
    const b = toCanvas(cp.cp1x, cp.cp1y);
    const p0 = toCanvas(poses[i].x, poses[i].y);
    const p1 = toCanvas(poses[i + 1].x, poses[i + 1].y);

    ctx.strokeStyle = '#f472b640';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(a.x, a.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.setLineDash([]);

    ctx.fillStyle = '#f472b688';

    ctx.beginPath();
    ctx.arc(a.x, a.y, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPoses() {
  poses.forEach((p, i) => {
    const c = toCanvas(p.x, p.y);
    const isSel = p.id === selected;
    const s = view.scale;

    const col =
      p.type === 'start'
        ? '#f472b6'
        : p.type === 'end'
          ? '#fb7185'
          : '#f9a8d4';

    if (isSel) {
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 20;
      ctx.strokeStyle = col + '66';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 16 * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(-p.heading);

    const rw = 15 * s * 2;
    const rh = 12 * s * 2;

    ctx.fillStyle = isSel ? col + '2a' : '#161c2a';
    ctx.strokeStyle = col;
    ctx.lineWidth = isSel ? 2 : 1.5;

    ctx.beginPath();
    ctx.rect(-rw / 2, -rh / 2, rw, rh);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.rect(rw / 2 - 3 * s, -2 * s, 3 * s, 4 * s);
    ctx.fill();

    ctx.restore();

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(-p.heading);

    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.5;

    const al = 22 * s;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(al, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(al, 0);
    ctx.lineTo(al - 6 * s, -3.5 * s);
    ctx.lineTo(al - 6 * s, 3.5 * s);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    const fs = Math.max(9, 11 * s);
    ctx.fillStyle = '#e2e8f0cc';
    ctx.font = `bold ${fs}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(i + 1, c.x, c.y - 16 * s);
  });
}

function draw() {
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#0d0f14';
  ctx.fillRect(0, 0, W, H);

  const fw = FIELD_W * PPM * view.scale;
  const fh = FIELD_H * PPM * view.scale;

  if (fieldImg.complete) {
    ctx.drawImage(fieldImg, view.x, view.y, fw, fh);
  }

  ensurePathSamples();
  drawPath();
  drawBezierHandles();
  drawOverlay();
  drawPoses();

  document.getElementById('status').textContent =
    `poses: ${poses.length} · mode: ${mode} · path: ${pathMode} · zoom: ${(view.scale * 100).toFixed(0)}% · rate: ${animation.playbackRate.toFixed(2)}x`;
}

function updateSidebar() {
  const list = document.getElementById('pose-list');
  list.innerHTML = '';

  poses.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'pose-item' + (p.id === selected && selectedSegment === null ? ' selected' : '');

    div.innerHTML = `
      <div class="pose-dot ${p.type}"></div>
      <div class="pose-info">
        <div class="pose-name">${i + 1}. ${p.name}</div>
        <div class="pose-coords">
          (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) · ${(p.heading * 180 / Math.PI).toFixed(1)}°
        </div>
      </div>
      <button class="pose-delete">✕</button>
    `;

    div.onclick = () => {
      selected = p.id;
      selectedSegment = null;
      updateSidebar();
      draw();
      updateInspector();
    };

    div.querySelector('.pose-delete').onclick = e => {
      e.stopPropagation();
      deletePose(p.id);
    };

    list.appendChild(div);

    if (i < poses.length - 1) {
      const segmentDiv = document.createElement('div');
      const segment = {
        maxVel: p.maxVel,
        maxAccel: p.maxAccel,
        maxAngularVel: p.maxAngularVel,
        maxAngularAccel: p.maxAngularAccel
      };
      const hasConstraints = segment.maxVel != null || segment.maxAccel != null || segment.maxAngularVel != null || segment.maxAngularAccel != null;

      segmentDiv.className = 'pose-item segment-item' + (selectedSegment === i ? ' selected' : '');
      segmentDiv.innerHTML = `
        <div class="pose-dot constraint"></div>
        <div class="pose-info">
          <div class="pose-name">Segment ${i + 1}</div>
          <div class="pose-coords">${hasConstraints ? 'Constraints set' : 'No constraints'}</div>
        </div>
      `;
      segmentDiv.onclick = () => {
        selected = null;
        selectedSegment = i;
        updateSidebar();
        draw();
        updateInspector();
      };
      list.appendChild(segmentDiv);
    }
  });

  updateInspector();
}

function updateInspector() {
  const el = document.getElementById('insp-content');

  if (selectedSegment != null && selectedSegment >= 0 && selectedSegment < poses.length - 1) {
    const p0 = poses[selectedSegment];
    const p1 = poses[selectedSegment + 1];

    el.innerHTML = `
      <div class="insp-row">
        <label>Segment</label>
        <input value="${selectedSegment + 1} (${p0.name} → ${p1.name})" readonly>
      </div>

      <div class="insp-row" style="margin-top:10px;">
        <label style="width:100%;font-size:10px;color:#b295c6;">Segment constraints</label>
      </div>

      <div class="insp-row">
        <label>V</label>
        <input id="inp-seg-max-vel" type="number" step="0.01" placeholder="m/s" value="${p0.maxVel != null ? p0.maxVel : ''}">
      </div>

      <div class="insp-row">
        <label>A</label>
        <input id="inp-seg-max-accel" type="number" step="0.01" placeholder="m/s²" value="${p0.maxAccel != null ? p0.maxAccel : ''}">
      </div>

      <div class="insp-row">
        <label>ω</label>
        <input id="inp-seg-max-ang-vel" type="number" step="0.01" placeholder="rad/s" value="${p0.maxAngularVel != null ? p0.maxAngularVel : ''}">
      </div>

      <div class="insp-row">
        <label>α</label>
        <input id="inp-seg-max-ang-accel" type="number" step="0.01" placeholder="rad/s²" value="${p0.maxAngularAccel != null ? p0.maxAngularAccel : ''}">
      </div>
    `;

    document.getElementById('inp-seg-max-vel').oninput = e => {
      p0.maxVel = e.target.value === '' ? null : parseFloat(e.target.value);
      markPathDirty();
      updateSidebar();
      draw();
    };

    document.getElementById('inp-seg-max-accel').oninput = e => {
      p0.maxAccel = e.target.value === '' ? null : parseFloat(e.target.value);
      markPathDirty();
      updateSidebar();
      draw();
    };

    document.getElementById('inp-seg-max-ang-vel').oninput = e => {
      p0.maxAngularVel = e.target.value === '' ? null : parseFloat(e.target.value);
      markPathDirty();
      updateSidebar();
      draw();
    };

    document.getElementById('inp-seg-max-ang-accel').oninput = e => {
      p0.maxAngularAccel = e.target.value === '' ? null : parseFloat(e.target.value);
      markPathDirty();
      updateSidebar();
      draw();
    };

    return;
  }

  const p = poses.find(p => p.id === selected);

  if (!p) {
    el.innerHTML = 'No path element selected';
    return;
  }

  const isLast = poses.indexOf(p) === poses.length - 1;

  el.innerHTML = `
    <div class="insp-row">
      <label>Name</label>
      <input id="inp-name" value="${p.name}">
    </div>

    <div class="insp-row">
      <label>X</label>
      <input id="inp-x" type="number" step="0.01" value="${p.x.toFixed(2)}">
    </div>

    <div class="insp-row">
      <label>Y</label>
      <input id="inp-y" type="number" step="0.01" value="${p.y.toFixed(2)}">
    </div>

    <div class="insp-row">
      <label>θ°</label>
      <input id="inp-h" type="number" step="1" value="${(p.heading * 180 / Math.PI).toFixed(1)}">
    </div>

    <div class="insp-row" style="margin-top:10px;">
      <label style="width:100%;font-size:10px;color:#b295c6;">Segment constraints</label>
    </div>

    <div class="insp-row">
      <label>V</label>
      <input id="inp-max-vel" type="number" step="0.01" placeholder="m/s" value="${p.maxVel != null ? p.maxVel : ''}">
    </div>

    <div class="insp-row">
      <label>A</label>
      <input id="inp-max-accel" type="number" step="0.01" placeholder="m/s²" value="${p.maxAccel != null ? p.maxAccel : ''}">
    </div>

    <div class="insp-row">
      <label>ω</label>
      <input id="inp-max-ang-vel" type="number" step="0.01" placeholder="deg/s" value="${p.maxAngularVel != null ? p.maxAngularVel : ''}">
    </div>

    <div class="insp-row">
      <label>α</label>
      <input id="inp-max-ang-accel" type="number" step="0.01" placeholder="deg/s²" value="${p.maxAngularAccel != null ? p.maxAngularAccel : ''}">
    </div>

    <div class="insp-row" style="font-size:10px;color:#b295c6;line-height:1.4;">
      ${isLast ? 'This is the final pose; segment constraints apply to the previous pose.' : 'Applies to the segment from this pose to the next pose.'}
    </div>
  `;

  document.getElementById('inp-name').oninput = e => {
    p.name = e.target.value;
    updateSidebar();
  };

  document.getElementById('inp-x').oninput = e => {
    p.x = parseFloat(e.target.value) || 0;
    draw();
    updateSidebar();
  };

  document.getElementById('inp-y').oninput = e => {
    p.y = parseFloat(e.target.value) || 0;
    draw();
    updateSidebar();
  };

  document.getElementById('inp-h').oninput = e => {
    p.heading = (parseFloat(e.target.value) || 0) * Math.PI / 180;
    draw();
    updateSidebar();
  };

  document.getElementById('inp-max-vel').oninput = e => {
    p.maxVel = e.target.value === '' ? null : parseFloat(e.target.value);
    markPathDirty();
    updateSidebar();
    draw();
  };

  document.getElementById('inp-max-accel').oninput = e => {
    p.maxAccel = e.target.value === '' ? null : parseFloat(e.target.value);
    markPathDirty();
    updateSidebar();
    draw();
  };

  document.getElementById('inp-max-ang-vel').oninput = e => {
    p.maxAngularVel = e.target.value === '' ? null : parseFloat(e.target.value);
    markPathDirty();
    updateSidebar();
    draw();
  };

  document.getElementById('inp-max-ang-accel').oninput = e => {
    p.maxAngularAccel = e.target.value === '' ? null : parseFloat(e.target.value);
    markPathDirty();
    updateSidebar();
    draw();
  };
}

function exportJSON() {
  const pathElements = poses.map(p => ({
    type: 'waypoint',
    translation_target: {
      x_meters: parseFloat(p.x.toFixed(6)),
      y_meters: parseFloat(p.y.toFixed(6))
    },
    rotation_target: {
      rotation_radians: parseFloat(p.heading.toFixed(6)),
      profiled_rotation: true
    }
  }));

  const rawConstraints = {
    max_velocity_meters_per_sec: [],
    max_acceleration_meters_per_sec_sq: [],
    max_angular_velocity_radians_per_sec: [],
    max_angular_acceleration_radians_per_sec_sq: []
  };

  poses.forEach((p, i) => {
    if (i >= poses.length - 1) {
      return;
    }

    if (p.maxVel != null) {
      rawConstraints.max_velocity_meters_per_sec.push({
        value: p.maxVel,
        start_ordinal: i,
        end_ordinal: i + 1
      });
    }

    if (p.maxAccel != null) {
      rawConstraints.max_acceleration_meters_per_sec_sq.push({
        value: p.maxAccel,
        start_ordinal: i,
        end_ordinal: i + 1
      });
    }

    if (p.maxAngularVel != null) {
      rawConstraints.max_angular_velocity_radians_per_sec.push({
        value: p.maxAngularVel * Math.PI / 180,
        start_ordinal: i,
        end_ordinal: i + 1
      });
    }

    if (p.maxAngularAccel != null) {
      rawConstraints.max_angular_acceleration_radians_per_sec_sq.push({
        value: p.maxAngularAccel * Math.PI / 180,
        start_ordinal: i,
        end_ordinal: i + 1
      });
    }
  });

  const constraints = {};
  Object.entries(rawConstraints).forEach(([key, list]) => {
    if (list.length > 0) {
      constraints[key] = list;
    }
  });

  const data = {
    path_elements: pathElements,
    constraints
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'path.json';
  a.click();
}

canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  const cp = getControlPointAt(cx, cy);
  const hit = getPoseAt(cx, cy);

  if (e.button === 1 || mode === 'pan') {
    panning = true;
    panStart = {
      x: cx - view.x,
      y: cy - view.y
    };
    canvas.style.cursor = 'grabbing';
    return;
  }

  if (cp && (pathMode === 'bezier' || pathMode === 'cubic')) {
    dragging = {
      type: 'controlPoint',
      cp,
      pose: poses[cp.poseIdx]
    };

    canvas.style.cursor = 'grabbing';
    return;
  }

  if (mode === 'add' && !hit) {
    const f = toField(cx, cy);

    if (f.x >= 0 && f.x <= FIELD_W && f.y >= 0 && f.y <= FIELD_H) {
      addPose(f.x, f.y);
    }

    return;
  }

  if (hit) {
    selected = hit.id;

    const hitCanvas = toCanvas(hit.x, hit.y);

    dragging = {
      type: 'pose',
      pose: hit,
      ox: cx - hitCanvas.x,
      oy: cy - hitCanvas.y
    };

    canvas.style.cursor = 'grabbing';

    updateSidebar();
    draw();
  } else {
    selected = null;
    updateSidebar();
    draw();
  }
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  if (panning) {
    view.x = cx - panStart.x;
    view.y = cy - panStart.y;
    draw();
    return;
  }

  if (dragging) {
    if (dragging.type === 'controlPoint') {
      const f = toField(cx, cy);
      const pose = dragging.pose;

      if (dragging.cp.type === 'outHandle') {
        pose.outHandle = {
          x: f.x - pose.x,
          y: f.y - pose.y
        };
      }

      if (dragging.cp.type === 'inHandle') {
        pose.inHandle = {
          x: f.x - pose.x,
          y: f.y - pose.y
        };
      }

      markPathDirty();
      updateSidebar();
      draw();
      return;
    }

    if (dragging.type === 'pose') {
      const f = toField(cx - dragging.ox, cy - dragging.oy);

      dragging.pose.x = Math.max(0, Math.min(FIELD_W, f.x));
      dragging.pose.y = Math.max(0, Math.min(FIELD_H, f.y));

      markPathDirty();
      updateSidebar();
      draw();
      return;
    }
  }

  if (mode !== 'pan') {
    if (getControlPointAt(cx, cy)) {
      canvas.style.cursor = 'pointer';
    } else {
      canvas.style.cursor = getPoseAt(cx, cy) ? 'grab' : 'crosshair';
    }
  }
});

canvas.addEventListener('mouseup', () => {
  dragging = null;
  panning = false;
  canvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  const hit = getPoseAt(cx, cy, 24);

  if (hit) {
    // This now ONLY rotates robot heading.
    // It does NOT affect the Bézier curve shape.
    hit.heading += e.deltaY * 0.008;

    updateSidebar();
    draw();
  } else {
    const f = e.deltaY < 0 ? 1.1 : 0.91;

    view.x = cx + (view.x - cx) * f;
    view.y = cy + (view.y - cy) * f;
    view.scale *= f;

    draw();
  }
}, { passive: false });

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const hit = getPoseAt(e.clientX - rect.left, e.clientY - rect.top);

  if (hit) {
    deletePose(hit.id);
  }
});

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') {
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selected !== null) {
      deletePose(selected);
    }
  }

  if (e.key === 'a') setMode('add');
  if (e.key === 's') setMode('select');
  if (e.key === 'p') setMode('pan');

  if (e.key === 'Escape') {
    selected = null;
    updateSidebar();
    draw();
  }
});

new ResizeObserver(resize).observe(wrap);

resize();
setTimeout(resetView, 50);
setPathMode('bezier');

function populateSystemSettings() {
  document.getElementById('sys-max-vel').value = systemConstraints.maxVel;
  document.getElementById('sys-max-accel').value = systemConstraints.maxAccel;
  document.getElementById('sys-max-ang-vel').value = systemConstraints.maxAngularVel;
  document.getElementById('sys-max-ang-accel').value = systemConstraints.maxAngularAccel;
}

function openSettings() {
  populateSystemSettings();
  document.getElementById('settings-panel').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-panel').classList.add('hidden');
}

function saveSystemConstraints() {
  systemConstraints.maxVel = parseFloat(document.getElementById('sys-max-vel').value) || systemConstraints.maxVel;
  systemConstraints.maxAccel = parseFloat(document.getElementById('sys-max-accel').value) || systemConstraints.maxAccel;
  systemConstraints.maxAngularVel = parseFloat(document.getElementById('sys-max-ang-vel').value) || systemConstraints.maxAngularVel;
  systemConstraints.maxAngularAccel = parseFloat(document.getElementById('sys-max-ang-accel').value) || systemConstraints.maxAngularAccel;
  markPathDirty();
  draw();
  closeSettings();
}

document.getElementById('settings-btn').onclick = openSettings;
document.getElementById('settings-close').onclick = closeSettings;
document.getElementById('settings-save-btn').onclick = saveSystemConstraints;

document.getElementById('settings-btn').onclick = openSettings;
document.getElementById('settings-close').onclick = closeSettings;
document.getElementById('settings-save-btn').onclick = saveSystemConstraints;
document.getElementById('speed-range').oninput = e => {
  animation.playbackRate = parseFloat(e.target.value);
};
