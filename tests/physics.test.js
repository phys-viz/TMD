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
  const loose = { ...P.defaultDamperFor(tower), damping: 0 };
  const hitRun = P.simulate({ tower, damper: loose, pulse: { ...pulse, amplitude: 4 }, duration: 35, stopOnHit: true });
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

{
  // Use the same earthquake presets as the UI, not a separate test-only pulse.
  const classroomTower = P.generateTower("freshman-lab", 0);
  const moderate = { ...P.defaultPulse(), amplitude: P.earthquakeStrengths.moderate, duration: P.earthquakeDuration };
  const tuned = P.defaultDamperFor(classroomTower);
  const resultFor = (massRatio, damping, length = tuned.length) =>
    P.evaluateDesign(classroomTower, { ...tuned, massRatio, damping, length }, moderate);
  close(moderate.duration, 3, 1e-12, "classroom earthquake lasts three seconds");
  const baseline = P.evaluateDesign(classroomTower, { enabled: false }, moderate);
  assert.strictEqual(baseline.status, "failed", "Medium needs a TMD for the default Moderate earthquake");
  for (const damping of [0.1, 0.25, 0.45, 0.7, 0.9]) {
    assert.strictEqual(resultFor(0.01, damping).status, "failed", `1 percent mass is insufficient at damping ${damping}`);
  }
  assert.strictEqual(resultFor(0.05, 0.1).status, "failed", "too little damping fails the representative design");
  assert.strictEqual(resultFor(0.05, 0.45).status, "standing", "a tuned middle-damping design can survive Medium");
  assert.strictEqual(resultFor(0.05, 0.9).status, "failed", "too much damping fails the representative design");
  assert.strictEqual(resultFor(0.06, 0.45, 2).status, "failed", "a badly mistuned pendulum fails Medium");
  for (let index = 0; index < 24; index++) {
    const scenario = P.generateTower("freshman-lab", index);
    const result = P.evaluateDesign(scenario, { ...P.defaultDamperFor(scenario), massRatio: 0.1, damping: 0.45 }, moderate);
    assert.strictEqual(result.status, "standing", `tower ${index} has a surviving design within the allowed mass range`);
  }
}
{
  const classroomTower = P.generateTower("freshman-lab", 0);
  const strongHard = { ...P.defaultPulse(), amplitude: P.earthquakeStrengths.strong, collapseTime: 2.5 };
  const design = { ...P.defaultDamperFor(classroomTower), length: 8.4, massRatio: 0.08 };
  assert.strictEqual(P.evaluateDesign(classroomTower, { ...design, damping: 0.25 }, strongHard).status, "standing", "Strong/Hard has a successful design at the visible default length");
  for (const damping of [0.1, 0.9]) {
    assert.strictEqual(P.evaluateDesign(classroomTower, { ...design, damping }, strongHard).status, "failed", "Strong/Hard still rejects excessive or insufficient damping");
  }
  assert.strictEqual(P.evaluateDesign(classroomTower, { ...design, massRatio: 0.01, damping: 0.45 }, strongHard).status, "failed", "Strong/Hard needs sufficient damper mass");
  for (const limit of [2.5, 3]) {
    const settings = { collapseTime: limit, dangerEnabled: true };
    assert.strictEqual(P.dangerLimitReached(limit - 0.001, settings), false, "danger time below the limit does not fail");
    assert.strictEqual(P.dangerLimitReached(limit, settings), true, "danger time at the limit fails");
    assert.strictEqual(P.dangerLimitReached(limit + 0.001, settings), true, "danger time above the limit fails");
    assert.strictEqual(P.dangerLimitReached(limit, { ...settings, dangerEnabled: false }), false, "Easy has no danger failure");
  }
}
{
  // Every classroom scenario must have a successful design below the mass cap.
  for (const seed of ["freshman-lab", "period-window-a"]) {
    for (let index = 0; index < 24; index++) {
      const scenario = P.generateTower(seed, index);
      const strongHard = { ...P.defaultPulse(), amplitude: P.earthquakeStrengths.strong, collapseTime: 2.5, collapseSway: scenario.dangerSwayLimit };
      const damper = { ...P.defaultDamperFor(scenario), massRatio: 0.08, damping: 0.25 };
      const result = P.evaluateDesign(scenario, damper, strongHard);
      assert.strictEqual(result.status, "standing", `${seed} tower ${index} survives Strong/Hard with a tuned 8 percent design`);
      assert(result.overLimitTime < 2.45, "winning design has margin below the 2.50 second limit");
      assert.strictEqual(P.evaluateDesign(scenario, { enabled: false }, strongHard).status, "failed", "Strong/Hard still requires a working TMD");
    }
  }
}
{
  const small = P.createLabTower(170, 7.5e6);
  const large = P.createLabTower(350, 15e6);
  const middle = P.createLabTower(260, 11.3e6);
  assert(P.createLabTower(350, middle.mass).period > middle.period, "height changes the physical period");
  assert(P.createLabTower(middle.height, 15e6).period > middle.period, "mass changes the physical period");
  assert.deepStrictEqual(P.createLabTower(0, 0), small, "tower inputs are bounded at the lower limits");
  assert.deepStrictEqual(P.createLabTower(999, 99e6), large, "tower inputs are bounded at the upper limits");
  assert.deepStrictEqual(P.createLabTower(260, 11.3e6), middle, "same dimensions recreate the same solo tower");

  for (const height of [170, 260, 350]) {
    for (const mass of [7.5e6, 11.3e6, 15e6]) {
      const scenario = P.createLabTower(height, mass);
      assert(scenario.period >= 4.8 && scenario.period <= 7, "every editable tower stays in the stopwatch range");
      const free = P.simulate({
        tower: scenario, damper: { enabled: false }, initialX: 0.2,
        pulse: { amplitude: 0, dangerEnabled: false }, duration: 30, sampleDt: 0.02
      });
      // Measure three cycles from same-direction zero crossings of real motion.
      const crossings = [];
      for (let i = 1; i < free.samples.length; i++) {
        const a = free.samples[i - 1], b = free.samples[i];
        if (a.sway > 0 && b.sway <= 0) {
          crossings.push(a.t + a.sway / (a.sway - b.sway) * (b.t - a.t));
        }
      }
      assert(crossings.length >= 4, "a stopwatch can measure three complete cycles");
      close((crossings[3] - crossings[0]) / 3, scenario.period, 0.01, "free-motion period matches the tower setting");

      const strongHard = { ...P.defaultPulse(), amplitude: P.earthquakeStrengths.strong, collapseTime: 2.5, collapseSway: scenario.dangerSwayLimit };
      const damper = { ...P.defaultDamperFor(scenario), massRatio: 0.08, damping: 0.25 };
      assert.strictEqual(P.evaluateDesign(scenario, damper, strongHard).status, "standing", `${height} m / ${mass} kg tower has a successful 8 percent design`);
      assert.strictEqual(P.evaluateDesign(scenario, { enabled: false }, strongHard).status, "failed", "editable Hard/Strong towers still need a working TMD");
    }
  }
  const soloDefault = P.createLabTower(345, 11.5e6);
  const moderate = P.defaultPulse();
  const tuned = { ...P.defaultDamperFor(soloDefault), massRatio: 0.05, damping: 0.45 };
  assert.strictEqual(P.evaluateDesign(soloDefault, { enabled: false }, moderate).status, "failed", "the editable default tower needs a TMD on Medium/Moderate");
  assert.strictEqual(P.evaluateDesign(soloDefault, tuned, moderate).status, "standing", "a useful middle-damping design survives on the editable default tower");
  assert.strictEqual(P.evaluateDesign(soloDefault, { ...tuned, length: 2 }, moderate).status, "failed", "a mistuned design still fails on the editable default tower");
}
{
  // Hits occur within actual student settings, and one hit ends the challenge.
  const scenario = P.createLabTower(345, 11.5e6);
  const damper = { ...P.defaultDamperFor(scenario), length: 10.3, massRatio: 0.01, damping: 0 };
  const strong = { ...P.defaultPulse(), amplitude: P.earthquakeStrengths.strong };
  for (const dangerEnabled of [false, true]) {
    const result = P.evaluateDesign(scenario, damper, { ...strong, dangerEnabled });
    assert.strictEqual(result.status, "failed", "the first wall hit fails official scoring even on Easy");
    assert.strictEqual(result.hits, 1, "official simulation stops at one physical hit");
    assert(result.samples[result.samples.length - 1].t < strong.runDuration, "the impact ends the design's observation run");
    close(result.heat, 0, 1e-9, "the terminal hit is not counted as hydraulic heat");
  }
}
{
  // Without a TMD, most of the sway should remain after five natural cycles.
  // This verifies the intended slower background decay, rather than a constant.
  const labTower = P.createLabTower(260, 11.3e6);
  const free = P.simulate({
    tower: labTower, damper: { enabled: false }, initialX: 0.2,
    pulse: { amplitude: 0, dangerEnabled: false },
    duration: 5 * labTower.period, sampleDt: 0.02
  });
  const retained = free.final.x / 0.2;
  assert(retained > 0.82 && retained < 0.88, "no-TMD sway retains about 85 percent of its initial amplitude after five cycles");
}

