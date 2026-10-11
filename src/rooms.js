const physics = require("../public/physics.js");

// The City skyline gets crowded beyond this many towers.
const maxGroups = 12;

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
    results: room.results
  };
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
      runDuration: physics.clamp(Number(body.runDuration) || 120, 20, 120),
      driftLimit: physics.clamp(Number(body.driftLimit) || 1.2, 0.3, 3)
    }
  };
  return room;
}

function ensureStudent(room, body) {
  const nickname = String(body.nickname || "Student").slice(0, 24);
  const token = String(body.token || physics.makeId("tok")).slice(0, 80);
  let student = Array.from(room.students.values()).find(s => s.token === token);
  if (!student) {
    const index = room.nextStudentIndex ?? room.students.size;
    room.nextStudentIndex = index + 1;
    const id = physics.makeId("stu");
    student = {
      id,
      token,
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

function scoreRoom(room) {
  const difficulty = difficultySettings[room.config.difficulty] || difficultySettings.medium;
  room.quake = {
    amplitude: room.config.amplitude,
    duration: room.config.pulseDuration,
    difficulty: difficulty.difficulty,
    dangerEnabled: difficulty.dangerEnabled,
    collapseSway: difficulty.collapseSway,
    collapseTime: difficulty.collapseTime,
    runDuration: room.config.runDuration,
    driftLimit: room.config.driftLimit,
    introDurationMs: 10000,
    startedAt: Date.now() + 10000
  };
  room.results = Array.from(room.students.values()).map(student => {
    // Groups without a submission are tested without a TMD but stay "not submitted".
    const submission = student.submission || { enabled: false };
    const result = physics.evaluateDesign(student.tower, submission, { ...room.quake, collapseSway: student.tower.dangerSwayLimit ?? physics.dangerSway });
    student.result = result;
    return { studentId: student.id, nickname: student.nickname, tower: student.tower, submission, result };
  }).sort((a, b) => {
    if (a.result.status !== b.result.status) return a.result.status === "standing" ? -1 : 1;
    return a.result.settleTime - b.result.settleTime || a.result.hits - b.result.hits || a.result.peakSway - b.result.peakSway;
  });
  room.quake.startedAt = Date.now() + room.quake.introDurationMs;
}

function removeStudent(room, id) {
  if (!room.students.has(id)) return false;
  room.nextStudentIndex ??= room.students.size;
  room.students.delete(id);
  room.results = room.results.filter(entry => entry.studentId !== id);
  return true;
}


module.exports = { maxGroups, createRoom, publicRoom, ensureStudent, scoreRoom, removeStudent };
