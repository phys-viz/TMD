const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const physics = require("./public/physics.js");

const publicDir = path.join(__dirname, "public");
const rooms = new Map();

const { createRoom, publicRoom, ensureStudent, findStudent, joinError, submissionError, addPreviewGroups, scoreRoom, removeStudent } = require("./src/rooms.js");
const teacherAuth = require("./src/teacher-auth.js");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

class BadRequest extends Error {}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 16384) {
        reject(new BadRequest("Request too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new BadRequest("Could not process this request."));
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
    const teacherAction = req.method === "POST" && (url.pathname === "/api/rooms" || /\/(lock|unlock|start|replay|delete|remove-student|blocked-names)$/.test(url.pathname));
    if (teacherAction && !teacher) return json(res, 403, { error: "Enter the teacher password to use teacher controls." });

    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readBody(req);
      let room;
      do room = createRoom({ ...body, code: undefined }); while (rooms.has(room.code));
      rooms.set(room.code, room);
      if (body.preview === true) addPreviewGroups(room);
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
      const log = room.blockedNames;
      const error = joinError(room, body);
      if (error) {
        if (room.blockedNames !== log) broadcast(room);
        return json(res, 409, { error });
      }
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
      const student = findStudent(room, body.token);
      if (!student) return json(res, 404, { error: "Student token not found" });
      const error = submissionError(body.submission);
      if (error) return json(res, 400, { error });
      student.submission = physics.clampDamper({ wallLimit: 2.7, ...body.submission });
      broadcast(room);
      return json(res, 200, { student, room: publicRoom(room) });
    }

    if (req.method === "POST" && /^\/api\/rooms\/[^/]+\/(lock|unlock|start|replay|delete|remove-student|blocked-names)$/.test(url.pathname)) {
      const room = getRoom(url.pathname.split("/")[3]);
      if (!room) return json(res, 404, { error: "Room not found" });
      if (req.headers["x-teacher-token"] !== room.teacherToken) return json(res, 403, { error: "Only this room's teacher can use this control." });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/rooms\/[^/]+\/blocked-names$/)) {
      const room = getRoom(url.pathname.split("/")[3]);
      return json(res, 200, { blockedNames: room.blockedNames || [] });
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
    if (!filePath.startsWith(publicDir + path.sep)) return json(res, 403, { error: "Forbidden" });
    fs.readFile(filePath, (err, data) => {
      if (err) return json(res, 404, { error: "Not found" });
      res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  } catch (err) {
    if (err instanceof BadRequest) json(res, 400, { error: err.message });
    else json(res, 500, { error: "Something went wrong. Please try again." });
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log(`TMD Skyscraper Lab running at http://localhost:${port}`);
});
