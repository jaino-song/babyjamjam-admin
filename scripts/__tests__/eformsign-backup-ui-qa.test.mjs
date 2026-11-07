import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildFixtureArgs, guiSocketPath, isIdleNativeRootEntries, proof, equalProof, descendant } from '../eformsign-backup-ui-qa.mjs';
import { parseArgs, TARGET } from '../../backend/scripts/eformsign-backup-qa.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const launcher = path.join(source, 'scripts/eformsign-backup-ui-qa.mjs');
const parent = path.join(source, 'backend/scripts/eformsign-backup-qa.mjs');
const sha = '0123456789abcdef0123456789abcdef01234567';

for (const mode of ['self-test', 'start']) {
  test(`${mode} child arguments satisfy the unchanged parent parser`, () => {
    const args = buildFixtureArgs(mode, sha);
    assert.equal(args[0], parent);
    assert.deepEqual(parseArgs(args.slice(1)), {
      mode, profile: 'pagination', port: 3003,
      'connection-file': TARGET.connection, 'qa-env-file': TARGET.qaEnv,
      root: TARGET.root, candidate: sha,
    });
    // Each caller receives its own argv; mutation cannot change subsequent calls.
    args[1] = 'stop';
    assert.equal(parseArgs(buildFixtureArgs(mode, sha).slice(1)).mode, mode);
  });
}

test('child argument builder rejects every mode outside the two caller operations', () => {
  for (const mode of ['stop', 'readiness', 'exercise', 'prepare', 'client-probe', 'deploy', '', undefined, null, {}, ['start']]) {
    assert.throws(() => buildFixtureArgs(mode, sha), { message: 'MODE_REFUSED' });
  }
});

test('child argument builder accepts only a full lowercase SHA string', () => {
  for (const value of ['', sha.slice(1), sha + '0', sha.toUpperCase(), sha + '\n', 'g'.repeat(40), undefined, null, 123, {}, [sha]]) {
    assert.throws(() => buildFixtureArgs('self-test', value), { message: 'CANDIDATE_INVALID' });
  }
});

test('launcher and parent import inertly without credential read or child-process permission', () => {
  const result = spawnSync(process.execPath, [
    '--experimental-permission', '--disable-warning=ExperimentalWarning',
    `--allow-fs-read=${launcher}`, `--allow-fs-read=${parent}`, '--input-type=module',
  ], {
    input: `
      import assert from 'node:assert/strict';
      import { pathToFileURL } from 'node:url';
      assert.equal(process.permission.has('fs.read', ${JSON.stringify(TARGET.connection)}), false);
      assert.equal(process.permission.has('fs.read', ${JSON.stringify(TARGET.qaEnv)}), false);
      assert.equal(process.permission.has('fs.read', ${JSON.stringify(TARGET.password)}), false);
      assert.equal(process.permission.has('child'), false);
      await import(pathToFileURL(${JSON.stringify(launcher)}));
      await import(pathToFileURL(${JSON.stringify(parent)}));
      console.log('inert');
    `,
    env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 1000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'inert\n');
});

test('idle native root requires its owner marker and only optional native history', () => {
  for (const entries of [['owner.json'], ['owner.json', 'native.log'], ['native.log', 'owner.json']]) {
    assert.equal(isIdleNativeRootEntries(entries), true);
  }
  for (const entries of [[], ['native.log'], ['owner.json', 'owner.json'], null, {}, 'owner.json']) {
    assert.equal(isIdleNativeRootEntries(entries), false);
  }
  for (const name of [
    'deployment.json', 'startup.json', 'm.sock', 'failure.json', 'account-state.json',
    'manager.log', 'children.log', 'closed.json', 'process.json', 'operation.json', 'session',
    'capability', 'unknown', '../native.log', null,
  ]) {
    assert.equal(isIdleNativeRootEntries(['owner.json', 'native.log', name]), false);
  }
});

test('GUI socket at the 103-byte boundary supports bind, private chmod and HTTP control', { timeout: 10_000 }, async () => {
  // Use a short, real OS temp path; never use the private GUI/fixture roots.
  const temporary = await fs.mkdtemp(path.join(await fs.realpath('/tmp'), 'ui-socket-'));
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/readiness');
    res.end(JSON.stringify({ ready: true }));
  });
  let root;
  try {
    await fs.chmod(temporary, 0o700);
    const temporaryStat = await fs.lstat(temporary);
    assert.equal(temporaryStat.isDirectory(), true);
    assert.equal(temporaryStat.mode & 0o777, 0o700);
    assert.equal(temporaryStat.uid, process.getuid());
    const directory = path.join(temporary, 'a'.repeat(96 - Buffer.byteLength(temporary, 'utf8') - 1));
    await fs.mkdir(directory, { mode: 0o700 });
    root = directory;
    const socket = guiSocketPath(root);
    assert.equal(Buffer.byteLength(root, 'utf8'), 96);
    assert.equal(socket, path.join(root, 'm.sock'));
    assert.equal(Buffer.byteLength(socket, 'utf8'), 103);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TEST_LISTEN_TIMEOUT')), 2000);
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.listen(socket, () => { clearTimeout(timer); resolve(); });
    });
    await fs.chmod(socket, 0o600);
    const stat = await fs.lstat(socket);
    assert.equal(stat.isSocket(), true);
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(stat.uid, process.getuid());
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ socketPath: socket, path: '/readiness', method: 'POST', agent: false,
        signal: AbortSignal.timeout(2000) }, res => {
        let body = '';
        res.on('error', reject);
        res.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(new Error('TEST_BODY_LIMIT')); });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject); req.end();
    });
    assert.deepEqual(result, { status: 200, body: JSON.stringify({ ready: true }) });
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (root) {
      try { await fs.unlink(path.join(root, 'm.sock')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rmdir(root);
    }
    await fs.rmdir(temporary);
  }
  await assert.rejects(fs.lstat(temporary), { code: 'ENOENT' });
});

