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
for (const id of ["stage", "stageCompare", "graph", "graphCompare"]) {
  dom[id].ctx = canvasRecorder();
  dom[id].getContext = () => dom[id].ctx;
  dom[id].getBoundingClientRect = () => ({ left: 0, width: dom[id].width });
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
function contactAngle(tower, damper, side = 1, sway = 0) {
  const P = require("../public/physics.js");
  let low = 0, high = 0;
  for (let angle = 0.001; angle < Math.PI / (2 * P.pendulumAngleScale); angle += 0.001) {
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
vm.runInContext(source, app);
const state = () => vm.runInContext("sim", app);
assert.equal(state().damper.damping, 0, "Solo Lab starts with zero damping");
assert.equal(Number(dom.compareDampingInput.value), 0, "comparison starts with zero damping");
assert.equal(Number(dom.submitDamping.value), 0, "new challenge submissions start with zero damping");
assert.strictEqual(vm.runInContext("graphRange().start", app), 0, "Solo graph starts at zero by default");
assert.strictEqual(vm.runInContext("graphRange().end", app), 120, "Solo graph shows the full 120-second trial by default");
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
const swayLabel = id => dom[id].ctx.drawings.find(d => d.method === "fillText" && /^\d.* m$/.test(d.args[0])).args[0];
assert.strictEqual(swayLabel("graphCompare"), swayLabel("graph"), "separate graphs retain matching sway scales");
for (const id of ["graph", "graphCompare"]) {
  assert(dom[id].ctx.drawings.some(d => d.method === "fillText" && d.args[0] === "sway"), "each plot has a sway axis label");
  assert(!dom[id].ctx.drawings.some(d => d.method === "rotate"), "sway labels are horizontal");
  assert(!dom[id].ctx.drawings.some(d => d.method === "fillText" && /roof sway|click graph/.test(d.args[0])), "crossed-out plot headings and instructions are removed");
}

const clickAt = (id, time) => dom[id].listeners.click({ clientX: 48 + time / 120 * (dom[id].width - 66) });
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
  assert(Math.abs(offset - Math.sin(angle * app.window.TMDPhysics.pendulumAngleScale) * travel.lengthPx) < 1e-9, "displayed displacement follows the actual pendulum angle");
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
  const pivotX = dom.stage.width / 2 + (sample.y + sample.sway) * 132;
  const contact = state().state.contact;
  assert(Math.abs(Math.hypot(bob.args[0] - pivotX - contact.x, bob.args[1] - contact.y) - g.bobRadiusPx) < 0.000001, "impact marker lies exactly on the bob's touching surface");
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
assert.strictEqual(dom.graph.height, 170, "inline readout adds no height to the plot");
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
for (let i = 0; i < cityScales.length; i += 2) {
  const [sx, sy] = cityScales[i].args;
  const [bx, by] = cityScales[i + 1].args;
  assert(Math.abs(sx * bx - sy * by) < 1e-9, "city bobs have equal horizontal and vertical display scales");
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
const failureScales = dom.cityCanvas.ctx.drawings.filter(d => d.method === "scale");
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
assert(!dom.studentTower.innerHTML.includes("Natural period"), "challenge hides the period");
assert(!dom.studentTower.innerHTML.includes("calculated length"), "challenge hides the calculated TMD length");
assert(dom.studentTower.innerHTML.includes("Use this height and mass in Solo Lab"), "assignment explains the independent lab workflow");
assert.equal(dom.submitLength.value, "", "rendering an assignment does not fill in a tuned length");
const originalQueryAll = app.document.querySelectorAll;
const views = ["lab", "student", "teacherLogin", "teacher", "city"].map(id => { dom[id].id = id; return dom[id]; });
app.document.querySelectorAll = selector => selector === ".view" ? views : originalQueryAll(selector);
vm.runInContext("teacherUnlocked = false; setView('teacher')", app);
assert.equal(dom.teacher.classList.contains("active"), false, "locked teachers cannot see the dashboard");
assert.equal(dom.teacherLogin.classList.contains("active"), true, "Teacher tab opens the password form");
vm.runInContext("teacherUnlocked = true; setView('teacher')", app);
assert.equal(dom.teacher.classList.contains("active"), true, "authenticated teachers can open the dashboard");
// City scales the complete canonical scene; mounts stay on both columns while swaying.
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
  const housings = commands.map((command, index) => ({ ...command, index })).filter(d => d.method === "stroke" && d.width === 8 && /^rgb/.test(d.color));
  assert.equal(housings.length, 2);
  housings.forEach((housing, index) => {
    const mount = commands.slice(0, housing.index).findLast(d => d.method === "moveTo").args;
    const side = index === 0 ? -1 : 1;
    const wallX = layout.width / 2 + .3 * layout.swayScale + sway * layout.swayScale * (layout.bottom - g.anchorY) / (layout.bottom - layout.top) + side * layout.towerWidth / 2;
    assert(Math.abs(mount[0] - wallX) < 1e-9 && mount[1] === g.anchorY, "City housing stays attached to the same moving column used in Solo and contact detection");
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
  assert(rosterBody.innerHTML.includes('8.40 m') && rosterBody.innerHTML.includes('6.0%') && rosterBody.innerHTML.includes('0.12'), "teacher roster displays all submitted settings");
  assert(dom.studentTower.innerHTML.includes('Pendulum length: 8.40 m') && dom.studentTower.innerHTML.includes('Damping: 0.12'), "saved design spells out parameter names");
  for (const id of ['submitLength', 'submitMass', 'submitDamping', 'submitDesignBtn']) assert.equal(dom[id].disabled, true, "locked room disables student controls");
  assert.equal(dom.submitLength.value, '8.40', "locked controls show the saved design");
  room.phase = 'design';
  app.renderRoom();
  for (const id of ['submitLength', 'submitMass', 'submitDamping', 'submitDesignBtn']) assert.equal(dom[id].disabled, false, "unlock re-enables student controls");
  assert.equal(dom.submitLength.max, '17.7');
  assert(html.includes('id="submitDamping" value="0" required type="number" min="0" max="1" step="0.01"'));
  dom.submitLength.value = '17.8';
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert(dom.submitState.textContent.includes('17.7'), "length above 17.7 m is rejected");
  dom.submitLength.value = "8.43"; dom.submitMass.value = "6.4"; dom.submitDamping.value = "0.17";
  let submittedBody;
  app.api = async (_, body) => {
    submittedBody = body;
    student.submission = body.submission;
    return { student, room };
  };
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert.equal(submittedBody.submission.length, 8.43, "arbitrary in-range lengths submit without step restrictions");
  assert.equal(submittedBody.submission.massRatio, .064, "decimal mass percentages convert correctly");
  assert(dom.submitState.textContent.includes("Design submitted!"), "a successful submit has visible confirmation");
  assert.equal(dom.submitDesignBtn.disabled, false);
  app.api = async () => { throw Error("Design window is locked"); };
  await dom.submitForm.listeners.submit({ preventDefault() {} });
  assert(dom.submitState.textContent.includes("Design was not submitted: Design window is locked"), "server rejection is displayed");
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
  await dom.joinForm.listeners.submit({ preventDefault() {} });
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
  let createCount = 0;
  app.api = async () => { createCount++; return { ...room, code: 'NEWER2', teacherToken: 'new-key' }; };
  await Promise.all([app.createClassRoom(), app.createClassRoom()]);
  assert.equal(createCount, 1, "double clicks create only one room");
  assert(dom.teacherRooms.innerHTML.includes('OLDER2') && dom.teacherRooms.innerHTML.includes('NEWER2'), "previous room keys remain selectable");
  dom.teacherRooms.value = 'OLDER2';
  app.fetch = async () => ({ ok: true, json: async () => ({ ...room, code: 'OLDER2' }) });
  await dom.openTeacherRoomBtn.listeners.click();
  assert.equal(vm.runInContext('currentRoom.code', app), 'OLDER2', "teacher can return to a previous room");
  assert.equal(dom.startBtn.disabled, false, "previous room retains teacher controls");
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
  console.log("rendering tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
