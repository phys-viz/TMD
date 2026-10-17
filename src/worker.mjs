import { DurableObject } from 'cloudflare:workers';
import rules from './rooms.js';
import physics from '../public/physics.js';
import teacherAuth from './teacher-auth.js';

const { settingsError, updateRoomSettings, createRoom, publicRoom, ensureStudent, findStudent, joinError, submissionError, addPreviewGroups, beginQuake, scoreRoom, removeStudent } = rules;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function roomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join('');
}

async function roomEvents(stub, origin) {
  const response = await stub.fetch(new Request(`${origin}/events`, { headers: { Upgrade: 'websocket' } }));
  if (response.status !== 101) return response;
  const socket = response.webSocket;
  const encoder = new TextEncoder();
  let heartbeat, controller, closed = false;
  function finish(error) {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (error) controller.error(error);
    else controller.close();
  }
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      socket.addEventListener('message', event => {
        if (!closed) c.enqueue(encoder.encode(`data: ${event.data}\n\n`));
      });
      socket.addEventListener('close', () => finish());
      socket.addEventListener('error', () => finish(new Error('Room connection closed.')));
      socket.accept();
      // Keep browser SSE connections alive here, outside the Durable Object.
      // No heartbeat reaches the room, so idle rooms remain hibernateable.
      heartbeat = setInterval(() => {
        if (!closed) c.enqueue(encoder.encode(': keepalive\n\n'));
      }, 20000);
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      socket.close(1000, 'Browser disconnected');
    }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ status: 'ok' });
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/events/')) return env.ASSETS.fetch(request);
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({ error: 'Use the app on its own website.' }, 403);
    try {
      const body = request.method === 'POST' ? await request.text() : undefined;
      if (body && body.length > 16384) return json({ error: 'Request too large.' }, 413);
      const options = { method: request.method, headers: request.headers, body };
      const teacher = await teacherAuth.isTeacher(env.TEACHER_PASSWORD, request.headers.get('Cookie') || '');
      if (url.pathname === '/api/teacher/session' && request.method === 'GET') return json({ teacher });
      if (url.pathname === '/api/teacher/login' && request.method === 'POST') {
        let password;
        try { password = JSON.parse(body).password; } catch (_) { return json({ error: 'Enter the teacher password.' }, 400); }
        const cookie = await teacherAuth.login(env.TEACHER_PASSWORD, password);
        if (!cookie) return json({ error: 'Incorrect teacher password.' }, 403);
        return Response.json({ teacher: true }, { headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/teacher/logout' && request.method === 'POST')
        return Response.json({ teacher: false }, { headers: { 'Set-Cookie': teacherAuth.logout(), 'Cache-Control': 'no-store' } });
      const teacherAction = request.method === 'POST' && (url.pathname === '/api/rooms' || /\/(settings|lock|unlock|start|replay|delete|remove-student|blocked-names)$/.test(url.pathname));
      if (teacherAction && !teacher) return json({ error: 'Enter the teacher password to use teacher controls.' }, 403);
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = roomCode();
          const response = await env.ROOMS.getByName(code).fetch(new Request(`${url.origin}/create?code=${code}`, options));
          if (response.status !== 409) return response;
        }
        return json({ error: 'Please try creating a room again.' }, 503);
      }
      const match = url.pathname.match(/^\/(?:api\/rooms|events)\/([A-Z2-9]{5,6})(?:\/(join|submit|settings|lock|unlock|start|replay|delete|remove-student|blocked-names))?$/i);
      if (!match) return json({ error: 'Room not found' }, 404);
      const action = url.pathname.startsWith('/events/') ? 'events' : (match[2] || 'state');
      const stub = env.ROOMS.getByName(match[1].toUpperCase());
      if (action === 'events' && request.method === 'GET') return await roomEvents(stub, url.origin);
      return await stub.fetch(new Request(`${url.origin}/${action}`, options));
    } catch (error) {
      console.error('Room service request failed', { path: url.pathname, method: request.method, message: error.message });
      if (/Exceeded allowed .*Durable Objects free tier/i.test(error.message || '')) {
        return json({ error: 'Room service has reached its daily usage limit. It resets at 00:00 UTC. Please try again after the reset.' }, 503);
      }
      return json({ error: 'Room service unavailable. Please try again.' }, 503);
    }
  }
};

