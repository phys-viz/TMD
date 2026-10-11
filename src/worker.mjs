import { DurableObject } from 'cloudflare:workers';
import rules from './rooms.js';
import physics from '../public/physics.js';
import teacherAuth from './teacher-auth.js';

const { createRoom, publicRoom, ensureStudent, findStudent, joinError, submissionError, addPreviewGroups, scoreRoom, removeStudent } = rules;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function roomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join('');
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
      const teacherAction = request.method === 'POST' && (url.pathname === '/api/rooms' || /\/(lock|unlock|start|replay|delete|remove-student)$/.test(url.pathname));
      if (teacherAction && !teacher) return json({ error: 'Enter the teacher password to use teacher controls.' }, 403);
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = roomCode();
          const response = await env.ROOMS.getByName(code).fetch(new Request(`${url.origin}/create?code=${code}`, options));
          if (response.status !== 409) return response;
        }
        return json({ error: 'Please try creating a room again.' }, 503);
      }
      const match = url.pathname.match(/^\/(?:api\/rooms|events)\/([A-Z2-9]{5,6})(?:\/(join|submit|lock|unlock|start|replay|delete|remove-student))?$/i);
      if (!match) return json({ error: 'Room not found' }, 404);
      const action = url.pathname.startsWith('/events/') ? 'events' : (match[2] || 'state');
      return env.ROOMS.getByName(match[1].toUpperCase()).fetch(new Request(`${url.origin}/${action}`, options));
    } catch (_) {
      return json({ error: 'Room service unavailable. Please try again.' }, 503);
    }
  }
};

export class ChallengeRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.clients = new Set();
    this.queue = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => {
      // Rebuild the complete skyline from persistent metadata and per-tower samples.
      const saved = await ctx.storage.get('room');
      if (!saved) return;
      this.room = { ...saved, students: new Map(), clients: this.clients, results: [] };
      for (const student of saved.students) {
        student.result = await ctx.storage.get(`result:${student.id}`) || null;
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
    for (const student of students) {
      if (student.result) await this.ctx.storage.put(`result:${student.id}`, student.result);
      else await this.ctx.storage.delete(`result:${student.id}`);
    }
    await this.ctx.storage.put('room', {
      code: r.code, teacherToken: r.teacherToken, createdAt: r.createdAt, expiresAt: r.expiresAt,
      phase: r.phase, preview: r.preview || false, config: r.config, quake: r.quake, nextStudentIndex: r.nextStudentIndex,
      students: students.map(s => ({ ...s, result: null })), resultOrder: r.results.map(s => s.studentId)
    });
    await this.ctx.storage.setAlarm(r.expiresAt);
    const payload = new TextEncoder().encode(`data: ${JSON.stringify(publicRoom(r))}\n\n`);
    for (const client of this.clients) {
      try { client.enqueue(payload); } catch (_) { this.clients.delete(client); }
    }
  }

  async alarm() {
    const work = this.queue.then(async () => {
      if (this.room && Date.now() < this.room.expiresAt) return this.ctx.storage.setAlarm(this.room.expiresAt);
      for (const client of this.clients) try { client.close(); } catch (_) {}
      this.clients.clear();
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
        this.room.clients = this.clients;
        if (body.preview === true) addPreviewGroups(this.room);
        await this.save();
        return json({ ...publicRoom(this.room), teacherToken: this.room.teacherToken });
      }
      const room = this.room;
      if (!room || room.expiresAt <= Date.now()) return json({ error: 'Room not found or expired' }, 404);
      if (url.pathname === '/state' && request.method === 'GET') return json(publicRoom(room));
      if (url.pathname === '/events' && request.method === 'GET') {
        let controller, heartbeat;
        const clients = this.clients;
        const stream = new ReadableStream({
          start(c) {
            controller = c;
            clients.add(c);
            c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(publicRoom(room))}\n\n`));
            heartbeat = setInterval(() => {
              try { c.enqueue(new TextEncoder().encode(': keepalive\n\n')); }
              catch (_) { clearInterval(heartbeat); clients.delete(c); }
            }, 20000);
          },
          cancel() { clearInterval(heartbeat); clients.delete(controller); }
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' } });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (['/lock', '/unlock', '/start', '/replay', '/delete', '/remove-student'].includes(url.pathname) && request.headers.get('X-Teacher-Token') !== room.teacherToken)
        return json({ error: "Only this room's teacher can use this control." }, 403);
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
        const payload = new TextEncoder().encode(`data: ${JSON.stringify({ deleted: true, code: room.code })}\n\n`);
        for (const client of this.clients) {
          try { client.enqueue(payload); client.close(); } catch (_) {}
        }
        this.clients.clear();
        return json({ deleted: true, code: room.code });
      }
      if (url.pathname === '/join') {
        const body = await request.json();
        const error = joinError(room, body);
        if (error) return json({ error }, 409);
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
        student.submission = physics.clampDamper({ wallLimit: 2.7, ...body.submission });
        await this.save();
        return json({ student, room: publicRoom(room) });
      }
      if (url.pathname === '/lock') room.phase = 'locked';
      else if (url.pathname === '/unlock') {
        room.phase = 'design';
        room.quake = null;
        room.results = [];
        for (const student of room.students.values()) student.result = null;
      }
      else if (url.pathname === '/start') { room.phase = 'running'; scoreRoom(room); }
      else if (url.pathname === '/replay') {
        room.phase = 'running';
        scoreRoom(room);
      } else return json({ error: 'Action not found' }, 404);
      await this.save();
      return json(publicRoom(room));
    } catch (_) { return json({ error: 'Could not process this request.' }, 400); }
  }
}
