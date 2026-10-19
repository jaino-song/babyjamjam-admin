import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { test } from 'node:test';
import { classifyPaths } from './impact.mjs';

const root = resolve(import.meta.dirname, '../..');
test('every actual backend input compiled by shared selects mobile', () => {
  // Enumerate compiler inputs independently of the routing table. A new backend
  // import must gain a mobile edge even if it is not in today's pinned fixtures.
  const compiled = spawnSync('pnpm', ['--filter', '@babyjamjam/shared', 'exec', 'tsc', '--noEmit', '--listFiles'], {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.ifError(compiled.error);
  assert.equal(compiled.status, 0, `Installed shared TypeScript compiler must succeed:\n${compiled.stdout}\n${compiled.stderr}`);
  const backendInputs = [...new Set(compiled.stdout.split(/\r?\n/)
    .filter(line => line.startsWith(root + '/'))
    .map(file => relative(root, file)).filter(file => file.startsWith('backend/')))];
  assert.ok(backendInputs.length > 0, 'Expected actual backend compiler inputs; missing compiler output cannot pass');
  for (const path of backendInputs) assert.equal(classifyPaths([path]).selected.mobile, true,
    `Shared compiler consumes ${path}; mobile runs the shared type-check and must be selected`);
});
