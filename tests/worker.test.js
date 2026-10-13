const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const persistence = fs.mkdtempSync(path.join(os.tmpdir(), 'tmd-worker-test-'));
const baseUrl = 'http://127.0.0.1:3198';
const password = 'local-worker-test-password';
const worker = spawn(process.execPath, [
  path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', path.join(__dirname, 'worker-harness.mjs'), '--local',
  '--ip', '127.0.0.1', '--port', '3198', '--persist-to', persistence,
  '--var', `TEACHER_PASSWORD:${password}`, '--log-level', 'error'
], { cwd: root, windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostics = '';
worker.stdout.on('data', chunk => { diagnostics += chunk; });
worker.stderr.on('data', chunk => { diagnostics += chunk; });

(async () => {
  try {
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      if (worker.exitCode !== null) throw new Error(`Cloudflare runtime exited early: ${diagnostics}`);
      try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { ready = true; break; }
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(ready, `Cloudflare runtime did not start: ${diagnostics}`);
    const tests = spawn(process.execPath, [path.join(__dirname, 'rooms.test.js')], {
      cwd: root, windowsHide: true, stdio: 'inherit',
      env: { ...process.env, TMD_TEST_URL: baseUrl, TEACHER_PASSWORD: password, TMD_TEST_WORKER: '1' }
    });
    const code = await new Promise((resolve, reject) => { tests.once('error', reject); tests.once('exit', resolve); });
    assert.equal(code, 0, 'room API and idle live updates pass in the Cloudflare runtime');
    console.log('Cloudflare room tests passed.');
  } finally {
    if (worker.exitCode === null) {
      if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else worker.kill('SIGTERM');
      if (worker.exitCode === null) await new Promise(resolve => worker.once('exit', resolve));
    }
    // Delete only the fresh temporary directory created by this test runner.
    const resolved = path.resolve(persistence);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert(path.basename(resolved).startsWith('tmd-worker-test-'));
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
        windowsHide: true, env: { ...process.env, TMD_WORKER_TEST_TEMP: resolved },
        input: `& {
          $ErrorActionPreference = 'Stop'
          $target = [IO.Path]::GetFullPath($env:TMD_WORKER_TEST_TEMP)
          $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\\')
          if ([IO.Path]::GetDirectoryName($target) -ne $parent -or -not [IO.Path]::GetFileName($target).StartsWith('tmd-worker-test-')) { throw 'Invalid test cleanup path' }
          Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
        }\n\n`, stdio: ['pipe', 'ignore', 'pipe']
      });
      assert(!fs.existsSync(resolved), 'temporary worker store is removed');
    } else fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
