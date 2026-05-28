const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');

//Field Image
const fieldImg = new Image();
fieldImg.src = 'images/field2026.png'; // path relative to index.html
fieldImg.onload = () => draw();

let poses = [];
let selected = null;
let mode = 'add';
let pathMode = 'bezier';
let view = { x: 0, y: 0, scale: 1 };
let dragging = null;
let panning = false;
let panStart = null;
let idCounter = 0;

const FIELD_W = 16.54, FIELD_H = 8.21;
const PPM = 60; // pixels per meter base

function resize() {
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  draw();
}

function resetView() {
  const fw = FIELD_W * PPM, fh = FIELD_H * PPM;
  const s = Math.min((canvas.width - 40) / fw, (canvas.height - 40) / fh);
  view.scale = s;
  view.x = (canvas.width - fw * s) / 2;
  view.y = (canvas.height - fh * s) / 2;
  draw();
}

function zoom(f) {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  view.x = cx + (view.x - cx) * f;
  view.y = cy + (view.y - cy) * f;
  view.scale *= f;
  draw();
}

function toCanvas(fx, fy) {
  return { x: view.x + fx * PPM * view.scale, y: view.y + (FIELD_H - fy) * PPM * view.scale };
}

function toField(cx, cy) {
  return { x: (cx - view.x) / (PPM * view.scale), y: FIELD_H - (cy - view.y) / (PPM * view.scale) };
}

function setMode(m) {
  mode = m;
  ['add','select','pan'].forEach(k => document.getElementById('btn-'+k).classList.toggle('active', k===m));
  canvas.style.cursor = m === 'pan' ? 'grab' : 'crosshair';
}

function setPathMode(m) {
  pathMode = m;
  document.getElementById('pm-bezier-s').classList.toggle('active', m==='bezier');
  document.getElementById('pm-linear-s').classList.toggle('active', m==='linear');
  draw();
}

function clearAll() {
  if (poses.length === 0 || confirm('Clear all poses?')) { poses = []; selected = null; updateSidebar(); draw(); }
}

function refreshTypes() {
  poses.forEach((p, i) => {
    p.type = i === 0 ? 'start' : i === poses.length - 1 ? 'end' : 'waypoint';
    if (poses.length === 1) p.type = 'start';
  });
}

function addPose(fx, fy) {
  const p = { id: idCounter++, x: fx, y: fy, heading: 0, name: `Pose ${idCounter}`, type: 'waypoint' };
  poses.push(p);
  refreshTypes();
  selected = p.id;
  updateSidebar();
  draw();
}

function deletePose(id) {
  poses = poses.filter(p => p.id !== id);
  refreshTypes();
  if (selected === id) selected = null;
  updateSidebar();
  draw();
}

function getPoseAt(cx, cy, r = 18) {
  for (let i = poses.length - 1; i >= 0; i--) {
    const p = poses[i];
    const c = toCanvas(p.x, p.y);
    if (Math.hypot(cx - c.x, cy - c.y) < r) return p;
  }
  return null;
}

function cpFor(p0, p1) {
  const d = Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.4;
  return {
    cp0x: p0.x + Math.cos(p0.heading) * d, cp0y: p0.y + Math.sin(p0.heading) * d,
    cp1x: p1.x - Math.cos(p1.heading) * d, cp1y: p1.y - Math.sin(p1.heading) * d
  };
}

