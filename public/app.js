const P = window.TMDPhysics;
const $ = id => document.getElementById(id);
const fmt = (n, d = 2) => Number(n || 0).toFixed(d);

let labTower = P.generateTower("freshman-lab", 0);
let sim = null;
let currentRoom = null;
let currentStudent = null;
let events = null;
let cityStart = 0;
let lastCityStartedAt = 0;
let graphCursors = [];

const RUN_DURATION = 120;
const DANGER_SWAY = 0.2;
const DIFFICULTY = {
  easy: { label: "Easy", dangerEnabled: false, collapseSway: DANGER_SWAY, collapseTime: 3 },
  medium: { label: "Medium", dangerEnabled: true, collapseSway: DANGER_SWAY, collapseTime: 3 },
  hard: { label: "Hard", dangerEnabled: true, collapseSway: DANGER_SWAY, collapseTime: 2.5 }
};

function inputNumber(id, fallback = 0) {
  const el = $(id);
  const value = Number(el.value);
  const min = el.min === "" ? -Infinity : Number(el.min);
  const max = el.max === "" ? Infinity : Number(el.max);
  return P.clamp(Number.isFinite(value) ? value : fallback, min, max);
}

function normalizeNumberInput(id, digits = 2) {
  const el = $(id);
  el.value = fmt(inputNumber(id, Number(el.defaultValue) || 0), digits);
}

function setGraphRange(start, end) {
  const runDuration = sim?.pulse?.runDuration || RUN_DURATION;
  const cleanStart = P.clamp(Number(start) || 0, 0, runDuration - 0.5);
  const cleanEnd = P.clamp(Number(end) || 24, cleanStart + 0.5, runDuration);
  $("graphStartInput").value = fmt(cleanStart, 1);
  $("graphEndInput").value = fmt(cleanEnd, 1);
}

function graphRange() {
  const runDuration = sim?.pulse?.runDuration || RUN_DURATION;
  const start = P.clamp(Number($("graphStartInput").value) || 0, 0, runDuration - 0.5);
  const end = P.clamp(Number($("graphEndInput").value) || 24, start + 0.5, runDuration);
  return { start, end };
}

function setView(view) {
  document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === view));
  document.querySelectorAll(".tab").forEach(el => el.classList.toggle("active", el.dataset.view === view));
}
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));

function selectedDifficulty() {
  const selected = document.querySelector('input[name="difficultyMode"]:checked')?.value || "medium";
  return { mode: selected, ...DIFFICULTY[selected] };
}

function pulseFromLab() {
  const difficulty = selectedDifficulty();
  return {
    amplitude: inputNumber("ampInput", 0.34),
    duration: inputNumber("pulseInput", 1.8),
    difficulty: difficulty.mode,
    driftLimit: 1.2,
    dangerEnabled: difficulty.dangerEnabled,
    collapseSway: difficulty.collapseSway,
    collapseTime: difficulty.collapseTime,
    runDuration: RUN_DURATION
  };
}

function damperFromLab(enabled = $("damperEnabled").checked) {
  return P.clampDamper({
    enabled,
    length: inputNumber("lengthInput", 8.4),
    massRatio: inputNumber("massInput", 3.5) / 100,
    damping: inputNumber("dampingInput", 0.45),
    wallLimit: 2.7,
    restitution: 0.28,
    bobRadius: 0.3
  });
}

function makeSim() {
  const damper = damperFromLab();
  const pulse = pulseFromLab();
  sim = {
    tower: labTower,
    damper,
    pulse,
    state: P.initialState(),
    baseline: P.simulate({ tower: labTower, damper: { enabled: false }, pulse, duration: pulse.runDuration, sampleDt: 0.05 }),
    samples: [],
    playing: false,
    energyScale: Math.max(4000, labTower.mass * 0.0012),
    lastClock: performance.now(),
    sampleClock: 0,
    peak: 0,
    lastAbove: pulse.duration,
    overLimitTime: 0,
    failed: false,
    failedAt: null,
    collapseAge: 0
  };
  appendSample();
}

function updateLabels() {
  const predicted = P.g * Math.pow(labTower.period / (2 * Math.PI), 2);
  $("towerReadout").innerHTML = `
    <strong>${labTower.name}</strong><br>
    Height ${labTower.height} m; mass ${(labTower.mass / 1e6).toFixed(1)} million kg<br>
    Measure natural period from the free-motion peaks.<br>
    Reference after measuring: <button type="button" id="revealPeriodBtn">Reveal</button>
    <span id="periodSecret" hidden>${fmt(labTower.period)} s; tuned length ${fmt(predicted)} m</span>
  `;
  $("revealPeriodBtn").addEventListener("click", () => {
    $("periodSecret").hidden = false;
    $("revealPeriodBtn").disabled = true;
  });
}

