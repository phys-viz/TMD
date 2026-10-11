const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const physics = require("./public/physics.js");

const publicDir = path.join(__dirname, "public");
const rooms = new Map();

const { maxGroups, createRoom, publicRoom, ensureStudent, scoreRoom, removeStudent } = require("./src/rooms.js");
const teacherAuth = require("./src/teacher-auth.js");

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

function broadcast(room) {
  const payload = `data: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const client of room.clients) client.write(payload);
}
function getRoom(code) {
  const room = rooms.get(String(code || "").trim().toUpperCase());
  return room && room.expiresAt > Date.now() ? room : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { status: "ok" });
    const origin = req.headers.origin;
    if (origin && origin !== url.origin) return json(res, 403, { error: "Use the app on its own website." });
    const teacher = await teacherAuth.isTeacher(process.env.TEACHER_PASSWORD, req.headers.cookie || "");
    if (url.pathname === "/api/teacher/session" && req.method === "GET") return json(res, 200, { teacher });
    if (url.pathname === "/api/teacher/login" && req.method === "POST") {
      const body = await readBody(req);
      const cookie = await teacherAuth.login(process.env.TEACHER_PASSWORD, body.password, false);
      if (!cookie) return json(res, 403, { error: "Incorrect teacher password." });
      res.setHeader("Set-Cookie", cookie);
      return json(res, 200, { teacher: true });
    }
    if (url.pathname === "/api/teacher/logout" && req.method === "POST") {
      res.setHeader("Set-Cookie", teacherAuth.logout(false));
      return json(res, 200, { teacher: false });
    }
    const teacherAction = req.method === "POST" && (url.pathname === "/api/rooms" || /\/(lock|unlock|start|replay|delete|remove-student)$/.test(url.pathname));
    if (teacherAction && !teacher) return json(res, 403, { error: "Enter the teacher password to use teacher controls." });

    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readBody(req);
      let room;
      do room = createRoom({ ...body, code: undefined }); while (rooms.has(room.code));
      rooms.set(room.code, room);
      if (body.preview === true) {
        room.preview = true;
        for (let i = 0; i < 12; i++) {
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
      return json(res, 200, { ...publicRoom(room), teacherToken: room.teacherToken });
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
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive"
      });
      room.clients.add(res);
      res.write(`data: ${JSON.stringify(publicRoom(room))}\n\n`);
      const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 20000);
      req.on("close", () => {
        clearInterval(heartbeat);
        room.clients.delete(res);
      });
      return;
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/join$/)) {
      const code = url.pathname.split("/")[3];
      const room = getRoom(code);
      if (!room) return json(res, 404, { error: "Room not found" });
      const body = await readBody(req);
      const existing = Array.from(room.students.values()).find(s => s.token === body.token);
      if (!existing && room.phase !== "design") return json(res, 409, { error: "This room is locked to new groups" });
      if (!existing && room.students.size >= maxGroups) return json(res, 409, { error: `This room is full (${maxGroups} groups)` });
      const student = ensureStudent(room, body);
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
      const d = body.submission;
      if (!d || !Number.isFinite(d.length) || d.length < .7 || d.length > 17.7 || !Number.isFinite(d.massRatio) || d.massRatio < .01 || d.massRatio > .1 || !Number.isFinite(d.damping) || d.damping < 0 || d.damping > 1)
        return json(res, 400, { error: "Enter length 0.7–17.7 m, mass 1–10%, and damping 0–1." });
      student.submission = physics.clampDamper({ wallLimit: 2.7, ...(body.submission || {}) });
      broadcast(room);
      return json(res, 200, { student, room: publicRoom(room) });
    }

    if (req.method === "POST" && /^\/api\/rooms\/[^/]+\/(lock|unlock|start|replay|delete|remove-student)$/.test(url.pathname)) {
      const room = getRoom(url.pathname.split("/")[3]);
      if (!room) return json(res, 404, { error: "Room not found" });
      if (req.headers["x-teacher-token"] !== room.teacherToken) return json(res, 403, { error: "Only this room's teacher can use this control." });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/remove-student$/)) {
      const room = getRoom(url.pathname.split("/")[3]);
      const { studentId } = await readBody(req);
      if (!removeStudent(room, studentId)) return json(res, 404, { error: "Group not found" });
      broadcast(room);
      return json(res, 200, publicRoom(room));
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/delete$/)) {
      const room = getRoom(url.pathname.split("/")[3]);
      if (!room) return json(res, 404, { error: "Room not found" });
      rooms.delete(room.code);
      for (const client of room.clients) {
        client.end(`data: ${JSON.stringify({ deleted: true, code: room.code })}\n\n`);
      }
      room.clients.clear();
      return json(res, 200, { deleted: true, code: room.code });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/lock$/)) {
      const room = getRoom(url.pathname.split("/")[3]);
      if (!room) return json(res, 404, { error: "Room not found" });
      room.phase = "locked";
      broadcast(room);
      return json(res, 200, publicRoom(room));
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/unlock$/)) {
      const room = getRoom(url.pathname.split("/")[3]);
      if (!room) return json(res, 404, { error: "Room not found" });
      room.phase = "design";
      room.quake = null;
      room.results = [];
      for (const student of room.students.values()) student.result = null;
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
      scoreRoom(room);
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
server.listen(port, "0.0.0.0", () => {
  console.log(`TMD Skyscraper Lab running at http://localhost:${port}`);
});
