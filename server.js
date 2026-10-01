const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const physics = require("./public/physics.js");

const publicDir = path.join(__dirname, "public");
const rooms = new Map();

const difficultySettings = {
  easy: { difficulty: "easy", dangerEnabled: false, collapseSway: physics.dangerSway, collapseTime: 3 },
  medium: { difficulty: "medium", dangerEnabled: true, collapseSway: physics.dangerSway, collapseTime: 3 },
  hard: { difficulty: "hard", dangerEnabled: true, collapseSway: physics.dangerSway, collapseTime: 2.5 }
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

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

function broadcast(room) {
  const payload = `data: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const client of room.clients) client.write(payload);
}

function getRoom(code) {
  return rooms.get(String(code || "").trim().toUpperCase());
}

function createRoom(body) {
  const seed = body.seed || `room-${Date.now()}`;
  const difficulty = difficultySettings[body.difficulty] ? body.difficulty : "medium";
  let code = String(body.code || "").trim().toUpperCase();
  if (!code) {
    do code = codeFromSeed(seed + Math.random());
    while (rooms.has(code));
  }
  const room = {
    code,
    createdAt: Date.now(),
    phase: "design",
    clients: new Set(),
    students: new Map(),
    quake: null,
    results: [],
    config: {
      seed,
      designMinutes: Number(body.designMinutes) || 12,
      amplitude: Number(body.amplitude) || 0.42,
      pulseDuration: Number(body.pulseDuration) || 1.8,
      difficulty,
      runDuration: Number(body.runDuration) || 120,
      driftLimit: Number(body.driftLimit) || 1.2
    }
  };
  rooms.set(code, room);
  return room;
}

function ensureStudent(room, body) {
  const nickname = String(body.nickname || "Student").slice(0, 24);
  const token = String(body.token || physics.makeId("tok")).slice(0, 80);
  let student = Array.from(room.students.values()).find(s => s.token === token);
  if (!student) {
    const index = room.students.size;
    const id = physics.makeId("stu");
    student = {
      id,
      token,
      nickname,
      tower: physics.generateTower(room.config.seed, index),
      submission: null,
      result: null
    };
    room.students.set(id, student);
  } else {
    student.nickname = nickname;
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
    startedAt: Date.now()
  };
  room.results = Array.from(room.students.values()).map(student => {
    const submission = student.submission || physics.defaultDamperFor(student.tower);
    const result = physics.evaluateDesign(student.tower, submission, room.quake);
    student.submission = submission;
    student.result = result;
    return { studentId: student.id, nickname: student.nickname, tower: student.tower, submission, result };
  }).sort((a, b) => {
    if (a.result.status !== b.result.status) return a.result.status === "standing" ? -1 : 1;
    return a.result.settleTime - b.result.settleTime || a.result.hits - b.result.hits || a.result.peakSway - b.result.peakSway;
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const room = createRoom(await readBody(req));
      return json(res, 200, publicRoom(room));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/rooms/")) {
      const code = url.pathname.split("/")[3];
      const room = getRoom(code);
      return room ? json(res, 200, publicRoom(room)) : json(res, 404, { error: "Room not found" });
    }

    if (req.method === "GET" && url.pathname.startsWith("/events/")) {
      const code = url.pathname.split("/")[2];
      const room = getRoom(code);
      if (!room) return json(res, 404, { error: "Room not found" });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      room.clients.add(res);
      res.write(`data: ${JSON.stringify(publicRoom(room))}\n\n`);
      req.on("close", () => room.clients.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/join$/)) {
      const code = url.pathname.split("/")[3];
      const room = getRoom(code);
      if (!room) return json(res, 404, { error: "Room not found" });
      const student = ensureStudent(room, await readBody(req));
      broadcast(room);
      return json(res, 200, { token: student.token, student, room: publicRoom(room) });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/submit$/)) {
      const code = url.pathname.split("/")[3];
      const room = getRoom(code);
      if (!room) return json(res, 404, { error: "Room not found" });
      if (room.phase !== "design") return json(res, 409, { error: "Design window is locked" });
      const body = await readBody(req);
      const student = Array.from(room.students.values()).find(s => s.token === body.token);
      if (!student) return json(res, 404, { error: "Student token not found" });
      student.submission = physics.clampDamper({ wallLimit: 2.7, ...(body.submission || {}) });
      broadcast(room);
      return json(res, 200, { student, room: publicRoom(room) });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/lock$/)) {
      const room = getRoom(url.pathname.split("/")[3]);
      if (!room) return json(res, 404, { error: "Room not found" });
      room.phase = "locked";
      broadcast(room);
      return json(res, 200, publicRoom(room));
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/start$/)) {
      const room = getRoom(url.pathname.split("/")[3]);
      if (!room) return json(res, 404, { error: "Room not found" });
      room.phase = "running";
      scoreRoom(room);
      broadcast(room);
      return json(res, 200, publicRoom(room));
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/replay$/)) {
      const room = getRoom(url.pathname.split("/")[3]);
      if (!room) return json(res, 404, { error: "Room not found" });
      room.phase = "running";
      if (!room.quake) scoreRoom(room);
      else room.quake.startedAt = Date.now();
      broadcast(room);
      return json(res, 200, publicRoom(room));
    }

    let filePath = path.normalize(path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname));
    if (!filePath.startsWith(publicDir)) return json(res, 403, { error: "Forbidden" });
    fs.readFile(filePath, (err, data) => {
      if (err) return json(res, 404, { error: "Not found" });
      res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`TMD Skyscraper Lab running at http://localhost:${port}`);
});
