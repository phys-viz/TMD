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
console.log("rendering tests passed");
