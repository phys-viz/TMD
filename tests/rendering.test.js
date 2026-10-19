const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Exercise the actual canvas renderer without starting a browser or the lab.
const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const bodyConstant = source.match(/const HYDRAULIC_BODY_PX = [^;]+;/)[0];
const renderer = source.slice(source.indexOf("function drawHydraulicDamper("), source.indexOf("function drawLockBrace("));
const context = vm.createContext({ P: require("../public/physics.js") });
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
  const rodStroke = strokes.find(s => s.width === 4);
  assert.deepEqual(rodStroke.end, { x: bobX, y: bobY }, "hydraulic rods extend behind the TMD ball to keep the joint connected");
  return { housing: length(strokes.find(s => s.width === 8)), rod: length(rodStroke) };
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
      if (key === "measureText") return text => ({ width: String(text).length * 7 });
      return (...args) => drawings.push({ method: key, args, width: target.lineWidth, color: target.strokeStyle, fillColor: target.fillStyle, font: target.font });
    }
  });
  return ctx;
}
function domElement(attributes = "") {
  const attr = name => attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
  const classes = new Set();
  return {
    value: attr("value"), defaultValue: attr("value"), min: attr("min"), max: attr("max"), step: attr("step"),
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
for (const id of ["stage", "stageCompare", "graph", "graphCompare"]) {
  dom[id].ctx = canvasRecorder();
  dom[id].getContext = () => dom[id].ctx;
  dom[id].getBoundingClientRect = () => ({ left: 0, width: dom[id].width });
}
for (const id of ["earthquakeStrength"]) {
  const buttons = ["gentle", "moderate", "strong"].map(strength => {
    const button = domElement();
    button.dataset.strength = strength;
    button.getAttribute = () => String(strength === "moderate");
    return button;
  });
  dom[id].querySelectorAll = () => buttons;
  dom[id].querySelector = () => buttons[1];
}
// Simulate a browser restoring a previous Medium selection before startup.
let difficulty = "medium";
const difficultyInputs = [...html.matchAll(/<input[^>]+name="difficultyMode"[^>]*>/g)].map(match => {
  const input = domElement(match[0]);
  Object.defineProperty(input, "checked", {
    get: () => difficulty === input.value,
    set: checked => { if (checked) difficulty = input.value; }
  });
  return input;
});
const pageListeners = {};
let clock = 0;
const app = vm.createContext({
  window: { TMDPhysics: require("../public/physics.js"), addEventListener: (event, callback) => { pageListeners[event] = callback; } },
  document: {
    getElementById: id => dom[id],
    querySelectorAll: selector => selector === 'input[name="difficultyMode"]' ? difficultyInputs
      : [],
    querySelector: () => ({ value: difficulty })
  },
  performance: { now: () => clock }, requestAnimationFrame() {},
  Math: Object.create(Math)
});
function contactAngle(tower, damper, side = 1, sway = 0) {
  const P = require("../public/physics.js");
  let low = 0, high = 0;
  for (let angle = 0.001; angle < Math.PI / 2; angle += 0.001) {
    if (P.pendulumContact(tower, damper, side * angle, sway).clearance <= 0) { high = angle; break; }
    low = angle;
  }
  assert(high > low, "fixture has a reachable contact");
  for (let i = 0; i < 35; i++) {
    const mid = (low + high) / 2;
    if (P.pendulumContact(tower, damper, side * mid, sway).clearance <= 0) high = mid; else low = mid;
  }
  return side * high;
}
app.contactAngle = contactAngle;
// Simulate restored Solo values before a fresh load.
dom.damperEnabled.checked = true;
dom.lengthInput.value = '8.4';
dom.massInput.value = '3.5';
vm.runInContext(source, app);
const state = () => vm.runInContext("sim", app);
assert.equal(state().pulse.difficulty, "easy", "fresh startup overrides restored Medium with Easy");
assert.equal(dom.showDangerInput.disabled, true, "Easy default disables the danger zone control");
assert.equal(state().damper.enabled, false, "fresh Solo starts without a TMD despite restored forms");
assert.equal(Number(dom.lengthInput.value), .7, "Solo starts at minimum length");
assert.equal(Number(dom.massInput.value), 1, "Solo starts at minimum mass");
difficulty = "hard";
dom.activeRoomDifficulty.value = "medium";
pageListeners.pageshow({ persisted: false });
assert.equal(state().pulse.difficulty, "easy", "Easy also wins over form restoration during page load");
assert.equal(dom.activeRoomDifficulty.value, "easy", "new teacher setup defaults to Easy");
// The remaining danger/geometry checks exercise an explicitly selected Medium trial.
difficulty = "medium";
vm.runInContext("resetLab()", app);

assert.equal(state().damper.damping, 0, "Solo Lab starts with zero damping");
assert.equal(Number(dom.compareDampingInput.value), 0, "comparison starts with zero damping");
for (const [id, minimum] of [["submitLength", .7], ["submitMass", 1], ["submitDamping", 0]]) {
  assert.equal(Number(dom[id].value), minimum, "new student fields start at their minimum available settings");
  assert.equal(Number(dom[id].min), minimum, "native stepping cannot go below the available settings");
}
for (const id of ["lengthInput", "massInput", "dampingInput", "compareLengthInput", "compareMassInput", "compareDampingInput", "submitLength", "submitMass", "submitDamping", "dampingSlider", "compareDampingSlider"]) {
  assert.equal(dom[id].step, '0.05', "T/M/D controls use the same 0.05 arrow increment");
}
assert.strictEqual(vm.runInContext("graphRange().start", app), 0, "Solo graph starts at zero by default");
assert.strictEqual(vm.runInContext("graphRange().end", app), 120, "Solo graph shows the full 120-second trial by default");
const primaryTmdFields = ["lengthInput", "massInput", "dampingInput", "dampingSlider"];
const comparisonTmdFields = ["compareLengthInput", "compareMassInput", "compareDampingInput", "compareDampingSlider"];
const savedTmdValues = primaryTmdFields.map(id => String(dom[id].value));
assert.equal(dom.earthquakeStatus.hidden, true, "idle earthquake controls contain no explanatory paragraph");
assert(primaryTmdFields.every(id => dom[id].disabled === true), "starting Solo TMD fields are disabled");
dom.damperEnabled.checked = false;
dom.damperEnabled.dispatch("input");
assert(primaryTmdFields.every(id => dom[id].disabled === true), "uninstalling the TMD disables all its numeric inputs and slider");
assert.deepEqual(primaryTmdFields.map(id => String(dom[id].value)), savedTmdValues, "uninstalling preserves the chosen settings");
assert.equal(state().damper.enabled, false, "unchecked TMD is also absent from the model");
dom.damperEnabled.checked = true;
dom.damperEnabled.dispatch("input");
assert(primaryTmdFields.every(id => dom[id].disabled === false), "reinstalling re-enables its controls");
assert.deepEqual(primaryTmdFields.map(id => String(dom[id].value)), savedTmdValues, "reinstalling restores the same choices");
dom.massInput.value = '1.05';
dom.massInput.dispatch('change');
assert.equal(Number(dom.massInput.value), 1.05, "committing mass preserves a 0.05 increment");
assert.equal(state().damper.massRatio, .0105, "the simulation receives the full mass precision");
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
assert.strictEqual(heavy.roof[0] + heavy.roof[2] / 2, tall.roof[0] + tall.roof[2] / 2, "tower changes keep the resting tower on the same foundation");
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

// Danger labels must fit the visible red bands, including at earthquake extremes.
for (const groundPosition of [-0.8, -0.4, 0, 0.4, 0.8]) {
  dom.stage.ctx.drawings.length = 0;
  vm.runInContext(`drawStage({ ...P.sampleState(sim.state, sim.tower, sim.damper, sim.pulse), y: ${groundPosition} })`, app);
  const bands = dom.stage.ctx.drawings.filter(d => d.method === "fillRect" && d.args[1] === 0 && d.args[3] === dom.stage.height - 44);
  const labels = dom.stage.ctx.drawings.filter(d => d.method === "fillText" && d.args[0] === "danger");
  labels.forEach(label => {
    const x = label.args[1];
    const band = bands.find(b => x >= b.args[0] && x <= b.args[0] + b.args[2]);
    assert(band, "danger text remains inside a visible shaded band");
    assert(Math.abs(x - (band.args[0] + band.args[2] / 2)) < 1e-9, "danger text follows the center of its band");
    const textWidth = 42 * Number(label.font.match(/([\d.]+)px/)[1]) / 12;
    assert(x - textWidth / 2 >= band.args[0] && x + textWidth / 2 <= band.args[0] + band.args[2], "the whole danger label fits within the band");
  });
}

const heatColor = energy => vm.runInContext(`strutHeatColor(${energy}, 10000)`, app).match(/\d+/g).map(Number);
const cold = heatColor(0);
const justWarm = heatColor(10000);
assert(justWarm[0] - cold[0] < 10, "initial energy produces a subtle warming instead of immediately turning red");
let previous = cold;
for (const energy of [5000, 10000, 40000, 80000, 160000, 320000]) {
  const color = heatColor(energy);
  assert(color[0] >= previous[0] && color[1] <= previous[1] && color[2] <= previous[2], "increasing heat warms the color monotonically");
  previous = color;
}
assert(previous[0] > previous[1] && previous[0] > previous[2], "high accumulated heat remains visibly red");
assert.deepStrictEqual(heatColor(-1), cold, "nonpositive energy keeps the cold color");
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
assert(comparisonTmdFields.every(id => dom[id].disabled === true), "Tower A's uninstalled TMD controls start disabled");
assert(primaryTmdFields.every(id => dom[id].disabled === false), "Tower B remains independently editable");
assert.strictEqual(comparison().damper.length, state().damper.length, "the comparison starts from the current TMD design");
assert.strictEqual(dom.compareTower.hidden, false, "Compare displays the second tower");
assert.strictEqual(vm.runInContext("graphRange(true).end", app), 120, "Tower A also defaults to the full trial");
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
assert(comparisonTmdFields.every(id => dom[id].disabled === false), "installing Tower A enables its own fields");
assert(primaryTmdFields.every(id => dom[id].disabled === false), "Tower A's toggle does not disable Tower B");
vm.runInContext("for (let i = 0; i < 100; i++) stepLive(0.02)", app);
assert.deepStrictEqual(comparison().state, state().state, "identical TMD designs produce identical coupled motion");
dom.compareLengthInput.value = "2";
dom.compareLengthInput.dispatch("input");
assert.strictEqual(state().damper.length, 7.25, "editing Tower A leaves Tower B's design intact");
assert.strictEqual(comparison().state.t, 0, "editing either TMD resets both runs for a fair comparison");
dom.graph.ctx.drawings.length = 0;
dom.graphCompare.ctx.drawings.length = 0;
vm.runInContext("for (let i = 0; i < 200; i++) stepLive(0.02); renderLab()", app);
assert(Math.abs(comparison().state.x - state().state.x) > 1e-5, "different TMD designs produce different motion");
assert.strictEqual(comparison().state.t, state().state.t, "different designs remain synchronized");
const hasTrace = (id, color) => dom[id].ctx.drawings.some(d => d.method === "stroke" && d.color === color);
assert(hasTrace("graphCompare", "#0f7b7e"), "Tower A's graph draws its own trace");
assert(!hasTrace("graphCompare", "#245e9b"), "Tower A's graph does not overlay Tower B");
assert(hasTrace("graph", "#245e9b"), "Tower B's graph draws its own trace");
assert(!hasTrace("graph", "#0f7b7e"), "Tower B's graph does not overlay Tower A");
for (const [id, color] of [["stageCompare", "#0f7b7e"], ["stage", "#245e9b"]]) {
  dom[id].ctx.drawings.length = 0;
}
vm.runInContext("renderLab()", app);
for (const [id, color] of [["stageCompare", "#0f7b7e"], ["stage", "#245e9b"]]) {
  const roof = dom[id].ctx.drawings.find(d => d.method === "roundRect" && d.args[3] === 18);
  const badge = dom[id].ctx.drawings.find(d => d.method === "roundRect" && d.args[3] === 28);
  assert.equal(roof.fillColor, color, "each comparison roof matches its trace identity");
  assert.equal(badge.fillColor, color, "roof and A/B badge use the same color");
}

const swayLabel = id => dom[id].ctx.drawings.find(d => d.method === "fillText" && /^\d.* m$/.test(d.args[0])).args[0];
assert.strictEqual(swayLabel("graphCompare"), swayLabel("graph"), "separate graphs retain matching sway scales");
for (const id of ["graph", "graphCompare"]) {
  assert(dom[id].ctx.drawings.some(d => d.method === "fillText" && d.args[0] === "Building"), "each plot has a sway axis label");
  assert(!dom[id].ctx.drawings.some(d => d.method === "rotate"), "sway labels are horizontal");
  assert(!dom[id].ctx.drawings.some(d => d.method === "fillText" && /roof sway|click graph/.test(d.args[0])), "crossed-out plot headings and instructions are removed");
}

const clickAt = (id, time) => dom[id].listeners.click({ clientX: 72 + time / 120 * (dom[id].width - 90) });
clickAt("graph", 4);
clickAt("graph", 8);
clickAt("graphCompare", 6);
clickAt("graphCompare", 12);
assert.strictEqual(vm.runInContext("graphCursors.length", app), 2, "Tower B keeps its measurement cursors");
assert(Math.abs(vm.runInContext("compareGraphCursors[1] - compareGraphCursors[0]", app) - 6) < 1e-9, "Tower A has independent measurement cursors");
dom.compareGraphStartInput.value = "2";
dom.compareGraphEndInput.value = "14";
dom.compareGraphEndInput.dispatch("change");
assert.strictEqual(Number(dom.graphEndInput.value), 120, "editing Tower A's window preserves Tower B's window");
assert.strictEqual(vm.runInContext("compareGraphCursors.length", app), 0, "editing a window clears its old cursors");
assert.strictEqual(vm.runInContext("graphCursors.length", app), 2, "editing Tower A preserves Tower B's cursors");
const sharedTime = vm.runInContext("labTime", app);
dom.compareGraphStartInput.value = "0";
dom.compareGraphEndInput.value = "120";
assert.strictEqual(vm.runInContext("graphRange(true).end", app), 14, "typing an axis limit leaves the current plot stable until committed");
dom.compareGraphEndInput.dispatch("change");
assert.strictEqual(vm.runInContext("graphRange(true).end", app), 120, "editing the axis limits can show the full run");
assert.strictEqual(Number(dom.graphEndInput.value), 120, "editing Tower A's axis leaves Tower B's window alone");
assert.strictEqual(vm.runInContext("labTime", app), sharedTime, "editing graph limits preserves the simulation time");
dom.compareGraphStartInput.value = "200";
dom.compareGraphEndInput.value = "-8";
dom.compareGraphEndInput.dispatch("change");
assert.strictEqual(Number(dom.compareGraphStartInput.value), 119.5, "out-of-range axis edits clamp to the run duration");
assert.strictEqual(Number(dom.compareGraphEndInput.value), 120, "reversed limits retain at least half a second of visible time");
assert.strictEqual(dom.graphLatestBtn, undefined, "the separate Latest button is removed");
assert.strictEqual(dom.graphFullBtn, undefined, "the separate Full button is removed");
assert.strictEqual(dom.primaryHits, undefined, "wall-hit readouts are removed");
assert.strictEqual(dom.primaryTmdState, undefined, "redundant TMD state readouts are removed");
assert.strictEqual(dom.primaryGraphHeading, undefined, "external graph headings are removed");
vm.runInContext("setGraphRange(0, 120, true)", app);

for (const mode of ["easy", "medium", "hard"]) {
  difficulty = mode;
  dom.compareLengthInput.value = "10";
  vm.runInContext("resetLab(); compareSim.state.th = contactAngle(compareSim.tower, compareSim.damper) - 0.0002; compareSim.state.w = 0.2", app);
  dom.playBtn.dispatch("click");
  vm.runInContext("stepLive(0.01); renderLab()", app);
  assert.strictEqual(comparison().failed, true, `one wall hit fails Tower A on ${mode}`);
  assert.strictEqual(comparison().state.hits, 1, "the first displayed contact is terminal");
  assert.strictEqual(comparison().failureCause, "Collision — failed", "the failure cause is explicit");
  assert.strictEqual(state().failed, false, "a wall hit leaves the other tower standing");
  assert.strictEqual(state().playing, true, "a failed tower does not stop its counterpart");
  assert.strictEqual(dom.compareFailure.textContent, comparison().failureCause, "the failure cause remains accessible without a status row");
  assert(dom.graphCompare.ctx.drawings.some(d => d.method === "fillText" && d.args[0] === comparison().failureCause), "the failed tower's graph identifies its failure cause");
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
assert.strictEqual(dom.compareFailure.textContent, "", "shared Reset clears the failure announcement");
assert.strictEqual(vm.runInContext("graphCursors.length + compareGraphCursors.length", app), 0, "shared Reset clears both graph measurements");
const soloLength = state().damper.length;
dom.compareEnabled.checked = false;
dom.compareEnabled.dispatch("change");
assert.strictEqual(comparison(), null, "leaving Compare restores a single run");
assert.strictEqual(state().damper.length, soloLength, "leaving Compare preserves the original TMD design");
assert.strictEqual(dom.compareTower.hidden, true, "leaving Compare hides Tower A");
dom.graph.ctx.drawings.length = 0;
vm.runInContext("renderLab()", app);
assert(hasTrace("graph", "#0f7b7e"), "Solo retains its own sway graph");
dom.damperEnabled.checked = true;
dom.dampingSlider.value = "0.99";
dom.stage.ctx.drawings.length = 0;
dom.dampingSlider.dispatch("input");
assert.strictEqual(dom.dampingInput.value, "0.99", "slider displays damping to hundredths");
assert.strictEqual(state().damper.damping, 0.99, "slider updates the simulated resistance");
assert(!dom.stage.ctx.drawings.some(d => d.method === "fillText" && d.args[0] === "LOCKED"), "0.99 is not visually locked");
dom.dampingInput.value = "0.986";
dom.dampingInput.dispatch("change");
assert.strictEqual(dom.dampingInput.value, "0.99", "numeric edits round to hundredths on commit");
assert.strictEqual(Number(dom.dampingSlider.value), 0.99, "numeric edits synchronize the slider");
assert.strictEqual(state().damper.damping, 0.99, "committed damping uses hundredths in the simulation");
dom.dampingSlider.value = "1";
dom.stage.ctx.drawings.length = 0;
dom.dampingSlider.dispatch("input");
assert.strictEqual(dom.dampingInput.value, "1.00", "the lock endpoint is explicit in the readout");
assert.strictEqual(dom.dampingSlider["aria-valuetext"], "1.00, locked", "the lock endpoint is accessible");
assert(dom.stage.ctx.drawings.some(d => d.method === "fillText" && d.args[0] === "LOCKED"), "only the endpoint shows lock braces");
dom.compareEnabled.checked = true;
dom.compareEnabled.dispatch("change");
dom.compareDampingSlider.value = "0.99";
dom.compareDampingSlider.dispatch("input");
assert.strictEqual(comparison().damper.damping, 0.99, "Tower A has an independent resistance slider");
assert.strictEqual(state().damper.damping, 1, "Tower A edits preserve Tower B's lock setting");
assert.strictEqual(vm.runInContext("labTime", app), 0, "resistance edits reset the shared trial");
// The bob follows its angle continuously right up to contact, without a
// separate visual clamp that could pin it while the physical angle changes.
vm.runInContext("resetLab(); sim.damper = { ...sim.damper, length: 10.3, massRatio: 0.01, damping: 0.1, enabled: true }", app);
const travel = vm.runInContext("P.pendulumGeometry(sim.tower, sim.damper)", app);
const limitAngle = contactAngle(state().tower, state().damper);
const offsets = [];
for (const fraction of [0.8, 0.9, 0.99]) {
  dom.stage.ctx.drawings.length = 0;
  const angle = limitAngle * fraction;
  vm.runInContext(`drawStage({ ...P.sampleState(sim.state, sim.tower, sim.damper, sim.pulse), theta: ${angle} })`, app);
  const bob = dom.stage.ctx.drawings.find(d => d.method === "arc" && Math.abs(d.args[2] - travel.bobRadiusPx) < 1e-9);
  assert(bob, "the live bob remains visible before contact");
  const offset = bob.args[0] - dom.stage.width / 2;
  assert(Math.abs(offset - app.window.TMDPhysics.pendulumPose(travel, angle, state().damper.length).x) < 1e-9, "displayed displacement follows the actual pendulum angle");
  assert(Math.abs(offset - travel.pxPerMeter * state().damper.length * Math.sin(angle)) < 1e-9, "drawn offset is the true bob offset at the cutaway scale");
  offsets.push(offset);
}
assert(offsets[0] < offsets[1] && offsets[1] < offsets[2], "bob keeps moving as it approaches the displayed contact limit");
for (const sway of [-0.8, -0.4, 0, 0.4, 0.8]) {
  dom.stage.ctx.drawings.length = 0;
  vm.runInContext(`drawStage({ ...P.sampleState(sim.state, sim.tower, sim.damper, sim.pulse), sway: ${sway}, y: 0.3, theta: 0 })`, app);
  const P = app.window.TMDPhysics;
  const g = P.pendulumGeometry(state().tower, state().damper, sway);
  const commands = dom.stage.ctx.drawings;
  const housings = commands.map((command, index) => ({ ...command, index })).filter(d => d.method === "stroke" && d.width === 8 && /^rgb/.test(d.color));
  assert.strictEqual(housings.length, 2, "both rigid housings remain visible while the tower sways");
  housings.forEach((housing, index) => {
    const start = commands.slice(0, housing.index).findLast(d => d.method === "moveTo").args;
    const end = commands.slice(0, housing.index).findLast(d => d.method === "lineTo").args;
    const side = index === 0 ? -1 : 1;
    const expectedX = dom.stage.width / 2 + 0.3 * 132 + sway * 132 * (436 - g.anchorY) / (436 - g.top) + side * 108;
    assert(Math.abs(start[0] - expectedX) < 1e-9 && start[1] === g.anchorY, "each housing starts exactly on its moving column");
    assert(Math.abs(Math.hypot(end[0] - start[0], end[1] - start[1]) - P.hydraulicBodyPx) < 1e-9, "housing length stays fixed at every sway position");
  });
}
for (const damping of [0, 0.1]) for (const side of [-1, 1]) {
  vm.runInContext(`resetLab(); sim.damper = { ...sim.damper, length: ${damping ? 8.4 : 10.3}, massRatio: 0.01, damping: ${damping}, enabled: true }; sim.state.th = contactAngle(sim.tower, sim.damper, ${side}) - ${side} * 0.0002; sim.state.w = ${side} * 0.2; stepLive(0.01); sim.collapseAge = 0.2`, app);
  assert.strictEqual(state().failed, true, "visible contact immediately fails the tower");
  dom.stage.ctx.drawings.length = 0;
  vm.runInContext("renderLab()", app);
  const P = app.window.TMDPhysics;
  const sample = P.sampleState(state().state, state().tower, state().damper, state().pulse);
  const g = P.pendulumGeometry(state().tower, state().damper, sample.sway);
  const bob = dom.stage.ctx.drawings.find(d => d.method === "arc" && d.args[2] === g.bobRadiusPx);
  assert(bob, "failed tower briefly retains its bob at the impact pose");
  const marker = dom.stage.ctx.drawings.find(d => d.method === "fillText" && d.args[0] === "IMPACT");
  assert(Math.abs(Math.hypot(bob.args[0] - marker.args[1], bob.args[1] - (marker.args[2] + 19)) - g.bobRadiusPx) < 0.000001, "impact marker lies exactly on the bob's touching surface");
  assert.strictEqual(state().state.contact.kind, damping > 0 ? "housing" : "wall", "the recorded contact names the touched surface");
  assert(dom.stage.ctx.drawings.some(d => d.method === "fillText" && d.args[0] === "IMPACT"), "the contact is visibly marked before collapse");
  vm.runInContext("sim.collapseAge = 0.46", app);
  dom.stage.ctx.drawings.length = 0;
  vm.runInContext("renderLab()", app);
  assert(dom.stage.ctx.drawings.some(d => d.method === "fillText" && d.args[0] === "FAILED"), "collapse animation follows the brief impact pose");
  assert(!dom.stage.ctx.drawings.some(d => d.method === "fillText" && d.args[0] === "IMPACT"), "the impact marker clears after its brief hold");
}
const dangerLabels = id => dom[id].ctx.drawings.filter(d => d.method === "fillText" && d.args[0].startsWith("Danger time:"));
for (const mode of ["medium", "hard", "easy"]) {
  difficulty = mode;
  vm.runInContext("resetLab(); sim.overLimitTime = 1.239; compareSim.overLimitTime = 0.567", app);
  for (const id of ["graph", "graphCompare"]) dom[id].ctx.drawings.length = 0;
  vm.runInContext("renderLab()", app);
  if (mode === "easy") {
    assert.strictEqual(dangerLabels("graph").length, 0, "Easy has no danger-time badge");
    assert.strictEqual(dangerLabels("graphCompare").length, 0, "Easy hides both danger-time badges");
    assert.strictEqual(dom.primaryDangerTime.textContent, "", "Easy clears the accessible danger-time readout");
  } else {
    const limit = mode === "hard" ? "2.50" : "3.00";
    assert.strictEqual(dangerLabels("graph")[0].args[0], `Danger time: 1.23 / ${limit} s`, "the plot shows accumulated danger time and the mode's limit in hundredths");
    assert.strictEqual(dangerLabels("graphCompare")[0].args[0], `Danger time: 0.56 / ${limit} s`, "each tower has an independent danger-time counter");
    assert.strictEqual(dom.primaryDangerTime.textContent, dangerLabels("graph")[0].args[0], "accessible counter matches the plotted counter");
    assert.strictEqual(dom.compareDangerTime.textContent, dangerLabels("graphCompare")[0].args[0], "Tower A's accessible counter matches its plot");
  }
}
difficulty = "hard";
vm.runInContext("resetLab(); sim.overLimitTime = 2.499; renderLab()", app);
assert.strictEqual(dom.primaryDangerTime.textContent, "Danger time: 2.49 / 2.50 s", "the counter never rounds up to the limit before failure");
dom.graph.ctx.drawings.length = 0;
vm.runInContext("sim.overLimitTime = 2.5; renderLab()", app);
assert.strictEqual(dom.primaryDangerTime.textContent, "Danger time: 2.50 / 2.50 s", "reaching the limit shows the complete danger allowance");
assert.strictEqual(dangerLabels("graph")[0].fillColor, "#b63030", "the limit is highlighted when danger time reaches it");
vm.runInContext("resetLab()", app);
assert.strictEqual(dom.primaryDangerTime.textContent, "Danger time: 0.00 / 2.50 s", "Reset clears the counter");
assert.strictEqual(dom.graph.height, 210, "inline readout adds no height to the plot");
// The city uses the student tower renderer for every pair, including TMD hardware.
dom.cityCanvas.ctx = canvasRecorder();
dom.cityCanvas.getContext = () => dom.cityCanvas.ctx;
dom.resultsTable.querySelector = () => ({ innerHTML: "" });
vm.runInContext(`currentRoom = {
  code: "DEMO", phase: "design", config: {}, quake: null, results: [],
  students: Array.from({ length: 12 }, (_, i) => ({
    nickname: "Pair " + (i + 1), tower: P.generateTower("city-render", i),
    submission: { ...P.defaultDamperFor(P.generateTower("city-render", i)), damping: 0.45 }
  }))
}; renderCity()`, app);
const cityDrawings = dom.cityCanvas.ctx.drawings;
assert.equal(cityDrawings.filter(d => d.method === "roundRect" && d.fillColor === "#0f7b7e").length, 12, "each city tower has the student tower's teal roof");
assert.equal(cityDrawings.filter(d => d.method === "stroke" && d.width === 8).length, 24, "each pair has both hydraulic housings");
assert.equal(cityDrawings.filter(d => d.method === "fillText" && String(d.args[0]).startsWith("Pair ")).length, 12, "all pairs keep readable skyline labels");
assert.equal(cityDrawings.filter(d => d.method === "fillRect" && d.args[2] === 420).length, 0, "individual towers do not paint over their neighbors");
const cityScales = cityDrawings.filter(d => d.method === "scale");
for (const command of cityScales) {
  const [sx, sy] = command.args;
  assert(Math.abs(sx - sy) < 1e-9, "City roofs, rods, housings and bobs all retain their proportions");
}
// Check the rod's displayed length throughout the swing at sparse and full City sizes.
for (const count of [1, 12]) for (const height of [170, 350]) for (const theta of [-.4, 0, .4]) {
  dom.cityCanvas.ctx.drawings.length = 0;
  vm.runInContext(`currentRoom = {
    code: "PROPORTIONS", phase: "design", config: {}, quake: null, results: [],
    students: Array.from({ length: ${count} }, () => ({ nickname: "Test", tower: P.createLabTower(${height}, 11.5e6),
      submission: { enabled: true, length: 10.3, massRatio: .04, damping: 0 },
      result: { status: "standing", samples: [{ t: 0, y: 0, sway: 0, theta: ${theta}, heat: 0 }] }
    }))
  }; renderCity()`, app);
  const commands = dom.cityCanvas.ctx.drawings;
  // One extra skyline slot holds the local landmark.
  const displayScale = Math.min(.3, 1100 / (count + 1) / 420);
  const rods = commands.map((command, index) => ({ ...command, index })).filter(d => d.method === "stroke" && d.width === 2 && d.color === "#1e2d36");
  assert.equal(rods.length, count);
  for (const rod of rods) {
    const path = commands.slice(0, rod.index);
    const from = path.findLast(d => d.method === "moveTo").args;
    const to = path.findLast(d => d.method === "lineTo").args;
    const TP = app.window.TMDPhysics;
    const expectedPx = TP.pendulumGeometry(TP.createLabTower(height, 11.5e6), { enabled: true, length: 10.3, massRatio: .04, damping: 0 }).lengthPx;
    assert(Math.abs(Math.hypot(to[0] - from[0], to[1] - from[1]) * displayScale - expectedPx * displayScale) < 1e-9,
      "displayed City rod length stays constant as it swings");
  }
  const layout = app.window.TMDPhysics.towerGeometry(app.window.TMDPhysics.createLabTower(height, 11.5e6));
  const roofs = commands.filter(d => d.method === "roundRect" && d.fillColor === "#0f7b7e");
  for (const roof of roofs) {
    assert.equal(roof.args[2], layout.towerWidth + layout.columnWidth, "roof spans the outer column edges");
    assert.equal(roof.args[3], 18, "roof retains its shallow thickness");
  }
  const foundations = commands.filter(d => d.method === "roundRect" && d.fillColor === "#cedee5");
  const desiredHeight = 180 + (height - 170) / 180 * 160;
  assert(Math.abs((foundations[0].args[1] + 8 - layout.top) * displayScale - desiredHeight) < 1e-9,
    "City keeps its intended skyline height without stretching the pendulum");
}
// The original buckle remains, followed by a ground-level rubble ending.
function collapseDrawing(age) {
  dom.stage.ctx.drawings.length = 0;
  vm.runInContext(`drawStage(P.sampleState(sim.state, sim.tower, sim.damper, sim.pulse), { ...sim, failed: true, state: {}, collapseAge: ${age} })`, app);
  return [...dom.stage.ctx.drawings];
}
const buckleDrawing = collapseDrawing(2.2);
const rubbleDrawing = collapseDrawing(3.6);
const columnTips = drawings => drawings.filter(d => d.method === "quadraticCurveTo").map(d => d.args[3]);
assert(columnTips(buckleDrawing).every(y => y < dom.stage.height - 100), "the original crash still leaves a buckled structure before pulverizing");
assert.equal(columnTips(rubbleDrawing).length, 0, "the completed collapse draws no remaining columns");
assert.equal(rubbleDrawing.filter(d => d.method === "fillRect").length - buckleDrawing.filter(d => d.method === "fillRect").length, 47, "the ending replaces the nine flying beams with 56 settled rubble fragments");
const failureTitle = rubbleDrawing.find(d => d.method === "fillText" && d.args[0] === "FAILED");
assert.deepEqual(failureTitle.args, ["FAILED", dom.stage.width / 2, dom.stage.height / 2], "failure title is centered in the tower view");
assert.equal(failureTitle.font, "bold 52px system-ui", "failure title is large enough to stand out");
// Intro, ground shaking, settling, and aftermath follow a single shared clock.
vm.runInContext(`currentRoom.phase = "running"; currentRoom.quake = { id: "slow-preparation", preparing: true, startedAt: Date.now() - 1000, duration: 3, runDuration: 20 }; renderCity()`, app);
assert.equal(dom.quakeIntro.hidden, false, "slow scoring keeps the map visible after the countdown");
assert.equal(dom.quakeCountdown.textContent, "Preparing city…");
assert.equal(dom.cityCanvas.hidden, true, "unscored towers never start shaking");
assert.equal(dom.cityResults.hidden, true, "unscored results stay hidden");
assert.equal(dom.skipResultsBtn.hidden, true, "preparation cannot be skipped");
vm.runInContext("currentRoom.quake.preparing = false; currentRoom.quake.startedAt = Date.now() + 2000; renderCity()", app);
assert.equal(dom.quakeIntro.hidden, false, "a slow preparation gets a shared lead-in before shaking");
clock = vm.runInContext("cityStart", app) + 100;
vm.runInContext("renderCity()", app);
assert.equal(dom.quakeIntro.hidden, true, "the prepared skyline begins at its revised shared start time");
const sequenceStart = clock;
app.quakeScheduledAt = Date.now() + 10000;
vm.runInContext(`currentRoom.phase = "running"; currentRoom.quake = { startedAt: quakeScheduledAt, duration: 3, runDuration: 20, difficulty: "medium", amplitude: .62 }; renderCity()`, app);
assert.equal(dom.quakeIntro.hidden, false, "scheduled quake begins with the Morristown alert");
assert.equal(dom.cityCanvas.hidden, true, "skyline waits until the alert ends");
assert.equal(dom.cityResults.hidden, true, "final results stay hidden during the alert");
clock = sequenceStart + 10100;
vm.runInContext("renderCity()", app);
assert.equal(dom.quakeIntro.hidden, true, "alert closes after its hold");
assert.equal(dom.cityCanvas.hidden, false, "skyline is revealed from the start of shaking");
assert.equal(dom.quakeBadge.textContent, "Ground shaking!");
assert.equal(dom.skipResultsBtn.hidden, true, "students never see Skip to results");
const unskippedCityStart = vm.runInContext('cityStart', app);
dom.skipResultsBtn.listeners.click();
assert.equal(dom.cityResults.hidden, true, "invoking the hidden skip handler cannot reveal student results");
assert.equal(vm.runInContext('cityStart', app), unskippedCityStart, "students cannot fast-forward the shared clock");
const playbackRoomCode = vm.runInContext('currentRoom.code', app);
app.localStorage = { getItem: key => key === `tmd-teacher-${playbackRoomCode}` ? 'teacher-key' : null };
vm.runInContext('teacherUnlocked = true; renderCity()', app);
assert.equal(dom.skipResultsBtn.hidden, false, "the room owner can skip their own playback");
dom.skipResultsBtn.listeners.click();
assert.equal(dom.cityResults.hidden, false, "the teacher shortcut reveals their results");
assert.equal(vm.runInContext('cityStart', app), unskippedCityStart, "teacher skipping does not alter the shared clock");
vm.runInContext('currentStudent = currentRoom.students[0]; renderCity()', app);
assert.equal(dom.skipResultsBtn.hidden, true, "a joined student cannot skip even with shared teacher credentials");
assert.equal(dom.cityResults.hidden, true, "switching to a student identity cannot inherit teacher fast-forwarding");
dom.skipResultsBtn.listeners.click();
assert.equal(dom.cityResults.hidden, true, "the skip handler also rejects a joined student with teacher credentials");
vm.runInContext('currentStudent = null; teacherUnlocked = false; renderCity()', app);
delete app.localStorage;
clock = sequenceStart + 13500;
vm.runInContext("renderCity()", app);
assert.equal(dom.quakeBadge.textContent, "Ground stopped — settling");
clock = sequenceStart + 34500;
vm.runInContext("renderCity()", app);
assert.equal(dom.quakeBadge.textContent, "Aftermath");
assert.equal(dom.cityResults.hidden, false, "aftermath reveals the final results");
// Even a failure at the very end receives its full collapse before aftermath.
vm.runInContext(`currentRoom.students = [ { ...currentRoom.students[0], result: { status: "failed", failureTime: 20, samples: [{ t: 20, y: 0, sway: 0, theta: 0, heat: 0 }] } } ]`, app);
dom.cityCanvas.ctx.drawings.length = 0;
vm.runInContext("renderCity()", app);
assert.equal(dom.cityCanvas.ctx.drawings.filter(d => d.method === "fillRect" && ["#723a37", "#c4d4da", "#9d7970", "#0f7b7e"].includes(d.fillColor)).length, 56, "late failures finish with all rubble fragments before the clock stops");
{
  // Every screen draws the same landmark in the same slot for a quake, and both appear across quakes.
  const picks = Array.from({ length: 40 }, (_, i) => vm.runInContext(`cityLandmark("quake-${i}", 12)`, app));
  assert.deepEqual(vm.runInContext('cityLandmark("quake-7", 12)', app), picks[7], "the landmark choice is deterministic for a quake");
  assert(picks.some(p => p.kind === "suvios") && picks.some(p => p.kind === "mhs"), "both landmarks appear across quakes");
  assert(picks.every(p => p.slot >= 0 && p.slot <= 12), "the landmark takes one of the skyline slots");
}
// Skip the landmark, which squashes on purpose; check the group building drawn after its label.
const landmarkLabel = dom.cityCanvas.ctx.drawings.findIndex(d => d.method === "fillText" && /Suvio|Morristown/.test(d.args[0]));
const failureScales = dom.cityCanvas.ctx.drawings.slice(landmarkLabel + 1).filter(d => d.method === "scale");
assert(Math.abs(failureScales[0].args[0] * failureScales.at(-1).args[0] - failureScales[0].args[1] * failureScales.at(-1).args[1]) < 1e-9, "FAILED text has equal horizontal and vertical scales in City");
dom.cityCanvas.ctx.drawings.length = 0;
vm.runInContext("currentRoom.students[0].result.failureTime = 21; renderCity()", app);
assert.equal(dom.cityCanvas.ctx.drawings.filter(d => d.method === "quadraticCurveTo").length, 0, "aftermath explicitly removes all failed structures even with late failure timestamps");
assert.equal(dom.cityCanvas.ctx.drawings.filter(d => d.method === "fillRect" && ["#723a37", "#c4d4da", "#9d7970", "#0f7b7e"].includes(d.fillColor)).length, 56, "aftermath always contains the complete rubble pile");
// Warning audio plays once per map intro; mute stops it and replay can sound again.
const warningOscillators = [];
const audioParam = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
app.window.AudioContext = class {
  constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
  createOscillator() {
    const node = { frequency: audioParam(), connect() {}, disconnect() {}, starts: [], stops: [], start(t) { this.starts.push(t); }, stop(t) { this.stops.push(t); } };
    warningOscillators.push(node);
    return node;
  }
  createGain() { return { gain: audioParam(), connect() {}, disconnect() {} }; }
};
vm.runInContext("prepareQuakeAudio(); playQuakeWarning(100); playQuakeWarning(100)", app);
assert.equal(warningOscillators.length, 3, "repeated frames do not repeat the three siren calls");
dom.quakeSoundBtn.dispatch("click");
assert.equal(dom.quakeSoundBtn.textContent, "Sound off");
assert(warningOscillators.every(node => node.stops.includes(undefined)), "mute immediately stops scheduled siren calls");
vm.runInContext("playQuakeWarning(200)", app);
assert.equal(warningOscillators.length, 3, "muted intros remain silent");
dom.quakeSoundBtn.dispatch("click");
vm.runInContext("playQuakeWarning(200)", app);
assert.equal(warningOscillators.length, 6, "a new intro can sound after unmuting");
dom.roster.querySelector = () => ({ innerHTML: "" });
vm.runInContext(`currentRoom.config = { difficulty: "medium", amplitude: .62, pulseDuration: 3 }; currentRoom.students[0].id = "assigned-pair"; currentStudent = currentRoom.students[0]; currentStudent.submission = null; renderRoom()`, app);
const savedRoomPhase = vm.runInContext("currentRoom.phase", app);
for (const [phase, label, primary] of [["design", "Open for designs", "lockBtn"], ["locked", "Designs locked", "startBtn"], ["running", "Testing", "replayBtn"]]) {
  vm.runInContext(`currentRoom.phase = "${phase}"; renderRoom()`, app);
  assert.equal(dom.phaseSteps.textContent, `Status: ${label}`, "teacher sees a plain current status");
  const primaryButtons = ["lockBtn", "startBtn", "replayBtn", "unlockBtn"].filter(id => !dom[id].hidden && dom[id].className === "button-primary");
  assert.deepEqual(primaryButtons, [primary], "only the next action receives primary emphasis");
}
vm.runInContext(`currentRoom.phase = "${savedRoomPhase}"; renderRoom()`, app);
assert(!dom.studentTower.innerHTML.includes("Natural period"), "challenge hides the period");
assert(!dom.studentTower.innerHTML.includes("calculated length"), "challenge hides the calculated TMD length");
assert(dom.studentTower.innerHTML.includes("Use this height and mass in the Solo Lab"), "assignment explains the independent lab workflow");
assert.equal(Number(dom.submitLength.value), .7, "rendering an assignment retains the minimum starting length");
const originalQueryAll = app.document.querySelectorAll;
const views = ["lab", "student", "teacherLogin", "teacher", "city"].map(id => { dom[id].id = id; return dom[id]; });
app.document.querySelectorAll = selector => selector === ".view" ? views : originalQueryAll(selector);
vm.runInContext("teacherUnlocked = false; setView('teacher')", app);
assert.equal(dom.teacher.classList.contains("active"), false, "locked teachers cannot see the dashboard");
assert.equal(dom.teacherLogin.classList.contains("active"), true, "Teacher tab opens the password form");
vm.runInContext("teacherUnlocked = true; setView('teacher')", app);
assert.equal(dom.teacher.classList.contains("active"), true, "authenticated teachers can open the dashboard");
// City walls remain straight and mounts sit on the displayed columns while swaying.
for (const height of [170, 350]) for (const mass of [7.5e6, 15e6]) for (const sway of [-.8, .8]) {
  dom.cityCanvas.ctx.drawings.length = 0;
  vm.runInContext(`currentRoom = {
    code: "GEOMETRY", phase: "design", config: {}, quake: null, results: [],
    students: [{ nickname: "Mount test", tower: P.createLabTower(${height}, ${mass}),
      submission: { enabled: true, length: 10.3, massRatio: .04, damping: .45 },
      result: { status: "standing", samples: [{ t: 0, y: .3, sway: ${sway}, theta: .1, heat: 0 }] } }]
  }; renderCity()`, app);
  const P = app.window.TMDPhysics;
  const tower = P.createLabTower(height, mass);
  const layout = P.towerGeometry(tower);
  const g = P.pendulumGeometry(tower, { enabled: true, length: 10.3, massRatio: .04, damping: .45 }, sway);
  const commands = dom.cityCanvas.ctx.drawings;
  const columnsIndex = commands.findIndex(d => d.method === "stroke" && d.width === layout.columnWidth && d.color === "#1e2d36");
  const columnCommands = commands.slice(0, columnsIndex);
  const columnPathStart = columnCommands.findLastIndex(d => d.method === "beginPath");
  const columnPath = columnCommands.slice(columnPathStart);
  assert.equal(columnPath.filter(d => d.method === "moveTo").length, 2, "City draws two continuous walls");
  assert.equal(columnPath.filter(d => d.method === "lineTo").length, 2, "each wall is a single straight segment without a bend");
  const housings = commands.map((command, index) => ({ ...command, index })).filter(d => d.method === "stroke" && d.width === 8 && /^rgb/.test(d.color));
  assert.equal(housings.length, 2);
  housings.forEach((housing, index) => {
    const mount = commands.slice(0, housing.index).findLast(d => d.method === "moveTo").args;
    const side = index === 0 ? -1 : 1;
    const foundationY = layout.top + (180 + (height - 170) / 180 * 160) / .3;
    const wallX = layout.width / 2 + .3 * layout.swayScale + sway * layout.swayScale * (foundationY - g.anchorY) / (foundationY - layout.top) + side * layout.towerWidth / 2;
    assert(Math.abs(mount[0] - wallX) < 1e-9 && mount[1] === g.anchorY, "City housing stays attached to the straight displayed column");
  });
}
// Uneven browser frames produce exactly the same trial as official fixed-step scoring.
for (const damping of [0, .25, 1]) {
  vm.runInContext(`{ resetLab(); compareSim = null;
    sim.tower = P.createLabTower(345, 11.5e6);
    sim.damper = { ...P.defaultDamperFor(sim.tower), length: 10.3, massRatio: .04, damping: ${damping} };
    sim.pulse = { ...P.defaultPulse(), amplitude: P.earthquakeStrengths.strong, collapseSway: sim.tower.dangerSwayLimit, runDuration: 20 };
    labTime = 0; labAccumulator = 0;
    let frame = 0;
    while (labTime < 20 - 1e-9 && !sim.failed) stepLive([.007, .033, .019][frame++ % 3]); }
  `, app);
  const live = state();
  const scored = app.window.TMDPhysics.evaluateDesign(live.tower, live.damper, live.pulse);
  assert.equal(scored.status, live.failed ? "failed" : "standing", "frame timing cannot change practice versus City survival");
  assert(Math.abs(scored.overLimitTime - live.overLimitTime) < 1e-9, "practice and City danger time agree under uneven browser frames");
  if (live.failed) {
    assert(Math.abs(scored.failureTime - live.failedAt) < 1e-9, "practice and City fail at exactly the same simulation time");
    assert(Math.abs(scored.samples.at(-1).theta - live.state.th) < 1e-9, "practice and City share the terminal pendulum pose");
  }
}
// Exercise the real submit handler, including decimal inputs, confirmation, and errors.
(async () => {
  const P = app.window.TMDPhysics;
  const student = { id: "submit-test", nickname: "Test Pair", tower: P.createLabTower(345, 11.5e6), submission: null };
  const room = { code: "SUBMIT", phase: "design", config: { difficulty: "medium", amplitude: .62, pulseDuration: 3 }, students: [student], results: [] };
  app.localStorage = { getItem: () => "student-token" };
  app.sessionStorage = { getItem: () => "student-token", setItem() {} };
  app.testRoom = room; app.testStudent = student;
  const rosterBody = { innerHTML: '' };
  dom.roster.querySelector = () => rosterBody;
  vm.runInContext("currentRoom = testRoom; currentStudent = testStudent", app);
  student.submission = { enabled: true, length: 8.4, massRatio: .06, damping: .12 };
  room.phase = 'locked';
  dom.submitLength.value = '12';
  app.renderRoom();
  assert(rosterBody.innerHTML.includes('8.40 m') && rosterBody.innerHTML.includes('6.00%') && rosterBody.innerHTML.includes('0.12'), "teacher roster displays all submitted settings");
  assert(!dom.studentTower.innerHTML.includes('submission-summary'), "submitted values do not appear in the tower assignment");
  assert(dom.submitState.textContent.includes('Length: 8.40 m; mass: 6.00%; damping: 0.12'), "submitted values appear together with the confirmation");
  for (const id of ['submitLength', 'submitMass', 'submitDamping', 'submitDesignBtn']) assert.equal(dom[id].disabled, true, "locked room disables student controls");
  assert.equal(dom.submitLength.value, '8.40', "locked controls show the saved design");
  vm.runInContext("setView('lab')", app);
  room.phase = 'running';
  room.quake = { id: 'student-quake-1', preparing: true, startedAt: Date.now() + 10000 };
  app.renderRoom();
  assert(dom.city.classList.contains('active'), "students switch to City immediately during the quake countdown");
  vm.runInContext("setView('student')", app);
  app.renderRoom();
  assert(dom.student.classList.contains('active'), "repeated room updates let students stay on a tab they chose");
  room.quake.preparing = false;
  room.quake.startedAt += 20000;
  app.renderRoom();
  assert(dom.student.classList.contains('active'), "ready notifications for the same quake do not redirect students again");
  room.quake.id = 'student-quake-2';
  app.renderRoom();
  assert(dom.city.classList.contains('active'), "a new replay brings students back to City");
  vm.runInContext("lastStudentQuake = ''; setView('student')", app);
  app.renderRoom();
  assert(dom.city.classList.contains('active'), "students joining an already running quake also see City");
  vm.runInContext("currentStudent = null; setView('lab')", app);
  room.quake.startedAt += 20000;
  app.renderRoom();
  assert(dom.lab.classList.contains('active'), "room updates do not redirect viewers who are not joined students");
  vm.runInContext("currentStudent = testStudent", app);
  room.quake = null;
  room.phase = 'design';
  app.renderRoom();
  for (const id of ['submitLength', 'submitMass', 'submitDamping', 'submitDesignBtn']) assert.equal(dom[id].disabled, false, "unlock re-enables student controls");
  assert.equal(dom.submitLength.max, '17.7');
  assert(html.includes('id="submitDamping" value="0" required type="number" min="0" max="1" step="0.05"'));
  dom.submitLength.value = '0'; dom.submitMass.value = '0'; dom.submitDamping.value = '0';
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert.equal(dom.submitState.textContent, 'Enter a pendulum length from 0.7 to 17.7 m.', 'zero length is outside the available range');
  dom.submitLength.value = '8.4';
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert.equal(dom.submitState.textContent, 'Enter TMD mass from 1 to 10%.', 'zero mass is outside the available range');
  dom.submitLength.value = '17.8';
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert(dom.submitState.textContent.includes('17.7'), "length above 17.7 m is rejected");
  dom.submitLength.value = "8.43"; dom.submitMass.value = "6.45"; dom.submitDamping.value = "0.17";
  let submittedBody;
  app.api = async (_, body) => {
    submittedBody = body;
    student.submission = body.submission;
    return { student, room };
  };
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert.equal(submittedBody.submission.length, 8.43, "arbitrary in-range lengths submit without step restrictions");
  assert.equal(submittedBody.submission.massRatio, .0645, "decimal mass percentages convert correctly");
  assert(dom.submitState.textContent.includes("Design submitted!"), "a successful submit has visible confirmation");
  assert(dom.submitState.textContent.includes('Length: 8.43 m; mass: 6.45%; damping: 0.17'), "confirmation contains the actual saved values with two decimal places");
  assert.equal(dom.submitDesignBtn.disabled, false);
  assert.equal(dom.submitState.hidden, false, "save confirmation is visible");
  assert.equal(dom.submitState.dataset.kind, 'success', "server-confirmed saves receive success emphasis");
  dom.submitLength.value = '10.3'; dom.submitMass.value = '8'; dom.submitDamping.value = '.25';
  dom.submitLength.dispatch('input');
  assert.equal(dom.submitState.dataset.kind, 'warning', "editing a saved design clearly marks it as not submitted");
  let finishSubmission, submissionCalls = 0;
  const nextDesign = { enabled: true, length: 10.3, massRatio: .08, damping: .25 };
  app.api = () => { submissionCalls++; return new Promise(resolve => { finishSubmission = resolve; }); };
  const pendingSubmission = dom.submitForm.listeners.submit({ preventDefault() {} });
  app.renderRoom();
  assert.equal(dom.submitDesignBtn.disabled, true, "room events cannot re-enable Submit during a save");
  assert.equal(dom.submitState.dataset.kind, 'pending');
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert.equal(submissionCalls, 1, "duplicate clicks cannot create overlapping design saves");
  app.newerStudentRoom = { ...room, phase: 'locked', students: [{ ...student, submission: nextDesign }] };
  vm.runInContext('currentRoom = newerStudentRoom; renderRoom()', app);
  finishSubmission({ student: { ...student, submission: nextDesign }, room: { ...room, phase: 'design' } });
  await pendingSubmission;
  assert.equal(vm.runInContext('currentRoom.phase', app), 'locked', "a save response cannot roll back a newer lock event");
  assert.equal(dom.submitState.dataset.kind, 'success', "confirmation survives lock events");
  app.renderRoom();
  assert(dom.submitState.textContent.includes('Design submitted!'), "ordinary updates retain the saved design confirmation");
  student.submission = nextDesign;
  vm.runInContext('currentRoom = testRoom; currentStudent = testStudent; renderRoom()', app);
  app.api = async () => { throw Error("Design window is locked"); };
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert(dom.submitState.textContent.includes("Design was not submitted: Design window is locked"), "server rejection is displayed");
  app.renderRoom();
  assert.equal(dom.submitState.dataset.kind, 'error', "room updates do not hide a failed save");
  app.api = async () => ({ student: { ...student, submission: { enabled: false } }, room });
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert.equal(dom.submitState.dataset.kind, 'error', "a response without the requested TMD cannot claim success");
  assert(dom.submitState.textContent.includes('did not confirm'), "an unconfirmed save asks the student to retry");
  dom.submitMass.value = "0.064";
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert.equal(dom.submitState.textContent, "Enter TMD mass from 1 to 10%.");
  vm.runInContext("currentStudent = null", app);
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert(dom.submitState.textContent.includes("Join a challenge room"), "unjoined groups see an explanation");
  app.localStorage = { getItem: () => "student-token", setItem() {} };
  app.EventSource = class { close() {} };
  dom.studentRoom.value = " submit "; dom.nickname.value = "Test Pair";
  let joinPath;
  app.api = async path => { joinPath = path; return { token: "student-token", student, room }; };
  const previousStudentDesign = student.submission;
  student.submission = null;
  await dom.joinForm.listeners.submit({ preventDefault() {} });
  for (const [id, minimum] of [['submitLength', .7], ['submitMass', 1], ['submitDamping', 0]]) assert.equal(Number(dom[id].value), minimum, 'a newly joined student sees the lowest available TMD settings');
  student.submission = previousStudentDesign;
  await dom.joinForm.listeners.submit({ preventDefault() {} });
  assert.equal(Number(dom.submitLength.value), previousStudentDesign.length, 'reconnection still restores an existing submitted design');
  assert.equal(Number(dom.submitMass.value), previousStudentDesign.massRatio * 100, 'reconnection preserves 0.05 mass increments');
  assert.equal(joinPath, "/api/rooms/SUBMIT/join", "joining trims and normalizes the room code");
  assert(dom.studentTower.innerHTML.includes("345 m") && dom.studentTower.innerHTML.includes("11.5 million kg"), "successful browser join shows the assigned tower");
  assert.equal(vm.runInContext("currentStudent.id", app), "submit-test");
  app.api = async () => { throw Error("This room is locked to new groups"); };
  await dom.joinForm.listeners.submit({ preventDefault() {} });
  assert.equal(dom.studentState.textContent, "Could not join: This room is locked to new groups", "join rejections show the exact server reason");
  const tabStorage = (initial = []) => {
    const data = new Map(initial);
    return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  };
  const firstTab = tabStorage(), secondTab = tabStorage();
  const identities = [];
  // Like the server, issue a new token on first join and keep a known one on reconnect.
  let issued = 0;
  app.api = async (_, body) => { const token = body.token || `issued-${++issued}`; identities.push(token); return { token, student, room }; };
  app.sessionStorage = firstTab;
  dom.nickname.value = 'Group A';
  await dom.joinForm.listeners.submit({ preventDefault() {} });
  await dom.joinForm.listeners.submit({ preventDefault() {} });
  assert.equal(identities[0], identities[1], "reconnecting in the same tab retains the student identity");
  app.sessionStorage = secondTab;
  dom.nickname.value = 'Group B';
  await dom.joinForm.listeners.submit({ preventDefault() {} });
  assert.notEqual(identities[0], identities[2], "two student tabs have independent identities");
  const duplicateTab = tabStorage([['tmd-token-SUBMIT', identities[0]], ['tmd-nickname-SUBMIT', 'Group A']]);
  app.sessionStorage = duplicateTab;
  dom.nickname.value = 'Group C';
  await dom.joinForm.listeners.submit({ preventDefault() {} });
  assert.equal(identities[0], identities[3], "changing a name preserves the existing student identity");
  dom.submitMass.value = '6';
  app.api = async (_, body) => { submittedBody = body; return { student, room }; };
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert.equal(submittedBody.token, identities[3], "submissions use this tab's token");
  const saved = new Map([['tmd-teacher-OLDER2', 'old-key'], ['tmd-last-teacher-room', 'OLDER2']]);
  app.localStorage = { get length() { return saved.size; }, key: i => [...saved.keys()][i], getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  vm.runInContext('teacherUnlocked = true', app);
  let createCount = 0, createdScenario;
  dom.activeRoomDifficulty.value = 'hard';
  dom.activeRoomStrength.value = 'strong';
  app.api = async (_, body) => { createCount++; createdScenario = body; return { ...room, code: 'NEWER2', teacherToken: 'new-key' }; };
  await Promise.all([app.createClassRoom(), app.createClassRoom()]);
  assert.equal(createCount, 1, "double clicks create only one room");
  assert.equal(createdScenario.difficulty, 'hard', "new rooms use the shared difficulty selector");
  assert.equal(createdScenario.amplitude, .65, "new rooms use the shared earthquake selector");
  assert(dom.teacherRooms.innerHTML.includes('OLDER2') && dom.teacherRooms.innerHTML.includes('NEWER2'), "previous room keys remain selectable");
  const oldRoomStream = vm.runInContext('events', app);
  dom.teacherRooms.value = 'OLDER2';
  app.renderRoom();
  assert.equal(dom.teacherRooms.value, 'OLDER2', 'room updates preserve a different room selected in the dropdown');
  saved.set('tmd-teacher-EXPRD2', 'expired-key');
  saved.set('tmd-teacher-QUOTA2', 'quota-key');
  saved.set('tmd-teacher-OFFLN2', 'offline-key');
  app.fetch = async path => {
    const code = path.split('/').at(-1);
    if (code === 'EXPRD2') return { ok: false, status: 404, json: async () => ({ error: 'Room not found or expired' }) };
    if (code === 'QUOTA2') return { ok: false, status: 503, json: async () => ({ error: 'Daily usage limit reached' }) };
    if (code === 'OFFLN2') throw new TypeError('Network unavailable');
    return { ok: true, status: 200, json: async () => ({ ...room, code }) };
  };
  await app.refreshSavedTeacherRooms();
  assert.equal(saved.has('tmd-teacher-EXPRD2'), false, 'validation removes a confirmed missing room');
  assert(!dom.teacherRooms.innerHTML.includes('EXPRD2'), 'expired rooms disappear from the dropdown');
  assert(saved.has('tmd-teacher-OLDER2') && saved.has('tmd-teacher-NEWER2'), 'healthy room credentials remain');
  assert(saved.has('tmd-teacher-QUOTA2') && saved.has('tmd-teacher-OFFLN2'), 'quota and network errors retain saved room credentials');
  assert.equal(dom.teacherRooms.value, 'OLDER2', 'validation preserves the teacher selection');
  assert.equal(vm.runInContext('currentRoom.code', app), 'NEWER2', 'background validation does not switch rooms');
  saved.set('tmd-teacher-EXPRD2', 'expired-key');
  dom.teacherRooms.value = 'EXPRD2';
  await dom.teacherRooms.listeners.change();
  assert.equal(saved.has('tmd-teacher-EXPRD2'), false, 'opening a missing room also removes its stale entry');
  assert.equal(vm.runInContext('currentRoom.code', app), 'NEWER2', 'opening an unavailable room preserves the active room');
  assert(dom.teacherRoomStatus.textContent.includes('expired') && dom.teacherRoomStatus.textContent.includes('removed'), 'missing rooms get an actionable explanation');
  dom.teacherRooms.value = 'QUOTA2';
  await dom.teacherRooms.listeners.change();
  assert(saved.has('tmd-teacher-QUOTA2'), 'a failed open does not erase a room during a quota outage');
  assert.equal(dom.teacherRoomStatus.textContent, 'Daily usage limit reached');
  saved.set('tmd-teacher-EXPRD2', 'expired-key');
  saved.set('tmd-last-teacher-room', 'EXPRD2');
  app.savedActiveRoom = vm.runInContext('currentRoom', app);
  vm.runInContext('currentRoom = null', app);
  await app.restoreSavedTeacherRoom();
  assert.equal(saved.has('tmd-teacher-EXPRD2'), false, 'automatic restore also cleans up an expired saved room');
  assert.equal(saved.has('tmd-last-teacher-room'), false, 'automatic restore removes the stale last-room marker');
  vm.runInContext('currentRoom = savedActiveRoom', app);
  saved.set('tmd-last-teacher-room', 'NEWER2');
  app.renderRoom();
  dom.teacherRooms.value = 'OLDER2';
  app.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ...room, code: 'OLDER2' }) });
  await dom.teacherRooms.listeners.change();
  assert.equal(vm.runInContext('currentRoom.code', app), 'OLDER2', "teacher can return to a previous room");
  oldRoomStream.onmessage({ data: JSON.stringify({ ...room, code: 'NEWER2' }) });
  assert.equal(vm.runInContext('currentRoom.code', app), 'OLDER2', 'late events from the previous room cannot switch the teacher back');
  assert.equal(dom.startBtn.disabled, false, "previous room retains teacher controls");
  app.sessionStorage.setItem('tmd-token-OLDER2', 'student-token');
  app.sessionStorage.setItem('tmd-student-id-OLDER2', student.id);
  app.fetch = async path => ({ ok: true, status: 200, json: async () => ({ ...room, code: path.split('/').at(-1) }) });
  dom.teacherRooms.value = 'NEWER2';
  await dom.teacherRooms.listeners.change();
  dom.teacherRooms.value = 'OLDER2';
  await dom.teacherRooms.listeners.change();
  assert.equal(vm.runInContext('currentStudent.id', app), student.id, "returning to a room restores the same-tab pretend-student identity");
  assert.equal(vm.runInContext('currentStudent.submission.enabled', app), true, "restored student retains the server-confirmed installed TMD");
  assert(dom.roomState.innerHTML.includes('JOIN CODE') && !dom.roomState.innerHTML.includes('Join at'), 'room banner uses the simple JOIN CODE label');
  dom.activeRoomDifficulty.value = 'hard';
  dom.activeRoomStrength.value = 'strong';
  dom.activeRoomDifficulty.dispatch('change');
  assert.equal(dom.lockBtn.disabled, true, 'unapplied settings block locking');
  assert.equal(dom.startBtn.disabled, true, 'unapplied settings block starting');
  assert.equal(dom.applyRoomSettingsBtn.disabled, false);
  let settingsRequest;
  app.api = async (path, body) => {
    settingsRequest = { path, body };
    return { ...room, code: 'OLDER2', config: { ...room.config, difficulty: body.difficulty, amplitude: .65 } };
  };
  await dom.applyRoomSettingsBtn.listeners.click();
  assert.equal(settingsRequest.path, '/api/rooms/OLDER2/settings');
  assert.equal(settingsRequest.body.difficulty, 'hard');
  assert.equal(settingsRequest.body.strength, 'strong');
  assert.equal(dom.startBtn.disabled, false, 'applying changes permits the next round');
  assert.equal(dom.roomSettingsNotice.hidden, false);
  assert(dom.roomSettingsNotice.textContent.includes('Hard difficulty') && dom.roomSettingsNotice.textContent.includes('Strong earthquake'), 'settings announcement names the new scenario');
  const savedDesign = JSON.stringify(student.submission);
  assert.equal(JSON.stringify(vm.runInContext('currentRoom.students[0].submission', app)), savedDesign, 'UI preserves the submitted design');
  vm.runInContext('currentRoom.phase = "locked"; renderRoom()', app);
  assert.equal(dom.activeRoomSettings.disabled, true, 'locked scenarios cannot be edited');
  assert.equal(dom.roomSettingsNotice.hidden, true, 'the notice clears for the locked round');
  vm.runInContext('currentRoom.phase = "design"; renderRoom()', app);
  const removeButton = { disabled: false, dataset: { studentId: student.id } };
  const removeEvent = { target: { closest: () => removeButton } };
  app.window.confirm = () => false;
  let removalRequest;
  app.api = async (path, body) => { removalRequest = { path, body }; return { ...room, code: 'OLDER2', students: [] }; };
  await dom.roster.listeners.click(removeEvent);
  assert.equal(removalRequest, undefined, "canceling removal keeps the group");
  app.window.confirm = () => true;
  await dom.roster.listeners.click(removeEvent);
  assert.equal(removalRequest.path, '/api/rooms/OLDER2/remove-student');
  assert.equal(removalRequest.body.studentId, student.id);
  assert.equal(vm.runInContext('currentRoom.students.length', app), 0, "removed group disappears from the roster");
  app.window.confirm = () => false;
  let deleted = false;
  app.api = async () => { deleted = true; return { deleted: true, code: 'OLDER2' }; };
  await dom.deleteRoomBtn.listeners.click();
  assert.equal(deleted, false, "canceling deletion preserves the room");
  app.window.confirm = () => true;
  await dom.deleteRoomBtn.listeners.click();
  assert.equal(deleted, true);
  assert.equal(vm.runInContext('currentRoom', app), null, "deleting clears the active room");
  assert.equal(saved.has('tmd-teacher-OLDER2'), false, "deleted room disappears from saved rooms");
  assert.equal(saved.has('tmd-teacher-NEWER2'), true, "other saved rooms remain accessible");
  assert.equal(dom.deleteRoomBtn.disabled, true);

  vm.runInContext("currentRoom = testRoom; currentStudent = null; setView('teacher')", app);
  let finishStart, startCalls = 0;
  app.api = () => { startCalls++; return new Promise(resolve => { finishStart = resolve; }); };
  const starting = app.runQuake('start');
  assert(dom.city.classList.contains('active') && !dom.quakeIntro.hidden, "the teacher sees the map before the Start response arrives");
  assert.equal(dom.quakeCountdown.textContent, 'Sending earthquake alert…');
  assert.equal(dom.cityResults.hidden, true);
  await app.runQuake('start');
  assert.equal(startCalls, 1, "double clicks cannot start two preparation jobs");
  app.readyRoom = { ...room, phase: 'running', quake: { id: 'fast-ready', preparing: false, startedAt: Date.now() + 10000 } };
  vm.runInContext("currentRoom = readyRoom", app);
  finishStart({ ...app.readyRoom, quake: { ...app.readyRoom.quake, preparing: true } });
  await starting;
  assert.equal(vm.runInContext('currentRoom.quake.preparing', app), false, "an older HTTP response cannot overwrite completed SSE results");
  vm.runInContext("currentRoom = testRoom; setView('teacher')", app);
  app.api = async () => { throw new Error('Start unavailable'); };
  await app.runQuake('start');
  assert(dom.teacher.classList.contains('active'), "a rejected Start returns the teacher to the controls");
  assert.equal(dom.teacherRoomStatus.textContent, 'Start unavailable');
  assert.equal(vm.runInContext('startingQuake', app), false, "failed starts can be retried");

  const entry = (nickname, status, damping, extra = {}) => ({ nickname, submission: damping == null ? { enabled: false } : { enabled: true, massRatio: 0.04, damping }, result: { status, failureTime: status === "failed" ? extra.failureTime : null, overLimitTime: 0, peakSway: 0.3, relativeSettleTime: 10, settleTime: 10 } });
  const boardResults = [entry("Late fall", "failed", 0.1, { failureTime: 40 }), entry("Bare", "standing", null), entry("B", "standing", 0.2), entry("Early fall", "failed", 0, { failureTime: 5 }), entry("A", "standing", 0.2), entry("C", "standing", 0.5)];
  const board = vm.runInContext("leaderboard", app)(boardResults, r => r.submission.damping, { needsTmd: true });
  assert.deepEqual(Array.from(board, row => row.r.nickname), ["B", "A", "C", "Bare", "Late fall", "Early fall"], "survivors rank by value, then no-TMD survivors, then failures by how long they lasted");
  assert.deepEqual(Array.from(board, row => row.place), [1, 1, 3, null, null, null], "only eligible survivors receive places, with ties preserved");
  assert.equal(board.find(row => row.r.nickname === "Early fall").kind, "failed", "the lowest damping cannot win if the tower collapsed");
  vm.runInContext("renderLeaderboards", app)(boardResults, { dangerEnabled: true });
  assert(dom.survivorBanner.innerHTML.includes("4 of 6 buildings survived") && dom.survivorBanner.innerHTML.includes("Late fall"), "banner counts survivors and names collapses");
  const boards = dom.leaderboards.innerHTML.split('<section class="leaderboard">').slice(1);
  const fallenRow = board => board.match(/<li class="board-failed">.*?Late fall.*?<\/li>/)[0];
  assert(boards[1].includes("Least time in danger zone"));
  for (const [index, metric] of [[0, 'Collapsed'], [1, '0.00 s'], [2, '4.0%'], [3, '0.10']]) {
    const row = fallenRow(boards[index]);
    assert(row.includes(`class="board-value">${metric}</span>`), "collapsed rows retain useful metrics but cannot claim to have settled");
    assert(row.includes('class="board-status">Collapsed at 40.00 s</small>'), "collapse time stays separate from the metric");
  }
  assert(boards.every(board => board.includes('Collapsed (latest first)')), "collapsed towers have a separate unranked group");
  for (const board of boards) {
    const failedRows = [...board.matchAll(/<li class="board-failed">.*?<\/li>/g)].map(match => match[0]);
    assert(failedRows[0].includes('Late fall') && failedRows[1].includes('Early fall'), "each collapsed group orders latest collapse first");
    assert(failedRows.every(row => row.includes('class="board-place">&mdash;</span>')), "collapsed towers never display rank numbers or medals");
  }
  const allFailed = boardResults.filter(row => row.result.status === 'failed');
  vm.runInContext("renderLeaderboards", app)(allFailed, { dangerEnabled: true });
  assert.equal((dom.leaderboards.innerHTML.match(/No qualifying designs this round\./g) || []).length, 4, "all-collapsed rounds clearly have no qualifying designs on every board");
  assert(!dom.leaderboards.innerHTML.includes('<ol>') && !dom.leaderboards.innerHTML.includes('podium'), "all-collapsed rounds award no ranks or medals");
  const resultsBody = { innerHTML: '' };
  dom.resultsTable.querySelector = () => resultsBody;
  vm.runInContext("renderResultsTable", app)(boardResults);
  const resultRows = resultsBody.innerHTML;
  assert(resultRows.includes('<td>&mdash;</td><td>Late fall</td><td>Collapsed at 40.00 s</td><td>&mdash;</td>'), "detailed results also omit rank and settling time for a collapsed tower");
  assert(resultRows.indexOf('Late fall') < resultRows.indexOf('Early fall'), "detailed results order collapsed towers by survival time");
  vm.runInContext("renderLeaderboards", app)([entry("Bare fall", "failed", null, { failureTime: 2 })], { dangerEnabled: true });
  assert.equal((dom.leaderboards.innerHTML.match(/class="board-value">No TMD/g) || []).length, 2, "failed bare towers have no invented mass or damping");
  vm.runInContext("renderLeaderboards", app)(boardResults, { dangerEnabled: false });
  assert(dom.leaderboards.innerHTML.includes("Least peak sway"), "Easy rooms rank peak sway instead of danger time");
  assert(fallenRow(dom.leaderboards.innerHTML.split('<section class="leaderboard">')[2]).includes('class="board-value">0.30 m</span>'), "Easy failed rows also show peak sway");
  console.log("rendering tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
