const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '3197' }, stdio: ['ignore', 'pipe', 'pipe'] });
async function post(path, body) {
  const response = await fetch(`http://localhost:3197${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  assert.equal(response.status, 200);
  return response.json();
}
(async () => {
  try {
    await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
    const room = await post('/api/rooms', { preview: true, seed: 'preview-test', difficulty: 'hard', amplitude: 0.65, runDuration: 20 });
    assert.equal(room.preview, true);
    assert.equal(room.students.length, 12);
    assert.equal(new Set(room.students.map(s => s.id)).size, 12);
    assert(room.students.every(s => s.submission && !s.result));
    assert(room.students.some(s => !s.submission.enabled));
    const started = await post(`/api/rooms/${room.code}/start`);
    assert.equal(started.results.length, 12);
    assert.equal(started.quake.introDurationMs, 10000);
    assert(started.quake.startedAt > Date.now(), "the intro finishes before the simulation clock begins");
    assert(started.results.some(r => r.result.status === 'standing'));
    assert(started.results.some(r => r.result.status === 'failed'));
    const replay = await post(`/api/rooms/${room.code}/replay`);
    assert.deepEqual(replay.results, started.results);
    const regular = await post('/api/rooms', { seed: 'regular' });
    assert.equal(regular.students.length, 0);
    assert.equal(regular.preview, false);
    console.log('Class preview API tests passed.');
  } finally { server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
