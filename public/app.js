const P = window.TMDPhysics;
const $ = id => document.getElementById(id);
const fmt = (n, d = 2) => Number(n || 0).toFixed(d);

let labTower = P.createLabTower(Number($("towerHeightInput").value), Number($("towerMassInput").value) * 1e6);
let sim = null;
let compareSim = null;
let labTime = 0;
let labPaused = false;
let comparisonInitialized = false;
let currentRoom = null;
let currentStudent = null;
let events = null;
let cityStart = 0;
let lastCityStartedAt = 0;
let graphCursors = [];
let compareGraphCursors = [];
const graphWindows = [{ start: 0, end: 120 }, { start: 0, end: 120 }];

const RUN_DURATION = 120;
const EARTHQUAKE_DURATION = P.earthquakeDuration;
const EARTHQUAKE_STRENGTHS = P.earthquakeStrengths;
const HYDRAULIC_BODY_PX = P.hydraulicBodyPx;
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

function setGraphRange(start, end, comparison = false) {
  const runDuration = sim?.pulse?.runDuration || RUN_DURATION;
  const cleanStart = P.clamp(Number(start) || 0, 0, runDuration - 0.5);
  const cleanEnd = P.clamp(Number(end) || runDuration, cleanStart + 0.5, runDuration);
  graphWindows[comparison ? 1 : 0] = { start: cleanStart, end: cleanEnd };
  $(comparison ? "compareGraphStartInput" : "graphStartInput").value = fmt(cleanStart, 2);
  $(comparison ? "compareGraphEndInput" : "graphEndInput").value = fmt(cleanEnd, 2);
}

function graphRange(comparison = false) {
  const runDuration = sim?.pulse?.runDuration || RUN_DURATION;
  const window = graphWindows[comparison ? 1 : 0];
  const start = P.clamp(window.start, 0, runDuration - 0.5);
  const end = P.clamp(window.end, start + 0.5, runDuration);
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

function selectedEarthquakeAmplitude(groupId) {
  const strength = $(groupId).querySelector('button[aria-pressed="true"]').dataset.strength;
  return EARTHQUAKE_STRENGTHS[strength];
}

["earthquakeStrength", "roomStrength"].forEach(groupId => {
  const group = $(groupId);
  group.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-pressed") === "true") return;
      group.querySelectorAll("button").forEach(choice => {
        choice.setAttribute("aria-pressed", String(choice === button));
      });
      if (groupId === "earthquakeStrength") resetLab();
    });
  });
});

function pulseFromLab() {
  const difficulty = selectedDifficulty();
  return {
    amplitude: selectedEarthquakeAmplitude("earthquakeStrength"),
    duration: EARTHQUAKE_DURATION,
    difficulty: difficulty.mode,
    driftLimit: 1.2,
    dangerEnabled: difficulty.dangerEnabled,
    collapseSway: labTower.dangerSwayLimit ?? difficulty.collapseSway,
    collapseTime: difficulty.collapseTime,
    runDuration: RUN_DURATION
  };
}

function damperFromLab(comparison = false) {
  const ids = comparison ? ["compareDamperEnabled", "compareLengthInput", "compareMassInput", "compareDampingInput"] :
    ["damperEnabled", "lengthInput", "massInput", "dampingInput"];
  return P.clampDamper({
    enabled: $(ids[0]).checked,
    length: inputNumber(ids[1], 8.4),
    massRatio: inputNumber(ids[2], 3.5) / 100,
    damping: inputNumber(ids[3], 0.45),
    wallLimit: 2.7,
    restitution: 0.28,
    bobRadius: 0.3
  });
}

function makeRun(damper, pulse, baseline) {
  const state = P.initialState();
  return {
    tower: labTower,
    damper,
    pulse,
    state,
    baseline,
    samples: [P.sampleState(state, labTower, damper, pulse)],
    playing: false,
    energyScale: Math.max(4000, labTower.mass * 0.0012),
    lastClock: performance.now(),
    sampleClock: 0,
    peak: 0,
    lastAbove: pulse.duration,
    overLimitTime: 0,
    failed: false,
    failedAt: null,
    collapseAge: 0,
    failureCause: null,
    hitFlash: 0
  };
}

