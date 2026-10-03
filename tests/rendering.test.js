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
const elements = {
  earthquakeStatus: {},
  showDangerInput: { checked: true },
  metrics: {}
};
Object.assign(context, {
  P: require("../public/physics.js"),
  $: id => elements[id],
  fmt: (value, digits = 2) => Number(value || 0).toFixed(digits),
  metric: (label, value) => `${label}: ${value}`,
  drawStage() {}, drawGraph() {}, measuredPeriod() { return null; },
  sim: {
    state: { t: 9.126, x: 0, v: 0, th: 0, w: 0 },
    tower: {}, damper: { enabled: false }, samples: [],
    pulse: { duration: 3, collapseTime: 2.5, dangerEnabled: true },
    overLimitTime: 2.499, failed: false
  }
});
vm.runInContext(source.slice(source.indexOf("function renderLab()"), source.indexOf("function resetLab()")), context);
context.renderLab();
assert(elements.metrics.innerHTML.includes("Time: 9.13 s"), "elapsed time displays hundredths");
assert(elements.metrics.innerHTML.includes("Danger: 2.49 / 2.50 s"), "danger time does not round up to the failure limit");
assert.strictEqual(elements.showDangerInput.disabled, false, "danger toggle is enabled on Hard");
context.sim.pulse.dangerEnabled = false;
context.renderLab();
assert.strictEqual(elements.showDangerInput.disabled, true, "danger toggle is disabled on Easy");
assert(elements.metrics.innerHTML.includes("Danger: Off"), "Easy reports no danger timer");
context.sim.pulse.dangerEnabled = true;
context.renderLab();
assert.strictEqual(elements.showDangerInput.disabled, false, "switching back enables the toggle");
assert.strictEqual(elements.showDangerInput.checked, true, "difficulty changes preserve the visibility preference");
console.log("rendering tests passed");
