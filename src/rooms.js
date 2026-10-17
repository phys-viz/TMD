const physics = require("../public/physics.js");
const { isBlockedName } = require("./name-filter.js");

// The City skyline gets crowded beyond this many towers.
const maxGroups = 12;
// The teacher's blocked-name log keeps only the most recent attempts.
const maxBlockedNames = 50;
// The City interpolates between every other 0.05 s scoring sample.
const citySampleStride = 2;

const difficultySettings = {
  easy: { difficulty: "easy", dangerEnabled: false, collapseSway: physics.dangerSway, collapseTime: 3 },
  medium: { difficulty: "medium", dangerEnabled: true, collapseSway: physics.dangerSway, collapseTime: 3 },
  hard: { difficulty: "hard", dangerEnabled: true, collapseSway: physics.dangerSway, collapseTime: 2.5 }
};

function codeFromSeed(seed) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let n = physics.hashSeed(seed + Date.now());
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length);
  }
  return code;
}

function publicRoom(room) {
  return {
    code: room.code,
    preview: room.preview || false,
    config: room.config,
    phase: room.phase,
    createdAt: room.createdAt,
    quake: room.quake,
    students: Array.from(room.students.values()).map(s => ({
      id: s.id,
      nickname: s.nickname,
      tower: s.tower,
      submission: s.submission,
      result: s.result
    })),
    // City samples already travel with each student; the results table needs only the summary.
    blockedCount: (room.blockedNames || []).length,
    results: room.results.map(({ studentId, nickname, submission, result: { samples, ...summary } }) =>
      ({ studentId, nickname, submission, result: summary }))
  };
}

// Pack scoring samples into the fields the City draws, as integers:
// ground and sway in 0.1 mm, pendulum angle in 0.01 mrad, damper heat in 100 J.
// The final sample is kept exactly so a failed tower holds its contact pose.
function packCitySamples(samples) {
  const kept = samples.filter((_, i) => i % citySampleStride === 0);
  const pack = (key, scale) => kept.map(s => Math.round(s[key] * scale));
  const last = samples.at(-1);
  return {
    dt: 0.05 * citySampleStride,
    y: pack("y", 1e4), sway: pack("sway", 1e4), theta: pack("theta", 1e5), heat: pack("heat", 0.01),
    end: last && { t: last.t, y: last.y, sway: last.sway, theta: last.theta, heat: last.heat }
  };
}

function addPreviewGroups(room) {
  room.preview = true;
  for (let i = 0; i < maxGroups; i++) {
    const student = ensureStudent(room, { nickname: `Pair ${String(i + 1).padStart(2, "0")}` });
    const tuned = physics.defaultDamperFor(student.tower);
    // A repeatable mix of tuned, mistuned, loose, locked, and bare towers.
    const designs = [
      { ...tuned, massRatio: 0.08, damping: 0.25 },
      { ...tuned, massRatio: 0.06, damping: 0.45 },
      { ...tuned, length: tuned.length * 0.55, massRatio: 0.035, damping: 0.45 },
      { ...tuned, massRatio: 0.01, damping: 0 },
      { ...tuned, massRatio: 0.04, damping: 1 },
      { ...tuned, enabled: false }
    ];
    student.submission = physics.clampDamper(designs[i % designs.length]);
  }
}

function findStudent(room, token) {
  return token ? Array.from(room.students.values()).find(s => s.token === token) : undefined;
}

function nicknameOf(body) {
  return String(body.nickname || "Student").slice(0, 24);
}

// Returns an error message when a group may not join or rename, or null.
// Blocked names are logged for the teacher.
function joinError(room, body) {
  const nickname = nicknameOf(body);
  if (isBlockedName(nickname)) {
    room.blockedNames = [...(room.blockedNames || []), { name: nickname, at: Date.now() }].slice(-maxBlockedNames);
    return "Please choose a different group name.";
  }
  if (findStudent(room, body.token)) return null;
  if (room.phase !== "design") return "This room is locked to new groups";
  if (room.students.size >= maxGroups) return `This room is full (${maxGroups} groups)`;
  return null;
}

// Returns an error message for an out-of-range design, or null.
function submissionError(d) {
  const inRange = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  if (d && inRange(d.length, 0.7, 17.7) && inRange(d.massRatio, 0.01, 0.1) && inRange(d.damping, 0, 1)) return null;
  return "Enter length 0.7–17.7 m, mass 1–10%, and damping 0–1.";
}

