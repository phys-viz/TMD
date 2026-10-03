const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Exercise the actual canvas renderer without starting a browser or the lab.
const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const bodyConstant = source.match(/const HYDRAULIC_BODY_PX = [^;]+;/)[0];
const renderer = source.slice(source.indexOf("function drawHydraulicDamper("), source.indexOf("function drawLockBrace("));
const context = vm.createContext({});
vm.runInContext(bodyConstant + "\n" + renderer, context);

function render(bobX, bobY) {
  const strokes = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, arc() {}, fill() {},
    moveTo(x, y) { this.start = { x, y }; },
    lineTo(x, y) { this.end = { x, y }; },
    stroke() { strokes.push({ start: this.start, end: this.end, width: this.lineWidth }); }
  };
  context.drawHydraulicDamper(ctx, 0, 0, bobX, bobY, 15, -1, "gray");
  const length = stroke => Math.hypot(stroke.end.x - stroke.start.x, stroke.end.y - stroke.start.y);
  return { housing: length(strokes.find(s => s.width === 8)), rod: length(strokes.find(s => s.width === 4)) };
}

const closeBob = render(70, 0);
const farBob = render(160, 0);
const angledBob = render(90, 65);
assert(Math.abs(closeBob.housing - farBob.housing) < 1e-9, "housing length stays fixed as the piston retracts");
assert(Math.abs(closeBob.housing - angledBob.housing) < 1e-9, "housing length stays fixed as the damper rotates");
assert(farBob.rod > closeBob.rod, "the exposed piston rod extends with bob distance");
// Run the full app with the actual HTML inputs and capture its canvas commands.
// This also catches references to removed controls during startup and edits.
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
function canvasRecorder() {
  const drawings = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({ drawings }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => gradient;
      return (...args) => drawings.push({ method: key, args, width: target.lineWidth, color: target.strokeStyle });
    }
  });
  return ctx;
}
function domElement(attributes = "") {
  const attr = name => attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
  const classes = new Set();
  return {
    value: attr("value"), defaultValue: attr("value"), min: attr("min"), max: attr("max"),
    checked: /\bchecked\b/.test(attributes), width: Number(attr("width")), height: Number(attr("height")),
    listeners: {}, dataset: {},
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    dispatch(event) { this.listeners[event](); }
  };
}
const dom = {};
for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) dom[match[1]] = domElement(match[0]);
for (const id of ["stage", "stageCompare", "graph"]) {
  dom[id].ctx = canvasRecorder();
  dom[id].getContext = () => dom[id].ctx;
}
for (const id of ["earthquakeStrength", "roomStrength"]) {
  const buttons = ["gentle", "moderate", "strong"].map(strength => {
    const button = domElement();
    button.dataset.strength = strength;
    button.getAttribute = () => String(strength === "moderate");
    return button;
  });
  dom[id].querySelectorAll = () => buttons;
  dom[id].querySelector = () => buttons[1];
}
let difficulty = "medium";
let clock = 0;
const app = vm.createContext({
  window: { TMDPhysics: require("../public/physics.js") },
  document: {
    getElementById: id => dom[id], querySelectorAll: () => [],
    querySelector: () => ({ value: difficulty })
  },
  performance: { now: () => clock }, requestAnimationFrame() {},
  Math: Object.create(Math)
});
vm.runInContext(source, app);
const state = () => vm.runInContext("sim", app);
const geometry = () => ({
  roof: dom.stage.ctx.drawings.find(d => d.method === "roundRect" && d.args[3] === 18).args,
  column: dom.stage.ctx.drawings.find(d => d.method === "stroke" && d.color === "#1e2d36").width
});
const changeTower = (height, mass) => {
  dom.stage.ctx.drawings.length = 0;
  dom.towerHeightInput.value = String(height);
  dom.towerMassInput.value = String(mass);
  dom.towerHeightInput.dispatch("change");
  return geometry();
};
const short = changeTower(170, 7.5);
const tall = changeTower(350, 7.5);
assert(tall.roof[1] < short.roof[1], "height controls visibly raise the roof");
assert.strictEqual(tall.column, short.column, "height changes preserve column thickness");
const heavy = changeTower(350, 15);
assert(heavy.column > tall.column, "mass controls visibly thicken structural columns");
assert.strictEqual(heavy.roof[1], tall.roof[1], "mass changes preserve the drawn height");
assert.strictEqual(heavy.roof[0], tall.roof[0], "tower changes keep the resting tower on the same foundation");
assert.strictEqual(state().tower.mass, 15e6, "mass input converts million kilograms into physics units");
assert.strictEqual(state().baseline.samples[0].t, 0, "changing towers refreshes the baseline trial");
vm.runInContext("sim.playing = true; sim.state.t = 12; graphCursors = [4, 8]", app);
dom.lengthInput.value = "7.25";
dom.massInput.value = "6.0";
dom.dampingInput.value = "0.31";
app.Math.random = () => 0.5;
dom.randomTowerBtn.dispatch("click");
assert.strictEqual(Number(dom.towerHeightInput.value), 260, "Random fills the editable height field");
assert.strictEqual(Number(dom.towerMassInput.value), 11.3, "Random fills the editable mass field");
assert.strictEqual(state().state.t, 0, "Random resets elapsed time");
assert.strictEqual(state().playing, false, "Random stops the current run");
assert.strictEqual(vm.runInContext("graphCursors.length", app), 0, "tower changes clear old measurement cursors");
assert.strictEqual(state().damper.length, 7.25, "Random preserves student length instead of supplying a tuned answer");
assert.strictEqual(state().damper.massRatio, 0.06, "Random preserves the selected TMD mass ratio");
assert.strictEqual(state().damper.damping, 0.31, "Random preserves the selected damping");
changeTower(999, 99);
assert.strictEqual(Number(dom.towerHeightInput.value), 350, "height field visibly clamps to its limit");
assert.strictEqual(Number(dom.towerMassInput.value), 15, "mass field visibly clamps to its limit");
assert.strictEqual(dom.labSwayLimit.textContent, state().pulse.collapseSway.toFixed(2), "model notes show the active game sway limit");
assert.strictEqual(dom.metrics, undefined, "the four metric cards have been removed");
assert.strictEqual(dom.primaryHeat, undefined, "thermal energy display is deferred");
assert.strictEqual(dom.showDangerInput.disabled, false, "danger toggle is enabled on Medium");
difficulty = "easy";
vm.runInContext("resetLab()", app);
assert.strictEqual(dom.showDangerInput.disabled, true, "danger toggle is disabled on Easy");
difficulty = "hard";
vm.runInContext("resetLab()", app);
assert.strictEqual(dom.showDangerInput.disabled, false, "switching back enables the toggle");
assert.strictEqual(dom.showDangerInput.checked, true, "difficulty changes preserve the visibility preference");

