(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TMDPhysics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const g = 9.81;
  const trialStep = 0.004;
  const dangerSway = 0.2;
  const hydraulicDamperCount = 2;
  const hydraulicBodyPx = 44;
  // Each hydraulic damper adds this fraction of the pendulum's critical
  // rotational damping per unit of resistance, so the pair gives
  // damping ratio = 2 x hydraulicRatio x resistance at every length.
  const hydraulicRatio = 1 / 9;
  // Physical cutaway: horizontal distance from the pendulum's centreline to
  // the inner wall surface. Collisions are decided in metres; the drawing
  // maps these distances so a drawn touch is an actual touch.
  const wallClearance = 2.8;
  const impactRestitution = 0.3;
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

  // Only the three student design choices are accepted; cutaway geometry is fixed.
  function clampDamper(d) {
    return {
      enabled: d.enabled !== false,
      length: clamp(d.length, 0.7, 17.7),
      massRatio: clamp(d.massRatio, 0.01, 0.10),
      damping: clamp(d.damping, 0, 1)
    };
  }

  // Schematic bob size in metres; heavier bobs are larger.
  function bobRadius(massRatio) {
    return 0.25 + 3.5 * massRatio;
  }

  function defaultDamperFor(tower) {
    return clampDamper({
      enabled: true,
      length: g * Math.pow(tower.period / (2 * Math.PI), 2),
      massRatio: 0.035,
      damping: 0.45
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

  function generateChallengeTower(seed, index) {
    const random = rng(`${seed}:challenge:${index}`);
    const height = Math.round(labTowerLimits.minHeight + random() * (labTowerLimits.maxHeight - labTowerLimits.minHeight));
    // Match the precision students can enter in Solo Lab: whole meters and 0.1 million kg.
    const mass = Math.round((labTowerLimits.minMass + random() * (labTowerLimits.maxMass - labTowerLimits.minMass)) / 1e5) * 1e5;
    return { ...createLabTower(height, mass), name: `Tower ${index + 1}` };
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
    return { amplitude: earthquakeStrengths.moderate, duration: earthquakeDuration, dangerEnabled: true, collapseSway: dangerSway, collapseTime: 3, runDuration: 120 };
  }

  // Called several times per integration step, so it reads the pulse directly
  // rather than building a merged settings object.
  function baseMotion(t, pulse) {
    const amplitude = pulse?.amplitude ?? earthquakeStrengths.moderate;
    const duration = pulse?.duration ?? earthquakeDuration;
    if (amplitude === 0 || t < 0 || t > duration) return { y: 0, yd: 0 };
    const u = t / duration;
    const carrier = Math.sin(2 * Math.PI * u);
    const envelope = Math.sin(Math.PI * u) ** 2;
    const y = amplitude * carrier * envelope;
    const carrierDot = (2 * Math.PI / duration) * Math.cos(2 * Math.PI * u);
    const envelopeDot = (Math.PI / duration) * Math.sin(2 * Math.PI * u);
    return { y, yd: amplitude * (carrierDot * envelope + carrier * envelopeDot) };
  }

  // Rotational damping coefficient b (N·m·s) for an already clamped damper.
  function coeffFor(tower, d) {
    if (d.damping >= 1) return 0;
    const m = tower.mass * d.massRatio;
    // Match the existing control through 0.8, then approach infinite resistance.
    const resistance = d.damping <= 0.8 ? d.damping :
      0.8 + (d.damping - 0.8) / (5 * (1 - d.damping));
    // Critical rotational damping of a simple pendulum: 2 m L^2 sqrt(g/L) = 2 m L sqrt(gL).
    const critical = 2 * m * d.length * Math.sqrt(g * d.length);
    return hydraulicDamperCount * hydraulicRatio * resistance * critical;
  }

  function damperCoeff(tower, damper) {
    return coeffFor(tower, clampDamper(damper));
  }

  function derivatives(state, tower, damper, pulse) {
    return accelerations(state, tower, damper && damper.enabled ? clampDamper(damper) : null, pulse);
  }

  // d is a clamped damper, or null when no TMD is installed.
  function accelerations(state, tower, d, pulse) {
    const bm = baseMotion(state.t, pulse);
    const rel = state.x - bm.y;
    const relv = state.v - bm.yd;
    if (d && d.damping >= 1) {
      const attachedMass = tower.mass * d.massRatio;
      return { t: 1, x: state.v, v: (-tower.damping * relv - tower.stiffness * rel) / (tower.mass + attachedMass), th: 0, w: 0, heat: 0 };
    }
    if (!d) {
      return { t: 1, x: state.v, v: (-tower.damping * relv - tower.stiffness * rel) / tower.mass, th: 0, w: 0, heat: 0 };
    }

    const M = tower.mass;
    const m = tower.mass * d.massRatio;
    const L = d.length;
    const b = coeffFor(tower, d);
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

  // d is a clamped damper, or null when no TMD is installed.
  function rk4Step(state, dt, tower, d, pulse) {
    const k1 = accelerations(state, tower, d, pulse);
    const k2 = accelerations(addState(state, k1, dt / 2), tower, d, pulse);
    const k3 = accelerations(addState(state, k2, dt / 2), tower, d, pulse);
    const k4 = accelerations(addState(state, k3, dt), tower, d, pulse);
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
    const totalMass = M + m, b = coeffFor(tower, damper);
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

  function towerGeometry(tower) {
    const heightFraction = clamp((tower.height - labTowerLimits.minHeight) /
      (labTowerLimits.maxHeight - labTowerLimits.minHeight), 0, 1);
    return {
      width: 420, height: 480, top: 118 - 60 * heightFraction, bottom: 436,
      towerWidth: 216, swayScale: 132,
      columnWidth: 4 + 4 * clamp((tower.mass - labTowerLimits.minMass) /
        (labTowerLimits.maxMass - labTowerLimits.minMass), 0, 1)
    };
  }

  function pendulumGeometry(tower, damper, sway = 0) {
    const d = clampDamper(damper);
    const layout = towerGeometry(tower);
    const { top, bottom, columnWidth } = layout;
    const pivotY = top + 2;
    // Horizontal pixels per metre: the inner wall surface is wallClearance from the centreline.
    const pxPerMeter = (layout.towerWidth / 2 - columnWidth / 2) / wallClearance;
    const radius = bobRadius(d.massRatio);
    const bobRadiusPx = radius * pxPerMeter;
    // Schematic length, at least long enough for the drawn bob to reach any
    // wall the real bob can reach. The actual length is reported numerically.
    const lengthPx = clamp(Math.max(d.length * 15, pxPerMeter * Math.min(d.length, wallClearance)), 45, 190);
    // Keep mounts above the bob for short pendulums, leaving room for each
    // rigid housing; longer pendulums use the same upper-column mounting area.
    const anchorY = top + clamp(lengthPx - 70, 16, 60);
    const mountSlope = sway * layout.swayScale / (bottom - top);
    const shearOffset = -mountSlope * (anchorY - top);
    const leftAnchorOffset = -layout.towerWidth / 2 + shearOffset, rightAnchorOffset = layout.towerWidth / 2 + shearOffset;
    return { lengthPx, bobRadius: radius, bobRadiusPx, pxPerMeter, anchorY, leftAnchorOffset, rightAnchorOffset, mountSlope, columnWidth, top, pivotY };
  }

  // Drawn bob centre (x relative to the pivot) for a physical angle. The rigid
  // rod is drawn at the angle that puts the bob's horizontal offset from the
  // drawn (tilted) walls at the true offset L sin(theta), scaled by pxPerMeter.
  function pendulumPose(geometry, theta, length) {
    const { lengthPx, pxPerMeter, mountSlope: slope, pivotY, top } = geometry;
    const offsetPx = pxPerMeter * length * Math.sin(theta);
    const norm = Math.hypot(1, slope);
    const reach = Math.max(-1, Math.min(1, (offsetPx - slope * (pivotY - top)) / (lengthPx * norm)));
    const angle = Math.asin(reach) - Math.atan(slope);
    return { angle, x: lengthPx * Math.sin(angle), y: pivotY + lengthPx * Math.cos(angle) };
  }

  function pendulumContact(tower, damper, theta, sway = 0) {
    const d = clampDamper(damper);
    if (!d.enabled || d.damping >= 1) return null;
    return pendulumContactAt(pendulumGeometry(tower, d, sway), d, theta);
  }

  // Nearest surface for a clamped damper in a given drawn geometry. Contact
  // points lie on the bob's surface, so a view can mark them on its own pose.
  function pendulumContactAt(geo, d, theta) {
    const bob = pendulumPose(geo, theta, d.length);
    const offset = d.length * Math.sin(theta);
    let nearest = null;
    for (const side of [-1, 1]) {
      // Wall contact uses the physical horizontal gap in metres, expressed in drawn pixels.
      const clearance = (wallClearance - geo.bobRadius - side * offset) * geo.pxPerMeter;
      const wall = { clearance, side, kind: "wall", x: bob.x + side * geo.bobRadiusPx, y: bob.y };
      if (!nearest || clearance < nearest.clearance) nearest = wall;
      if (d.damping > 0.001) {
        const anchorX = side < 0 ? geo.leftAnchorOffset : geo.rightAnchorOffset;
        const dx = bob.x - anchorX, dy = bob.y - geo.anchorY, distance = Math.hypot(dx, dy);
        // The round housing tip extends four pixels beyond its rigid centerline.
        const housing = { clearance: distance - hydraulicBodyPx - 4 - geo.bobRadiusPx, side, kind: "housing",
          x: bob.x - dx / distance * geo.bobRadiusPx, y: bob.y - dy / distance * geo.bobRadiusPx };
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
    state.w = -impactRestitution * state.w;
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
      const advance = step => highResistance ? highResistanceStep(before, step, tower, d, pulse) : rk4Step(before, step, tower, d, pulse);
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

  function advanceTrial(state, dt, tower, damper, pulse, overLimitTime = 0) {
    const next = stepSimulation(state, dt, tower, damper, pulse);
    const sample = sampleState(next, tower, damper, pulse);
    const dangerDt = Math.max(0, next.t - Math.max(state.t, pulse.duration));
    if (pulse.dangerEnabled !== false && Math.abs(sample.sway) > (pulse.collapseSway ?? dangerSway)) overLimitTime += dangerDt;
    const failed = sample.hits > 0 || dangerLimitReached(overLimitTime, pulse);
    return {
      state: next, sample, overLimitTime, failed,
      failureCause: failed ? (sample.hits > 0 ? "Collision \u2014 failed" : "Danger limit \u2014 failed") : null
    };
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
    let failureTime = null;
    const settleBand = options.settleBand || 0.06;
    while (state.t < duration - 1e-9) {
      const sample = sampleState(state, tower, damper, pulse);
      peak = Math.max(peak, Math.abs(sample.sway));
      if (state.t > pulse.duration && Math.abs(sample.sway) > settleBand) lastAbove = state.t;
      const dt = Math.min(trialStep, duration - state.t);
      if (state.t >= nextSample - 1e-9) {
        samples.push(sample);
        nextSample += sampleDt;
      }
      const trial = advanceTrial(state, dt, tower, damper, pulse, overLimitTime);
      state = trial.state;
      overLimitTime = trial.overLimitTime;
      const failed = trial.failed;
      if (failureTime === null && (failed || state.hits > 0)) failureTime = state.t;
      if ((options.stopOnHit && state.hits > 0) || (options.stopOnFailure && failed)) {
        const finalSample = sampleState(state, tower, damper, pulse);
        samples.push(finalSample);
        peak = Math.max(peak, Math.abs(finalSample.sway));
        break;
      }
    }
    return { samples, failureTime, peakSway: peak, settleTime: lastAbove, overLimitTime, final: state, heat: state.heat || 0, hits: state.hits || 0, hitSeverity: state.hitSeverity || 0 };
  }

  function dangerLimitReached(dangerTime, pulse) {
    return pulse.dangerEnabled !== false && dangerTime + 1e-9 >= (pulse.collapseTime ?? 3);
  }

  function evaluateDesign(tower, damper, pulse) {
    const p = { ...defaultPulse(), collapseSway: tower.dangerSwayLimit ?? dangerSway, ...(pulse || {}) };
    const duration = p.runDuration || 120;
    const baseline = simulate({ tower, damper: { enabled: false }, pulse: p, duration, sampleDt: 0.05 });
    const designed = simulate({ tower, damper, pulse: p, duration, sampleDt: 0.05, stopOnHit: true, stopOnFailure: true });
    const improvement = baseline.settleTime > 0 ? 100 * (baseline.settleTime - designed.settleTime) / baseline.settleTime : 0;
    const dangerEnabled = p.dangerEnabled !== false;
    const collapseSway = p.collapseSway ?? 0.5;
    const collapseTime = p.collapseTime ?? 3;
    const status = designed.hits > 0 || dangerLimitReached(designed.overLimitTime, p) ? "failed" : "standing";
    return {
      baselinePeak: baseline.peakSway,
      peakSway: designed.peakSway,
      baselineSettleTime: baseline.settleTime,
      settleTime: designed.settleTime,
      improvement,
      status,
      failureTime: status === "failed" ? (designed.failureTime ?? designed.final.t) : null,
      contact: designed.final.contact || null,
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
    trialStep,
    dangerSway,
    hydraulicDamperCount,
    hydraulicBodyPx,
    hydraulicRatio,
    wallClearance,
    bobRadius,
    towerGeometry,
    pendulumGeometry,
    pendulumPose,
    pendulumContact,
    pendulumContactAt,
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
    generateChallengeTower,
    createLabTower,
    defaultPulse,
    baseMotion,
    damperCoeff,
    derivatives,
    initialState,
    sampleState,
    stepSimulation,
    advanceTrial,
    simulate,
    evaluateDesign,
    dangerLimitReached,
    mechanicalEnergy
  };
});
