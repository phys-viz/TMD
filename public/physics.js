(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TMDPhysics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const g = 9.81;
  const dangerSway = 0.2;
  const hydraulicDamperCount = 2;

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
      dampingRatio
    };
  }

  function defaultPulse() {
    return { amplitude: 0.42, duration: 1.8, driftLimit: 1.2, dangerEnabled: true, collapseSway: dangerSway, collapseTime: 3, runDuration: 120, hitLimit: 4 };
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
    if (d.damping >= 0.999) return 0;
    const m = tower.mass * d.massRatio;
    return hydraulicDamperCount * d.damping * 2 * m * Math.sqrt(g * d.length);
  }

  function derivatives(state, tower, damper, pulse) {
    const bm = baseMotion(state.t, pulse);
    const rel = state.x - bm.y;
    const relv = state.v - bm.yd;
    if (damper && damper.enabled && clampDamper(damper).damping >= 0.999) {
      return { t: 1, x: state.v, v: (-tower.damping * relv - tower.stiffness * rel) / tower.mass, th: 0, w: 0, heat: 0 };
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

  function applyWallImpact(state, tower, damper) {
    if (!damper || !damper.enabled) return state;
    const d = clampDamper(damper);
    const limit = Math.max(0.15, d.wallLimit - d.bobRadius);
    const bobX = d.length * Math.sin(state.th);
    const movingOut = Math.sign(bobX) * state.w * Math.cos(state.th) > 0;
    if (Math.abs(bobX) <= limit || !movingOut) return state;
    const side = Math.sign(bobX);
    const wBefore = state.w;
    state.th = side * Math.asin(clamp(limit / d.length, -0.98, 0.98));
    state.w = -d.restitution * state.w;
    const m = tower.mass * d.massRatio;
    const severity = m * d.length * Math.abs(wBefore - state.w);
    state.hits = (state.hits || 0) + 1;
    state.hitSeverity = (state.hitSeverity || 0) + severity;
    state.lastHit = severity;
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
    let next = { ...state, lastHit: 0 };
    let remaining = Math.max(0, dt);
    while (remaining > 1e-9) {
      const h = Math.min(maxDt, remaining);
      next = rk4Step(next, h, tower, damper, pulse);
      if (damper && damper.enabled && clampDamper(damper).damping >= 0.999) {
        next.th = 0;
        next.w = 0;
      }
      next = applyWallImpact(next, tower, damper);
      remaining -= h;
    }
    return next;
  }

  function simulate(options) {
    const tower = options.tower;
    const damper = options.damper && options.damper.enabled ? clampDamper(options.damper) : { enabled: false };
    const pulse = { ...defaultPulse(), ...(options.pulse || options.quake || {}) };
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
    }
    return { samples, peakSway: peak, settleTime: lastAbove, overLimitTime, final: state, heat: state.heat || 0, hits: state.hits || 0, hitSeverity: state.hitSeverity || 0 };
  }

  function evaluateDesign(tower, damper, pulse) {
    const p = { ...defaultPulse(), ...(pulse || {}) };
    const duration = p.runDuration || 120;
    const baseline = simulate({ tower, damper: { enabled: false }, pulse: p, duration, sampleDt: 0.05 });
    const designed = simulate({ tower, damper, pulse: p, duration, sampleDt: 0.05 });
    const improvement = baseline.settleTime > 0 ? 100 * (baseline.settleTime - designed.settleTime) / baseline.settleTime : 0;
    const limit = p.driftLimit || 1.2;
    const dangerEnabled = p.dangerEnabled !== false;
    const collapseSway = p.collapseSway ?? 0.5;
    const collapseTime = p.collapseTime ?? 3;
    const status = (dangerEnabled && designed.overLimitTime > collapseTime) || designed.peakSway > limit * 1.15 ? "failed" : designed.hits > (p.hitLimit || 4) ? "damaged" : "standing";
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
      e += m * g * d.length * (1 - Math.cos(state.th));
    }
    return e;
  }

  return {
    g,
    dangerSway,
    hydraulicDamperCount,
    hashSeed,
    rng,
    seededRange,
    makeId,
    clamp,
    clampDamper,
    defaultDamperFor,
    generateTower,
    defaultPulse,
    baseMotion,
    damperCoeff,
    derivatives,
    initialState,
    sampleState,
    stepSimulation,
    simulate,
    evaluateDesign,
    mechanicalEnergy
  };
});