difficulty = "easy";
dom.compareEnabled.checked = true;
dom.compareEnabled.dispatch("change");
const comparison = () => vm.runInContext("compareSim", app);
assert.strictEqual(comparison().tower, state().tower, "comparison towers have identical physical properties");
assert.strictEqual(comparison().pulse, state().pulse, "comparison towers receive exactly the same earthquake and difficulty");
assert.strictEqual(comparison().damper.enabled, false, "Tower A starts without a TMD");
assert.strictEqual(state().damper.enabled, true, "Tower B retains the student's installed TMD");
assert.strictEqual(comparison().damper.length, state().damper.length, "the comparison starts from the current TMD design");
assert.strictEqual(dom.compareTower.hidden, false, "Compare displays the second tower");
assert(dom.labSimulation.classList.contains("compare-mode"), "Compare selects the side-by-side layout");
dom.playBtn.dispatch("click");
clock = 40;
vm.runInContext("animateLab(40)", app);
assert(state().state.t > 0, "shared Start advances Tower B");
assert.strictEqual(comparison().state.t, state().state.t, "shared Start advances both on the same clock");
dom.pauseBtn.dispatch("click");
const pausedTime = state().state.t;
clock = 90;
vm.runInContext("animateLab(90)", app);
assert.strictEqual(state().state.t, pausedTime, "shared Pause freezes Tower B");
assert.strictEqual(comparison().state.t, pausedTime, "shared Pause freezes Tower A");
dom.playBtn.dispatch("click");
clock = 130;
vm.runInContext("animateLab(130)", app);
assert(state().state.t > pausedTime, "shared Start resumes the paused trial");

