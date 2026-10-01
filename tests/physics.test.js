const assert = require("assert");
const P = require("../public/physics.js");

function close(actual, expected, tolerance, label) {
  assert(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}

const tower = {
  name: "Test tower",
  height: 240,
  period: 6,
  mass: 1e7,
  stiffness: 1e7 * Math.pow(2 * Math.PI / 6, 2),
  damping: 2 * 0.03 * Math.sqrt(1e7 * (1e7 * Math.pow(2 * Math.PI / 6, 2))),
  dampingRatio: 0.03
};

const pulse = { amplitude: 0.42, duration: 1.8, runDuration: 45, driftLimit: 1.2 };

{
  const L = P.g * Math.pow(6 / (2 * Math.PI), 2);
  const T = 2 * Math.PI * Math.sqrt(L / P.g);
  close(T, 6, 1e-10, "pendulum period inversion");
  close(P.defaultPulse().collapseSway, 0.2, 1e-12, "default danger-zone sway threshold");
  close(P.clampDamper({ length: 8, massRatio: 0.5, damping: 0.4 }).massRatio, 0.10, 1e-12, "damper mass ratio caps at 10 percent");
}

{
  const atStart = P.baseMotion(0, pulse);
  const after = P.baseMotion(pulse.duration + 0.1, pulse);
  close(atStart.y, 0, 1e-12, "pulse starts at zero displacement");
  close(after.y, 0, 1e-12, "ground stops after pulse");
  close(after.yd, 0, 1e-12, "ground velocity stops after pulse");
  const run = P.simulate({ tower, damper: { enabled: false }, pulse, duration: 35 });
  assert(run.peakSway > 0.1, "pulse starts building motion");
}

{
  const d = P.defaultDamperFor(tower);
  const expectedCoeff = P.hydraulicDamperCount * d.damping * 2 * tower.mass * d.massRatio * Math.sqrt(P.g * d.length);
  close(P.damperCoeff(tower, d), expectedCoeff, 1e-6, "two hydraulic dampers act in parallel");
  let state = P.initialState();
  let heat = 0;
  for (let i = 0; i < 3000; i++) {
    state = P.stepSimulation(state, 0.01, tower, d, pulse);
    assert(state.heat >= heat - 1e-5, "damper heat never decreases");
    heat = state.heat;
  }
  assert(heat > 0, "damper dissipates energy");
}

{
  const noResistance = { ...P.defaultDamperFor(tower), damping: 0 };
  const locked = { ...P.defaultDamperFor(tower), damping: 1 };
  const freeRun = P.simulate({ tower, damper: noResistance, pulse, duration: 25 });
  const lockedRun = P.simulate({ tower, damper: locked, pulse, duration: 25 });
  close(freeRun.heat, 0, 1e-9, "zero resistance dissipates no damper energy");
  close(lockedRun.heat, 0, 1e-9, "locked damper dissipates no damper energy");
  assert(Math.max(...lockedRun.samples.map(s => Math.abs(s.theta))) < 1e-9, "locked damper prevents pendulum swing");
}

{
  const loose = { ...P.defaultDamperFor(tower), damping: 0, wallLimit: 1.2 };
  const hitRun = P.simulate({ tower, damper: loose, pulse: { ...pulse, amplitude: 1.25 }, duration: 35 });
  assert(hitRun.hits > 0, "low damping can strike the building wall");
  assert(hitRun.hitSeverity > 0, "wall hits record severity");
  close(hitRun.heat, 0, 1e-9, "wall impacts do not count as damper heat");
}

{
  const ordinary = P.evaluateDesign(tower, P.defaultDamperFor(tower), pulse);
  const easySevere = P.evaluateDesign(tower, { enabled: false }, { ...pulse, amplitude: 3, driftLimit: 99, dangerEnabled: false, collapseSway: 0.5, collapseTime: 0.2 });
  const duringPulse = P.simulate({ tower, damper: { enabled: false }, pulse: { ...pulse, amplitude: 3, duration: 4, collapseSway: 0, collapseTime: 0.1 }, duration: 2 });
  const visibleOutside = P.simulate({ tower, damper: { enabled: false }, pulse: { ...pulse, amplitude: 0, duration: 0.01, collapseSway: 0.1 }, initialX: 0.3, duration: 0.3, sampleDt: 0.01 });
  const fastInside = P.simulate({ tower, damper: { enabled: false }, pulse: { ...pulse, amplitude: 0, duration: 0.005, collapseSway: 0.2 }, initialX: 0, initialV: 5, duration: 0.006, sampleDt: 0.01 });
  assert.notStrictEqual(ordinary.status, "failed", "default pulse should not collapse the test tower");
  assert(visibleOutside.overLimitTime > 0.2, "visible sway outside limit accumulates danger time");
  assert.notStrictEqual(easySevere.status, "failed", "easy mode disables danger-zone collapse");
  close(duringPulse.overLimitTime, 0, 1e-12, "danger time starts after pulse ends");
  close(fastInside.overLimitTime, 0, 1e-12, "danger time ignores velocity while visible sway is inside limit");
}

{
  const tuned = P.defaultDamperFor(tower);
  const result = P.evaluateDesign(tower, tuned, pulse);
  assert(result.settleTime <= result.baselineSettleTime, "representative tuned damper settles at least as fast as no TMD");
  assert(result.heat > 0, "official result reports dissipated heat");
}

{
  const d = { ...P.defaultDamperFor(tower), damping: 0.45 };
  const a = P.evaluateDesign(tower, d, pulse);
  const b = P.evaluateDesign(tower, d, pulse);
  assert.deepStrictEqual(a, b, "same design and pulse replay deterministically");
}

{
  const a = P.generateTower("same-seed", 7);
  const b = P.generateTower("same-seed", 7);
  assert.deepStrictEqual(a, b, "tower generation is deterministic");
}

console.log("physics tests passed");
