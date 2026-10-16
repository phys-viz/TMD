const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const P = require('../public/physics.js');
const { createRoom, ensureStudent, beginQuake, scoreRoom } = require('../src/rooms.js');
const teacherPassword = process.env.TEACHER_PASSWORD || "local-test-password";
let teacherCookie = "";
const baseUrl = process.env.TMD_TEST_URL || 'http://localhost:3197';
const server = process.env.TMD_TEST_URL ? null : spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '3197', TEACHER_PASSWORD: teacherPassword }, stdio: ['ignore', 'pipe', 'pipe'] });
const teacherKeys = new Map();
async function roomEvents(code) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/events/${code}`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert(response.headers.get('content-type').startsWith('text/event-stream'));
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffered = '';
  async function readMatching(predicate) {
    while (true) {
      const boundary = buffered.indexOf('\n\n');
      if (boundary >= 0) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        if (data) {
          const room = JSON.parse(data.slice(6));
          if (predicate(room)) return room;
        }
      } else {
        const chunk = await reader.read();
        assert.equal(chunk.done, false, 'live room stream stays connected');
        buffered += decoder.decode(chunk.value, { stream: true });
      }
    }
  }
  return {
    async next(predicate = () => true, timeoutMs = 5000) {
      let timer;
      try {
        return await Promise.race([readMatching(predicate), new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Timed out waiting for a room update')); }, timeoutMs);
        })]);
      } finally { clearTimeout(timer); }
    },
    close() { controller.abort(); }
  };
}
async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Teacher-Token': teacherKeys.get(path.split('/')[3]) || '', Cookie: teacherCookie }, body: JSON.stringify(body || {}) });
  assert.equal(response.status, 200);
  const data = await response.json();
  if (data.teacherToken) teacherKeys.set(data.code, data.teacherToken);
  return data;
}
async function startRun(path) {
  const code = path.split('/')[3];
  const events = await roomEvents(code);
  try {
    await events.next();
    const pending = await post(path);
    assert.equal(pending.phase, 'running');
    assert.equal(pending.quake.preparing, true, 'Start responds before the calculations');
    assert.deepEqual(pending.results, [], 'the announcement never includes stale results');
    assert(pending.students.every(student => student.result === null));
    const announced = await events.next(room => room.quake?.id === pending.quake.id && room.quake.preparing);
    assert.equal(announced.quake.startedAt, pending.quake.startedAt, 'connected clients receive the initial countdown before scores');
    const ready = await events.next(room => room.quake?.id === pending.quake.id && !room.quake.preparing, 20000);
    assert(ready.quake.startedAt >= announced.quake.startedAt, 'preparation cannot shorten the announced countdown');
    assert(ready.students.every(student => student.result), 'the skyline is released only with complete results');
    return ready;
  } finally { events.close(); }
}
(async () => {
  try {
    if (server) await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    const map = await fetch(`${baseUrl}/east-coast.svg`);
    assert.equal(map.status, 200);
    assert(map.headers.get('content-type').startsWith('image/svg+xml'), 'the local map loads as an SVG image');
    assert((await map.text()).includes('New Jersey'), 'the map includes the highlighted state');
    const blockedCreate = await fetch(`${baseUrl}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(blockedCreate.status, 403, "students cannot create teacher rooms without the password");
    const wrong = await fetch(`${baseUrl}/api/teacher/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({password: 'wrong-password'}) });
    assert.equal(wrong.status, 403);
    const login = await fetch(`${baseUrl}/api/teacher/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({password: teacherPassword}) });
    assert.equal(login.status, 200);
    teacherCookie = login.headers.get('set-cookie').split(';')[0];
    assert(login.headers.get('set-cookie').includes('HttpOnly'), "teacher session cannot be read by browser scripts");
    const session = await (await fetch(`${baseUrl}/api/teacher/session`, { headers: { Cookie: teacherCookie } })).json();
    assert.equal(session.teacher, true);
    if (process.env.TMD_TEST_WORKER === '1') {
      for (const method of ['GET', 'POST']) for (const type of ['quota', 'backend-error']) {
        const response = await fetch(`${baseUrl}/test/${type}`, {
          method, headers: { Cookie: teacherCookie, 'Content-Type': 'application/json' },
          ...(method === 'POST' ? { body: '{}' } : {})
        });
        assert.equal(response.status, 503, 'asynchronous room failures produce a controlled unavailable response');
        assert(response.headers.get('content-type').startsWith('application/json'), 'room errors stay JSON rather than Cloudflare exception pages');
        const error = (await response.json()).error;
        if (type === 'quota') {
          assert(error.includes('daily usage limit') && error.includes('00:00 UTC'), 'exhausted daily allowance explains when the service can recover');
        } else assert.equal(error, 'Room service unavailable. Please try again.');
      }
    }
    const tampered = await (await fetch(`${baseUrl}/api/teacher/session`, { headers: { Cookie: teacherCookie + 'a' } })).json();
    assert.equal(tampered.teacher, false, "modified session cookies are rejected");
    const room = await post('/api/rooms', { preview: true, seed: 'preview-test', difficulty: 'hard', amplitude: 0.65, runDuration: 20 });
    assert.equal(room.preview, true);
    assert.equal(room.students.length, 12);
    assert.equal(new Set(room.students.map(s => s.id)).size, 12);
    assert(room.students.every(s => s.submission && !s.result));
    assert(room.students.some(s => !s.submission.enabled));
    const forbidden = await fetch(`${baseUrl}/api/rooms/${room.code}/start`, { method: 'POST' });
    assert.equal(forbidden.status, 403, "room codes do not grant teacher controls");
    const snapshot = await (await fetch(`${baseUrl}/api/rooms/${room.code}`)).json();
    assert.equal(snapshot.teacherToken, undefined, "public state does not expose the teacher key");
    const started = await startRun(`/api/rooms/${room.code}/start`);
    assert.equal(started.results.length, 12);
    assert.equal(started.quake.introDurationMs, 10000);
    assert(started.quake.startedAt > Date.now(), "the intro finishes before the simulation clock begins");
    assert(started.results.some(r => r.result.status === 'standing'));
    assert(started.results.some(r => r.result.status === 'failed'));
    assert(started.results.every(r => r.result.relativeSettleTime >= 3 && r.result.relativeSettleTime <= 20), "each tower gets a settle time relative to its own peak");
    const replay = await startRun(`/api/rooms/${room.code}/replay`);
    assert.notEqual(replay.quake.id, started.quake.id, 'replay announces a distinct quake');
    assert.deepEqual(replay.results, started.results);
    const blockedUnlock = await fetch(`${baseUrl}/api/rooms/${room.code}/unlock`, { method: 'POST' });
    assert.equal(blockedUnlock.status, 403, "students cannot unlock rooms");
    const settingsRequest = (body, headers = {}) => fetch(`${baseUrl}/api/rooms/${room.code}/settings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: teacherCookie, 'X-Teacher-Token': teacherKeys.get(room.code), ...headers }, body: JSON.stringify(body)
    });
    assert.equal((await settingsRequest({ difficulty: 'hard', strength: 'strong' }, { Cookie: '' })).status, 403, 'settings require teacher login');
    assert.equal((await settingsRequest({ difficulty: 'hard', strength: 'strong' }, { 'X-Teacher-Token': 'wrong' })).status, 403, 'settings require this room teacher key');
    assert.equal((await settingsRequest({ difficulty: 'hard', strength: 'strong' })).status, 409, 'running rounds cannot be edited');
    const reopened = await post(`/api/rooms/${room.code}/unlock`);
    assert.equal(reopened.phase, 'design');
    assert.equal(reopened.quake, null);
    assert.deepEqual(reopened.results, []);
    assert(reopened.students.every(s => !s.result && s.submission), "unlock clears scores while retaining designs");
    for (const invalid of [null, {}, { difficulty: 'unknown', strength: 'strong' }, { difficulty: 'hard', strength: 'invalid' }]) {
      assert.equal((await settingsRequest(invalid)).status, 400, 'invalid scenarios are rejected atomically');
    }
    const unchanged = await (await fetch(`${baseUrl}/api/rooms/${room.code}`)).json();
    assert.deepEqual(unchanged.config, reopened.config, 'invalid settings never partially change difficulty');
    const changed = await post(`/api/rooms/${room.code}/settings`, { difficulty: 'hard', strength: 'strong' });
    assert.equal(changed.code, reopened.code, 'revisions keep the same join code');
    assert.deepEqual(changed.students, reopened.students, 'settings preserve every tower, identity and submitted design');
    assert.equal(changed.config.difficulty, 'hard');
    assert.equal(changed.config.amplitude, P.earthquakeStrengths.strong);
    assert.equal(changed.config.seed, reopened.config.seed);
    assert.equal(changed.quake, null);
    assert.deepEqual(changed.results, []);
    await post(`/api/rooms/${room.code}/lock`);
    assert.equal((await settingsRequest({ difficulty: 'easy', strength: 'gentle' })).status, 409, 'locking freezes the scenario');
    const revisedRun = await startRun(`/api/rooms/${room.code}/start`);
    assert.equal(revisedRun.quake.difficulty, 'hard', 'the next scored round uses the updated difficulty');
    assert.equal(revisedRun.quake.collapseTime, 2.5);
    assert.equal(revisedRun.quake.amplitude, P.earthquakeStrengths.strong, 'the next round uses updated strength');
    assert.equal(revisedRun.config.seed, reopened.config.seed);
    const regular = await post('/api/rooms', { seed: 'regular' });
    assert.equal(regular.students.length, 0);
    assert.equal(regular.preview, false);
    const joined = await post(`/api/rooms/${regular.code}/join`, { nickname: "Pair A", token: "client-chosen-token" });
    assert.notEqual(joined.token, "client-chosen-token", "the server issues student tokens");
    const assigned = joined.student.tower;
    assert.deepEqual(assigned, { ...P.createLabTower(assigned.height, assigned.mass), name: assigned.name }, "the assigned dimensions recreate identical physics in Solo Lab");
    assert.equal(assigned.mass % 100000, 0, "assigned mass uses the displayed precision");
    const rejoined = await post(`/api/rooms/${regular.code}/join`, { nickname: "Pair A", token: joined.token });
    assert.deepEqual(rejoined.student.tower, assigned, "reconnecting preserves the assignment");
    const other = await post(`/api/rooms/${regular.code}/join`, { nickname: "Pair B", token: "pair-b-token" });
    assert.notDeepEqual([other.student.tower.height, other.student.tower.mass], [assigned.height, assigned.mass]);
    const submitted = await post(`/api/rooms/${regular.code}/submit`, {
      token: joined.token, submission: { enabled: true, length: 8.4, massRatio: .06, damping: 0 }
    });
    assert.equal(submitted.student.submission.massRatio, .06);
    assert.equal(submitted.student.submission.damping, 0);
    const renamed = await post(`/api/rooms/${regular.code}/join`, { nickname: 'Renamed Pair A', token: joined.token });
    assert.equal(renamed.student.id, joined.student.id, "renaming keeps the same student");
    assert.deepEqual(renamed.student.tower, assigned, "renaming keeps the assigned tower");
    assert.deepEqual(renamed.student.submission, submitted.student.submission, "renaming keeps the submitted design");
    assert.equal(renamed.room.students.length, 2, "renaming does not add a student");
    assert.equal(renamed.student.nickname, 'Renamed Pair A');
    await post(`/api/rooms/${regular.code}/lock`);
    const lockedSubmission = await fetch(`${baseUrl}/api/rooms/${regular.code}/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: joined.token, submission: { enabled: true, length: 8.4, massRatio: .06, damping: .2 } })
    });
    assert.equal(lockedSubmission.status, 409, "locked submissions cannot be revised");
    await post(`/api/rooms/${regular.code}/unlock`);
    const revised = await post(`/api/rooms/${regular.code}/submit`, {
      token: joined.token, submission: { enabled: true, length: 8.4, massRatio: .06, damping: .2 }
    });
    assert.equal(revised.student.submission.damping, .2, "unlock permits revisions");
    const firstRun = await startRun(`/api/rooms/${regular.code}/start`);
    const originalResult = firstRun.students.find(s => s.id === joined.student.id).result;
    await post(`/api/rooms/${regular.code}/unlock`);
    const revision = { enabled: true, length: 17.7, massRatio: .1, damping: 1 };
    await post(`/api/rooms/${regular.code}/submit`, { token: joined.token, submission: revision });
    const nextRun = await startRun(`/api/rooms/${regular.code}/replay`);
    const updated = nextRun.students.find(s => s.id === joined.student.id);
    assert.equal(updated.submission.length, 17.7);
    assert.equal(updated.submission.damping, 1);
    assert.notDeepEqual(updated.result.samples, originalResult.samples, "retesting after unlock simulates the revised design");
    const expectedRevision = P.evaluateDesign(assigned, updated.submission, { ...nextRun.quake, collapseSway: assigned.dangerSwayLimit });
    assert.equal(updated.result.status, expectedRevision.status, "city survival uses the latest submitted settings");
    // City samples keep every other scoring sample, rounded to 0.1 mm, 0.01 mrad, and 100 J.
    const packed = updated.result.samples;
    const kept = expectedRevision.samples.filter((_, i) => i % 2 === 0);
    assert.equal(packed.sway.length, kept.length);
    kept.forEach((expected, index) => {
      for (const [key, scale] of [['y', 1e4], ['sway', 1e4], ['theta', 1e5], ['heat', 0.01]]) {
        assert(Math.abs(packed[key][index] / scale - expected[key]) <= 0.5 / scale + 1e-12, `revised city sample ${index} ${key} matches the new design`);
      }
    });
    assert.deepEqual(packed.end, (({ t, y, sway, theta, heat }) => ({ t, y, sway, theta, heat }))(expectedRevision.samples.at(-1)), "the final pose is kept exactly");
    assert.equal(nextRun.results[0].result.samples, undefined, "the results table does not repeat City samples");
    await post(`/api/rooms/${regular.code}/unlock`);
    const lateJoin = await post(`/api/rooms/${regular.code}/join`, { nickname: 'Pair C', token: 'pair-c-token' });
    assert.equal(lateJoin.room.students.length, 3, "unlock permits new groups");
    const originalRoom = await (await fetch(`${baseUrl}/api/rooms/${room.code}`)).json();
    assert.equal(originalRoom.code, room.code, "creating another room preserves the previous room");
    const protectedRemoval = await fetch(`${baseUrl}/api/rooms/${regular.code}/remove-student`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: joined.student.id })
    });
    assert.equal(protectedRemoval.status, 403, "students cannot remove groups");
    const testedRoom = await startRun(`/api/rooms/${regular.code}/start`);
    const unsubmitted = testedRoom.students.find(s => s.nickname === 'Pair C');
    assert.equal(unsubmitted.submission, null, "testing does not mark groups without a design as submitted");
    assert(unsubmitted.result, "groups without a design are still tested");
    const removal = await post(`/api/rooms/${regular.code}/remove-student`, { studentId: joined.student.id });
    assert.equal(removal.students.length, 2);
    assert(!removal.students.some(s => s.id === joined.student.id), "removed group loses its tower and submission");
    assert(!removal.results.some(s => s.studentId === joined.student.id), "removed group loses its results");
    assert.deepEqual(removal.students.find(s => s.id === other.student.id), testedRoom.students.find(s => s.id === other.student.id), "removal preserves other groups and results");
    const removedSubmit = await fetch(`${baseUrl}/api/rooms/${regular.code}/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: joined.token, submission: revision })
    });
    assert.equal(removedSubmit.status, 409, "running room still blocks submissions after removal");
    const blockedDelete = await fetch(`${baseUrl}/api/rooms/${regular.code}/delete`, { method: 'POST' });
    assert.equal(blockedDelete.status, 403, "students cannot delete a room");
    const wrongKey = await fetch(`${baseUrl}/api/rooms/${regular.code}/delete`, {
      method: 'POST', headers: { Cookie: teacherCookie, 'X-Teacher-Token': teacherKeys.get(room.code) }
    });
    assert.equal(wrongKey.status, 403, "a different room key cannot delete the room");
    const removed = await post(`/api/rooms/${regular.code}/delete`);
    assert.equal(removed.deleted, true);
    assert.equal((await fetch(`${baseUrl}/api/rooms/${regular.code}`)).status, 404, "deleted room is no longer accessible");
    const removedJoin = await fetch(`${baseUrl}/api/rooms/${regular.code}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: joined.token })
    });
    assert.equal(removedJoin.status, 404, "students cannot reconnect to a deleted room");
    assert.equal((await fetch(`${baseUrl}/api/rooms/${room.code}`)).status, 200, "deleting one room preserves other rooms");
    const capped = await post('/api/rooms', { seed: 'capped' });
    const joinCapped = (nickname, token) => fetch(`${baseUrl}/api/rooms/${capped.code}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, token })
    });
    await post(`/api/rooms/${capped.code}/lock`);
    assert.equal((await joinCapped('Late', 'late-token')).status, 409, "locked rooms reject new groups");
    await post(`/api/rooms/${capped.code}/unlock`);
    const capTokens = [];
    for (let i = 0; i < 12; i++) {
      const response = await joinCapped(`Pair ${i}`);
      assert.equal(response.status, 200);
      capTokens.push((await response.json()).token);
    }
    assert.equal((await joinCapped('Pair 13')).status, 409, "rooms hold at most 12 groups");
    assert.equal((await joinCapped('Pair 0', capTokens[0])).status, 200, "existing groups can still reconnect to a full room");

    const named = await post('/api/rooms', { seed: 'names' });
    const joinNamed = (nickname, token) => fetch(`${baseUrl}/api/rooms/${named.code}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, token }) });
    const rude = await joinNamed('F.u.c.k Towers');
    assert.equal(rude.status, 409);
    assert.equal((await rude.json()).error, 'Please choose a different group name.', "blocked names get a generic message");
    const okJoin = await joinNamed('Class Act');
    assert.equal(okJoin.status, 200, "ordinary names that contain short blocked words still join");
    const okToken = (await okJoin.json()).token;
    assert.equal((await joinNamed('Big Ass', okToken)).status, 409, "renaming is filtered too");
    const namedRoom = await (await fetch(`${baseUrl}/api/rooms/${named.code}`)).json();
    assert.equal(namedRoom.students[0].nickname, 'Class Act', "a rejected rename keeps the old name");
    assert.equal(namedRoom.blockedCount, 2, "the room counts blocked attempts");
    assert.equal(JSON.stringify(namedRoom).includes('Towers'), false, "blocked names are not broadcast to students");
    const studentPeek = await fetch(`${baseUrl}/api/rooms/${named.code}/blocked-names`, { method: 'POST' });
    assert.equal(studentPeek.status, 403, "only the teacher can read blocked names");
    const log = await post(`/api/rooms/${named.code}/blocked-names`);
    assert.deepEqual(log.blockedNames.map(entry => entry.name), ['F.u.c.k Towers', 'Big Ass']);
    const live = await post('/api/rooms', { seed: 'live-updates' });
    const teacherEvents = await roomEvents(live.code);
    let studentEvents;
    try {
      const initial = await teacherEvents.next();
      assert.equal(initial.code, live.code);
      assert.equal(initial.teacherToken, undefined, 'event streams never expose teacher credentials');
      // In the Cloudflare runtime, leave the connection idle long enough for
      // Durable Object hibernation before waking it with a room mutation.
      if (process.env.TMD_TEST_WORKER === '1') await new Promise(resolve => setTimeout(resolve, 11000));
      await post(`/api/rooms/${live.code}/join`, { nickname: 'Live Pair' });
      const joinedUpdate = await teacherEvents.next(room => room.students?.length === 1);
      assert.equal(joinedUpdate.students[0].nickname, 'Live Pair', 'the existing connection receives updates after idle time');
      studentEvents = await roomEvents(live.code);
      assert.equal((await studentEvents.next()).students.length, 1, 'reconnecting receives the current room snapshot');
      const revisedLive = await post(`/api/rooms/${live.code}/settings`, { difficulty: 'easy', strength: 'gentle' });
      for (const stream of [teacherEvents, studentEvents]) {
        const update = await stream.next(room => room.config?.difficulty === 'easy' && room.config?.amplitude === P.earthquakeStrengths.gentle);
        assert.deepEqual(update.students, revisedLive.students, 'teacher and student streams receive settings without changing assignments');
      }
      const restoredSettings = await (await fetch(`${baseUrl}/api/rooms/${live.code}`)).json();
      assert.deepEqual(restoredSettings.config, revisedLive.config, 'reconnecting loads the saved round settings');
      await post(`/api/rooms/${live.code}/lock`);
      assert.equal((await teacherEvents.next(room => room.phase === 'locked')).phase, 'locked');
      assert.equal((await studentEvents.next(room => room.phase === 'locked')).phase, 'locked', 'all connected clients receive the change');
      await post(`/api/rooms/${live.code}/delete`);
      assert.equal((await teacherEvents.next(room => room.deleted)).code, live.code, 'deletion reaches the teacher stream before it closes');
      assert.equal((await studentEvents.next(room => room.deleted)).code, live.code, 'deletion reaches student streams before they close');
    } finally { teacherEvents.close(); studentEvents?.close(); }
    const cancelled = await post('/api/rooms', { seed: 'cancel-preparation', runDuration: 20 });
    await post(`/api/rooms/${cancelled.code}/join`, { nickname: 'Cancel Pair' });
    await post(`/api/rooms/${cancelled.code}/start`);
    await post(`/api/rooms/${cancelled.code}/unlock`);
    await new Promise(resolve => setTimeout(resolve, 150));
    const afterCancel = await (await fetch(`${baseUrl}/api/rooms/${cancelled.code}`)).json();
    assert.equal(afterCancel.phase, 'design');
    assert.equal(afterCancel.quake, null, 'an old preparation job cannot restore a cancelled quake');
    assert.deepEqual(afterCancel.results, []);
    await post(`/api/rooms/${cancelled.code}/delete`);

    const slow = createRoom({ seed: 'slow-scoring-clock', runDuration: 20 });
    ensureStudent(slow, { nickname: 'Slow Pair' });
    beginQuake(slow);
    const { id, startedAt } = slow.quake;
    const realNow = Date.now;
    try {
      Date.now = () => startedAt + 5000;
      scoreRoom(slow);
    } finally { Date.now = realNow; }
    assert.equal(slow.quake.id, id, 'scoring preserves the announced quake identity');
    assert.equal(slow.quake.preparing, false);
    assert(slow.quake.startedAt >= startedAt + 7000, 'scoring that exceeds the countdown grants a shared two-second lead-in');
    console.log('Class preview API tests passed.');
  } finally { server?.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