function createRoom(body, assignedCode) {
  const seed = String(body.seed || `room-${Date.now()}`).slice(0, 100);
  const difficulty = difficultySettings[body.difficulty] ? body.difficulty : "medium";
  let code = String(assignedCode || body.code || "").trim().toUpperCase();
  if (!code) {
    code = codeFromSeed(seed + Math.random());
  }
  const room = {
    code,
    createdAt: Date.now(),
    teacherToken: crypto.randomUUID(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    phase: "design",
    clients: new Set(),
    students: new Map(),
    nextStudentIndex: 0,
    quake: null,
    results: [],
    config: {
      seed,
      designMinutes: physics.clamp(Number(body.designMinutes) || 12, 1, 60),
      amplitude: physics.clamp(Number(body.amplitude) || physics.earthquakeStrengths.moderate, 0.18, 0.65),
      pulseDuration: physics.earthquakeDuration,
      difficulty,
      runDuration: physics.clamp(Number(body.runDuration) || 120, 20, 120)
    }
  };
  return room;
}

// Validate the complete next-round scenario before changing any room state.
function settingsError(body) {
  if (!body || typeof body !== "object") return "Choose difficulty and earthquake strength.";
  if (!Object.hasOwn(difficultySettings, body.difficulty)) return "Choose Easy, Medium, or Hard.";
  if (!Object.hasOwn(physics.earthquakeStrengths, body.strength)) return "Choose Gentle, Moderate, or Strong.";
  return null;
}

function updateRoomSettings(room, body) {
  room.config.difficulty = body.difficulty;
  room.config.amplitude = physics.earthquakeStrengths[body.strength];
  room.quake = null;
  room.results = [];
  for (const student of room.students.values()) student.result = null;
}

function ensureStudent(room, body) {
  const nickname = nicknameOf(body);
  let student = findStudent(room, body.token);
  if (!student) {
    const index = room.nextStudentIndex ?? room.students.size;
    room.nextStudentIndex = index + 1;
    const id = physics.makeId("stu");
    student = {
      id,
      // Issued by the server so one group cannot guess or choose another's token.
      token: crypto.randomUUID(),
      nickname,
      tower: physics.generateChallengeTower(room.config.seed, index),
      submission: null,
      result: null
    };
    room.students.set(id, student);
  } else {
    student.nickname = nickname;
    for (const entry of room.results) {
      if (entry.studentId === student.id) entry.nickname = nickname;
    }
  }
  return student;
}

function beginQuake(room) {
  const difficulty = difficultySettings[room.config.difficulty] || difficultySettings.medium;
  room.phase = "running";
  room.results = [];
  for (const student of room.students.values()) student.result = null;
  room.quake = {
    id: crypto.randomUUID(),
    preparing: true,
    amplitude: room.config.amplitude,
    duration: room.config.pulseDuration,
    difficulty: difficulty.difficulty,
    dangerEnabled: difficulty.dangerEnabled,
    collapseSway: difficulty.collapseSway,
    collapseTime: difficulty.collapseTime,
    runDuration: room.config.runDuration,
    introDurationMs: 10000,
    startedAt: Date.now() + 10000
  };
}

function scoreRoom(room) {
  if (!room.quake?.preparing) beginQuake(room);
  room.results = Array.from(room.students.values()).map(student => {
    // Groups without a submission are tested without a TMD but stay "not submitted".
    const submission = student.submission || { enabled: false };
    const result = physics.evaluateDesign(student.tower, submission, { ...room.quake, collapseSway: student.tower.dangerSwayLimit ?? physics.dangerSway });
    student.result = { ...result, samples: packCitySamples(result.samples) };
    return { studentId: student.id, nickname: student.nickname, submission, result: student.result };
  }).sort((a, b) => {
    if (a.result.status !== b.result.status) return a.result.status === "standing" ? -1 : 1;
    return a.result.settleTime - b.result.settleTime || a.result.hits - b.result.hits || a.result.peakSway - b.result.peakSway;
  });
  // Preserve the countdown announced before scoring. Slow preparation gets a
  // short synchronized lead-in rather than revealing a half-finished skyline.
  room.quake.startedAt = Math.max(room.quake.startedAt, Date.now() + 2000);
  room.quake.preparing = false;
}

function removeStudent(room, id) {
  if (!room.students.has(id)) return false;
  room.nextStudentIndex ??= room.students.size;
  room.students.delete(id);
  room.results = room.results.filter(entry => entry.studentId !== id);
  return true;
}


module.exports = { settingsError, updateRoomSettings, maxGroups, isBlockedName, createRoom, publicRoom, ensureStudent, findStudent, joinError, submissionError, addPreviewGroups, beginQuake, scoreRoom, removeStudent };