dom.compareDamperEnabled.checked = true;
dom.compareDamperEnabled.dispatch("input");
vm.runInContext("for (let i = 0; i < 100; i++) stepLive(0.02)", app);
assert.deepStrictEqual(comparison().state, state().state, "identical TMD designs produce identical coupled motion");
dom.compareLengthInput.value = "2";
dom.compareLengthInput.dispatch("input");
assert.strictEqual(state().damper.length, 7.25, "editing Tower A leaves Tower B's design intact");
assert.strictEqual(comparison().state.t, 0, "editing either TMD resets both runs for a fair comparison");
vm.runInContext("for (let i = 0; i < 200; i++) stepLive(0.02); renderLab()", app);
assert(Math.abs(comparison().state.x - state().state.x) > 1e-5, "different TMD designs produce different motion");
assert.strictEqual(comparison().state.t, state().state.t, "different designs remain synchronized");
assert(dom.graph.ctx.drawings.some(d => d.method === "stroke" && d.color === "#0f7b7e"), "the shared graph draws Tower A's trace");
assert(dom.graph.ctx.drawings.some(d => d.method === "stroke" && d.color === "#245e9b"), "the shared graph draws Tower B's trace");

for (const mode of ["easy", "medium", "hard"]) {
  difficulty = mode;
  dom.compareLengthInput.value = "10";
  vm.runInContext("resetLab(); compareSim.state.th = Math.asin(2.5 / compareSim.damper.length); compareSim.state.w = 0.2", app);
  dom.playBtn.dispatch("click");
  vm.runInContext("stepLive(0.01); renderLab()", app);
  assert.strictEqual(comparison().failed, true, `one wall hit fails Tower A on ${mode}`);
  assert.strictEqual(comparison().state.hits, 1, "the first physical hit is terminal");
  assert.strictEqual(comparison().failureCause, "Wall hit — failed", "the failure cause is explicit");
  assert.strictEqual(state().failed, false, "a wall hit leaves the other tower standing");
  assert.strictEqual(state().playing, true, "a failed tower does not stop its counterpart");
  assert.strictEqual(dom.compareHits.textContent, "1", "the impact count stays visible after failure");
  assert(dom.compareHitIndicator.classList.contains("impact"), "the first hit visibly highlights its label");
  const failedTime = comparison().state.t;
  vm.runInContext("for (let i = 0; i < 10; i++) stepLive(0.01)", app);
  assert.strictEqual(comparison().state.t, failedTime, "the failed tower stops integrating immediately");
  assert(state().state.t > failedTime, "the standing tower continues the earthquake on the shared clock");
}
dom.resetBtn.dispatch("click");
assert.strictEqual(state().state.t, 0, "shared Reset rewinds Tower B");
assert.strictEqual(comparison().state.t, 0, "shared Reset rewinds Tower A");
assert.strictEqual(comparison().state.hits, 0, "shared Reset clears wall-hit failures");
assert.strictEqual(comparison().failed, false, "shared Reset restores the failed tower");
const soloLength = state().damper.length;
dom.compareEnabled.checked = false;
dom.compareEnabled.dispatch("change");
assert.strictEqual(comparison(), null, "leaving Compare restores a single run");
assert.strictEqual(state().damper.length, soloLength, "leaving Compare preserves the original TMD design");
assert.strictEqual(dom.compareTower.hidden, true, "leaving Compare hides Tower A");
console.log("rendering tests passed");
