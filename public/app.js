const P = window.TMDPhysics;
const $ = id => document.getElementById(id);
const fmt = (n, d = 2) => Number(n || 0).toFixed(d);

let labTower = P.createLabTower(Number($("towerHeightInput").value), Number($("towerMassInput").value) * 1e6);
let sim = null;
let compareSim = null;
let labTime = 0;
let labAccumulator = 0;
let labPaused = false;
let comparisonInitialized = false;
let currentRoom = null;
let currentStudent = null;
let events = null;
let teacherUnlocked = false;
let creatingRoom = false;
let openingTeacherRoom = false;
let listedTeacherRoom = "";
let checkingTeacherRooms = null;
const savedRoomLoads = new Map();
let startingQuake = false;
let cityStart = 0;
let lastCityStartedAt = 0;
let lastStudentQuake = "";
let quakeAudio = null;
let quakeSoundEnabled = true;
let lastQuakeSoundAt = 0;
let quakeSoundNodes = [];

function prepareQuakeAudio() {
  if (!quakeSoundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!quakeAudio) quakeAudio = new AudioContext();
    if (quakeAudio.state === "suspended") quakeAudio.resume().catch(() => {});
  } catch (_) { /* Audio support does not affect the earthquake sequence. */ }
}

function stopQuakeSound() {
  quakeSoundNodes.forEach(node => { try { node.stop(); } catch (_) {} });
  quakeSoundNodes = [];
}

function playQuakeWarning(startedAt) {
  if (!quakeSoundEnabled || !quakeAudio || quakeAudio.state !== "running" || lastQuakeSoundAt === startedAt) return;
  lastQuakeSoundAt = startedAt;
  stopQuakeSound();
  // Three soft rising/falling siren calls, synthesized locally without audio files.
  for (let i = 0; i < 3; i++) {
    const start = quakeAudio.currentTime + i * 0.7;
    const oscillator = quakeAudio.createOscillator();
    const gain = quakeAudio.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(440, start);
    oscillator.frequency.exponentialRampToValueAtTime(880, start + 0.25);
    oscillator.frequency.exponentialRampToValueAtTime(440, start + 0.55);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.04);
    gain.gain.setValueAtTime(0.12, start + 0.45);
    gain.gain.linearRampToValueAtTime(0, start + 0.6);
    oscillator.connect(gain);
    gain.connect(quakeAudio.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + 0.61);
    quakeSoundNodes.push(oscillator);
  }
}
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
  const requested = view;
  if (view === "teacher" && !teacherUnlocked) view = "teacherLogin";
  document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === view));
  document.querySelectorAll(".tab").forEach(el => el.classList.toggle("active", el.dataset.view === requested));
}
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));

function selectedDifficulty() {
  const selected = document.querySelector('input[name="difficultyMode"]:checked')?.value || "easy";
  return { mode: selected, ...DIFFICULTY[selected] };
}

function selectedEarthquakeAmplitude(groupId) {
  const strength = $(groupId).querySelector('button[aria-pressed="true"]').dataset.strength;
  return EARTHQUAKE_STRENGTHS[strength];
}