function draw() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0f14';
  ctx.fillRect(0, 0, W, H);

  const fw = FIELD_W * PPM * view.scale, fh = FIELD_H * PPM * view.scale;

  // // Field
  // ctx.fillStyle = '#0e1620';
  // ctx.fillRect(view.x, view.y, fw, fh);

  // // Grid
  // ctx.strokeStyle = '#1a2535'; ctx.lineWidth = 0.5;
  // for (let mx = 0; mx <= FIELD_W; mx++) { const c = toCanvas(mx, 0); ctx.beginPath(); ctx.moveTo(c.x, view.y); ctx.lineTo(c.x, view.y + fh); ctx.stroke(); }
  // for (let my = 0; my <= FIELD_H; my++) { const c = toCanvas(0, my); ctx.beginPath(); ctx.moveTo(view.x, c.y); ctx.lineTo(view.x + fw, c.y); ctx.stroke(); }

  // // Field border
  // ctx.strokeStyle = '#1e3a5f'; ctx.lineWidth = 2;
  // ctx.strokeRect(view.x, view.y, fw, fh);

  // // Center line
  // const cm = toCanvas(FIELD_W / 2, 0);
  // ctx.strokeStyle = '#1e3a5f66'; ctx.lineWidth = 1; ctx.setLineDash([8, 5]);
  // ctx.beginPath(); ctx.moveTo(cm.x, view.y); ctx.lineTo(cm.x, view.y + fh); ctx.stroke();
  // ctx.setLineDash([]);

  // // Alliance zones
  // const aw = 3 * PPM * view.scale;
  // ctx.fillStyle = '#1e3a5f33'; ctx.fillRect(view.x, view.y, aw, fh);
  // ctx.fillStyle = '#5f1e1e33'; ctx.fillRect(view.x + fw - aw, view.y, aw, fh);
  

  //Field
  ctx.drawImage(fieldImg, view.x, view.y, fw, fh);

  // Draw path
  if (poses.length >= 2) {
    ctx.save();
    ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 2.5;
    ctx.shadowColor = '#f472b6aa'; ctx.shadowBlur = 10;
    ctx.beginPath();
    const c0 = toCanvas(poses[0].x, poses[0].y);
    ctx.moveTo(c0.x, c0.y);
    for (let i = 0; i < poses.length - 1; i++) {
      const c1 = toCanvas(poses[i+1].x, poses[i+1].y);
      if (pathMode === 'bezier') {
        const cp = cpFor(poses[i], poses[i+1]);
        const a = toCanvas(cp.cp0x, cp.cp0y), b = toCanvas(cp.cp1x, cp.cp1y);
        ctx.bezierCurveTo(a.x, a.y, b.x, b.y, c1.x, c1.y);
      } else {
        ctx.lineTo(c1.x, c1.y);
      }
    }
    ctx.stroke(); ctx.restore();

    // Bezier handles
    if (pathMode === 'bezier') {
      for (let i = 0; i < poses.length - 1; i++) {
        const cp = cpFor(poses[i], poses[i+1]);
        const a = toCanvas(cp.cp0x, cp.cp0y), b = toCanvas(cp.cp1x, cp.cp1y);
        const c0c = toCanvas(poses[i].x, poses[i].y), c1c = toCanvas(poses[i+1].x, poses[i+1].y);
        ctx.strokeStyle = '#f472b640'; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
        ctx.beginPath(); ctx.moveTo(c0c.x, c0c.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(c1c.x, c1c.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#f472b688';
        ctx.beginPath(); ctx.arc(a.x, a.y, 3.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI*2); ctx.fill();
      }
    }
  }

  // Draw poses
  poses.forEach((p, i) => {
    const c = toCanvas(p.x, p.y);
    const isSel = p.id === selected;
    const s = view.scale;
    const col = p.type === 'start' ? '#f472b6' : p.type === 'end' ? '#fb7185' : '#f9a8d4';

    // Selection glow
    if (isSel) {
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 20;
      ctx.strokeStyle = col + '66'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c.x, c.y, 16 * s, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }

    // Robot rectangle
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(-p.heading);
    const rw = 15 * s, rh = 12 * s;
    ctx.fillStyle = isSel ? col + '2a' : '#161c2a';
    ctx.strokeStyle = col; ctx.lineWidth = isSel ? 2 : 1.5;
    ctx.beginPath(); ctx.rect(-rw/2, -rh/2, rw, rh); ctx.fill(); ctx.stroke();
    // Front marker
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.rect(rw/2 - 3*s, -2*s, 3*s, 4*s); ctx.fill();
    ctx.restore();

    // Heading arrow
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(-p.heading);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
    const al = 22 * s;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(al, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(al, 0); ctx.lineTo(al - 6*s, -3.5*s); ctx.lineTo(al - 6*s, 3.5*s); ctx.closePath(); ctx.fill();
    ctx.restore();

    // Index number
    const fs = Math.max(9, 11 * s);
    ctx.fillStyle = '#e2e8f0cc'; ctx.font = `bold ${fs}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(i + 1, c.x, c.y - 16 * s);
  });

  // Status
  document.getElementById('status').textContent =
    `poses: ${poses.length}  ·  mode: ${mode}  ·  path: ${pathMode}  ·  zoom: ${(view.scale * 100).toFixed(0)}%`;
}

function updateSidebar() {
  const list = document.getElementById('pose-list');
  list.innerHTML = '';
  poses.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'pose-item' + (p.id === selected ? ' selected' : '');
    div.innerHTML = `
      <div class="pose-dot ${p.type}"></div>
      <div class="pose-info">
        <div class="pose-name">${i+1}. ${p.name}</div>
        <div class="pose-coords">(${p.x.toFixed(2)}, ${p.y.toFixed(2)}) · ${(p.heading*180/Math.PI).toFixed(1)}°</div>
      </div>
      <button class="pose-delete" onclick="event.stopPropagation();deletePose(${p.id})">✕</button>`;
    div.onclick = () => { selected = p.id; updateSidebar(); draw(); updateInspector(); };
    list.appendChild(div);
  });
  updateInspector();
}

function updateInspector() {
  const el = document.getElementById('insp-content');
  const p = poses.find(p => p.id === selected);
  if (!p) { el.innerHTML = '<span style="color:#374151">No pose selected</span>'; return; }
  el.innerHTML = `
    <div class="insp-row"><label>Name</label><input id="inp-name" value="${p.name}"></div>
    <div class="insp-row"><label>X</label><input id="inp-x" type="number" step="0.01" value="${p.x.toFixed(3)}">
    <label style="width:20px;text-align:center;">Y</label><input id="inp-y" type="number" step="0.01" value="${p.y.toFixed(3)}"></div>
    <div class="insp-row"><label>θ°</label><input id="inp-h" type="number" step="1" value="${(p.heading*180/Math.PI).toFixed(1)}"></div>`;
  document.getElementById('inp-name').oninput = e => { p.name = e.target.value; updateSidebar(); };
  document.getElementById('inp-x').oninput = e => { p.x = parseFloat(e.target.value)||0; draw(); updateSidebar(); };
  document.getElementById('inp-y').oninput = e => { p.y = parseFloat(e.target.value)||0; draw(); updateSidebar(); };
  document.getElementById('inp-h').oninput = e => { p.heading = (parseFloat(e.target.value)||0)*Math.PI/180; draw(); updateSidebar(); };
}

function exportJSON() {
  const data = {
    waypoints: poses.map((p, i) => ({
      index: i,
      name: p.name,
      x: parseFloat(p.x.toFixed(4)),
      y: parseFloat(p.y.toFixed(4)),
      heading: parseFloat((p.heading * 180 / Math.PI).toFixed(2)),
      type: p.type
    })),
    pathMode
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'path.json';
  a.click();
}

// Mouse events
canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const hit = getPoseAt(cx, cy);
  if (e.button === 1 || mode === 'pan') {
    panning = true; panStart = { x: cx - view.x, y: cy - view.y };
    canvas.style.cursor = 'grabbing'; return;
  }
  if (mode === 'add' && !hit) {
    const f = toField(cx, cy);
    if (f.x >= 0 && f.x <= FIELD_W && f.y >= 0 && f.y <= FIELD_H) addPose(f.x, f.y);
    return;
  }
  if (hit) {
    selected = hit.id;
    dragging = { pose: hit, ox: cx - toCanvas(hit.x, hit.y).x, oy: cy - toCanvas(hit.x, hit.y).y };
    canvas.style.cursor = 'grabbing';
    updateSidebar(); draw();
  } else {
    selected = null; updateSidebar(); draw();
  }
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  if (panning) { view.x = cx - panStart.x; view.y = cy - panStart.y; draw(); return; }
  if (dragging) {
    const f = toField(cx - dragging.ox, cy - dragging.oy);
    dragging.pose.x = Math.max(0, Math.min(FIELD_W, f.x));
    dragging.pose.y = Math.max(0, Math.min(FIELD_H, f.y));
    updateSidebar(); draw(); return;
  }
  if (mode !== 'pan') canvas.style.cursor = getPoseAt(cx, cy) ? 'grab' : 'crosshair';
});

canvas.addEventListener('mouseup', () => {
  dragging = null; panning = false;
  canvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const hit = getPoseAt(cx, cy, 24);
  if (hit) {
    hit.heading += e.deltaY * 0.008;
    updateSidebar(); draw();
  } else {
    const f = e.deltaY < 0 ? 1.1 : 0.91;
    view.x = cx + (view.x - cx) * f; view.y = cy + (view.y - cy) * f; view.scale *= f;
    draw();
  }
}, { passive: false });

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const hit = getPoseAt(e.clientX - rect.left, e.clientY - rect.top);
  if (hit) deletePose(hit.id);
});

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Delete' || e.key === 'Backspace') { if (selected !== null) deletePose(selected); }
  if (e.key === 'a') setMode('add');
  if (e.key === 's') setMode('select');
  if (e.key === 'p') setMode('pan');
  if (e.key === 'Escape') { selected = null; updateSidebar(); draw(); }
});

new ResizeObserver(resize).observe(wrap);
resize();
setTimeout(resetView, 50);
setPathMode('bezier');