function appendSample() {
  const sample = P.sampleState(sim.state, sim.tower, sim.damper, sim.pulse);
  sim.samples.push(sample);
  if (sim.samples.length > 3600) sim.samples.shift();
  sim.peak = Math.max(sim.peak, Math.abs(sample.sway));
  if (sample.t > sim.pulse.duration && Math.abs(sample.sway) > 0.06) sim.lastAbove = sample.t;
}

function stepLive(dt) {
  const previousT = sim.state.t;
  const oldHeat = sim.state.heat || 0;
  sim.state = P.stepSimulation(sim.state, dt, sim.tower, sim.damper, sim.pulse);
  if ((sim.state.heat || 0) < oldHeat) sim.state.heat = oldHeat;
  const sample = P.sampleState(sim.state, sim.tower, sim.damper, sim.pulse);
  const dangerEnabled = sim.pulse.dangerEnabled !== false;
  const dangerDt = Math.max(0, sim.state.t - Math.max(previousT, sim.pulse.duration));
  if (dangerEnabled && Math.abs(sample.sway) > sim.pulse.collapseSway) sim.overLimitTime += dangerDt;
  if (dangerEnabled && !sim.failed && sim.overLimitTime > sim.pulse.collapseTime) {
    sim.failed = true;
    sim.failedAt = sim.state.t;
    sim.playing = false;
    appendSample();
    return;
  }
  sim.sampleClock += dt;
  while (sim.sampleClock >= 0.04) {
    appendSample();
    sim.sampleClock -= 0.04;
  }
}

function measuredPeriod(samples) {
  const peaks = [];
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i].t > sim.pulse.duration && samples[i].sway > samples[i - 1].sway && samples[i].sway > samples[i + 1].sway && samples[i].sway > 0.04) peaks.push(samples[i].t);
  }
  if (peaks.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < Math.min(peaks.length, 5); i++) gaps.push(peaks[i] - peaks[i - 1]);
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}