function makeSim() {
  const pulse = pulseFromLab();
  const baseline = P.simulate({ tower: labTower, damper: { enabled: false }, pulse, duration: pulse.runDuration, sampleDt: 0.05 });
  sim = makeRun(damperFromLab(), pulse, baseline);
  compareSim = $("compareEnabled").checked ? makeRun(damperFromLab(true), pulse, baseline) : null;
  labTime = 0;
  labPaused = false;
}

function labRuns() {
  return compareSim ? [compareSim, sim] : [sim];
}

function updateLabels() {
  $("labSwayLimit").textContent = fmt(labTower.dangerSwayLimit);
  [["dampingInput", "dampingSlider"], ["compareDampingInput", "compareDampingSlider"]].forEach(([inputId, sliderId]) => {
    const value = P.clamp(Number($(inputId).value), 0, 1);
    $(sliderId).value = value;
    $(sliderId).setAttribute("aria-valuetext", value === 1 ? "1.00, locked" : `${fmt(value, 2)}, resistance`);
  });
}

function applyTowerInputs() {
  normalizeNumberInput("towerHeightInput", 0);
  normalizeNumberInput("towerMassInput", 1);
  labTower = P.createLabTower(Number($("towerHeightInput").value), Number($("towerMassInput").value) * 1e6);
  updateLabels();
  resetLab();
}

function appendSample(run) {
  const sample = P.sampleState(run.state, run.tower, run.damper, run.pulse);
  run.samples.push(sample);
  if (run.samples.length > 3600) run.samples.shift();
  run.peak = Math.max(run.peak, Math.abs(sample.sway));
  if (sample.t > run.pulse.duration && Math.abs(sample.sway) > 0.06) run.lastAbove = sample.t;
}

function stepRun(run, dt) {
  if (run.failed) return;
  const previousT = run.state.t;
  const oldHeat = run.state.heat || 0;
  const oldHits = run.state.hits || 0;
  run.state = P.stepSimulation(run.state, dt, run.tower, run.damper, run.pulse);
  if ((run.state.heat || 0) < oldHeat) run.state.heat = oldHeat;
  const sample = P.sampleState(run.state, run.tower, run.damper, run.pulse);
  if (sample.hits > oldHits) run.hitFlash = 0.6;
  const dangerDt = Math.max(0, run.state.t - Math.max(previousT, run.pulse.duration));
  if (run.pulse.dangerEnabled !== false && Math.abs(sample.sway) > run.pulse.collapseSway) run.overLimitTime += dangerDt;
  if (sample.hits > 0 || P.dangerLimitReached(run.overLimitTime, run.pulse)) {
    run.failed = true;
    run.failedAt = run.state.t;
    run.failureCause = sample.hits > 0 ? "Collision — failed" : "Danger limit — failed";
    appendSample(run);
    return;
  }
  run.sampleClock += dt;
  if (run.sampleClock >= 0.04) {
    appendSample(run);
    run.sampleClock %= 0.04;
  }
}

function stepLive(dt) {
  const step = Math.min(Math.max(0, dt), sim.pulse.runDuration - labTime);
  if (step > 0) {
    labRuns().forEach(run => stepRun(run, step));
    labTime += step;
  }
  if (labTime >= sim.pulse.runDuration - 1e-9 || labRuns().every(run => run.failed)) sim.playing = false;
}

function strutHeatColor(energy, scale) {
  // Spread the warming over more energy, with a gentle start and a muted red.
  // This changes the visual cue only; simulated heat remains in joules.
  const u = 1 - Math.exp(-Math.max(0, energy) / (8 * Math.max(1, scale)));
  const warmth = u * u * (3 - 2 * u);
  const r = Math.round(109 + 81 * warmth);
  const g = Math.round(127 - 50 * warmth);
  const b = Math.round(139 - 69 * warmth);
  return `rgb(${r},${g},${b})`;
}

