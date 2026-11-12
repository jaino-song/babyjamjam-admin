import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  OWNED_URL, SUITES, buildChildEnv, discoverPostgres, runHarness, validateReport,
} from './run-eformsign-contract-authority-pg.mjs';

const backend = resolve(import.meta.dirname, '..');
function report() {
  return { success: true, wasInterrupted: false, numTotalTestSuites: 2, numPassedTestSuites: 2,
    numFailedTestSuites: 0, numPendingTestSuites: 0, numRuntimeErrorTestSuites: 0,
    numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: SUITES.map((suite, i) => ({ name: resolve(backend, suite), status: 'passed',
      startTime: 1, endTime: 2, assertionResults: Array.from({ length: i + 1 }, () => ({ status: 'passed' })) })) };
}

test('requires complete, executed, successful results from both exact suites', () => {
  assert.deepEqual(validateReport(report(), backend).map(s => s.tests), [1, 2]);
  for (const mutate of [
    r => { r.success = false; }, r => { r.wasInterrupted = true; },
    r => { r.numPendingTests = 1; }, r => { r.numTodoTests = 1; },
    r => { r.numFailedTestSuites = 1; }, r => { delete r.numRuntimeErrorTestSuites; },
    r => { r.testResults.pop(); }, r => { r.testResults[1] = r.testResults[0]; },
    r => { r.testResults[0].assertionResults = []; },
    r => { r.testResults[1].assertionResults[0].status = 'pending'; },
    r => { r.testResults[0].status = 'skipped'; },
    r => { r.testResults[0].name = '/foreign/authority.pg.spec.ts'; },
    r => { r.testResults[0].endTime = 0; }, r => { r.numPassedTests = 50; },
  ]) {
    const invalid = report(); mutate(invalid);
    assert.throws(() => validateReport(invalid, backend));
  }
  for (const invalid of [null, {}, { testResults: [] }]) assert.throws(() => validateReport(invalid, backend));
});

test('child environment drops inherited credentials, Postgres routing and Node preloads', () => {
  const env = buildChildEnv({ PATH: '/bin', HOME: '/home/runner', CI: 'true',
    DATABASE_URL: 'foreign-database', DIRECT_URL: 'foreign-direct', PGHOST: 'foreign-host', PGPORT: '9999',
    PGPASSWORD: 'foreign-password', PGSERVICEFILE: '/foreign', NODE_OPTIONS: '--require=/foreign',
    NODE_PATH: '/foreign', DOTENV_CONFIG_PATH: '/foreign', PRISMA_SCHEMA: '/foreign',
    BJJ_RETENTION_OWNER: '/foreign', SUPABASE_SERVICE_ROLE_KEY: 'foreign-key' }, '/tmp/owned', 123);
  assert.equal(env.DATABASE_URL, OWNED_URL); assert.equal(env.DIRECT_URL, OWNED_URL);
  assert.equal(env.BJJ_RETENTION_OWNER, '/tmp/owned'); assert.equal(env.BJJ_RETENTION_OWNER_PID, '123');
  assert.equal(env.BJJ_RETENTION_OWNED_DB, OWNED_URL);
  for (const key of ['PGHOST','PGPORT','PGPASSWORD','PGSERVICEFILE','NODE_OPTIONS','NODE_PATH',
    'DOTENV_CONFIG_PATH','PRISMA_SCHEMA','SUPABASE_SERVICE_ROLE_KEY']) assert.equal(env[key], undefined, key);
});

test('discovers installed PG16 only; absent or other major fails clearly', async () => {
  const run = async (cmd) => ({ stdout: cmd === 'pg_config' ? '/configured/bin\n' : 'postgres (PostgreSQL) 18.0\n' });
  await assert.rejects(discoverPostgres(run, {}, () => {}), /PostgreSQL 16 server binaries/);
  const pg = await discoverPostgres(async cmd => ({ stdout: cmd === 'pg_config' ? '/configured/bin\n' : 'postgres (PostgreSQL) 16.6\n' }), {}, () => {});
  assert.equal(pg.bin, '/configured/bin'); assert.match(pg.version, /16.6/);
});