["earthquakeStrength"].forEach(groupId => {
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
    damping: inputNumber(ids[3], 0),
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
  labAccumulator = 0;
  labPaused = false;
}

function labRuns() {
  return compareSim ? [compareSim, sim] : [sim];
}

function updateLabels() {
  for (const [toggle, fields] of [
    ["damperEnabled", ["lengthInput", "massInput", "dampingInput", "dampingSlider"]],
    ["compareDamperEnabled", ["compareLengthInput", "compareMassInput", "compareDampingInput", "compareDampingSlider"]]
  ]) {
    for (const id of fields) $(id).disabled = !$(toggle).checked;
  }
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
  const oldHeat = run.state.heat || 0;
  const oldHits = run.state.hits || 0;
  const trial = P.advanceTrial(run.state, dt, run.tower, run.damper, run.pulse, run.overLimitTime);
  run.state = trial.state;
  if ((run.state.heat || 0) < oldHeat) run.state.heat = oldHeat;
  const sample = trial.sample;
  if (sample.hits > oldHits) run.hitFlash = 0.6;
  run.overLimitTime = trial.overLimitTime;
  if (trial.failed) {
    run.failed = true;
    run.failedAt = run.state.t;
    run.failureCause = trial.failureCause;
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
  labAccumulator += Math.max(0, dt);
  while (labTime < sim.pulse.runDuration - 1e-9 && !labRuns().every(run => run.failed)) {
    const step = Math.min(P.trialStep, sim.pulse.runDuration - labTime);
    if (labAccumulator + 1e-9 < step) break;
    labRuns().forEach(run => stepRun(run, step));
    labTime += step;
    labAccumulator = Math.max(0, labAccumulator - step);
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
  // Draw behind the bob to its center so the joint stays connected at every display scale.
  const rodEndX = bobX;
  const rodEndY = bobY;
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
  const endX = bobX;
  const endY = bobY;

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

function drawStage(sample, run = sim, canvasId = "stage", options = {}) {
  const canvas = typeof canvasId === "string" ? $(canvasId) : canvasId;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const layout = P.towerGeometry(run.tower);
  const scale = layout.swayScale;
  const baseX = w / 2 + sample.y * scale;
  const roofX = baseX + sample.sway * scale;
  const { top, columnWidth, towerWidth } = layout;
  const bottom = options.foundationY ?? layout.bottom;
  const d = run.damper;
  const towerColor = compareSim && canvasId === "stage" ? "#245e9b" : "#0f7b7e";

  if (options.background !== false) {
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

  }

  ctx.fillStyle = "rgba(42, 68, 82, .10)";
  ctx.beginPath();
  ctx.ellipse(baseX, bottom + 2, 152, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#cedee5";
  ctx.roundRect(baseX - 138, bottom - 8, 276, 12, 3);
  ctx.fill();

  const dangerEnabled = run.pulse.dangerEnabled !== false;
  if (options.danger !== false && !run.failed && dangerEnabled && $("showDangerInput").checked) {
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
    // Keep the original crash, then crush the remaining structure to the ground.
    const crushProgress = run.collapseAge >= 3.6 - 1e-9 ? 1 : P.clamp((run.collapseAge - 2.2) / 1.4, 0, 1);
    const crush = crushProgress * crushProgress * (3 - 2 * crushProgress);
    const buckledTop = top + (bottom - top) * (0.52 * p);
    const collapsedTop = buckledTop + (bottom - 8 - buckledTop) * crush;
    const lean = 70 * p;
    const buckle = 24 * Math.sin(p * Math.PI);
    const leftBase = baseX - towerWidth / 2;
    const rightBase = baseX + towerWidth / 2;
    const leftTop = roofX - towerWidth / 2 + lean - buckle;
    const rightTop = roofX + towerWidth / 2 + lean + buckle * 0.4;

    if (crushProgress < 1) {
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
      ctx.lineTo(leftTop, collapsedTop + 18 * p * (1 - crush));
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "#723a37";
      ctx.lineWidth = columnWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(leftBase, bottom);
      ctx.quadraticCurveTo(leftBase - 18 * p, (bottom + collapsedTop) / 2, leftTop, collapsedTop + 18 * p * (1 - crush));
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
      ctx.globalAlpha = 1 - crush;
      ctx.beginPath();
      ctx.roundRect(-(towerWidth + columnWidth) / 2, -9, towerWidth + columnWidth, 18, 3);
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

    }

    if (crushProgress > 0) {
      // Deterministic fragments settle into a low pile; replay uses the same debris.
      for (let i = 0; i < 56; i++) {
        const spread = (i / 55 - 0.5) * 320;
        const arc = Math.sin(crushProgress * Math.PI) * (12 + (i % 5) * 9);
        const pileHeight = (1 - Math.abs(spread) / 175) * (8 + i % 6 * 4);
        ctx.save();
        ctx.translate(baseX + spread * (0.65 + 0.35 * crush), bottom - pileHeight * crush - arc);
        ctx.rotate(i * 1.7 + crush * (i % 3 - 1));
        ctx.fillStyle = ["#723a37", "#c4d4da", "#9d7970", "#0f7b7e"][i % 4];
        ctx.fillRect(-6 - i % 4, -4, 12 + i % 9, 6 + i % 5);
        ctx.restore();
      }
    }

    const dustBurst = Math.sin(crushProgress * Math.PI);
    ctx.fillStyle = `rgba(118, 95, 84, ${0.30 * (1 - p * 0.22) * (1 - crush) + 0.28 * dustBurst})`;
    for (let i = 0; i < 13; i++) {
      const spread = 1 + p * 0.9 + dustBurst * 0.3;
      const px = baseX - 145 * spread + i * 24 * spread + Math.sin(i * 2.1) * 15;
      const py = bottom + 3 - Math.sin(p * Math.PI) * (12 + i % 3 * 7);
      ctx.beginPath();
      ctx.arc(px, py, 9 + (i % 4) * 5 + p * 18 + dustBurst * 16, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = `rgba(118, 95, 84, ${0.35 * (1 - p)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(baseX, bottom + 6, 48 + p * 165, 8 + p * 30, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#723a37";
    ctx.font = "bold 52px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(248, 251, 252, .95)";
    ctx.lineWidth = 7;
    ctx.save();
    ctx.strokeText("FAILED", w / 2, h / 2);
    ctx.fillText("FAILED", w / 2, h / 2);
    ctx.restore();
    ctx.restore();
    return;
  }

  drawTowerSegment(ctx, baseX, roofX, towerWidth, bottom, top, bottom, top, false, columnWidth);
  ctx.fillStyle = towerColor;
  ctx.save();
  ctx.shadowColor = "rgba(20, 33, 42, .20)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.roundRect(roofX - (towerWidth + columnWidth) / 2, top - 15, towerWidth + columnWidth, 18, 3);
  ctx.fill();
  if (compareSim && (canvasId === "stage" || canvasId === "stageCompare")) {
    ctx.save();
    ctx.fillStyle = towerColor;
    ctx.beginPath(); ctx.roundRect(roofX - 15, top - 49, 30, 28, 5); ctx.fill();
    ctx.fillStyle = "white"; ctx.font = "bold 20px system-ui"; ctx.textAlign = "center";
    ctx.fillText(canvasId === "stageCompare" ? "A" : "B", roofX, top - 28);
    ctx.restore();
  }

  ctx.restore();

  if (d.enabled && (!run.failed || showContact)) {
    const pivotX = roofX;
    const pivotY = top + 2;
    const geometry = P.pendulumGeometry(run.tower, d, sample.sway);
    // City uses taller schematic walls; place the mounts on those straight walls.
    // The pendulum still uses the same angle and a fixed, uniformly scaled length.
    geometry.mountSlope = sample.sway * scale / (bottom - top);
    const shearOffset = -geometry.mountSlope * (geometry.anchorY - top);
    geometry.leftAnchorOffset = -towerWidth / 2 + shearOffset;
    geometry.rightAnchorOffset = towerWidth / 2 + shearOffset;
    const Lpx = geometry.lengthPx;
    const bobR = geometry.bobRadiusPx;
    const drawTheta = sample.theta * P.pendulumAngleScale;
    const isLocked = d.damping >= 1;
    const showHydraulics = d.damping > 0.001 && !isLocked;
    const anchorY = geometry.anchorY;
    const leftAnchorX = pivotX + geometry.leftAnchorOffset;
    const rightAnchorX = pivotX + geometry.rightAnchorOffset;
    // Keep each hydraulic mount on the displayed column.
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

    // The complete mechanism uses a uniform scale in every view.
    ctx.save();
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
    ctx.restore();
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
  const plot = { left: 72, right: w - 18, top: 14, bottom: h - 36 };
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
  ctx.font = "bold 13px system-ui";
  ctx.fillText(`${fmt(maxY)} m`, 6, plot.top + 4);
  ctx.fillText(`-${fmt(maxY)} m`, 6, plot.bottom);
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Building", 6, (plot.top + plot.bottom) / 2 - 9);
  ctx.fillText("sway (m)", 6, (plot.top + plot.bottom) / 2 + 9);
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
  const quakeStatus = labRuns().every(run => run.failed) ? "Trial ended." : labTime === 0 ? "" : labPaused ? "Paused." : labTime < sim.pulse.duration ? "Ground shaking." : "Ground stopped.";
  $("earthquakeStatus").textContent = quakeStatus;
  $("earthquakeStatus").hidden = !quakeStatus;
  const dangerEnabled = sim.pulse.dangerEnabled !== false;
  const dangerToggle = $("showDangerInput");
  dangerToggle.disabled = !dangerEnabled;
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
    if (run.failed) run.collapseAge = Math.min(3.6, run.collapseAge + elapsed);
    run.hitFlash = Math.max(0, run.hitFlash - elapsed);
  });
  if (sim.playing) {
    stepLive(elapsed);
  }
  renderLab();
  requestAnimationFrame(animateLab);
}

async function api(path, body) {
  const headers = { "Content-Type": "application/json" };
  const code = path.match(/^\/api\/rooms\/([^/]+)/)?.[1];
  const teacherToken = code && typeof localStorage !== "undefined" ? localStorage.getItem(`tmd-teacher-${code}`) : null;
  if (teacherToken) headers["X-Teacher-Token"] = teacherToken;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body || {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function connectRoom(code) {
  if (events) events.close();
  const source = new EventSource(`/events/${code}`);
  events = source;
  source.onmessage = event => {
    if (events !== source) return;
    const room = JSON.parse(event.data);
    if (room.deleted) { clearDeletedRoom(room.code); return; }
    currentRoom = room;
    renderRoom();
    renderCity();
  };
}

function clearDeletedRoom(code, reason = "deleted") {
  const unavailable = reason === "unavailable";
  localStorage.removeItem(`tmd-teacher-${code}`);
  if (localStorage.getItem("tmd-last-teacher-room") === code) localStorage.removeItem("tmd-last-teacher-room");
  sessionStorage.removeItem(`tmd-token-${code}`);
  sessionStorage.removeItem(`tmd-nickname-${code}`);
  if (currentRoom?.code === code) {
    $("roomSettingsNotice").hidden = true;
    events?.close();
    events = null;
    currentRoom = null;
    currentStudent = null;
    stopQuakeSound();
    $("activeRoomSettings").disabled = true;
    $("applyRoomSettingsBtn").disabled = true;
    $("activeRoomSettingsStatus").textContent = "Open or create a room to choose settings.";
    $("roomState").textContent = unavailable ? "Room expired or no longer available. Create or open another room." : "Room deleted. Create or open another room.";
    $("studentState").textContent = unavailable ? "This room expired or is no longer available." : "This room was deleted by the teacher.";
    $("studentTower").textContent = "Join a room to receive a tower.";
    $("submitState").textContent = "";
    $("designEntry").hidden = false;
    showJoined(false);
    $("phaseSteps").innerHTML = "";
    $("roster").querySelector("tbody").innerHTML = "";
    $("resultsTable").querySelector("tbody").innerHTML = "";
    $("quakeIntro").hidden = true;
    $("cityCanvas").hidden = false;
    $("cityResults").hidden = true;
    $("cityCaption").textContent = "Create or join a room to see the shared skyline.";
    $("quakeBadge").textContent = "Waiting";
    ["lockBtn", "unlockBtn", "startBtn", "replayBtn", "deleteRoomBtn"].forEach(id => { $(id).disabled = true; });
    renderCity();
  }
  renderTeacherRooms();
  renderRoomSettings(teacherUnlocked);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

let applyingRoomSettings = false;
let roomSettingsEditorKey = "";
let lastRoomScenario = null;

function roomStrength(config) {
  return Object.keys(EARTHQUAKE_STRENGTHS).find(key => Math.abs(EARTHQUAKE_STRENGTHS[key] - config.amplitude) < 1e-9) || "moderate";
}

function roomScenarioText(config) {
  const strength = roomStrength(config);
  return `${DIFFICULTY[config.difficulty]?.label || "Medium"} difficulty / ${strength[0].toUpperCase() + strength.slice(1)} earthquake`;
}

function roomSettingsDirty() {
  return currentRoom && ($("activeRoomDifficulty").value !== currentRoom.config.difficulty || $("activeRoomStrength").value !== roomStrength(currentRoom.config));
}

function renderRoomSettings(teacher) {
  $("createRoomBtn").disabled = creatingRoom || applyingRoomSettings;
  $("previewClassBtn").disabled = creatingRoom || applyingRoomSettings;
  $("applyRoomSettingsBtn").hidden = !currentRoom;
  if (!currentRoom) {
    for (const id of ["activeRoomSettings", "activeRoomDifficulty", "activeRoomStrength"]) $(id).disabled = !teacher || creatingRoom;
    $("activeRoomSettingsStatus").textContent = "";
    return;
  }
  const signature = `${currentRoom.config.difficulty}:${currentRoom.config.amplitude}`;
  const editorKey = `${currentRoom.code}:${signature}`;
  if (roomSettingsEditorKey !== editorKey || currentRoom.phase !== "design") {
    $("activeRoomDifficulty").value = currentRoom.config.difficulty;
    $("activeRoomStrength").value = roomStrength(currentRoom.config);
    $("activeRoomSettingsStatus").textContent = "";
    roomSettingsEditorKey = editorKey;
  }
  if (lastRoomScenario?.code !== currentRoom.code || currentRoom.phase !== "design") $("roomSettingsNotice").hidden = true;
  if (lastRoomScenario?.code === currentRoom.code && lastRoomScenario.signature !== signature) {
    $("roomSettingsNotice").textContent = `Room settings updated: ${roomScenarioText(currentRoom.config)}. Your tower and saved design stay the same.`;
    $("roomSettingsNotice").hidden = false;
  }
  lastRoomScenario = { code: currentRoom.code, signature };
  const editable = teacher && currentRoom.phase === "design" && !applyingRoomSettings && !startingQuake && !creatingRoom;
  for (const id of ["activeRoomSettings", "activeRoomDifficulty", "activeRoomStrength"]) $(id).disabled = !editable;
  const dirty = roomSettingsDirty();
  $("applyRoomSettingsBtn").disabled = !editable || !dirty;
  if (applyingRoomSettings || (currentRoom.phase === "design" && dirty)) {
    $("lockBtn").disabled = true;
    $("startBtn").disabled = true;
  }
  if (!applyingRoomSettings) $("activeRoomSettingsStatus").textContent = currentRoom.phase !== "design"
    ? "" : dirty ? "Unapplied changes." : "";
}

function renderRoom() {
  if (!currentRoom) return renderRoomSettings(teacherUnlocked);
  const teacher = teacherUnlocked && typeof localStorage !== "undefined" && !!localStorage.getItem(`tmd-teacher-${currentRoom.code}`);
  const phase = currentRoom.phase;
  // Only the controls that make sense in this phase are shown; the next step is the primary one.
  const controls = {
    design: { lockBtn: "primary", startBtn: "secondary" },
    locked: { startBtn: "primary", unlockBtn: "secondary" },
    running: { replayBtn: "primary", unlockBtn: "secondary" }
  }[phase] || {};
  for (const id of ["lockBtn", "startBtn", "replayBtn", "unlockBtn"]) {
    $(id).hidden = !controls[id];
    $(id).disabled = !teacher || !controls[id] || startingQuake || (id === "replayBtn" && !!currentRoom.quake?.preparing);
    $(id).className = `button-${controls[id] || "secondary"}`;
  }
  renderRoomSettings(teacher);
  $("deleteRoomBtn").disabled = !teacher;
  renderBlockedNames(teacher);
  renderTeacherRooms();
  const roomMode = DIFFICULTY[currentRoom.config.difficulty]?.label || "Medium";
  const phaseLabel = { design: "Open for designs", locked: "Designs locked", running: "Testing" }[phase] || phase;
  $("roomState").innerHTML = `<div class="room-banner"><div class="join-callout"><span>JOIN CODE</span><span class="room-code">${escapeHtml(currentRoom.code)}</span></div></div><div class="room-facts"><span>${roomMode} difficulty</span><span>Earthquake ${fmt(currentRoom.config.amplitude)} m · ${fmt(currentRoom.config.pulseDuration)} s</span><span>${currentRoom.students.length} ${currentRoom.students.length === 1 ? "group" : "groups"}${currentRoom.preview ? " · Demo class" : ""}</span></div>`;
  $("phaseSteps").textContent = `Status: ${phaseLabel}`;
  $("studentState").textContent = `Room ${currentRoom.code} / ${phaseLabel} / ${roomScenarioText(currentRoom.config)}`;
  $("roster").querySelector("tbody").innerHTML = currentRoom.students.map(s => `<tr><td><strong>${escapeHtml(s.nickname)}</strong></td><td class="num">${fmt(s.tower.period)} s</td><td><span class="status-chip ${s.submission ? "status-submitted" : "status-none"}">${s.submission ? "Submitted" : "Not submitted"}</span></td><td class="num">${s.submission ? `${fmt(s.submission.length)} m` : "—"}</td><td class="num">${s.submission ? `${fmt(s.submission.massRatio * 100, 1)}%` : "—"}</td><td class="num">${s.submission ? fmt(s.submission.damping) : "—"}</td><td><button type="button" class="remove-group" data-student-id="${escapeHtml(s.id)}" aria-label="Remove ${escapeHtml(s.nickname)}" ${teacher ? "" : "disabled"}>✕</button></td></tr>`).join("");
  const wasLocked = $("submitLength").disabled;
  const locked = phase !== "design" || !currentStudent;
  ["submitLength", "submitMass", "submitDamping", "submitDesignBtn"].forEach(id => { $(id).disabled = locked; });
  if (!currentStudent) return showJoined(false);
  const latest = currentRoom.students.find(s => s.id === currentStudent.id);
  if (!latest) {
    currentStudent = null;
    sessionStorage.removeItem(`tmd-token-${currentRoom.code}`);
    ["submitLength", "submitMass", "submitDamping", "submitDesignBtn"].forEach(id => { $(id).disabled = true; });
    $("studentTower").textContent = "Your group was removed from this room by the teacher.";
    $("submitState").textContent = "";
    $("designEntry").hidden = false;
    return showJoined(false);
  }
  currentStudent = latest;
  const studentQuake = phase === "running" && currentRoom.quake?.startedAt
    ? `${currentRoom.code}:${currentRoom.quake.id || currentRoom.quake.startedAt}` : "";
  if (studentQuake && studentQuake !== lastStudentQuake) {
    lastStudentQuake = studentQuake;
    setView("city");
    window.scrollTo?.(0, 0);
  }
  $("designEntry").hidden = locked;
  if (locked) {
    $("submitLength").value = latest.submission ? fmt(latest.submission.length) : "";
    $("submitMass").value = latest.submission ? fmt(latest.submission.massRatio * 100, 1) : "";
    $("submitDamping").value = latest.submission ? fmt(latest.submission.damping) : "0";
    $("submitState").textContent = "";
  } else if (wasLocked) {
    $("submitState").textContent = "Room reopened. Change your settings and click Submit / revise to save them for the next earthquake.";
  }
  const lockBanner = !locked ? "" : `<div class="lock-banner" role="status"><span aria-hidden="true">🔒</span> ${phase === "running" ? "Earthquake underway — watch the board!" : "Designs locked — watch the board."}${latest.submission ? "" : " No design was submitted, so your tower is tested without a TMD."}</div>`;
  $("studentTower").innerHTML = `${lockBanner}<p class="round-settings">Current round: ${roomScenarioText(currentRoom.config)}</p><div class="assignment-heading"><strong>${escapeHtml(latest.nickname)} — ${escapeHtml(latest.tower.name)}</strong><span class="status-chip ${latest.submission ? "status-submitted" : "status-none"}">${latest.submission ? "Design submitted" : "Not submitted"}</span></div><div class="tower-facts"><div><span>Height</span> <strong>${latest.tower.height} m</strong></div><div><span>Tower mass</span> <strong>${(latest.tower.mass / 1e6).toFixed(1)} million kg</strong></div></div><p>Use this height and mass in the Solo Lab. Measure the period and tune your TMD with the proper damping to prevent your tower from collapsing during an earthquake.</p>${latest.submission ? `<div class="submission-summary"><strong>Saved design</strong><span>Pendulum length: ${fmt(latest.submission.length)} m</span><span>TMD mass: ${fmt(latest.submission.massRatio * 100, 1)}%</span><span>Damping: ${fmt(latest.submission.damping)}</span></div>` : ""}`;
  $("joinedSummary").innerHTML = `<strong>${escapeHtml(latest.nickname)}</strong> · Room ${escapeHtml(currentRoom.code)} · ${escapeHtml(phaseLabel)}`;
  if (!joinEditing) showJoined(true);
}

// Blocked names stay collapsed so they are not shown on a projected dashboard by accident.
let blockedNamesLoaded = "";
async function renderBlockedNames(teacher) {
  const count = currentRoom?.blockedCount || 0;
  $("blockedNamesBox").hidden = !teacher || !count;
  if (!teacher || !count) return;
  $("blockedNamesSummary").textContent = `Blocked group names (${count})`;
  const key = `${currentRoom.code}:${count}`;
  if (blockedNamesLoaded === key) return;
  blockedNamesLoaded = key;
  try {
    const { blockedNames } = await api(`/api/rooms/${currentRoom.code}/blocked-names`);
    $("blockedNamesList").innerHTML = blockedNames.slice().reverse().map(entry => `<li><span>${escapeHtml(entry.name)}</span><time>${new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></li>`).join("");
  } catch (error) {
    blockedNamesLoaded = "";
  }
}

// Once a group has joined, the join form collapses to a one-line strip so the design card gets the width.
let joinEditing = false;
function showJoined(joined) {
  $("joinFields").hidden = joined;
  $("joinedStrip").hidden = !joined;
  $("challengeLayout").classList.toggle("joined", joined);
}

// Room results pack City samples as integer arrays (see packCitySamples in src/rooms.js).
// Rooms scored before that change still hold arrays of sample objects.
function citySample(result, time) {
  const s = result?.samples;
  if (Array.isArray(s)) return s[Math.min(s.length - 1, Math.floor(time / 0.05))];
  if (!s?.sway?.length) return null;
  const position = Math.min(s.sway.length - 1, Math.max(0, time / s.dt));
  const i = Math.floor(position), j = Math.min(s.sway.length - 1, i + 1), f = position - i;
  const at = (values, scale) => (values[i] + (values[j] - values[i]) * f) / scale;
  return { t: time, y: at(s.y, 1e4), sway: at(s.sway, 1e4), theta: at(s.theta, 1e5), heat: at(s.heat, 0.01) };
}

function cityFinalSample(result) {
  const s = result?.samples;
  return Array.isArray(s) ? s.at(-1) : s?.end;
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
  const students = currentRoom.students.slice(0, 12);
  const pulse = currentRoom.quake;
  if (!pulse) lastCityStartedAt = 0;
  if (pulse?.startedAt && currentRoom.phase === "running" && pulse.startedAt !== lastCityStartedAt) {
    cityStart = performance.now() - (Date.now() - pulse.startedAt);
    lastCityStartedAt = pulse.startedAt;
  }
  $("cityCaption").textContent = `Room ${currentRoom.code}: ${roomScenarioText(currentRoom.config)} - same settings for every tower.`;
  $("quakeBadge").textContent = pulse ? `${DIFFICULTY[pulse.difficulty]?.label || "Medium"}: ${fmt(pulse.amplitude)} m` : "Waiting";
  const t = currentRoom.phase === "running" ? Math.min(Math.max(0, (performance.now() - cityStart) / 1000), (pulse?.runDuration || RUN_DURATION) + 3.6) : 0;
  const running = currentRoom.phase === "running" && !!pulse;
  const remaining = running ? Math.max(0, (cityStart - performance.now()) / 1000) : 0;
  const preparing = pulse?.preparing === true;
  const intro = startingQuake || preparing || remaining > 0;
  $("quakeIntro").hidden = !intro;
  canvas.hidden = intro;
  $("cityResults").hidden = intro || (running && t < (pulse.runDuration || RUN_DURATION) + 3.6);
  $("skipResultsBtn").hidden = !running || intro || t >= (pulse.runDuration || RUN_DURATION) + 3.6;
  if (intro) {
    if (!startingQuake && pulse) playQuakeWarning(pulse.id || pulse.startedAt);
    $("quakeCountdown").textContent = startingQuake ? "Sending earthquake alert…"
      : preparing && remaining <= 0 ? "Preparing city…"
      : `Brace your buildings — skyline in ${Math.ceil(remaining)}!`;
    $("quakeBadge").textContent = "Epicenter: Morristown, NJ";
    $("cityCaption").textContent = "Incoming classroom quake!";
    return;
  }
  if (running) {
    const finished = t >= (pulse.runDuration || RUN_DURATION) + 3.6;
    $("quakeBadge").textContent = finished ? "Aftermath" : t < pulse.duration ? "Ground shaking!" : "Ground stopped — settling";
    $("cityCaption").textContent = `Room ${currentRoom.code}: ${finished ? "the dust has settled." : t < pulse.duration ? "Hold on! The earthquake has reached the city." : "Watch which designs survive."}`;
  }
  const aftermath = running && t >= (pulse.runDuration || RUN_DURATION) + 3.6;
  const cell = w / Math.max(1, students.length);
  students.forEach((s, i) => {
    const result = s.result;
    const sampleTime = result?.failureTime != null ? Math.min(t, result.failureTime) : t;
    const terminal = cityFinalSample(result);
    const terminalPose = result?.status === "failed" && t >= result.failureTime && terminal && Math.abs(terminal.t - result.failureTime) < 1e-6;
    const sample = (terminalPose ? terminal : citySample(result, sampleTime)) || { t: 0, y: 0, sway: 0, theta: 0, heat: 0 };
    const cx = cell * i + cell / 2;
    const fraction = P.clamp((s.tower.height - 170) / 180, 0, 1);
    const height = 180 + fraction * 160;
    const towerScale = Math.min(0.3, cell / 420);
    const layout = P.towerGeometry(s.tower);
    const foundationY = layout.top + height / towerScale;
    const failureTime = result?.failureTime ?? terminal?.t ?? Infinity;
    const failed = result?.status === "failed" && (aftermath || t >= failureTime);
    const run = {
      tower: s.tower,
      damper: s.submission || { enabled: false },
      pulse: pulse || { dangerEnabled: false },
      state: { contact: result?.contact || null },
      failed,
      collapseAge: failed ? (aftermath ? 3.6 : Math.max(0, t - failureTime)) : 0,
      energyScale: Math.max(4000, s.tower.mass * 0.0012)
    };
    ctx.save();
    ctx.translate(cx - layout.width / 2 * towerScale, h - 48 - foundationY * towerScale);
    ctx.scale(towerScale, towerScale);
    drawStage(sample, run, { width: layout.width, height: foundationY + 44, getContext: () => ctx }, { background: false, danger: false, foundationY });
    ctx.restore();
    ctx.fillStyle = "#17212b";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(s.nickname, cx, h - 14, Math.max(1, cell - 8));
  });

  renderLeaderboards(currentRoom.results || [], pulse);
  $("resultsTable").querySelector("tbody").innerHTML = (currentRoom.results || []).map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.nickname)}</td><td>${r.result.status}</td><td>${fmt(r.result.settleTime, 2)} s</td><td>${fmt(r.result.peakSway)} m</td><td>${r.result.hits}</td><td>${fmt(r.result.heat / 1000, 1)} kJ</td><td>${r.submission?.enabled ? `L ${fmt(r.submission.length)} m, D ${fmt(r.submission.damping)}` : "No TMD"}</td></tr>`).join("");
}

// Each board ranks surviving towers by one measure; collapsed towers follow, longest-lasting first.
// Tied values share a place.
function leaderboard(results, value, { needsTmd = false } = {}) {
  const survivors = results.filter(r => r.result.status !== "failed");
  const ranked = survivors.filter(r => !needsTmd || r.submission?.enabled).sort((a, b) => value(a) - value(b));
  const noTmd = needsTmd ? survivors.filter(r => !r.submission?.enabled) : [];
  const failed = results.filter(r => r.result.status === "failed").sort((a, b) => (b.result.failureTime ?? 0) - (a.result.failureTime ?? 0));
  const rows = [];
  ranked.forEach((r, i) => {
    const place = i > 0 && value(r) === value(ranked[i - 1]) ? rows[i - 1].place : i + 1;
    rows.push({ r, place, kind: "ranked" });
  });
  for (const r of noTmd) rows.push({ r, place: rows.length + 1, kind: "no-tmd" });
  for (const r of failed) rows.push({ r, place: rows.length + 1, kind: "failed" });
  return rows;
}

function renderLeaderboards(results, pulse) {
  if (!results.length) {
    $("survivorBanner").innerHTML = "";
    $("leaderboards").innerHTML = "";
    return;
  }
  const survivors = results.filter(r => r.result.status !== "failed");
  const fallen = results.filter(r => r.result.status === "failed");
  $("survivorBanner").innerHTML = `<strong>🏙️ ${survivors.length} of ${results.length} towers survived!</strong>${fallen.length ? `<span>Collapsed: ${fallen.map(r => escapeHtml(r.nickname)).join(", ")}</span>` : ""}`;
  const dangerOn = pulse?.dangerEnabled !== false;
  // Values are rounded to what is displayed so visible ties share a place.
  const round = (v, digits) => Number(v.toFixed(digits));
  const boards = [
    { title: "Fastest to settle", note: "Sway within 10% of its own peak", value: r => round(r.result.relativeSettleTime ?? r.result.settleTime, 2), show: v => `${fmt(v, 2)} s` },
    dangerOn
      ? { title: "Least time in danger zone", note: "Must survive", value: r => round(r.result.overLimitTime || 0, 2), show: v => `${fmt(v, 2)} s` }
      : { title: "Least peak sway", note: "No danger zone on Easy", value: r => round(r.result.peakSway, 2), show: v => `${fmt(v, 2)} m` },
    { title: "Lightest TMD", note: "Mass as % of tower, must survive", value: r => round(r.submission.massRatio * 100, 1), show: v => `${fmt(v, 1)}%`, needsTmd: true },
    { title: "Least damping", note: "Must survive", value: r => round(r.submission.damping, 2), show: v => fmt(v, 2), needsTmd: true }
  ];
  const medals = ["🥇", "🥈", "🥉"];
  $("leaderboards").innerHTML = boards.map(board => `<section class="leaderboard"><h3>${board.title}</h3><p>${board.note}</p><ol>${leaderboard(results, board.value, board).map(({ r, place, kind }) => {
    const label = board.needsTmd && !r.submission?.enabled ? "No TMD" : board.show(board.value(r));
    const mark = kind === "ranked" && place <= 3 ? medals[place - 1] : place;
    return `<li class="board-${kind}${kind === "ranked" && place <= 3 ? " podium" : ""}"><span class="board-place">${mark}</span><span class="board-name">${escapeHtml(r.nickname)}${kind === "failed" ? '<small class="board-status">Collapsed</small>' : ""}</span><span class="board-value">${label}</span></li>`;
  }).join("")}</ol></section>`).join("");
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
    const left = 72;
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

async function createClassRoom(preview = false) {
  if (creatingRoom) return;
  creatingRoom = true;
  renderRoomSettings(teacherUnlocked);
  $("createRoomBtn").disabled = true;
  $("previewClassBtn").disabled = true;
  try {
  currentRoom = await api("/api/rooms", {
    preview,
    seed: $("roomSeed").value,
    amplitude: EARTHQUAKE_STRENGTHS[$("activeRoomStrength").value],
    pulseDuration: EARTHQUAKE_DURATION,
    difficulty: $("activeRoomDifficulty").value,
    runDuration: Number($("roomRunDuration").value),
    driftLimit: 1.2
  });
  localStorage.setItem(`tmd-teacher-${currentRoom.code}`, currentRoom.teacherToken);
  localStorage.setItem("tmd-last-teacher-room", currentRoom.code);
  delete currentRoom.teacherToken;
  connectRoom(currentRoom.code);
  currentStudent = null;
  renderRoom();
  renderCity();
  setView("teacher");
  } finally {
    creatingRoom = false;
    $("createRoomBtn").disabled = false;
    $("previewClassBtn").disabled = false;
    renderRoom();
  }
}

function savedTeacherRoomCodes() {
  if (typeof localStorage === "undefined") return [];
  const codes = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("tmd-teacher-") && localStorage.getItem(key)) codes.add(key.slice("tmd-teacher-".length));
  }
  return Array.from(codes).sort();
}

function renderTeacherRooms() {
  if (typeof localStorage === "undefined") return;
  const codes = new Set(savedTeacherRoomCodes());
  const selected = $("teacherRooms").value;
  const active = currentRoom?.code || "";
  const last = localStorage.getItem("tmd-last-teacher-room");
  $("teacherRooms").innerHTML = '<option value="">Choose a previous room</option>' + Array.from(codes).map(code => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`).join("");
  $("teacherRooms").value = active !== listedTeacherRoom && codes.has(active) ? active
    : codes.has(selected) ? selected : codes.has(active) ? active : codes.has(last) ? last : "";
  listedTeacherRoom = active;
  $("teacherRooms").disabled = openingTeacherRoom;
  $("openTeacherRoomBtn").disabled = openingTeacherRoom || !$("teacherRooms").value;
}

function loadSavedTeacherRoom(code) {
  if (savedRoomLoads.has(code)) return savedRoomLoads.get(code);
  const token = localStorage.getItem(`tmd-teacher-${code}`);
  const request = (async () => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { cache: "no-store" });
    // Only a confirmed missing room removes a bookmark. Quota, network and
    // service failures must retain its private key so the teacher can retry.
    if (response.status === 404) {
      if (localStorage.getItem(`tmd-teacher-${code}`) === token) clearDeletedRoom(code, "unavailable");
      return null;
    }
    const room = await response.json();
    if (!response.ok) throw new Error(room.error || "Could not open room. Please try again.");
    return room;
  })();
  savedRoomLoads.set(code, request);
  request.then(() => savedRoomLoads.delete(code), () => savedRoomLoads.delete(code));
  return request;
}

function refreshSavedTeacherRooms() {
  if (checkingTeacherRooms) return checkingTeacherRooms;
  if (typeof fetch === "undefined" || typeof localStorage === "undefined") return Promise.resolve();
  checkingTeacherRooms = Promise.allSettled(savedTeacherRoomCodes().map(loadSavedTeacherRoom)).then(() => {
    checkingTeacherRooms = null;
    renderTeacherRooms();
  });
  return checkingTeacherRooms;
}

async function restoreSavedTeacherRoom() {
  if (typeof localStorage === "undefined" || currentRoom || openingTeacherRoom) return;
  const code = localStorage.getItem("tmd-last-teacher-room");
  if (!code || !localStorage.getItem(`tmd-teacher-${code}`)) return;
  try {
    const room = await loadSavedTeacherRoom(code);
    if (!room) {
      $("teacherRoomStatus").textContent = `Room ${code} expired or is no longer available and was removed from saved rooms.`;
      return;
    }
    if (currentRoom || openingTeacherRoom) return;
    currentRoom = room;
    connectRoom(code);
    renderRoom();
    renderCity();
  } catch (error) { $("teacherRoomStatus").textContent = error.message; }
}

$("teacherRooms").addEventListener("change", () => {
  $("openTeacherRoomBtn").disabled = openingTeacherRoom || !$("teacherRooms").value;
});
$("teacherRooms").addEventListener("focus", () => refreshSavedTeacherRooms());
window.addEventListener?.("focus", () => refreshSavedTeacherRooms());
$("openTeacherRoomBtn").addEventListener("click", async () => {
  const code = $("teacherRooms").value;
  if (!code || openingTeacherRoom) return;
  openingTeacherRoom = true;
  renderTeacherRooms();
  $("teacherRoomStatus").textContent = "Opening room...";
  try {
    const room = await loadSavedTeacherRoom(code);
    if (!room) {
      $("teacherRoomStatus").textContent = `Room ${code} expired or is no longer available and was removed from saved rooms.`;
      return;
    }
    currentRoom = room;
    currentStudent = null;
    localStorage.setItem("tmd-last-teacher-room", code);
    connectRoom(code);
    renderRoom();
    renderCity();
    $("teacherRoomStatus").textContent = "";
  } catch (error) { $("teacherRoomStatus").textContent = error.message; }
  finally {
    openingTeacherRoom = false;
    renderTeacherRooms();
  }
});

$("roomForm").addEventListener("submit", async event => {
  event.preventDefault();
  try { await createClassRoom(); }
  catch (error) { $("previewState").textContent = error.message; }
});
$("previewClassBtn").addEventListener("click", async () => {
  $("previewClassBtn").disabled = true;
  $("previewState").textContent = "Creating demo class...";
  try {
    await createClassRoom(true);
    $("previewState").textContent = "12 demo pair designs are ready. Start earthquake to watch the skyline, then Replay to watch again.";
  } catch (error) {
    $("previewState").textContent = error.message;
  } finally {
    $("previewClassBtn").disabled = false;
  }
});

$("joinForm").addEventListener("submit", async event => {
  event.preventDefault();
  const code = $("studentRoom").value.trim().toUpperCase();
  const key = `tmd-token-${code}`;
  const nickname = $("nickname").value.trim();
  // The server issues the token that identifies the group; its display name can change independently.
  const token = sessionStorage.getItem(key) || undefined;
  $("studentState").textContent = "Joining room...";
  try {
    const data = await api(`/api/rooms/${code}/join`, { nickname, token });
    sessionStorage.setItem(key, data.token);
    currentStudent = data.student;
    joinEditing = false;
    // New assignments start blank; reconnecting restores only the pair's own submission.
    $("submitLength").value = data.student.submission ? fmt(data.student.submission.length) : "";
    $("submitMass").value = data.student.submission ? fmt(data.student.submission.massRatio * 100, 1) : "";
    $("submitDamping").value = data.student.submission ? fmt(data.student.submission.damping) : "0";
    currentRoom = data.room;
    connectRoom(code);
    renderRoom();
    $("submitState").textContent = data.student.submission ? "Your saved design is restored. You can revise it before the room is locked." : "Enter your tested settings, then submit your design.";
  } catch (error) {
    $("studentState").textContent = `Could not join: ${error.message}`;
    // A rejected rename leaves the group joined under its old name.
    if (token) return;
    currentStudent = null;
    $("studentTower").textContent = "Join a room to receive a tower.";
  }

});

$("changeJoinBtn").addEventListener("click", () => {
  joinEditing = true;
  showJoined(false);
  $("nickname").focus?.();
});

$("submitForm").addEventListener("submit", async event => {
  event.preventDefault();
  const status = $("submitState");
  if (!currentRoom || !currentStudent) {
    status.textContent = "Join a challenge room before submitting your design.";
    return;
  }
  if (currentRoom.phase !== "design") {
    status.textContent = "This room is locked. Designs cannot be submitted or revised after the teacher locks or starts it.";
    return;
  }
  const fields = [
    ["submitLength", .7, 17.7, "Enter a pendulum length from 0.7 to 17.7 m."],
    ["submitMass", 1, 10, "Enter TMD mass from 1 to 10%."],
    ["submitDamping", 0, 1, "Enter damping from 0 to 1."]
  ];
  for (const [id, min, max, message] of fields) {
    const value = Number($(id).value);
    if ($(id).value.trim() === "" || !Number.isFinite(value) || value < min || value > max) {
      status.textContent = message;
      $(id).focus?.();
      return;
    }
  }
  $("submitDesignBtn").disabled = true;
  status.textContent = "Submitting your design...";
  try {
    const data = await api(`/api/rooms/${currentRoom.code}/submit`, {
      token: sessionStorage.getItem(`tmd-token-${currentRoom.code}`),
      submission: {
        enabled: true,
        length: Number($("submitLength").value),
        massRatio: Number($("submitMass").value) / 100,
        damping: Number($("submitDamping").value),
        wallLimit: 2.7
      }
    });
    currentRoom = data.room;
    currentStudent = data.student;
    renderRoom();
    status.textContent = "Design submitted! Your teacher can see it. You can revise it until the room is locked.";
  } catch (error) {
    status.textContent = `Design was not submitted: ${error.message}`;
  } finally {
    $("submitDesignBtn").disabled = currentRoom?.phase !== "design";
  }
});

$("lockBtn").addEventListener("click", async () => {
  if (!currentRoom) return;
  try {
    currentRoom = await api(`/api/rooms/${currentRoom.code}/lock`);
    renderRoom();
    $("teacherRoomStatus").textContent = "";
  } catch (error) { $("teacherRoomStatus").textContent = error.message; }
});
["activeRoomDifficulty", "activeRoomStrength"].forEach(id => {
  $(id).addEventListener("change", () => renderRoom());
});
$("applyRoomSettingsBtn").addEventListener("click", async () => {
  if (!currentRoom || currentRoom.phase !== "design" || applyingRoomSettings || !roomSettingsDirty()) return;
  const code = currentRoom.code;
  applyingRoomSettings = true;
  renderRoom();
  $("activeRoomSettingsStatus").textContent = "Applying settings...";
  let errorMessage = "";
  try {
    const room = await api(`/api/rooms/${code}/settings`, {
      difficulty: $("activeRoomDifficulty").value,
      strength: $("activeRoomStrength").value
    });
    if (currentRoom?.code === code) {
      currentRoom = room;
      renderRoom();
      renderCity();
    }
  } catch (error) { errorMessage = error.message; }
  finally {
    applyingRoomSettings = false;
    if (currentRoom?.code === code) {
      renderRoom();
      if (errorMessage) $("activeRoomSettingsStatus").textContent = errorMessage;
    }
  }
});
$("unlockBtn").addEventListener("click", async () => {
  if (!currentRoom) return;
  try {
    currentRoom = await api(`/api/rooms/${currentRoom.code}/unlock`);
    stopQuakeSound();
    renderRoom();
    renderCity();
    $("teacherRoomStatus").textContent = "";
  } catch (error) { $("teacherRoomStatus").textContent = error.message; }
});
$("deleteRoomBtn").addEventListener("click", async () => {
  if (!currentRoom || !teacherUnlocked) return;
  const code = currentRoom.code;
  if (!window.confirm(`Delete room ${code} and all its student designs and results? This cannot be undone.`)) return;
  $("deleteRoomBtn").disabled = true;
  try {
    await api(`/api/rooms/${code}/delete`);
    clearDeletedRoom(code);
    $("teacherRoomStatus").textContent = `Room ${code} deleted.`;
  } catch (error) {
    $("teacherRoomStatus").textContent = error.message;
    renderRoom();
  }
});
$("roster").addEventListener("click", async event => {
  const button = event.target.closest("button[data-student-id]");
  if (!button || button.disabled || !teacherUnlocked || !currentRoom) return;
  const student = currentRoom.students.find(s => s.id === button.dataset.studentId);
  if (!student || !window.confirm(`Remove ${student.nickname} from room ${currentRoom.code}? Their tower, submitted design, and results will be deleted.`)) return;
  button.disabled = true;
  try {
    currentRoom = await api(`/api/rooms/${currentRoom.code}/remove-student`, { studentId: student.id });
    renderRoom();
    renderCity();
    $("teacherRoomStatus").textContent = `${student.nickname} removed.`;
  } catch (error) { $("teacherRoomStatus").textContent = error.message; button.disabled = false; }
});
async function runQuake(action) {
  if (!currentRoom || startingQuake || currentRoom.quake?.preparing) return;
  const previousView = document.querySelector(".view.active")?.id || "teacher";
  startingQuake = true;
  prepareQuakeAudio();
  setView("city");
  window.scrollTo?.(0, 0);
  renderRoom();
  renderCity();
  try {
    const room = await api(`/api/rooms/${currentRoom.code}/${action}`);
    // A completed SSE update can overtake the initial HTTP response.
    if (!(room.quake?.preparing && currentRoom?.quake?.id === room.quake.id && currentRoom.quake.preparing === false)) currentRoom = room;
    $("teacherRoomStatus").textContent = "";
  } catch (error) {
    $("teacherRoomStatus").textContent = error.message;
    setView(previousView);
  } finally {
    startingQuake = false;
    renderRoom();
    renderCity();
  }
}
$("startBtn").addEventListener("click", () => runQuake("start"));
// Scores are computed when the quake starts, so skipping only fast-forwards the animation.
$("skipResultsBtn").addEventListener("click", () => {
  if (!currentRoom?.quake || currentRoom.phase !== "running") return;
  cityStart = performance.now() - ((currentRoom.quake.runDuration || RUN_DURATION) + 3.6) * 1000;
  renderCity();
});
$("replayBtn").addEventListener("click", () => runQuake("replay"));

$("quakeSoundBtn").addEventListener("click", () => {
  quakeSoundEnabled = !quakeSoundEnabled;
  $("quakeSoundBtn").textContent = quakeSoundEnabled ? "Sound on" : "Sound off";
  $("quakeSoundBtn").setAttribute("aria-pressed", String(quakeSoundEnabled));
  if (!quakeSoundEnabled) stopQuakeSound();
  else {
    prepareQuakeAudio();
    lastQuakeSoundAt = 0;
  }
});

function resetDifficultyDefaults() {
  // Browsers can restore old radio selections despite the HTML checked attribute.
  for (const name of ["difficultyMode"]) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
      input.checked = input.value === "easy";
    });
  }
  if (!currentRoom) {
    $("activeRoomDifficulty").value = "easy";
    $("activeRoomStrength").value = "moderate";
  }
}
resetDifficultyDefaults();
window.addEventListener?.("pageshow", event => {
  if (!event.persisted) {
    resetDifficultyDefaults();
    resetLab();
  }
});
updateLabels();
resetLab();
requestAnimationFrame(animateLab);
animateCity();

// Validate saved bookmarks on load, and again when the teacher returns.
// Shared in-flight lookups avoid fetching the last room twice during startup.
renderTeacherRooms();
if (typeof fetch !== "undefined" && typeof localStorage !== "undefined") {
  restoreSavedTeacherRoom();
  refreshSavedTeacherRooms();
}

$("teacherLoginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("teacherLoginState").textContent = "Checking password...";
  try {
    await api("/api/teacher/login", { password: $("teacherPassword").value });
    $("teacherPassword").value = "";
    $("teacherLoginState").textContent = "";
    teacherUnlocked = true;
    setView("teacher");
    renderRoom();
  } catch (error) {
    $("teacherLoginState").textContent = error.message;
  }
});
$("teacherLogoutBtn").addEventListener("click", async () => {
  await api("/api/teacher/logout");
  teacherUnlocked = false;
  $("teacherPassword").value = "";
  setView("teacher");
  renderRoom();
});
if (typeof fetch !== "undefined") {
  fetch("/api/teacher/session").then(res => res.json()).then(data => {
    teacherUnlocked = data.teacher === true;
    renderRoom();
  }).catch(() => {});
}
