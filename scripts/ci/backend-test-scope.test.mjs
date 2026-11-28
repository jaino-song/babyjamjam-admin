import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { backendTestScope } from './backend-test-scope.mjs';

const helper = fileURLToPath(new URL('./backend-test-scope.mjs', import.meta.url));
const service = 'backend/application/services/scheduler-lease.service.ts';
const full = { mode: 'full', files: [], realDatabase: true };

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'backend-test-scope-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (path, content = 'fixture\n') => {
    const file = join(cwd, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const commit = () => {
    git('add', '-A');
    git('-c', 'user.name=CI fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  write(service);
  const base = commit();
  return { cwd, git, write, commit, base, scope: head => backendTestScope(base, head, cwd) };
}

test('only changed backend sources reach Jest and the CLI preserves a path with spaces', t => {
  const repo = repository(t);
  const spec = 'backend/test/services/a service.spec.ts';
  repo.write(service, 'changed\n');
  repo.write(spec);
  repo.write('frontend/src/other.ts');
  repo.write('backend/docs/notes.md');
  const head = repo.commit();

  assert.deepEqual(repo.scope(head), { mode: 'related', files: [service, spec], realDatabase: false });
  assert.equal(execFileSync(process.execPath, [helper, repo.base, head], { cwd: repo.cwd, encoding: 'utf8' }), `${service}\n${spec}\n`);
});

test('configuration, shared inputs, lockfiles, and test support force full coverage', t => {
  const repo = repository(t);
  for (const path of [
    'backend/package.json',
    'pnpm-lock.yaml',
    'frontend/package-lock.json',
    'tools/deps/poetry.lock',
    'native/gradle.lockfile',
    'native/Package.resolved',
    'bun.lockb',
    'npm-shrinkwrap.json',
    'backend/jest.auth-e2e.config.ts',
    'backend/tsconfig.build.json',
    'backend/prisma/schema.prisma',
    'backend/prisma/migrations/version/migration.sql',
    'packages/shared/src/index.ts',
    '.github/workflows/backend-ci.yml',
    'scripts/ci/backend-test-scope.mjs',
    'backend/jest.setup.ts',
    'backend/test/integrity/helpers/tracker.ts',
    'backend/test/fixtures/document.pdf',
  ]) {
    repo.git('reset', '--hard', repo.base);
    repo.write(path);
    assert.deepEqual(repo.scope(repo.commit()), full, path);
  }
});

test('Prisma specs, integrity specs and persistence changes require real PostgreSQL', t => {
  const repo = repository(t);
  for (const path of [
    'backend/prisma/seed.ts',
    'backend/test/prisma/receipts.real-db.spec.ts',
    'backend/test/integrity/harness.real-db.spec.ts',
    'backend/infrastructure/database/prisma.service.ts',
    'backend/domain/repositories/receipt.interface.ts',
    'backend/infrastructure/persistence/receipt.ts',
    'backend/infrastructure/receipt.repository.ts',
  ]) {
    repo.git('reset', '--hard', repo.base);
    repo.write(path);
    assert.deepEqual(repo.scope(repo.commit()), { mode: 'related', files: [path], realDatabase: true }, path);
  }
});

test('deletions, renames, symlinks, ambiguous paths, and unresolved commits safely fall back', t => {
  const repo = repository(t);
  rmSync(join(repo.cwd, service));
  assert.deepEqual(repo.scope(repo.commit()), full, 'deletion');
  repo.git('reset', '--hard', repo.base);
  renameSync(join(repo.cwd, service), join(repo.cwd, `${service}.bak`));
  assert.deepEqual(repo.scope(repo.commit()), full, 'rename');
  repo.git('reset', '--hard', repo.base);
  symlinkSync('scheduler-lease.service.ts', join(dirname(join(repo.cwd, service)), 'alias.ts'));
  assert.deepEqual(repo.scope(repo.commit()), full, 'symlink');
  repo.git('reset', '--hard', repo.base);
  repo.write('backend/application/a\nb.ts');
  assert.deepEqual(repo.scope(repo.commit()), full, 'newline in filename');
  assert.deepEqual(repo.scope('f'.repeat(40)), full, 'missing commit');
  assert.deepEqual(backendTestScope('--help', repo.base, repo.cwd), full, 'invalid commit syntax');
});

test('empty related selections and GitHub outputs encode complete scope', t => {
  const repo = repository(t);
  repo.write('backend/README.md');
  const head = repo.commit();
  const output = join(repo.cwd, 'scope-output');
  execFileSync(process.execPath, [helper, repo.base, head, output], { cwd: repo.cwd });
  assert.equal(readFileSync(output, 'utf8'), 'mode=related\nreal-database=false\nfiles=[]\n');
  execFileSync(process.execPath, [helper, repo.base, 'bad-head', output], { cwd: repo.cwd });
  assert.match(readFileSync(output, 'utf8'), /mode=full\nreal-database=true\nfiles=\[\]\n$/);
});