// All child commands are fakes: no database, Prisma, provider or network runs here.
function waitForChildAbort(signal, interrupt) {
  assert.ok(signal instanceof AbortSignal, 'Child must receive the harness AbortSignal');
  return new Promise((_, reject) => {
    const onAbort = () => { clearTimeout(deadline); reject(signal.reason); };
    const deadline = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Timed out waiting for child AbortSignal'));
    }, 1000);
    signal.addEventListener('abort', onAbort, { once: true });
    queueMicrotask(interrupt);
  });
}
function assertRefusal(error, reason) {
  assert.equal(error.code, 'ERR_ASSERTION');
  // Node appends value diffs to assert.equal messages; the refusal text is exact.
  assert.equal(error.message.split('\n')[0], reason);
  return true;
}
function fixture(t, options = {}) {
  const calls = [], logs = [], signals = new EventEmitter();
  let dir;
  const postmaster = 900001, foreignPostmaster = 900002;
  let live = false, foreignLive = false, callsAtAbort;
  const changeLiveIdentity = () => {
    foreignLive = true;
    writeFileSync(join(dir, 'data/postmaster.pid'), `${foreignPostmaster}\n${dir}/data\n101\n62395\n${dir}/socket\n127.0.0.1\nready\n`);
  };
  const runtime = {
    sourceEnv: { CI: 'true', PATH: '/bin', HOME: '/home/runner', DATABASE_URL: 'foreign', DIRECT_URL: 'foreign', PGHOST: 'foreign', PGPORT: '1', NODE_OPTIONS: '--require=foreign' },
    uid: process.getuid(), signals, log: value => {
      logs.push(value);
      if (options.signalBeforeCommand && value.event === 'migrations-passed') {
        callsAtAbort = calls.length;
        signals.emit('SIGTERM');
      }
    },
    assertPortFree: async () => { if (options.portConflict) throw new Error('port conflict'); },
    discover: async () => ({ bin: '/fake/pg16', version: 'postgres (PostgreSQL) 16.6' }),
    resolveCli: name => `/fake/${name}.js`,
    isAlive: pid => pid === process.pid || (pid === postmaster && live) || (pid === foreignPostmaster && foreignLive),
    run: async (cmd, args, config) => {
      calls.push({ cmd, args, config });
      if (cmd === 'git') return { stdout: 'a'.repeat(40) + '\n' };
      dir ??= config.env.BJJ_RETENTION_OWNER;
      assert.equal(config.env.BJJ_RETENTION_OWNER_PID, String(process.pid));
      assert.equal(readFileSync(join(dir, 'owner'), 'utf8'), String(process.pid));
      if (cmd.endsWith('/initdb')) {
        if (options.fail === 'initdb') throw new Error('initdb failed');
        mkdirSync(join(dir, 'data'), { mode: 0o700 });
      }
      if (args[0] === 'start') {
        if (options.fail === 'start-no-pid') throw new Error('startup failed');
        live = true;
        writeFileSync(join(dir, 'data/postmaster.pid'), `${postmaster}\n${dir}/data\n100\n62395\n${dir}/socket\n127.0.0.1\nready\n`);
        if (options.fail === 'start') throw new Error('startup failed after postmaster fork');
      }
      if (args[0] === 'stop') {
        if (options.signalDuringStop) signals.emit('SIGTERM');
        if (options.stopFailure) throw new Error('stop failed');
        if (options.stopState !== 'still-live') live = false;
        if (options.stopState !== 'pid-remains') rmSync(join(dir, 'data/postmaster.pid'));
      }
      if (cmd.endsWith('/createdb') && options.fail === 'createdb') throw new Error('createdb failed');
      if (args.includes('deploy')) {
        assert.equal(config.cwd, dir);
        assert.equal(readFileSync(join(dir, 'schema/schema.prisma'), 'utf8'), readFileSync(join(backend, 'prisma/schema.prisma'), 'utf8'));
        assert.ok(existsSync(join(dir, 'schema/migrations/migration_lock.toml')));
        assert.equal(existsSync(join(dir, '.env')), false);
        if (options.tamper === 'owner') writeFileSync(join(dir, 'owner'), 'foreign');
        if (options.tamper === 'pid') writeFileSync(join(dir, 'data/postmaster.pid'), `900002\n${dir}/data\n100\n62395\n${dir}/socket\n127.0.0.1\nready\n`);
        if (options.tamper === 'mode') chmodSync(dir, 0o755);
        if (options.tamperIdentity === 'migrate') changeLiveIdentity();
        if (options.fail === 'migrate') throw new Error('migration failed');
        if (options.signal) await waitForChildAbort(config.signal, () => signals.emit(options.signal));
      }
      if (args.includes('--file')) { if (options.fail === 'verify') throw new Error('verifier failed'); }
      if (args.includes('--json')) {
        if (options.fail === 'jest') throw new Error('jest failed');
        const output = args[args.indexOf('--outputFile') + 1];
        if (options.report !== 'missing') writeFileSync(output, options.report === 'malformed' ? '{' : JSON.stringify(options.report ?? report()));
        if (options.tamperIdentity === 'jest') changeLiveIdentity();
        if (options.signalOnSuccess) signals.emit('SIGTERM');
      }
      return { stdout: '' };
    },
  };
  // Test teardown removes retained fake fixtures only after the refusal assertions.
  t.after(() => { if (dir && existsSync(dir)) { chmodSync(dir, 0o700); rmSync(dir, { recursive: true, force: true }); } });
  return { runtime, calls, logs, signals, directory: () => dir, callsAtAbort: () => callsAtAbort };
}