test('GUI socket rejects overlong ASCII and multibyte roots before binding', () => {
  for (const root of ['/' + 'a'.repeat(96), '/' + 'a'.repeat(94) + '한']) {
    const server = http.createServer();
    assert.ok(Buffer.byteLength(path.join(root, 'm.sock'), 'utf8') > 103);
    assert.throws(() => server.listen(guiSocketPath(root)), { message: 'SOCKET_PATH_TOO_LONG' });
    assert.equal(server.listening, false);
  }
});

test('GUI socket requires an absolute root', () => {
  for (const root of ['', 'relative', undefined, null, {}, 123]) {
    assert.throws(() => guiSocketPath(root), { message: 'SOCKET_ROOT_REFUSED' });
  }
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function parentPid(pid) {
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8', timeout: 1000 });
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout.trim());
}
async function waitFor(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'owned process transition timed out');
    await pause(20);
  }
}

test('detached manager retains readiness identity and permits owned stop after its launcher exits', async () => {
  const parent = spawn(process.execPath, ['--input-type=module', '-e', `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, ['--input-type=module', '-e', 'setInterval(() => {}, 1000)'], {
      detached: true, stdio: 'ignore', cwd: ${JSON.stringify(source)},
    });
    child.unref();
    process.send({ pid: child.pid });
    process.once('message', () => process.disconnect());
  `], { cwd: source, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let pid;
  let expected;
  try {
    [{ pid }] = await once(parent, 'message');
    expected = proof(pid);
    assert.equal(parentPid(pid), parent.pid);
    assert.equal(descendant(pid, parent.pid), true);
    equalProof(pid, expected);
    const exited = once(parent, 'exit');
    parent.send('exit');
    const [code] = await exited;
    assert.equal(code, 0);
    await waitFor(() => parentPid(pid) !== parent.pid);
    // PID, UID, start time, command and cwd remain identical after reparenting.
    assert.deepEqual(proof(pid), expected);
    equalProof(pid, expected);
    assert.equal(descendant(pid, parent.pid), false);
    // The same identity gate used by readiness/control must permit owned stop.
    equalProof(pid, expected);
    process.kill(pid, 'SIGTERM');
    await waitFor(() => spawnSync('/bin/ps', ['-p', String(pid)], { stdio: 'ignore' }).status !== 0);
    pid = undefined;
  } finally {
    // Both handles originate in this test; no fixture or deployment is touched.
    if (parent.exitCode === null && parent.signalCode === null) {
      const exited = once(parent, 'exit'); parent.kill('SIGTERM'); await exited;
    }
    if (pid) {
      process.kill(pid, 'SIGTERM');
      await waitFor(() => spawnSync('/bin/ps', ['-p', String(pid)], { stdio: 'ignore' }).status !== 0);
    }
  }
});

test('persistent identity mismatches and wrong live child lineage remain rejected', () => {
  const expected = proof(process.pid);
  equalProof(process.pid, expected);
  assert.throws(() => equalProof(process.ppid, expected), /PROCESS_IDENTITY_CHANGED|UID_REFUSED/);
  for (const changed of [
    { ...expected, pid: process.pid + 1 },
    { ...expected, identity: expected.identity.replace(/^\s*\d+/, String(process.getuid() + 1)) },
    { ...expected, identity: expected.identity.replace(/\d\d:\d\d:\d\d/, '99:99:99') },
    { ...expected, identity: expected.identity + ' unrelated-command' },
    { ...expected, cwd: source + '/unrelated' },
  ]) assert.throws(() => equalProof(process.pid, changed), { message: 'PROCESS_IDENTITY_CHANGED' });
  assert.throws(() => equalProof(1, expected), { message: 'PID_REFUSED' });
  assert.throws(() => equalProof(99999999, expected), { message: 'IDENTITY_COMMAND_FAILED' });
  assert.equal(descendant(process.pid, process.ppid), true);
  const wrongParent = [{ pid: 90, ppid: 80 }, { pid: 80, ppid: 1 }, { pid: 70, ppid: 1 }];
  assert.equal(descendant(90, 70, wrongParent), false);
  assert.equal(descendant(90, 70, [{ pid: 90, ppid: 80 }, { pid: 80, ppid: 90 }]), false);
});