export class ChallengeRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.queue = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => {
      // Rebuild the complete skyline from persistent metadata and per-tower samples.
      const saved = await ctx.storage.get('room');
      if (!saved) return;
      this.room = { ...saved, students: new Map(), clients: new Set(), results: [] };
      for (const student of saved.students) {
        student.result = saved.quake?.preparing ? null : await ctx.storage.get(`result:${student.id}`) || null;
        this.room.students.set(student.id, student);
      }
      this.room.results = (saved.resultOrder || []).map(id => {
        const s = this.room.students.get(id);
        return { studentId: id, nickname: s.nickname, submission: s.submission || { enabled: false }, result: s.result };
      });
    });
  }

  fetch(request) {
    const work = this.queue.then(() => this.handle(request));
    this.queue = work.catch(() => {});
    return work;
  }

  async save() {
    const r = this.room;
    const students = Array.from(r.students.values());
    // Samples are saved per tower so a whole room never exceeds the storage value limit.
    // The preparing announcement contains no scores; leave old samples alone
    // until the new scores replace them, keeping this first update small.
    for (const student of r.quake?.preparing ? [] : students) {
      if (student.result) await this.ctx.storage.put(`result:${student.id}`, student.result);
      else await this.ctx.storage.delete(`result:${student.id}`);
    }
    await this.ctx.storage.put('room', {
      code: r.code, teacherToken: r.teacherToken, createdAt: r.createdAt, expiresAt: r.expiresAt,
      phase: r.phase, preview: r.preview || false, config: r.config, quake: r.quake, nextStudentIndex: r.nextStudentIndex, blockedNames: r.blockedNames || [],
      students: students.map(s => ({ ...s, result: null })), resultOrder: r.results.map(s => s.studentId)
    });
    await this.ctx.storage.setAlarm(r.quake?.preparing ? Date.now() + 50 : r.expiresAt);
    const payload = JSON.stringify(publicRoom(r));
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(payload); } catch (_) { /* Closed peers are removed by the runtime. */ }
    }
  }

  webSocketMessage(socket) {
    // Room updates are read-only; mutations use authenticated HTTP requests.
    socket.close(1008, 'Use room controls to make changes.');
  }

  webSocketClose() {}

  webSocketError(socket) {
    try { socket.close(1011, 'Room connection closed.'); } catch (_) {}
  }

  async alarm() {
    const work = this.queue.then(async () => {
      if (this.room?.quake?.preparing && this.room.expiresAt > Date.now()) {
        try {
          scoreRoom(this.room);
          await this.save();
        } catch (error) {
          // Retain the pending state so an alarm retry can finish this quake.
          this.room.quake.preparing = true;
          throw error;
        }
        return;
      }
      if (this.room && Date.now() < this.room.expiresAt) return this.ctx.storage.setAlarm(this.room.expiresAt);
      for (const socket of this.ctx.getWebSockets()) try { socket.close(1000, 'Room expired'); } catch (_) {}
      this.room = null;
      await this.ctx.storage.deleteAll();
    });
    this.queue = work.catch(() => {});
    return work;
  }

  async handle(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/create' && request.method === 'POST') {
        if (this.room && this.room.expiresAt > Date.now()) return json({ error: 'Room exists' }, 409);
        const body = await request.json();
        this.room = createRoom(body, url.searchParams.get('code'));
        if (body.preview === true) addPreviewGroups(this.room);
        await this.save();
        return json({ ...publicRoom(this.room), teacherToken: this.room.teacherToken });
      }
      const room = this.room;
      if (!room || room.expiresAt <= Date.now()) return json({ error: 'Room not found or expired' }, 404);
      if (url.pathname === '/state' && request.method === 'GET') return json(publicRoom(room));
      if (url.pathname === '/events' && request.method === 'GET') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket upgrade required.' }, 426);
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.send(JSON.stringify(publicRoom(room)));
        return new Response(null, { status: 101, webSocket: client });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (['/settings', '/lock', '/unlock', '/start', '/replay', '/delete', '/remove-student', '/blocked-names'].includes(url.pathname) && request.headers.get('X-Teacher-Token') !== room.teacherToken)
        return json({ error: "Only this room's teacher can use this control." }, 403);
      if (url.pathname === '/blocked-names') return json({ blockedNames: room.blockedNames || [] });
      if (url.pathname === '/remove-student') {
        const { studentId } = await request.json();
        if (!removeStudent(room, studentId)) return json({ error: 'Group not found' }, 404);
        await this.ctx.storage.delete(`result:${studentId}`);
        await this.save();
        return json(publicRoom(room));
      }
      if (url.pathname === '/delete') {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        this.room = null;
        const payload = JSON.stringify({ deleted: true, code: room.code });
        for (const socket of this.ctx.getWebSockets()) {
          try { socket.send(payload); socket.close(1000, 'Room deleted'); } catch (_) {}
        }
        return json({ deleted: true, code: room.code });
      }
      if (url.pathname === '/join') {
        const body = await request.json();
        const log = room.blockedNames;
        const error = joinError(room, body);
        if (error) {
          // A blocked name is saved so the teacher's log and its count stay current.
          if (room.blockedNames !== log) await this.save();
          return json({ error }, 409);
        }
        const student = ensureStudent(room, body);
        await this.save();
        return json({ token: student.token, student, room: publicRoom(room) });
      }
      if (url.pathname === '/submit') {
        if (room.phase !== 'design') return json({ error: 'Design window is locked' }, 409);
        const body = await request.json();
        const student = findStudent(room, body.token);
        if (!student) return json({ error: 'Student token not found' }, 404);
        const error = submissionError(body.submission);
        if (error) return json({ error }, 400);
        student.submission = physics.clampDamper(body.submission);
        await this.save();
        return json({ student, room: publicRoom(room) });
      }
      if (url.pathname === '/settings') {
        if (room.phase !== 'design') return json({ error: 'Unlock for revisions before changing room settings.' }, 409);
        const body = await request.json();
        const error = settingsError(body);
        if (error) return json({ error }, 400);
        updateRoomSettings(room, body);
        await this.save();
        return json(publicRoom(room));
      }
      if (url.pathname === '/lock') room.phase = 'locked';
      else if (url.pathname === '/unlock') {
        room.phase = 'design';
        room.quake = null;
        room.results = [];
        for (const student of room.students.values()) student.result = null;
      }
      else if (url.pathname === '/start' || url.pathname === '/replay') {
        if (room.quake?.preparing) return json(publicRoom(room));
        beginQuake(room);
      } else return json({ error: 'Action not found' }, 404);
      await this.save();
      return json(publicRoom(room));
    } catch (_) { return json({ error: 'Could not process this request.' }, 400); }
  }
}