test('CI-only and non-root guards run before any child or database operation', async t => {
  for (const change of [{ sourceEnv: { CI: 'false' } }, { uid: 0 }]) {
    const f = fixture(t); Object.assign(f.runtime, change);
    await assert.rejects(runHarness(f.runtime), /CI|unprivileged/);
    assert.equal(f.calls.length, 0);
  }
});

test('owned lifecycle deploys migrations, verifies SQL, runs both suites and proves cleanup', async t => {
  const f = fixture(t); await runHarness(f.runtime);
  assert.equal(existsSync(f.directory()), false);
  const migrate = f.calls.find(c => c.args.includes('deploy'));
  assert.deepEqual(migrate.args.slice(1), ['migrate','deploy','--schema',join(f.directory(),'schema/schema.prisma')]);
  const psql = f.calls.find(c => c.args.includes('--file'));
  assert.ok(psql.args.includes('ON_ERROR_STOP=1')); assert.ok(psql.args.includes('--no-psqlrc'));
  for (const value of ['127.0.0.1','62395','bjj_document_jobs_test','bjj_document_jobs_qa']) assert.ok(psql.args.includes(value));
  const jest = f.calls.find(c => c.args.includes('--json'));
  assert.equal(jest.args[0], '--experimental-vm-modules');
  assert.ok(jest.args.includes('--runInBand')); assert.ok(jest.args.includes('--runTestsByPath'));
  for (const suite of SUITES) assert.ok(jest.args.includes(suite));
  for (const { config } of f.calls) {
    assert.equal(config.env.PGHOST, undefined); assert.equal(config.env.PGPORT, undefined);
    assert.equal(config.env.NODE_OPTIONS, undefined);
    if (config.env.DATABASE_URL) assert.equal(config.env.DIRECT_URL, OWNED_URL);
  }
  assert.ok(f.logs.some(l => l.event === 'verifier-passed'));
  assert.ok(f.logs.some(l => l.event === 'suites-passed' && l.suites.length === 2));
  assert.ok(f.logs.some(l => l.event === 'cleanup-passed' && l.candidate === 'a'.repeat(40)));
  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
});