function drawHydraulicDamper(ctx, anchorX, anchorY, bobX, bobY, bobR, side, warmColor, mountSlope = 0) {
  const dx = bobX - anchorX;
  const dy = bobY - anchorY;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / dist;
  const uy = dy / dist;
  const mountDepth = 14;
  const cylinderLen = HYDRAULIC_BODY_PX; // Rigid housing; only the piston rod changes length.
  const rodEndX = bobX - ux * (bobR + 3);
  const rodEndY = bobY - uy * (bobR + 3);
  const cylinderEndX = anchorX + ux * cylinderLen;
  const cylinderEndY = anchorY + uy * cylinderLen;

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "#4f626d";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(anchorX + mountSlope * mountDepth, anchorY - mountDepth);
  ctx.lineTo(anchorX - mountSlope * mountDepth, anchorY + mountDepth);
  ctx.stroke();
  ctx.fillStyle = "#4f626d";
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = warmColor;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
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

function drawTowerSegment(ctx, baseX, roofX, towerWidth, bottom, top, y0, y1, failed = false, columnWidth = 5) {
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
  ctx.lineWidth = columnWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(left0, y0);
  ctx.lineTo(left1, y1);
  ctx.moveTo(right0, y0);
  ctx.lineTo(right1, y1);
  ctx.stroke();
  ctx.lineCap = "butt";
}

function drawStage(sample, run = sim, canvasId = "stage") {
  const canvas = $(canvasId);
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const scale = 44 * 3;
  const baseX = w / 2 + sample.y * scale;
  const rawRoofX = baseX + sample.sway * scale;
  const roofX = rawRoofX;
  const bottom = h - 44;
  const heightFraction = P.clamp((run.tower.height - P.labTowerLimits.minHeight) /
    (P.labTowerLimits.maxHeight - P.labTowerLimits.minHeight), 0, 1);
  const massFraction = P.clamp((run.tower.mass - P.labTowerLimits.minMass) /
    (P.labTowerLimits.maxMass - P.labTowerLimits.minMass), 0, 1);
  const top = 118 - 60 * heightFraction;
  const columnWidth = 4 + 4 * massFraction;
  const towerWidth = 216;
  const d = run.damper;

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

  const dangerEnabled = run.pulse.dangerEnabled !== false;
  if (!run.failed && dangerEnabled && $("showDangerInput").checked) {
    const dangerPx = (run.pulse.collapseSway ?? DANGER_SWAY) * scale;
    const leftLimit = baseX - towerWidth / 2 - dangerPx;
    const rightLimit = baseX + towerWidth / 2 + dangerPx;
    const zoneTop = 0;
    const zoneBottom = bottom;
    ctx.save();
    ctx.fillStyle = "rgba(185, 65, 47, .085)";
    const leftZoneEnd = P.clamp(leftLimit, 0, w);
    const rightZoneStart = P.clamp(rightLimit, 0, w);
    ctx.fillRect(0, zoneTop, leftZoneEnd, zoneBottom - zoneTop);
    ctx.fillRect(rightZoneStart, zoneTop, w - rightZoneStart, zoneBottom - zoneTop);
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
    const labelY = (zoneTop + zoneBottom) / 2;
    const textWidth = ctx.measureText("danger").width;
    [[0, leftZoneEnd], [rightZoneStart, w]].forEach(([start, end]) => {
      const size = Math.min(1, Math.max(0, end - start - 8) / textWidth);
      // Hide a label when its visible band is too narrow to contain readable text.
      if (size < 0.65) return;
      ctx.font = `bold ${12 * size}px system-ui`;
      const labelX = (start + end) / 2;
      ctx.fillText("danger", labelX, labelY - 7 * size);
      ctx.fillText("zone", labelX, labelY + 7 * size);
    });
    ctx.restore();
  }

  const impactHold = run.state.contact ? 0.45 : 0;
  const showContact = run.failed && run.collapseAge < impactHold;
  if (run.failed && !showContact) {
    const p = P.clamp((run.collapseAge - impactHold) / (2.2 - impactHold), 0, 1);
    const impact = Math.max(0, 1 - run.collapseAge / 0.45);
    const shakeX = Math.sin(run.collapseAge * 60) * 5 * impact;
    const shakeY = Math.cos(run.collapseAge * 47) * 3 * impact;
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
    ctx.lineWidth = columnWidth;
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

  drawTowerSegment(ctx, baseX, roofX, towerWidth, bottom, top, bottom, top, false, columnWidth);
  ctx.fillStyle = "#0f7b7e";
  ctx.save();
  ctx.shadowColor = "rgba(20, 33, 42, .20)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.roundRect(roofX - towerWidth / 2 - 10, top - 15, towerWidth + 20, 18, 3);
  ctx.fill();
  ctx.restore();

  if (d.enabled && (!run.failed || showContact)) {
    const pivotX = roofX;
    const pivotY = top + 2;
    const geometry = P.pendulumGeometry(run.tower, d, sample.sway);
    const Lpx = geometry.lengthPx;
    const bobR = geometry.bobRadiusPx;
    const drawTheta = sample.theta * P.pendulumAngleScale;
    const isLocked = d.damping >= 1;
    const showHydraulics = d.damping > 0.001 && !isLocked;
    const anchorY = geometry.anchorY;
    const leftAnchorX = pivotX + geometry.leftAnchorOffset;
    const rightAnchorX = pivotX + geometry.rightAnchorOffset;
    // Use the same column mounts and bob position as the contact detector.
    const drawOffset = Math.sin(drawTheta) * Lpx;
    const bobX = pivotX + drawOffset;
    const bobY = pivotY + Math.cos(drawTheta) * Lpx;
    const warmColor = strutHeatColor(sample.heat, run.energyScale);

    ctx.strokeStyle = "#1e2d36";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(bobX, bobY);
    ctx.stroke();

    if (showHydraulics || isLocked) {
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
        drawHydraulicDamper(ctx, leftAnchorX, anchorY, bobX, bobY, bobR, -1, warmColor, geometry.mountSlope);
        drawHydraulicDamper(ctx, rightAnchorX, anchorY, bobX, bobY, bobR, 1, warmColor, geometry.mountSlope);
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
    if (showContact) {
      const contact = run.state.contact;
      const contactX = pivotX + contact.x, contactY = contact.y;
      ctx.save();
      ctx.strokeStyle = "#c65621";
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(contactX + 7 * Math.cos(angle), contactY + 7 * Math.sin(angle));
        ctx.lineTo(contactX + 13 * Math.cos(angle), contactY + 13 * Math.sin(angle));
        ctx.stroke();
      }
      ctx.fillStyle = "#a74319";
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("IMPACT", contactX, contactY - 19);
      ctx.restore();
    }
  }
}

function graphSwayScale() {
  let maxY = 0.15;
  [sim, compareSim].forEach((run, index) => {
    if (!run) return;
    const { start, end } = graphRange(index === 1);
    run.samples.forEach(sample => {
      if (sample.t >= start && sample.t <= end) maxY = Math.max(maxY, Math.abs(sample.sway));
    });
    if (run.pulse.dangerEnabled !== false) maxY = Math.max(maxY, (run.pulse.collapseSway ?? 0.5) * 1.15);
  });
  return maxY;
}

function dangerTimeLabel(run) {
  if (run.pulse.dangerEnabled === false) return "";
  const limit = run.pulse.collapseTime ?? 3;
  // Display completed hundredths, so a running trial cannot show the limit
  // before its danger time actually reaches that limit.
  const time = Math.floor((Math.min(Math.max(0, run.overLimitTime), limit) + 1e-9) * 100) / 100;
  return `Danger time: ${fmt(time)} / ${fmt(limit)} s`;
}

function drawGraph(run = sim, comparison = false, maxY = graphSwayScale()) {
  const canvas = $(comparison ? "graphCompare" : "graph");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const traces = [{ run, color: comparison || !compareSim ? "#0f7b7e" : "#245e9b", dash: [] }];
  const plot = { left: 48, right: w - 18, top: 14, bottom: h - 36 };
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#f8fbfc";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "13px system-ui";
  ctx.strokeStyle = "#d2dde3";
  for (let i = 0; i < 5; i++) {
    const y = plot.top + i * (plot.bottom - plot.top) / 4;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
  }
  const { start: tMin, end: tMax } = graphRange(comparison);
  traces.forEach(trace => { trace.visible = trace.run.samples.filter(r => r.t >= tMin && r.t <= tMax); });
  const danger = run.pulse.collapseSway ?? 0.5;
  const dangerEnabled = run.pulse.dangerEnabled !== false;
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
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("danger zone", (plot.left + plot.right) / 2, Math.max(plot.top + 7, (plot.top + dangerTop) / 2));
    ctx.restore();
  }
  const xFor = t => plot.left + (t - tMin) / Math.max(0.5, tMax - tMin) * (plot.right - plot.left);
  traces.forEach(trace => {
    ctx.strokeStyle = trace.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(trace.dash);
    ctx.beginPath();
    trace.visible.forEach((r, i) => {
      if (i === 0) ctx.moveTo(xFor(r.t), yFor(r.sway));
      else ctx.lineTo(xFor(r.t), yFor(r.sway));
    });
    ctx.stroke();
    ctx.setLineDash([]);
    const end = trace.run.samples[trace.run.samples.length - 1];
    if (trace.run.failed && end.t >= tMin && end.t <= tMax) {
      ctx.fillStyle = trace.color;
      ctx.beginPath();
      ctx.arc(xFor(end.t), yFor(end.sway), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.fillStyle = "#425160";
  ctx.font = "13px system-ui";
  ctx.fillText(`${fmt(maxY)} m`, 6, plot.top + 4);
  ctx.fillText(`-${fmt(maxY)} m`, 6, plot.bottom);
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("sway", 6, (plot.top + plot.bottom) / 2);
  ctx.restore();
  if (run.failed) {
    ctx.fillStyle = "#b63030";
    ctx.fillText(run.failureCause, plot.left + 6, plot.top + 16);
  }

  const cursors = (comparison ? compareGraphCursors : graphCursors).filter(t => t >= tMin && t <= tMax);
  if (comparison) compareGraphCursors = cursors;
  else graphCursors = cursors;
  cursors.forEach((t, idx) => {
    const x = plot.left + (t - tMin) / Math.max(0.5, tMax - tMin) * (plot.right - plot.left);
    ctx.strokeStyle = idx === 0 ? "#b9412f" : "#c28b1c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillText(String(idx + 1), x + 4, plot.top + 16);
  });
  if (cursors.length === 2) {
    const dt = Math.abs(cursors[1] - cursors[0]);
    ctx.fillStyle = "#17212b";
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillText(`Δt = ${fmt(dt)} s`, (plot.left + plot.right) / 2, h - 12);
    ctx.restore();
  }
  const dangerLabel = dangerTimeLabel(run);
  if (dangerLabel) {
    ctx.save();
    ctx.font = "12px system-ui";
    const labelWidth = ctx.measureText(dangerLabel).width;
    const right = plot.right - 4;
    ctx.fillStyle = "rgba(248, 251, 252, .94)";
    ctx.beginPath();
    ctx.roundRect(right - labelWidth - 10, plot.top + 4, labelWidth + 10, 20, 4);
    ctx.fill();
    ctx.fillStyle = P.dangerLimitReached(run.overLimitTime, run.pulse) ? "#b63030" : "#425160";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(dangerLabel, right - 5, plot.top + 14);
    ctx.restore();
  }
}

function syncCompareLayout() {
  const comparing = !!compareSim;
  $("labSimulation").classList.toggle("compare-mode", comparing);
  $("compareTower").hidden = !comparing;
  $("tmdHeading").textContent = comparing ? "Tower B" : "Tower";
  $("stage").setAttribute("aria-label", comparing ? "Tower B motion" : "Tower motion");
  $("graph").setAttribute("aria-label", comparing ? "Tower B roof sway over time" : "Tower roof sway over time");
  $("graphStartInput").setAttribute("aria-label", `${comparing ? "Tower B" : "Tower"} graph start time in seconds`);
  $("graphEndInput").setAttribute("aria-label", `${comparing ? "Tower B" : "Tower"} graph end time in seconds`);
}

function renderRun(run, prefix, canvasId) {
  const sample = P.sampleState(run.state, run.tower, run.damper, run.pulse);
  // Failed towers stop integrating, but both foundations still share the clock.
  sample.y = P.baseMotion(labTime, run.pulse).y;
  sample.sway = sample.x - sample.y;
  drawStage(sample, run, canvasId);
  $(`${prefix}Failure`).textContent = run.failureCause || "";
  $(`${prefix}DangerTime`).textContent = dangerTimeLabel(run);
}

function renderLab() {
  renderRun(sim, "primary", "stage");
  if (compareSim) renderRun(compareSim, "compare", "stageCompare");
  const maxY = graphSwayScale();
  drawGraph(sim, false, maxY);
  if (compareSim) drawGraph(compareSim, true, maxY);
  $("earthquakeStatus").textContent = labRuns().every(run => run.failed) ? "Reset to try a new TMD design." : labTime === 0 ? "A brief earthquake shakes the ground for 3.0 seconds. Measure the tower's period after the ground stops." : labTime < sim.pulse.duration ? "Earthquake in progress: the ground is shaking." : "Ground stopped: measure the building's period now. Turn the TMD off to measure its natural period.";
  const dangerEnabled = sim.pulse.dangerEnabled !== false;
  const dangerToggle = $("showDangerInput");
  dangerToggle.disabled = !dangerEnabled;
  dangerToggle.title = dangerEnabled ? "" : "Easy mode has no danger zone.";
}

function resetLab() {
  updateLabels();
  graphCursors = [];
  compareGraphCursors = [];
  makeSim();
  syncCompareLayout();
  setGraphRange($("graphStartInput").value, $("graphEndInput").value);
  setGraphRange($("compareGraphStartInput").value, $("compareGraphEndInput").value, true);
  renderLab();
}

function animateLab(now) {
  if (!sim) resetLab();
  const elapsed = Math.max(0, Math.min(0.06, (now - sim.lastClock) / 1000));
  sim.lastClock = now;
  if (!labPaused) labRuns().forEach(run => {
    if (run.failed) run.collapseAge = Math.min(2.2, run.collapseAge + elapsed);
    run.hitFlash = Math.max(0, run.hitFlash - elapsed);
  });
  if (sim.playing) {
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
  $("roomState").innerHTML = `<strong>Room ${currentRoom.code}</strong><br>Phase: ${currentRoom.phase}<br>Mode: ${roomMode}<br>Earthquake: ${fmt(currentRoom.config.amplitude)} m for ${fmt(currentRoom.config.pulseDuration)} s<br>Students: ${currentRoom.students.length}`;
  $("studentState").textContent = `Room ${currentRoom.code}: ${currentRoom.phase}`;
  $("roster").querySelector("tbody").innerHTML = currentRoom.students.map(s => `<tr><td>${escapeHtml(s.nickname)}</td><td>${fmt(s.tower.period)} s</td><td>${s.submission ? "yes" : "no"}</td></tr>`).join("");
  if (!currentStudent) return;
  const latest = currentRoom.students.find(s => s.id === currentStudent.id);
  if (!latest) return;
  currentStudent = latest;
  const tuned = P.g * Math.pow(latest.tower.period / (2 * Math.PI), 2);
  $("studentTower").innerHTML = `<strong>${escapeHtml(latest.tower.name)}</strong><br>Height ${latest.tower.height} m; mass ${(latest.tower.mass / 1e6).toFixed(1)} million kg<br>Natural period ${fmt(latest.tower.period)} s; calculated length ${fmt(tuned)} m<br>Game sway limit ${fmt(latest.tower.dangerSwayLimit ?? DANGER_SWAY)} m<br>Submission: ${latest.submission ? `L ${fmt(latest.submission.length)} m, D ${fmt(latest.submission.damping)}` : "not submitted"}`;
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
  $("cityCaption").textContent = `Room ${currentRoom.code}: same earthquake for every tower.`;
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

  $("resultsTable").querySelector("tbody").innerHTML = (currentRoom.results || []).map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.nickname)}</td><td>${r.result.status}</td><td>${fmt(r.result.settleTime, 2)} s</td><td>${fmt(r.result.peakSway)} m</td><td>${r.result.hits}</td><td>${fmt(r.result.heat / 1000, 1)} kJ</td><td>L ${fmt(r.submission.length)} m, D ${fmt(r.submission.damping)}</td></tr>`).join("");
}

function animateCity() {
  if (currentRoom?.phase === "running") renderCity();
  requestAnimationFrame(animateCity);
}

["lengthInput", "massInput", "dampingInput", "damperEnabled",
  "compareLengthInput", "compareMassInput", "compareDampingInput", "compareDamperEnabled"].forEach(id => {
  $(id).addEventListener("input", () => {
    updateLabels();
    resetLab();
  });
});
[["dampingSlider", "dampingInput"], ["compareDampingSlider", "compareDampingInput"]].forEach(([sliderId, inputId]) => {
  $(sliderId).addEventListener("input", () => {
    $(inputId).value = fmt(Number($(sliderId).value), 2);
    resetLab();
  });
});
document.querySelectorAll('input[name="difficultyMode"]').forEach(input => {
  input.addEventListener("change", () => resetLab());
});
[
  ["lengthInput", 2],
  ["massInput", 1],
  ["dampingInput", 2],
  ["compareLengthInput", 2],
  ["compareMassInput", 1],
  ["compareDampingInput", 2]
].forEach(([id, digits]) => {
  $(id).addEventListener("change", () => {
    normalizeNumberInput(id, digits);
    updateLabels();
    resetLab();
  });
});
$("playBtn").addEventListener("click", () => {
  if (labTime >= sim.pulse.runDuration - 1e-9 || labRuns().every(run => run.failed)) resetLab();
  labPaused = false;
  sim.playing = true;
  sim.lastClock = performance.now();
});
$("pauseBtn").addEventListener("click", () => { sim.playing = false; labPaused = true; });
$("resetBtn").addEventListener("click", () => resetLab());
[
  { comparison: false, canvasId: "graph", prefix: "graph" },
  { comparison: true, canvasId: "graphCompare", prefix: "compareGraph" }
].forEach(({ comparison, canvasId, prefix }) => {
  const clearCursors = () => {
    if (comparison) compareGraphCursors = [];
    else graphCursors = [];
  };
  $(canvasId).addEventListener("click", event => {
    const run = comparison ? compareSim : sim;
    if (!run || run.samples.length < 2) return;
    const canvas = $(canvasId);
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * canvas.width;
    const { start: tMin, end: tMax } = graphRange(comparison);
    const left = 48;
    const right = canvas.width - 18;
    const t = tMin + P.clamp((x - left) / (right - left), 0, 1) * Math.max(0.5, tMax - tMin);
    let cursors = comparison ? compareGraphCursors : graphCursors;
    if (cursors.length >= 2) { clearCursors(); cursors = comparison ? compareGraphCursors : graphCursors; }
    cursors.push(t);
    renderLab();
  });
  ["StartInput", "EndInput"].forEach(suffix => $(prefix + suffix).addEventListener("change", () => {
    setGraphRange($(prefix + "StartInput").value, $(prefix + "EndInput").value, comparison);
    clearCursors();
    renderLab();
  }));
  ["StartInput", "EndInput"].forEach(suffix => {
    const input = $(prefix + suffix);
    input.addEventListener("focus", () => { input.dataset.previousValue = input.value; input.select(); });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
      if (event.key === "Escape") { input.value = input.dataset.previousValue; input.blur(); }
    });
  });
});
$("showDangerInput").addEventListener("change", () => renderLab());
$("compareEnabled").addEventListener("change", () => {
  if ($("compareEnabled").checked && !comparisonInitialized) {
    [["lengthInput", "compareLengthInput"], ["massInput", "compareMassInput"], ["dampingInput", "compareDampingInput"]]
      .forEach(([source, target]) => { $(target).value = $(source).value; });
    comparisonInitialized = true;
  }
  resetLab();
});
["towerHeightInput", "towerMassInput"].forEach(id => {
  $(id).addEventListener("change", applyTowerInputs);
});
$("randomTowerBtn").addEventListener("click", () => {
  const limits = P.labTowerLimits;
  $("towerHeightInput").value = Math.round(limits.minHeight + Math.random() * (limits.maxHeight - limits.minHeight));
  $("towerMassInput").value = fmt((limits.minMass + Math.random() * (limits.maxMass - limits.minMass)) / 1e6, 1);
  applyTowerInputs();
});

$("roomForm").addEventListener("submit", async event => {
  event.preventDefault();
  currentRoom = await api("/api/rooms", {
    seed: $("roomSeed").value,
    designMinutes: Number($("designMinutes").value),
    amplitude: selectedEarthquakeAmplitude("roomStrength"),
    pulseDuration: EARTHQUAKE_DURATION,
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