function contactAngle(tower, damper, side, sway = 0) {
  let low = 0, high = 0;
  for (let angle = 0.001; angle < Math.PI / (2 * P.pendulumAngleScale); angle += 0.001) {
    if (P.pendulumContact(tower, damper, side * angle, sway).clearance <= 0) { high = angle; break; }
    low = angle;
  }
  assert(high > low, "fixture has a reachable visible contact");
  for (let i = 0; i < 35; i++) {
    const mid = (low + high) / 2;
    if (P.pendulumContact(tower, damper, side * mid, sway).clearance <= 0) high = mid; else low = mid;
  }
  return side * high;
}
{
  const labTower = P.createLabTower(345, 11.5e6);
  const design = { ...P.defaultDamperFor(labTower), massRatio: 0.08 };
  const quake = { ...P.defaultPulse(), dangerEnabled: false };
  const runAt = damping => P.simulate({ tower: labTower, damper: { ...design, damping }, pulse: quake, duration: 30 });
  const locked = runAt(1);
  const attached = P.simulate({ tower: { ...labTower, mass: labTower.mass * 1.08 }, damper: { enabled: false }, pulse: quake, duration: 30 });
  const bare = P.simulate({ tower: labTower, damper: { enabled: false }, pulse: quake, duration: 30 });
  const difference = (a, b) => Math.max(...a.samples.map((s, i) => Math.abs(s.sway - b.samples[i].sway)));
  close(difference(locked, attached), 0, 1e-10, "locked TMD behaves as attached mass with unchanged tower stiffness and damping");
  assert(difference(locked, bare) > 0.02, "locked TMD is distinct from removing its mass");
  let previousError = Infinity, previousAngle = Infinity, previousHeat = Infinity;
  for (const damping of [0.99, 0.999, 0.9999, 1 - 1e-10]) {
    const run = runAt(damping);
    const error = difference(run, locked);
    const angle = Math.max(...run.samples.map(s => Math.abs(s.theta)));
    assert(error < previousError && angle < previousAngle && run.heat < previousHeat, "motion and hydraulic heat approach the locked limit smoothly");
    assert(angle > 0 && run.heat > 0, "every setting below one still permits motion and dissipates heat");
    assert(run.samples.every(s => [s.sway, s.theta, s.heat].every(Number.isFinite)), "near-lock states remain finite");
    previousError = error; previousAngle = angle; previousHeat = run.heat;
  }
  assert(previousError < 0.00001, "extreme resistance matches the locked waveform within ten micrometers");
  assert(difference(runAt(0.8), runAt(0.8000001)) < 0.00001, "integration and resistance remain continuous at the high-resistance transition");
  for (const length of [0.7, 18]) for (const massRatio of [0.01, 0.1]) {
    const run = P.simulate({ tower: labTower, damper: { ...design, length, massRatio, damping: 1 - Number.EPSILON }, pulse: quake, duration: 8 });
    assert(Object.values(run.final).every(Number.isFinite), "near-lock integration stays stable at all length and mass bounds");
    assert(run.heat >= 0 && run.hits === 0, "near-lock resistance does not create heat loss or spurious impacts");
  }
  for (const damping of [0.81, 0.99, 1 - 1e-10]) {
    const conservativeTower = { ...labTower, damping: 0 };
    const damper = { ...design, damping };
    const noQuake = { amplitude: 0 };
    let state = P.initialState({ initialX: 0.03, initialTheta: 0.01, initialOmega: 0.03 });
    const energy = P.mechanicalEnergy(state, conservativeTower, damper, noQuake);
    for (let i = 0; i < 1000; i++) {
      const previous = state.heat;
      state = P.stepSimulation(state, 0.004, conservativeTower, damper, noQuake);
      assert(state.heat >= previous, "exponential drag never decreases accumulated heat");
    }
    assert.strictEqual(state.hits, 0, "hydraulic energy check stays inside the contact limit");
    close((P.mechanicalEnergy(state, conservativeTower, damper, noQuake) + state.heat) / energy, 1, 0.00002, "high-resistance mechanical energy becomes hydraulic heat");
  }
}
{
  const scenario = P.createLabTower(345, 11.5e6);
  const noQuake = { amplitude: 0, dangerEnabled: false };
  for (const damping of [0, 0.1]) for (const side of [-1, 1]) {
    const damper = { ...P.defaultDamperFor(scenario), length: damping > 0 ? 8.4 : 10.3, damping, massRatio: 0.01 };
    const limitAngle = contactAngle(scenario, damper, side);
    const inside = P.initialState({ initialTheta: limitAngle - side * 0.001, initialOmega: side * 0.2 });
    const before = P.stepSimulation(inside, 0.001, scenario, damper, noQuake);
    assert.strictEqual(before.hits, 0, "motion inside the displayed travel limit is not a hit");
    const hit = P.stepSimulation(before, 0.01, scenario, damper, noQuake);
    assert.strictEqual(hit.hits, 1, "reaching either displayed swing limit produces one wall hit");
    const contact = P.pendulumContact(scenario, damper, hit.th, hit.x);
    close(contact.clearance, 0, 0.000001, "impact is localized to touching drawn surfaces with no safety gap");
    assert.strictEqual(contact.side, side, "the correct side registers contact");
    assert.strictEqual(contact.kind, damping > 0 ? "housing" : "wall", "actual housing tips and wall surfaces both register contact");
    assert(hit.hitSeverity > 0, "displayed contact records physical impact severity");
    assert(hit.t < before.t + 0.01, "integration stops at the contact substep");
    if (damping === 0) close(hit.heat, 0, 1e-12, "displayed contact adds no hydraulic heat");
  }
  const damper = { ...P.defaultDamperFor(scenario), length: 10.3, damping: 0, massRatio: 0.01 };
  const strong = { ...P.defaultPulse(), amplitude: P.earthquakeStrengths.strong, dangerEnabled: false };
  const result = P.evaluateDesign(scenario, damper, strong);
  assert.strictEqual(result.status, "failed", "low-damping displayed contact fails official scoring even on Easy");
  assert.strictEqual(result.hits, 1, "official scoring ends on the first displayed contact");
  assert(result.samples.slice(0, -1).every(s => P.pendulumContact(scenario, damper, s.theta, s.sway).clearance > 0), "recorded motion stays clear of drawn surfaces until collapse");
  const finalSample = result.samples.at(-1);
  close(P.pendulumContact(scenario, damper, finalSample.theta, finalSample.sway).clearance, 0, 0.000001, "official scoring ends at visible surface contact");
  assert.strictEqual(P.pendulumContact(scenario, damper, finalSample.theta, finalSample.sway).kind, "wall", "Strong can produce a visible building-wall impact");
  const housingDesign = { ...damper, length: 9, damping: 0.01 };
  const housingRun = P.evaluateDesign(scenario, housingDesign, strong);
  assert.strictEqual(housingRun.status, "failed", "a preset-driven outer-housing impact is terminal even on Easy");
  assert.strictEqual(housingRun.hits, 1, "the first outer-housing impact ends the trial");
  const housingSample = housingRun.samples.at(-1);
  const housingContact = P.pendulumContact(scenario, housingDesign, housingSample.theta, housingSample.sway);
  assert.strictEqual(housingContact.kind, "housing", "actual student controls and Strong forcing can strike an outer cylinder");
  close(housingContact.clearance, 0, 0.000001, "the preset-driven housing impact has actual surface contact");
  const safeDesign = { ...damper, length: 10.3, massRatio: 0.08, damping: 0.25 };
  const safeRun = P.evaluateDesign(scenario, safeDesign, { ...strong, dangerEnabled: true, collapseTime: 2.5, collapseSway: scenario.dangerSwayLimit });
  assert.strictEqual(safeRun.status, "standing", "the same tower and Strong earthquake have a successful design below maximum mass on Hard");
  assert.strictEqual(safeRun.hits, 0, "a successful design clears both the building and its outer cylinders");
  const disabled = P.stepSimulation(P.initialState({ initialTheta: 0.5, initialOmega: 1 }), 0.01, scenario, { ...damper, enabled: false }, noQuake);
  assert.strictEqual(disabled.hits, 0, "removing the TMD removes its contact failure");
}
console.log("physics tests passed");
