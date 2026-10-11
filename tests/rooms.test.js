const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const P = require('../public/physics.js');
const teacherPassword = process.env.TEACHER_PASSWORD || "local-test-password";
let teacherCookie = "";
const baseUrl = process.env.TMD_TEST_URL || 'http://localhost:3197';
const server = process.env.TMD_TEST_URL ? null : spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '3197', TEACHER_PASSWORD: teacherPassword }, stdio: ['ignore', 'pipe', 'pipe'] });
const teacherKeys = new Map();
async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Teacher-Token': teacherKeys.get(path.split('/')[3]) || '', Cookie: teacherCookie }, body: JSON.stringify(body || {}) });
  assert.equal(response.status, 200);
  const data = await response.json();
  if (data.teacherToken) teacherKeys.set(data.code, data.teacherToken);
  return data;
}
(async () => {
  try {
    if (server) await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
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
    const started = await post(`/api/rooms/${room.code}/start`);
    assert.equal(started.results.length, 12);
    assert.equal(started.quake.introDurationMs, 10000);
    assert(started.quake.startedAt > Date.now(), "the intro finishes before the simulation clock begins");
    assert(started.results.some(r => r.result.status === 'standing'));
    assert(started.results.some(r => r.result.status === 'failed'));
    const replay = await post(`/api/rooms/${room.code}/replay`);
    assert.deepEqual(replay.results, started.results);
    const blockedUnlock = await fetch(`${baseUrl}/api/rooms/${room.code}/unlock`, { method: 'POST' });
    assert.equal(blockedUnlock.status, 403, "students cannot unlock rooms");
    const reopened = await post(`/api/rooms/${room.code}/unlock`);
    assert.equal(reopened.phase, 'design');
    assert.equal(reopened.quake, null);
    assert.deepEqual(reopened.results, []);
    assert(reopened.students.every(s => !s.result && s.submission), "unlock clears scores while retaining designs");
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
    const firstRun = await post(`/api/rooms/${regular.code}/start`);
    const originalResult = firstRun.students.find(s => s.id === joined.student.id).result;
    await post(`/api/rooms/${regular.code}/unlock`);
    const revision = { enabled: true, length: 17.7, massRatio: .1, damping: 1 };
    await post(`/api/rooms/${regular.code}/submit`, { token: joined.token, submission: revision });
    const nextRun = await post(`/api/rooms/${regular.code}/replay`);
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
    const testedRoom = await post(`/api/rooms/${regular.code}/start`);
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
    console.log('Class preview API tests passed.');
  } finally { server?.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
