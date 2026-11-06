import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildFixtureArgs, isIdleNativeRootEntries } from '../eformsign-backup-ui-qa.mjs';
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
    'deployment.json', 'startup.json', 'manager.sock', 'failure.json', 'account-state.json',
    'manager.log', 'children.log', 'closed.json', 'process.json', 'operation.json', 'session',
    'capability', 'unknown', '../native.log', null,
  ]) {
    assert.equal(isIdleNativeRootEntries(['owner.json', 'native.log', name]), false);
  }
});