for (const fail of ['createdb','migrate','verify','jest','start']) test(`${fail} failure remains red and cleans its own cluster`, async t => {
  const f = fixture(t, { fail }); await assert.rejects(runHarness(f.runtime), /failed/);
  assert.equal(existsSync(f.directory()), false);
  assert.equal(f.calls.filter(c => c.args[0] === 'stop').length, 1);
});
for (const result of ['missing','malformed', { ...report(), numPendingTests: 1 }]) test(`invalid Jest output fails closed: ${typeof result === 'string' ? result : 'skipped'}`, async t => {
  const f = fixture(t, { report: result }); await assert.rejects(runHarness(f.runtime));
  assert.equal(existsSync(f.directory()), false);
});
for (const tamper of ['owner','pid','mode']) test(`ownership mismatch ${tamper} forbids stop and deletion`, async t => {
  const f = fixture(t, { tamper }); await assert.rejects(runHarness(f.runtime), /ownership/i);
  assert.equal(existsSync(f.directory()), true);
  assert.equal(f.calls.filter(c => c.args[0] === 'stop').length, 0);
});
test('stop failure retains private directory and fails cleanup', async t => {
  const f = fixture(t, { stopFailure: true }); await assert.rejects(runHarness(f.runtime), /stop failed/);
  assert.equal(existsSync(f.directory()), true);
});
for (const signal of ['SIGINT','SIGTERM','SIGHUP']) test(`${signal} aborts the in-flight child through its passed signal`, { timeout: 3000 }, async t => {
  const f = fixture(t, { signal });
  await assert.rejects(runHarness(f.runtime), error => {
    assert.equal(error.message, `Interrupted by ${signal}`);
    assert.equal(error, f.calls.find(c => c.args.includes('deploy')).config.signal.reason);
    return true;
  });
  assert.equal(existsSync(f.directory()), false);
  assert.equal(f.calls.filter(c => c.args[0] === 'stop').length, 1);
  assert.equal(f.calls.some(c => c.args.includes('--file') || c.args.includes('--json')), false);
  for (const name of ['SIGINT','SIGTERM','SIGHUP']) assert.equal(f.signals.listenerCount(name), 0);
});
test('signal during a successful last command aborts before consuming its result', { timeout: 3000 }, async t => {
  const f = fixture(t, { signalOnSuccess: true });
  await assert.rejects(runHarness(f.runtime), { message: 'Interrupted by SIGTERM' });
  assert.equal(f.calls.filter(c => c.args.includes('--json')).length, 1);
  assert.equal(f.logs.some(l => l.event === 'suites-passed'), false);
  assert.equal(f.calls.filter(c => c.args[0] === 'stop').length, 1);
  assert.equal(existsSync(f.directory()), false);
});
test('already-aborted signal prevents spawning the next command', { timeout: 3000 }, async t => {
  const f = fixture(t, { signalBeforeCommand: true });
  await assert.rejects(runHarness(f.runtime), { message: 'Interrupted by SIGTERM' });
  assert.ok(Number.isInteger(f.callsAtAbort()));
  assert.deepEqual(f.calls.slice(f.callsAtAbort()).map(c => c.args[0]), ['stop']);
  assert.equal(f.calls.some(c => c.args.includes('--file') || c.args.includes('--json')), false);
  assert.equal(existsSync(f.directory()), false);
});
test('different live identity before a later command prevents that child and refuses cleanup', async t => {
  const f = fixture(t, { tamperIdentity: 'migrate' });
  await assert.rejects(runHarness(f.runtime), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    for (const e of error.errors) assert.equal(e.code, 'ERR_ASSERTION');
    assert.deepEqual(error.errors.map(e => e.message.split('\n')[0]), [
      'Postmaster ownership changed before command',
      'Postmaster ownership changed; refusing stop/deletion',
    ]);
    return true;
  });
  assert.equal(f.calls.some(c => c.args.includes('--file') || c.args.includes('--json')), false);
  assert.equal(f.calls.filter(c => c.args[0] === 'stop').length, 0);
  assert.equal(existsSync(f.directory()), true);
  assert.equal(f.logs.find(l => l.event === 'cleanup-failed')?.reason.split('\n')[0], 'Postmaster ownership changed; refusing stop/deletion');
  assert.equal(f.logs.some(l => l.event === 'cleanup-passed'), false);
});
test('different live identity during the last command refuses stop and deletion in finally', async t => {
  const f = fixture(t, { tamperIdentity: 'jest' });
  await assert.rejects(runHarness(f.runtime), error => assertRefusal(error, 'Postmaster ownership changed; refusing stop/deletion'));
  assert.equal(f.logs.some(l => l.event === 'suites-passed'), true);
  assert.equal(f.calls.filter(c => c.args[0] === 'stop').length, 0);
  assert.equal(existsSync(f.directory()), true);
  assert.equal(f.logs.find(l => l.event === 'cleanup-failed')?.reason.split('\n')[0], 'Postmaster ownership changed; refusing stop/deletion');
  assert.equal(f.logs.some(l => l.event === 'cleanup-passed'), false);
});
for (const [stopState, reason] of [
  ['pid-remains', 'Postmaster PID file remains; refusing deletion'],
  ['still-live', 'Postmaster still live; refusing deletion'],
]) test(`stop exits zero but ${stopState} retains the original directory`, async t => {
  const f = fixture(t, { stopState });
  await assert.rejects(runHarness(f.runtime), error => assertRefusal(error, reason));
  assert.equal(f.calls.filter(c => c.args[0] === 'stop').length, 1);
  assert.equal(existsSync(f.directory()), true);
  assert.equal(existsSync(join(f.directory(), 'data/postmaster.pid')), stopState === 'pid-remains');
  assert.equal(f.runtime.isAlive(900001), stopState === 'still-live');
  assert.equal(f.logs.find(l => l.event === 'cleanup-failed')?.reason.split('\n')[0], reason);
  assert.equal(f.logs.some(l => l.event === 'cleanup-passed'), false);
});
test('a conflicting port is never reused and never stopped', async t => {
  const f = fixture(t, { portConflict: true }); await assert.rejects(runHarness(f.runtime), /port conflict/);
  assert.equal(f.calls.some(c => c.args[0] === 'start' || c.args[0] === 'stop'), false);
  assert.equal(f.directory(), undefined);
});

test('initdb failure removes only its original directory without stopping any server', async t => {
  const f = fixture(t, { fail: 'initdb' }); await assert.rejects(runHarness(f.runtime), /initdb failed/);
  assert.equal(existsSync(f.directory()), false);
  assert.equal(f.calls.some(c => c.args[0] === 'start' || c.args[0] === 'stop'), false);
});
test('indeterminate startup without a postmaster PID retains directory and fails closed', async t => {
  const f = fixture(t, { fail: 'start-no-pid' }); await assert.rejects(runHarness(f.runtime), /Cannot prove failed startup stopped/);
  assert.equal(existsSync(f.directory()), true);
  assert.equal(f.calls.some(c => c.args[0] === 'stop'), false);
});

test('signal during cleanup finishes owned stop/deletion and still fails the run', async t => {
  const f = fixture(t, { signalDuringStop: true }); await assert.rejects(runHarness(f.runtime), /Interrupted by SIGTERM/);
  assert.equal(existsSync(f.directory()), false);
  assert.equal(f.calls.filter(c => c.args[0] === 'stop').length, 1);
  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
});