function metric(label, value, hint = "") {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${hint}</small></div>`;
}

function strutHeatColor(energy, scale) {
  const u = P.clamp(energy / Math.max(1, scale), 0, 1);
  const r = Math.round(109 + 132 * u);
  const g = Math.round(127 - 54 * u);
  const b = Math.round(139 - 104 * u);
  return `rgb(${r},${g},${b})`;
}

function drawHydraulicDamper(ctx, anchorX, anchorY, bobX, bobY, bobR, side, warmColor) {
  const dx = bobX - anchorX;
  const dy = bobY - anchorY;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / dist;
  const uy = dy / dist;
  const mountDepth = 14;
  const cylinderLen = Math.min(44, Math.max(22, dist * 0.42));
  const rodEndX = bobX - ux * (bobR + 3);
  const rodEndY = bobY - uy * (bobR + 3);
  const cylinderEndX = anchorX + ux * cylinderLen;
  const cylinderEndY = anchorY + uy * cylinderLen;

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "#4f626d";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY - mountDepth);
  ctx.lineTo(anchorX, anchorY + mountDepth);
  ctx.stroke();
  ctx.fillStyle = "#4f626d";
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = warmColor;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(anchorX + side * 2, anchorY);
  ctx.lineTo(cylinderEndX, cylinderEndY);
  ctx.stroke();

  ctx.strokeStyle = "#a5b1b8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cylinderEndX, cylinderEndY);
  ctx.lineTo(rodEndX, rodEndY);
  ctx.stroke();
  ctx.restore();
}

function drawLockBrace(ctx, anchorX, anchorY, bobX, bobY, bobR) {
  const dx = bobX - anchorX;
  const dy = bobY - anchorY;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / dist;
  const uy = dy / dist;
  const endX = bobX - ux * (bobR + 4);
  const endY = bobY - uy * (bobR + 4);

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "#1e2d36";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  ctx.strokeStyle = "#7f9099";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(anchorX - 5, anchorY - 9);
  ctx.lineTo(anchorX + 5, anchorY + 9);
  ctx.moveTo(anchorX + 5, anchorY - 9);
  ctx.lineTo(anchorX - 5, anchorY + 9);
  ctx.stroke();

  ctx.fillStyle = "#1e2d36";
  ctx.beginPath();
  ctx.arc(endX, endY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function towerPoint(baseX, roofX, towerWidth, bottom, top, side, y) {
  const t = P.clamp((bottom - y) / (bottom - top), 0, 1);
  return baseX + (roofX - baseX) * t + side * towerWidth / 2;
}

function drawTowerSegment(ctx, baseX, roofX, towerWidth, bottom, top, y0, y1, failed = false) {
  const left0 = towerPoint(baseX, roofX, towerWidth, bottom, top, -1, y0);
  const right0 = towerPoint(baseX, roofX, towerWidth, bottom, top, 1, y0);
  const left1 = towerPoint(baseX, roofX, towerWidth, bottom, top, -1, y1);
  const right1 = towerPoint(baseX, roofX, towerWidth, bottom, top, 1, y1);
  const minX = Math.min(left0, right0, left1, right1);
  const maxX = Math.max(left0, right0, left1, right1);
  const glass = ctx.createLinearGradient(minX, 0, maxX, 0);
  if (failed) {
    glass.addColorStop(0, "#ead5cf");
    glass.addColorStop(0.5, "#f7ece8");
    glass.addColorStop(1, "#dfc6bf");
  } else {
    glass.addColorStop(0, "#dbe9ee");
    glass.addColorStop(0.26, "#fbfefe");
    glass.addColorStop(0.68, "#eff7f9");
    glass.addColorStop(1, "#cbdde5");
  }
  ctx.save();
  ctx.shadowColor = "rgba(20, 33, 42, .16)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.moveTo(left0, y0);
  ctx.lineTo(right0, y0);
  ctx.lineTo(right1, y1);
  ctx.lineTo(left1, y1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = failed ? "#723a37" : "#1e2d36";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(left0, y0);
  ctx.lineTo(left1, y1);
  ctx.moveTo(right0, y0);
  ctx.lineTo(right1, y1);
  ctx.stroke();
  ctx.lineCap = "butt";
}

function drawStage(sample) {
  const canvas = $("stage");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const scale = 44 * 3;
  const baseX = w / 2 + sample.y * scale;
  const rawRoofX = baseX + sample.sway * scale;
  const roofX = rawRoofX;
  const bottom = h - 44;
  const top = 58;
  const towerWidth = 216;
  const d = sim.damper;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#e8f2f5");
  sky.addColorStop(0.58, "#f8fbfc");
  sky.addColorStop(1, "#f2f7f8");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#dfe9ee";
  ctx.fillRect(0, h - 54, w, 54);
  ctx.fillStyle = "#cbdbe2";
  ctx.fillRect(0, h - 54, w, 5);
  ctx.strokeStyle = "#8aa1ad";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h - 54);
  ctx.lineTo(w, h - 54);
  ctx.stroke();

  ctx.fillStyle = "rgba(42, 68, 82, .10)";
  ctx.beginPath();
  ctx.ellipse(baseX, bottom + 2, 152, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#cedee5";
  ctx.roundRect(baseX - 138, bottom - 8, 276, 12, 3);
  ctx.fill();

  const dangerEnabled = sim.pulse.dangerEnabled !== false;
  if (!sim.failed && dangerEnabled && $("showDangerInput").checked) {
    const dangerPx = (sim.pulse.collapseSway ?? DANGER_SWAY) * scale;
    const leftLimit = baseX - towerWidth / 2 - dangerPx;
    const rightLimit = baseX + towerWidth / 2 + dangerPx;
    const zoneTop = 0;
    const zoneBottom = bottom;
    ctx.save();
    ctx.fillStyle = "rgba(185, 65, 47, .085)";
    ctx.fillRect(0, zoneTop, Math.max(0, leftLimit), zoneBottom - zoneTop);
    ctx.fillRect(rightLimit, zoneTop, Math.max(0, w - rightLimit), zoneBottom - zoneTop);
    ctx.strokeStyle = "rgba(185, 65, 47, .72)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(leftLimit, zoneTop);
    ctx.lineTo(leftLimit, zoneBottom);
    ctx.moveTo(rightLimit, zoneTop);
    ctx.lineTo(rightLimit, zoneBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#9a352b";
    ctx.font = "bold 12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelY = top + 130;
    const leftLabelX = Math.max(42, leftLimit / 2);
    const rightLabelX = Math.min(w - 42, rightLimit + (w - rightLimit) / 2);
    ctx.fillText("danger", leftLabelX, labelY - 7);
    ctx.fillText("zone", leftLabelX, labelY + 7);
    ctx.fillText("danger", rightLabelX, labelY - 7);
    ctx.fillText("zone", rightLabelX, labelY + 7);
    ctx.restore();
  }

  if (sim.failed) {
    const p = P.clamp(sim.collapseAge / 2.2, 0, 1);
    const impact = Math.max(0, 1 - sim.collapseAge / 0.45);
    const shakeX = Math.sin(sim.collapseAge * 60) * 5 * impact;
    const shakeY = Math.cos(sim.collapseAge * 47) * 3 * impact;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    if (impact > 0) {
      ctx.fillStyle = `rgba(185, 65, 47, ${0.10 * impact})`;
      ctx.fillRect(-10, -10, w + 20, h + 20);
    }
    const collapsedTop = top + (bottom - top) * (0.52 * p);
    const lean = 70 * p;
    const buckle = 24 * Math.sin(p * Math.PI);
    const leftBase = baseX - towerWidth / 2;
    const rightBase = baseX + towerWidth / 2;
    const leftTop = roofX - towerWidth / 2 + lean - buckle;
    const rightTop = roofX + towerWidth / 2 + lean + buckle * 0.4;

    const crumple = ctx.createLinearGradient(leftTop, 0, rightTop, 0);
    crumple.addColorStop(0, "#e8d3cd");
    crumple.addColorStop(0.55, "#f8ebe7");
    crumple.addColorStop(1, "#dcc1ba");
    ctx.save();
    ctx.shadowColor = "rgba(20, 33, 42, .18)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = crumple;
    ctx.beginPath();
    ctx.moveTo(leftBase, bottom);
    ctx.lineTo(rightBase, bottom);
    ctx.lineTo(rightTop, collapsedTop);
    ctx.lineTo(leftTop, collapsedTop + 18 * p);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "#723a37";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(leftBase, bottom);
    ctx.quadraticCurveTo(leftBase - 18 * p, (bottom + collapsedTop) / 2, leftTop, collapsedTop + 18 * p);
    ctx.moveTo(rightBase, bottom);
    ctx.quadraticCurveTo(rightBase + 14 * p, (bottom + collapsedTop) / 2, rightTop, collapsedTop);
    ctx.stroke();

    ctx.strokeStyle = "rgba(114, 58, 55, .35)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const y = bottom - (bottom - collapsedTop) * (i + 1) / 5;
      ctx.beginPath();
      ctx.moveTo(leftBase + 26 + i * 8, y + Math.sin(i + p * 4) * 8);
      ctx.lineTo(rightBase - 26 + i * 4, y - 10 + Math.cos(i + p * 3) * 8);
      ctx.stroke();
    }
    ctx.lineCap = "butt";

    ctx.fillStyle = "#8b3e3e";
    ctx.save();
    ctx.translate((leftTop + rightTop) / 2, collapsedTop - 11);
    ctx.rotate(0.09 + 0.18 * p);
    ctx.roundRect(-towerWidth / 2 - 10, -9, towerWidth + 20, 18, 3);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(114, 58, 55, .65)";
    for (let i = 0; i < 9; i++) {
      const t = P.clamp((p * 1.25) - i * 0.045, 0, 1);
      const sx = baseX - 95 + i * 24 + Math.sin(i * 1.9) * 14;
      const sy = collapsedTop + 10 + t * (bottom - collapsedTop - 18) + Math.sin(t * Math.PI) * 18;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-0.8 + i * 0.27 + t * 1.2);
      ctx.fillRect(-10, -2, 20 + (i % 3) * 6, 4);
      ctx.restore();
    }

    ctx.fillStyle = `rgba(118, 95, 84, ${0.30 * (1 - p * 0.22)})`;
    for (let i = 0; i < 13; i++) {
      const spread = 1 + p * 0.9;
      const px = baseX - 145 * spread + i * 24 * spread + Math.sin(i * 2.1) * 15;
      const py = bottom + 3 - Math.sin(p * Math.PI) * (12 + i % 3 * 7);
      ctx.beginPath();
      ctx.arc(px, py, 9 + (i % 4) * 5 + p * 18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = `rgba(118, 95, 84, ${0.35 * (1 - p)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(baseX, bottom + 6, 48 + p * 165, 8 + p * 30, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#723a37";
    ctx.font = "bold 20px system-ui";
    ctx.fillText("FAILED", 22, 36);
    ctx.restore();
    return;
  }

  drawTowerSegment(ctx, baseX, roofX, towerWidth, bottom, top, bottom, top, false);
  ctx.fillStyle = "#0f7b7e";
  ctx.save();
  ctx.shadowColor = "rgba(20, 33, 42, .20)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.roundRect(roofX - towerWidth / 2 - 10, top - 15, towerWidth + 20, 18, 3);
  ctx.fill();
  ctx.restore();

  if (d.enabled && !sim.failed) {
    const pivotX = roofX;
    const pivotY = top + 2;
    const Lpx = P.clamp(d.length * 13, 45, 190);
    const bobR = P.clamp(9 + d.massRatio * 190, 11, 23);
    const drawTheta = P.clamp(sample.theta * 3.35, -1.05, 1.05);
    const maxBobOffset = towerWidth / 2 - bobR - 12;
    const drawOffset = P.clamp(Math.sin(drawTheta) * Lpx, -maxBobOffset, maxBobOffset);
    const bobX = pivotX + drawOffset;
    const bobY = pivotY + Math.sqrt(Math.max(0, Lpx * Lpx - drawOffset * drawOffset));
    const warmColor = strutHeatColor(sample.heat, sim.energyScale);
    const isLocked = d.damping >= 0.999;
    const showHydraulics = d.damping > 0.001 && !isLocked;

    ctx.strokeStyle = "#1e2d36";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(bobX, bobY);
    ctx.stroke();

    if (showHydraulics || isLocked) {
      const wallOffset = towerWidth / 2 - 12;
      const anchorDrop = Math.sqrt(Math.max(0, Lpx * Lpx - wallOffset * wallOffset));
      const anchorY = P.clamp(pivotY + anchorDrop, top + 60, bottom - 42);
      const leftAnchorX = towerPoint(baseX, roofX, towerWidth, bottom, top, -1, anchorY) + 4;
      const rightAnchorX = towerPoint(baseX, roofX, towerWidth, bottom, top, 1, anchorY) - 4;
      if (isLocked) {
        drawLockBrace(ctx, leftAnchorX, anchorY, bobX, bobY, bobR);
        drawLockBrace(ctx, rightAnchorX, anchorY, bobX, bobY, bobR);
        ctx.save();
        ctx.fillStyle = "#1e2d36";
        ctx.font = "bold 11px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("LOCKED", pivotX, anchorY - 10);
        ctx.restore();
      } else {
        drawHydraulicDamper(ctx, leftAnchorX, anchorY, bobX, bobY, bobR, -1, warmColor);
        drawHydraulicDamper(ctx, rightAnchorX, anchorY, bobX, bobY, bobR, 1, warmColor);
      }
    }

    const bobGradient = ctx.createRadialGradient(bobX - bobR * 0.35, bobY - bobR * 0.45, bobR * 0.2, bobX, bobY, bobR);
    bobGradient.addColorStop(0, "#f2c46d");
    bobGradient.addColorStop(0.68, "#9b6b18");
    bobGradient.addColorStop(1, "#5d3f0d");
    ctx.fillStyle = bobGradient;
    ctx.shadowColor = "rgba(20, 33, 42, .22)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.arc(bobX, bobY, bobR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
  }
}

function drawGraph() {
  const canvas = $("graph");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const rows = sim.samples;
  const plot = { left: 48, right: w - 18, top: 28, bottom: h - 44 };
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#f8fbfc";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#d2dde3";
  for (let i = 0; i < 5; i++) {
    const y = plot.top + i * (plot.bottom - plot.top) / 4;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
  }
  if (rows.length < 2) return;
  const { start: tMin, end: tMax } = graphRange();
  const visible = rows.filter(r => r.t >= tMin && r.t <= tMax);
  const danger = sim.pulse.collapseSway ?? 0.5;
  const dangerEnabled = sim.pulse.dangerEnabled !== false;
  let maxY = 0.15;
  visible.forEach(r => { maxY = Math.max(maxY, Math.abs(r.sway)); });
  if (dangerEnabled) maxY = Math.max(maxY, danger * 1.15);
  const yFor = value => (plot.top + plot.bottom) / 2 - value / maxY * ((plot.bottom - plot.top) * 0.45);
  if (dangerEnabled) {
    const dangerTop = yFor(danger);
    const dangerBottom = yFor(-danger);
    ctx.fillStyle = "rgba(185, 65, 47, .08)";
    ctx.fillRect(plot.left, plot.top, plot.right - plot.left, Math.max(0, dangerTop - plot.top));
    ctx.fillRect(plot.left, dangerBottom, plot.right - plot.left, Math.max(0, plot.bottom - dangerBottom));
    ctx.strokeStyle = "rgba(185, 65, 47, .38)";
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(plot.left, dangerTop);
    ctx.lineTo(plot.right, dangerTop);
    ctx.moveTo(plot.left, dangerBottom);
    ctx.lineTo(plot.right, dangerBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#b9412f";
    ctx.fillText("danger zone", plot.right - 92, dangerTop - 6);
  }
  ctx.strokeStyle = "#0f7b7e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  visible.forEach((r, i) => {
    const x = plot.left + (r.t - tMin) / Math.max(0.5, tMax - tMin) * (plot.right - plot.left);
    const y = yFor(r.sway);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = "#425160";
  ctx.font = "13px system-ui";
  ctx.fillText("roof sway relative to foundation", plot.left, 18);
  ctx.fillText(`${fmt(maxY)} m`, 6, plot.top + 4);
  ctx.fillText(`-${fmt(maxY)} m`, 6, plot.bottom);
  ctx.fillText(`${fmt(tMin, 1)} s`, plot.left, h - 16);
  ctx.fillText(`${fmt(tMax, 1)} s`, plot.right - 46, h - 16);

  graphCursors = graphCursors.filter(t => t >= tMin && t <= tMax);
  graphCursors.forEach((t, idx) => {
    const x = plot.left + (t - tMin) / Math.max(0.5, tMax - tMin) * (plot.right - plot.left);
    ctx.strokeStyle = idx === 0 ? "#b9412f" : "#c28b1c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillText(idx === 0 ? "A" : "B", x + 4, plot.top + 16);
  });
  if (graphCursors.length === 2) {
    const dt = Math.abs(graphCursors[1] - graphCursors[0]);
    ctx.fillStyle = "#17212b";
    ctx.fillText(`A-B = ${fmt(dt)} s`, plot.left + 120, 18);
  } else {
    ctx.fillStyle = "#5f6f7f";
    ctx.fillText("click graph to place A/B period cursors", plot.left + 205, 18);
  }
}

function renderLab() {
  const sample = P.sampleState(sim.state, sim.tower, sim.damper, sim.pulse);
  drawStage(sample);
  drawGraph();
  const measured = measuredPeriod(sim.samples);
  const dangerEnabled = sim.pulse.dangerEnabled !== false;
  const dangerText = dangerEnabled ? `${fmt(sim.overLimitTime, 1)} / ${fmt(sim.pulse.collapseTime, 1)} s` : "Off";
  $("metrics").innerHTML = [
    metric("Time", `${fmt(sample.t, 1)} s`),
    metric("Danger", dangerText),
    metric("Thermal energy", `${fmt(sample.heat / 1000, 1)} kJ`),
    metric(sim.failed ? "Status" : "Hits", sim.failed ? "Failed" : `${sample.hits}`)
  ].join("");
}

function resetLab() {
  graphCursors = [];
  makeSim();
  setGraphRange($("graphStartInput").value, $("graphEndInput").value);
  renderLab();
}

function animateLab(now) {
  if (!sim) resetLab();
  const elapsed = Math.min(0.06, (now - sim.lastClock) / 1000);
  sim.lastClock = now;
  if (sim.failed) {
    sim.collapseAge += elapsed;
  } else if (sim.playing && sim.state.t < sim.pulse.runDuration) {
    stepLive(elapsed);
  }
  renderLab();
  requestAnimationFrame(animateLab);
}

async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function connectRoom(code) {
  if (events) events.close();
  events = new EventSource(`/events/${code}`);
  events.onmessage = event => {
    currentRoom = JSON.parse(event.data);
    renderRoom();
    renderCity();
  };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function renderRoom() {
  if (!currentRoom) return;
  const roomMode = DIFFICULTY[currentRoom.config.difficulty]?.label || "Medium";
  $("roomState").innerHTML = `<strong>Room ${currentRoom.code}</strong><br>Phase: ${currentRoom.phase}<br>Mode: ${roomMode}<br>Pulse: ${fmt(currentRoom.config.amplitude)} m for ${fmt(currentRoom.config.pulseDuration)} s<br>Students: ${currentRoom.students.length}`;
  $("studentState").textContent = `Room ${currentRoom.code}: ${currentRoom.phase}`;
  $("roster").querySelector("tbody").innerHTML = currentRoom.students.map(s => `<tr><td>${escapeHtml(s.nickname)}</td><td>${fmt(s.tower.period)} s</td><td>${s.submission ? "yes" : "no"}</td></tr>`).join("");
  if (!currentStudent) return;
  const latest = currentRoom.students.find(s => s.id === currentStudent.id);
  if (!latest) return;
  currentStudent = latest;
  const tuned = P.g * Math.pow(latest.tower.period / (2 * Math.PI), 2);
  $("studentTower").innerHTML = `<strong>${escapeHtml(latest.tower.name)}</strong><br>Height ${latest.tower.height} m; mass ${(latest.tower.mass / 1e6).toFixed(1)} million kg<br>Natural period ${fmt(latest.tower.period)} s; calculated length ${fmt(tuned)} m<br>Submission: ${latest.submission ? `L ${fmt(latest.submission.length)} m, D ${fmt(latest.submission.damping)}` : "not submitted"}`;
  if (!$("submitLength").value) {
    const d = P.defaultDamperFor(latest.tower);
    $("submitLength").value = fmt(d.length);
    $("submitMass").value = fmt(d.massRatio, 3);
    $("submitDamping").value = fmt(d.damping, 2);
  }
}

function renderCity() {
  const canvas = $("cityCanvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#eef3f5";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#cad7dd";
  ctx.fillRect(0, h - 46, w, 46);
  if (!currentRoom) return;
  const students = currentRoom.students.slice(0, 24);
  const pulse = currentRoom.quake;
  if (pulse?.startedAt && currentRoom.phase === "running" && pulse.startedAt !== lastCityStartedAt) {
    cityStart = performance.now() - Math.max(0, Date.now() - pulse.startedAt);
    lastCityStartedAt = pulse.startedAt;
  }
  $("cityCaption").textContent = `Room ${currentRoom.code}: same pulse for every tower.`;
  $("quakeBadge").textContent = pulse ? `${DIFFICULTY[pulse.difficulty]?.label || "Medium"}: ${fmt(pulse.amplitude)} m` : "Waiting";
  const t = currentRoom.phase === "running" ? ((performance.now() - cityStart) / 1000) % (pulse?.runDuration || RUN_DURATION) : 0;
  const cell = w / Math.max(1, students.length);
  students.forEach((s, i) => {
    const result = s.result;
    const idx = result?.samples?.length ? Math.min(result.samples.length - 1, Math.floor(t / 0.05)) : 0;
    const sample = result?.samples?.[idx] || { sway: 0, theta: 0 };
    const cx = cell * i + cell / 2;
    const height = 120 + (s.tower.height - 170) / 180 * 180;
    const width = Math.max(24, Math.min(48, cell * 0.5));
    const amp = P.clamp(sample.sway * 32, -34, 34);
    ctx.save();
    ctx.translate(cx, h - 48);
    if (result?.status === "failed") ctx.rotate(0.18);
    ctx.fillStyle = result?.status === "failed" ? "#8b3e3e" : result?.status === "damaged" ? "#b77200" : "#516a78";
    ctx.beginPath();
    ctx.moveTo(-width / 2, 0);
    ctx.lineTo(width / 2, 0);
    ctx.lineTo(width / 2 + amp, -height);
    ctx.lineTo(-width / 2 + amp, -height);
    ctx.closePath();
    ctx.fill();
    if (s.submission?.enabled) {
      const pivotX = amp;
      const pivotY = -height + 25;
      const rod = Math.max(24, Math.min(58, s.submission.length * 4));
      const bobX = pivotX + Math.sin(sample.theta) * rod;
      const bobY = pivotY + Math.cos(sample.theta) * rod;
      ctx.strokeStyle = "#111820";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pivotX, pivotY);
      ctx.lineTo(bobX, bobY);
      ctx.stroke();
      ctx.fillStyle = "#d2a12a";
      ctx.beginPath();
      ctx.arc(bobX, bobY, Math.max(4, width * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "#17212b";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(s.nickname.slice(0, 12), cx, h - 14);
  });

  $("resultsTable").querySelector("tbody").innerHTML = (currentRoom.results || []).map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.nickname)}</td><td>${r.result.status}</td><td>${fmt(r.result.settleTime, 1)} s</td><td>${fmt(r.result.peakSway)} m</td><td>${r.result.hits}</td><td>${fmt(r.result.heat / 1000, 1)} kJ</td><td>L ${fmt(r.submission.length)} m, D ${fmt(r.submission.damping)}</td></tr>`).join("");
}

function animateCity() {
  if (currentRoom?.phase === "running") renderCity();
  requestAnimationFrame(animateCity);
}

["ampInput", "pulseInput", "lengthInput", "massInput", "dampingInput", "damperEnabled"].forEach(id => {
  $(id).addEventListener("input", () => {
    updateLabels();
    resetLab();
  });
});
document.querySelectorAll('input[name="difficultyMode"]').forEach(input => {
  input.addEventListener("change", () => resetLab());
});
[
  ["ampInput", 2],
  ["pulseInput", 1],
  ["lengthInput", 2],
  ["massInput", 1],
  ["dampingInput", 2]
].forEach(([id, digits]) => {
  $(id).addEventListener("change", () => {
    normalizeNumberInput(id, digits);
    updateLabels();
    resetLab();
  });
});
$("playBtn").addEventListener("click", () => {
  sim.playing = true;
  sim.lastClock = performance.now();
});
$("pauseBtn").addEventListener("click", () => { sim.playing = false; });
$("resetBtn").addEventListener("click", () => resetLab());
$("graph").addEventListener("click", event => {
  if (!sim || sim.samples.length < 2) return;
  const rect = $("graph").getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * $("graph").width;
  const { start: tMin, end: tMax } = graphRange();
  const left = 48;
  const right = $("graph").width - 18;
  const t = tMin + P.clamp((x - left) / (right - left), 0, 1) * Math.max(0.5, tMax - tMin);
  if (graphCursors.length >= 2) graphCursors = [];
  graphCursors.push(t);
  renderLab();
});
$("graphStartInput").addEventListener("change", () => {
  setGraphRange($("graphStartInput").value, $("graphEndInput").value);
  graphCursors = [];
  renderLab();
});
$("graphEndInput").addEventListener("change", () => {
  setGraphRange($("graphStartInput").value, $("graphEndInput").value);
  graphCursors = [];
  renderLab();
});
$("graphLatestBtn").addEventListener("click", () => {
  const width = graphRange().end - graphRange().start;
  const end = Math.min(sim.pulse.runDuration, Math.max(width, sim.state.t));
  setGraphRange(end - width, end);
  graphCursors = [];
  renderLab();
});
$("graphFullBtn").addEventListener("click", () => {
  setGraphRange(0, sim.pulse.runDuration);
  graphCursors = [];
  renderLab();
});
$("showDangerInput").addEventListener("change", () => renderLab());
$("newTowerBtn").addEventListener("click", () => {
  labTower = P.generateTower($("seedInput").value || "freshman-lab", Math.floor(Math.random() * 1000));
  const d = P.defaultDamperFor(labTower);
  $("lengthInput").value = fmt(d.length);
  $("massInput").value = fmt(d.massRatio * 100, 1);
  $("dampingInput").value = fmt(d.damping, 2);
  graphCursors = [];
  updateLabels();
  resetLab();
});

$("roomForm").addEventListener("submit", async event => {
  event.preventDefault();
  currentRoom = await api("/api/rooms", {
    seed: $("roomSeed").value,
    designMinutes: Number($("designMinutes").value),
    amplitude: Number($("roomAmp").value),
    pulseDuration: Number($("roomPulse").value),
    difficulty: $("roomDifficulty").value,
    runDuration: Number($("roomRunDuration").value),
    driftLimit: Number($("driftLimit").value)
  });
  connectRoom(currentRoom.code);
  setView("teacher");
});

$("joinForm").addEventListener("submit", async event => {
  event.preventDefault();
  const code = $("studentRoom").value.trim().toUpperCase();
  const key = `tmd-token-${code}`;
  const token = localStorage.getItem(key) || P.makeId("tok");
  const data = await api(`/api/rooms/${code}/join`, { nickname: $("nickname").value, token });
  localStorage.setItem(key, data.token);
  currentStudent = data.student;
  currentRoom = data.room;
  connectRoom(code);
  renderRoom();
});

$("submitForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentRoom || !currentStudent) return;
  const data = await api(`/api/rooms/${currentRoom.code}/submit`, {
    token: localStorage.getItem(`tmd-token-${currentRoom.code}`),
    submission: {
      enabled: true,
      length: Number($("submitLength").value),
      massRatio: Number($("submitMass").value),
      damping: Number($("submitDamping").value),
      wallLimit: 2.7
    }
  });
  currentRoom = data.room;
  renderRoom();
});

$("lockBtn").addEventListener("click", async () => {
  if (!currentRoom) return;
  currentRoom = await api(`/api/rooms/${currentRoom.code}/lock`);
  renderRoom();
});
$("startBtn").addEventListener("click", async () => {
  if (!currentRoom) return;
  currentRoom = await api(`/api/rooms/${currentRoom.code}/start`);
  cityStart = currentRoom.quake?.startedAt ? performance.now() - Math.max(0, Date.now() - currentRoom.quake.startedAt) : performance.now();
  setView("city");
  renderRoom();
  renderCity();
});
$("replayBtn").addEventListener("click", async () => {
  if (!currentRoom) return;
  currentRoom = await api(`/api/rooms/${currentRoom.code}/replay`);
  cityStart = currentRoom.quake?.startedAt ? performance.now() - Math.max(0, Date.now() - currentRoom.quake.startedAt) : performance.now();
  setView("city");
});

updateLabels();
resetLab();
requestAnimationFrame(animateLab);
animateCity();
