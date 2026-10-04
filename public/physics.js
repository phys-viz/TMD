(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TMDPhysics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const g = 9.81;
  const dangerSway = 0.2;
  const hydraulicDamperCount = 2;
  const hydraulicBodyPx = 44;
  const pendulumAngleScale = 2.5;
  const earthquakeDuration = 3.0;
  const earthquakeStrengths = Object.freeze({ gentle: 0.18, moderate: 0.62, strong: 0.65 });
  const labTowerLimits = Object.freeze({
    minHeight: 170, maxHeight: 350,
    minMass: 7.5e6, maxMass: 15e6,
    minPeriod: 4.8, maxPeriod: 7.0
  });

  function hashSeed(seed) {
    let h = 2166136261;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    let a = hashSeed(seed) || 1;
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededRange(seed, min, max) {
    return min + (max - min) * rng(seed)();
  }

  function makeId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function clampDamper(d) {
    return {
      enabled: d.enabled !== false,
      length: clamp(d.length, 0.7, 18),
      massRatio: clamp(d.massRatio, 0.01, 0.10),
      damping: clamp(d.damping, 0, 1),
      wallLimit: clamp(d.wallLimit ?? d.clearance ?? 2.7, 1.2, 5),
      strutBodyLength: clamp(d.strutBodyLength ?? 0.65, 0.25, 1.2),
      strutRadius: clamp(d.strutRadius ?? 0.12, 0.05, 0.25),
      restitution: clamp(d.restitution ?? 0.35, 0, 0.8),
      bobRadius: clamp(d.bobRadius ?? 0.28, 0.15, 0.6)
    };
  }

  function defaultDamperFor(tower) {
    return clampDamper({
      enabled: true,
      length: g * Math.pow(tower.period / (2 * Math.PI), 2),
      massRatio: 0.035,
      damping: 0.45,
      wallLimit: 2.7,
      strutBodyLength: 0.65,
      strutRadius: 0.12,
      restitution: 0.28,
      bobRadius: 0.3
    });
  }

  function generateTower(seed, index) {
    const r = rng(`${seed}:tower:${index}`);
    const period = 4.8 + r() * 2.2;
    const mass = 7.5e6 + r() * 7.5e6;
    const dampingRatio = 0.008 + r() * 0.007;
    const omega = 2 * Math.PI / period;
    const stiffness = mass * omega * omega;
    const damping = 2 * dampingRatio * Math.sqrt(stiffness * mass);
    return {
      name: `Tower ${index + 1}`,
      height: Math.round(170 + r() * 180),
      period,
      mass,
      stiffness,
      damping,
      dampingRatio,
      // Game tolerance balances the shorter-period towers under a common quake.
      dangerSwayLimit: Math.round(dangerSway * Math.max(1, (6 / period) ** 2) * 100) / 100
    };
  }

  function createLabTower(height, mass) {
    const limits = labTowerLimits;
    const cleanHeight = clamp(height, limits.minHeight, limits.maxHeight);
    const cleanMass = clamp(mass, limits.minMass, limits.maxMass);
    // Classroom calibration, not a structural prediction: map sqrt(H*M) into
    // the stopwatch-friendly period range, then derive consistent k and c.
    const size = Math.sqrt((cleanHeight / limits.minHeight) * (cleanMass / limits.minMass));
    const maxSize = Math.sqrt((limits.maxHeight / limits.minHeight) * (limits.maxMass / limits.minMass));
    const period = clamp(limits.minPeriod + (limits.maxPeriod - limits.minPeriod) *
      (size - 1) / (maxSize - 1), limits.minPeriod, limits.maxPeriod);
    const dampingRatio = 0.005;
    const stiffness = cleanMass * Math.pow(2 * Math.PI / period, 2);
    return {
      name: "Lab tower",
      height: cleanHeight,
      mass: cleanMass,
      period,
      stiffness,
      dampingRatio,
      damping: 2 * dampingRatio * Math.sqrt(stiffness * cleanMass),
      dangerSwayLimit: Math.round(dangerSway * Math.max(1, (6 / period) ** 2) * 100) / 100
    };
  }

  function defaultPulse() {
    return { amplitude: earthquakeStrengths.moderate, duration: earthquakeDuration, driftLimit: 1.2, dangerEnabled: true, collapseSway: dangerSway, collapseTime: 3, runDuration: 120 };
  }

  function baseMotion(t, pulse) {
    const p = { ...defaultPulse(), ...(pulse || {}) };
    if (p.amplitude === 0 || t < 0 || t > p.duration) return { y: 0, yd: 0 };
    const u = t / p.duration;
    const carrier = Math.sin(2 * Math.PI * u);
    const envelope = Math.sin(Math.PI * u) ** 2;
    const y = p.amplitude * carrier * envelope;
    const carrierDot = (2 * Math.PI / p.duration) * Math.cos(2 * Math.PI * u);
    const envelopeDot = (Math.PI / p.duration) * Math.sin(2 * Math.PI * u);
    return { y, yd: p.amplitude * (carrierDot * envelope + carrier * envelopeDot) };
  }

  function damperCoeff(tower, damper) {
    const d = clampDamper(damper);
    if (d.damping >= 1) return 0;
    const m = tower.mass * d.massRatio;
    // Match the existing control through 0.8, then approach infinite resistance.
    const resistance = d.damping <= 0.8 ? d.damping :
      0.8 + (d.damping - 0.8) / (5 * (1 - d.damping));
    return hydraulicDamperCount * resistance * 2 * m * Math.sqrt(g * d.length);
  }

  function derivatives(state, tower, damper, pulse) {
    const bm = baseMotion(state.t, pulse);
    const rel = state.x - bm.y;
    const relv = state.v - bm.yd;
    if (damper && damper.enabled && clampDamper(damper).damping >= 1) {
      const attachedMass = tower.mass * clampDamper(damper).massRatio;
      return { t: 1, x: state.v, v: (-tower.damping * relv - tower.stiffness * rel) / (tower.mass + attachedMass), th: 0, w: 0, heat: 0 };
    }
    if (!damper || !damper.enabled) {
      return { t: 1, x: state.v, v: (-tower.damping * relv - tower.stiffness * rel) / tower.mass, th: 0, w: 0, heat: 0 };
    }

    const d = clampDamper(damper);
    const M = tower.mass;
    const m = tower.mass * d.massRatio;
    const L = d.length;
    const b = damperCoeff(tower, d);
    const sin = Math.sin(state.th);
    const cos = Math.cos(state.th);
    const a11 = M + m;
    const a12 = m * L * cos;
    const a21 = cos;
    const a22 = L;
    const r1 = -tower.damping * relv - tower.stiffness * rel + m * L * state.w * state.w * sin;
    const r2 = -g * sin - (b / (m * L)) * state.w;
    const det = a11 * a22 - a12 * a21;
    const xdd = (r1 * a22 - a12 * r2) / det;
    const thdd = (a11 * r2 - r1 * a21) / det;
    return { t: 1, x: state.v, v: xdd, th: state.w, w: thdd, heat: Math.max(0, b * state.w * state.w) };
  }

  function addState(s, k, h) {
    return {
      t: s.t + h * k.t,
      x: s.x + h * k.x,
      v: s.v + h * k.v,
      th: s.th + h * k.th,
      w: s.w + h * k.w,
      heat: (s.heat || 0) + h * (k.heat || 0),
      hits: s.hits || 0,
      hitSeverity: s.hitSeverity || 0,
      lastHit: s.lastHit || 0
    };
  }

  function rk4Step(state, dt, tower, damper, pulse) {
    const k1 = derivatives(state, tower, damper, pulse);
    const k2 = derivatives(addState(state, k1, dt / 2), tower, damper, pulse);
    const k3 = derivatives(addState(state, k2, dt / 2), tower, damper, pulse);
    const k4 = derivatives(addState(state, k3, dt), tower, damper, pulse);
    return {
      t: state.t + dt,
      x: state.x + dt / 6 * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
      v: state.v + dt / 6 * (k1.v + 2 * k2.v + 2 * k3.v + k4.v),
      th: state.th + dt / 6 * (k1.th + 2 * k2.th + 2 * k3.th + k4.th),
      w: state.w + dt / 6 * (k1.w + 2 * k2.w + 2 * k3.w + k4.w),
      heat: (state.heat || 0) + dt / 6 * (k1.heat + 2 * k2.heat + 2 * k3.heat + k4.heat),
      hits: state.hits || 0,
      hitSeverity: state.hitSeverity || 0,
      lastHit: 0
    };
  }

  function highResistanceStep(state, dt, tower, damper, pulse) {
    const M = tower.mass, m = M * damper.massRatio, L = damper.length;
    const totalMass = M + m, b = damperCoeff(tower, damper);
    // Horizontal momentum per unit total mass eliminates the stiff torque
    // from the tower equation. Integrate angular drag exponentially, including
    // its forcing and heat, so even settings arbitrarily close to 1 stay stable.
    const momentum = state.v + m * L * Math.cos(state.th) * state.w / totalMass;
    function advance(h, at) {
      const bm = baseMotion(at.t, pulse);
      const force = -tower.damping * (at.v - bm.yd) - tower.stiffness * (at.x - bm.y);
      const sin = Math.sin(at.th), cos = Math.cos(at.th);
      const inertia = m * L * L * (M + m * sin * sin) / totalMass;
      const rate = b / inertia;
      const angularForce = (-g * sin - cos * force / totalMass -
        m * L * cos * sin * at.w * at.w / totalMass) * totalMass / (L * (M + m * sin * sin));
      const steadyOmega = angularForce / rate;
      const loss = -Math.expm1(-rate * h);
      const responseTime = loss / rate;
      const angleChange = state.w * responseTime + steadyOmega * (h - responseTime);
      const omega = state.w * (1 - loss) + steadyOmega * loss;
      const theta = state.th + angleChange;
      const transient = state.w - steadyOmega;
      const heat = inertia * (steadyOmega * steadyOmega * rate * h +
        2 * steadyOmega * transient * loss + transient * transient * -Math.expm1(-2 * rate * h) / 2);
      return {
        ...state, t: state.t + h,
        x: state.x + momentum * h + force / totalMass * h * h / 2 - m * L * cos / totalMass * angleChange,
        v: momentum + force / totalMass * h - m * L * Math.cos(theta) / totalMass * omega,
        th: theta, w: omega, heat: (state.heat || 0) + Math.max(0, heat), lastHit: 0
      };
    }
    const midpoint = advance(dt / 2, state);
    return advance(dt, midpoint);
  }

  function pendulumGeometry(tower, damper, sway = 0) {
    const d = clampDamper(damper);
    const heightFraction = clamp((tower.height - labTowerLimits.minHeight) /
      (labTowerLimits.maxHeight - labTowerLimits.minHeight), 0, 1);
    const top = 118 - 60 * heightFraction, bottom = 436, pivotY = top + 2;
    const lengthPx = clamp(d.length * 15, 45, 190);
    const bobRadiusPx = clamp(9 + d.massRatio * 190, 11, 23);
    // Keep mounts above the bob for short pendulums, leaving room for each
    // rigid housing; longer pendulums use the same upper-column mounting area.
    const anchorY = top + clamp(lengthPx - 70, 16, 60);
    const mountSlope = sway * 132 / (bottom - top);
    const shearOffset = -mountSlope * (anchorY - top);
    const leftAnchorOffset = -108 + shearOffset, rightAnchorOffset = 108 + shearOffset;
    const columnWidth = 4 + 4 * clamp((tower.mass - labTowerLimits.minMass) /
      (labTowerLimits.maxMass - labTowerLimits.minMass), 0, 1);
    return { lengthPx, bobRadiusPx, anchorY, leftAnchorOffset, rightAnchorOffset, mountSlope, columnWidth, top, pivotY };
  }

  function pendulumContact(tower, damper, theta, sway = 0) {
    const d = clampDamper(damper);
    if (!d.enabled || d.damping >= 1) return null;
    const g = pendulumGeometry(tower, d, sway);
    const bobX = g.lengthPx * Math.sin(theta * pendulumAngleScale);
    const bobY = g.pivotY + g.lengthPx * Math.cos(theta * pendulumAngleScale);
    const normalLength = Math.hypot(1, g.mountSlope);
    let nearest = null;
    for (const side of [-1, 1]) {
      const clearance = (108 - side * (bobX + g.mountSlope * (bobY - g.top))) / normalLength - g.columnWidth / 2 - g.bobRadiusPx;
      const wall = { clearance, side, kind: "wall", x: bobX + side * g.bobRadiusPx / normalLength, y: bobY + side * g.bobRadiusPx * g.mountSlope / normalLength };
      if (!nearest || clearance < nearest.clearance) nearest = wall;
      if (d.damping > 0.001) {
        const anchorX = side < 0 ? g.leftAnchorOffset : g.rightAnchorOffset;
        const dx = bobX - anchorX, dy = bobY - g.anchorY, distance = Math.hypot(dx, dy);
        // The round housing tip extends four pixels beyond its rigid centerline.
        const housing = { clearance: distance - hydraulicBodyPx - 4 - g.bobRadiusPx, side, kind: "housing",
          x: anchorX + dx / distance * (hydraulicBodyPx + 4), y: g.anchorY + dy / distance * (hydraulicBodyPx + 4) };
        if (housing.clearance < nearest.clearance) nearest = housing;
      }
    }
    return nearest;
  }

  function applyWallImpact(state, tower, damper, contact) {
    if (!damper || !damper.enabled) return state;
    const d = clampDamper(damper);
    if (d.damping >= 1) return state;
    if (!contact || contact.clearance > 0) return state;
    const wBefore = state.w;
    state.w = -d.restitution * state.w;
    const m = tower.mass * d.massRatio;
    const severity = m * d.length * Math.abs(wBefore - state.w);
    state.hits = (state.hits || 0) + 1;
    state.hitSeverity = (state.hitSeverity || 0) + severity;
    state.lastHit = severity;
    state.contact = contact;
    return state;
  }

  function initialState(options) {
    return {
      t: 0,
      x: Number(options?.initialX) || 0,
      v: Number(options?.initialV) || 0,
      th: Number(options?.initialTheta) || 0,
      w: Number(options?.initialOmega) || 0,
      heat: 0,
      hits: 0,
      hitSeverity: 0,
      lastHit: 0
    };
  }

  function sampleState(state, tower, damper, pulse) {
    const bm = baseMotion(state.t, pulse);
    const d = damper && damper.enabled ? clampDamper(damper) : null;
    return {
      t: state.t,
      x: state.x,
      y: bm.y,
      sway: state.x - bm.y,
      theta: state.th,
      bobOffset: d ? d.length * Math.sin(state.th) : 0,
      heat: state.heat || 0,
      hits: state.hits || 0,
      hitSeverity: state.hitSeverity || 0,
      lastHit: state.lastHit || 0
    };
  }

  function stepSimulation(state, dt, tower, damper, pulse) {
    const maxDt = 0.004;
    const d = damper && damper.enabled ? clampDamper(damper) : null;
    const locked = d && d.damping >= 1;
    const highResistance = d && d.damping > 0.8 && !locked;
    let next = { ...state, lastHit: 0 };
    if (locked) { next.th = 0; next.w = 0; }
    let remaining = Math.max(0, dt);
    while (remaining > 1e-9) {
      const h = Math.min(maxDt, remaining);
      const before = next;
      const advance = step => highResistance ? highResistanceStep(before, step, tower, d, pulse) : rk4Step(before, step, tower, damper, pulse);
      next = advance(h);
      if (locked) {
        next.th = 0;
        next.w = 0;
      }
      const contactAt = s => d ? pendulumContact(tower, d, s.th, s.x - baseMotion(s.t, pulse).y) : null;
      let contact = contactAt(next);
      if (contact && contact.clearance <= 0) {
        const initialContact = contactAt(before);
        if (initialContact && initialContact.clearance > 0) {
          let low = 0, high = h;
          // Locate actual surface contact within this integration step.
          for (let i = 0; i < 24; i++) {
            const middle = (low + high) / 2;
            if (contactAt(advance(middle)).clearance <= 0) high = middle;
            else low = middle;
          }
          next = advance(high);
          contact = contactAt(next);
        }
        next = applyWallImpact(next, tower, damper, contact);
      }
      remaining -= h;
      if (next.hits > (state.hits || 0)) break;
    }
    return next;
  }

  function simulate(options) {
    const tower = options.tower;
    const damper = options.damper && options.damper.enabled ? clampDamper(options.damper) : { enabled: false };
    const pulse = { ...defaultPulse(), collapseSway: tower.dangerSwayLimit ?? dangerSway, ...(options.pulse || options.quake || {}) };
    const duration = options.duration || pulse.runDuration || 120;
    const sampleDt = options.sampleDt || 0.05;
    let state = initialState(options);
    const samples = [];
    let nextSample = 0;
    let peak = 0;
    let lastAbove = pulse.duration;
    let overLimitTime = 0;
    const settleBand = options.settleBand || 0.06;
    const dangerEnabled = pulse.dangerEnabled !== false;
    const collapseSway = pulse.collapseSway ?? 0.5;
    while (state.t < duration - 1e-9) {
      const sample = sampleState(state, tower, damper, pulse);
      peak = Math.max(peak, Math.abs(sample.sway));
      if (state.t > pulse.duration && Math.abs(sample.sway) > settleBand) lastAbove = state.t;
      const dt = Math.min(sampleDt / 4, duration - state.t);
      if (dangerEnabled && state.t >= pulse.duration && Math.abs(sample.sway) > collapseSway) overLimitTime += dt;
      if (state.t >= nextSample - 1e-9) {
        samples.push(sample);
        nextSample += sampleDt;
      }
      state = stepSimulation(state, dt, tower, damper, pulse);
      if (options.stopOnHit && state.hits > 0) {
        const finalSample = sampleState(state, tower, damper, pulse);
        samples.push(finalSample);
        peak = Math.max(peak, Math.abs(finalSample.sway));
        break;
      }
    }
    return { samples, peakSway: peak, settleTime: lastAbove, overLimitTime, final: state, heat: state.heat || 0, hits: state.hits || 0, hitSeverity: state.hitSeverity || 0 };
  }

  function dangerLimitReached(dangerTime, pulse) {
    return pulse.dangerEnabled !== false && dangerTime + 1e-9 >= (pulse.collapseTime ?? 3);
  }

  function evaluateDesign(tower, damper, pulse) {
    const p = { ...defaultPulse(), collapseSway: tower.dangerSwayLimit ?? dangerSway, ...(pulse || {}) };
    const duration = p.runDuration || 120;
    const baseline = simulate({ tower, damper: { enabled: false }, pulse: p, duration, sampleDt: 0.05 });
    const designed = simulate({ tower, damper, pulse: p, duration, sampleDt: 0.05, stopOnHit: true });
    const improvement = baseline.settleTime > 0 ? 100 * (baseline.settleTime - designed.settleTime) / baseline.settleTime : 0;
    const limit = p.driftLimit || 1.2;
    const dangerEnabled = p.dangerEnabled !== false;
    const collapseSway = p.collapseSway ?? 0.5;
    const collapseTime = p.collapseTime ?? 3;
    const status = designed.hits > 0 || dangerLimitReached(designed.overLimitTime, p) || designed.peakSway > limit * 1.15 ? "failed" : "standing";
    return {
      baselinePeak: baseline.peakSway,
      peakSway: designed.peakSway,
      baselineSettleTime: baseline.settleTime,
      settleTime: designed.settleTime,
      improvement,
      status,
      limit,
      heat: designed.heat,
      hits: designed.hits,
      hitSeverity: designed.hitSeverity,
      overLimitTime: designed.overLimitTime,
      dangerEnabled,
      collapseSway,
      collapseTime,
      samples: designed.samples
    };
  }

  function mechanicalEnergy(state, tower, damper, pulse) {
    const bm = baseMotion(state.t, pulse);
    const rel = state.x - bm.y;
    const relv = state.v - bm.yd;
    let e = 0.5 * tower.mass * relv * relv + 0.5 * tower.stiffness * rel * rel;
    if (damper && damper.enabled) {
      const d = clampDamper(damper);
      const m = tower.mass * d.massRatio;
      e += 0.5 * m * Math.pow(state.v + d.length * Math.cos(state.th) * state.w, 2);
      e += 0.5 * m * Math.pow(d.length * Math.sin(state.th) * state.w, 2);
      e += m * g * d.length * (1 - Math.cos(state.th));
    }
    return e;
  }

  return {
    g,
    dangerSway,
    hydraulicDamperCount,
    hydraulicBodyPx,
    pendulumAngleScale,
    pendulumGeometry,
    pendulumContact,
    earthquakeDuration,
    earthquakeStrengths,
    labTowerLimits,
    hashSeed,
    rng,
    seededRange,
    makeId,
    clamp,
    clampDamper,
    defaultDamperFor,
    generateTower,
    createLabTower,
    defaultPulse,
    baseMotion,
    damperCoeff,
    derivatives,
    initialState,
    sampleState,
    stepSimulation,
    simulate,
    evaluateDesign,
    dangerLimitReached,
    mechanicalEnergy
  };
});
