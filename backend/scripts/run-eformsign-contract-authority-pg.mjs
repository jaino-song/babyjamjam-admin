import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  accessSync, chmodSync, constants, cpSync, existsSync, lstatSync, mkdirSync,
  mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OWNED_URL = 'postgresql://bjj_document_jobs_test@127.0.0.1:62395/bjj_document_jobs_qa';
export const SUITES = [
  'infrastructure/database/utils/eformsign-contract-authority.pg.spec.ts',
  'infrastructure/database/repositories/sb.eformsign-document-job.retention.spec.ts',
];
const backend = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(backend, '..');
const role = 'bjj_document_jobs_test', database = 'bjj_document_jobs_qa', port = '62395';

// No inherited application, Prisma, PG*, dotenv or Node preload configuration.
export function buildChildEnv(source, directory, pid) {
  const allowed = ['PATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','TZ',
    'TMPDIR','TMP','TEMP','CI','GITHUB_ACTIONS','PNPM_HOME','COREPACK_HOME',
    'COREPACK_ENABLE_DOWNLOAD_PROMPT','SystemRoot','SYSTEMROOT','WINDIR'];
  const env = Object.fromEntries(allowed.filter(key => typeof source[key] === 'string').map(key => [key, source[key]]));
  if (directory) Object.assign(env, {
    DATABASE_URL: OWNED_URL, DIRECT_URL: OWNED_URL,
    BJJ_RETENTION_OWNED_DB: OWNED_URL, BJJ_RETENTION_OWNER: directory,
    BJJ_RETENTION_OWNER_PID: String(pid),
  });
  return env;
}

export function validateReport(report, packageRoot = backend) {
  assert.ok(report && typeof report === 'object', 'Missing Jest report');
  assert.equal(report.success, true, 'Jest must succeed');
  assert.equal(report.wasInterrupted, false, 'Jest must finish');
  for (const key of ['numFailedTestSuites','numPendingTestSuites','numRuntimeErrorTestSuites',
    'numFailedTests','numPendingTests','numTodoTests']) assert.equal(report[key], 0, `${key} must be zero`);
  assert.equal(report.numTotalTestSuites, SUITES.length);
  assert.equal(report.numPassedTestSuites, SUITES.length);
  assert.ok(Number.isSafeInteger(report.numTotalTests) && report.numTotalTests > 0);
  assert.equal(report.numPassedTests, report.numTotalTests);
  assert.ok(Array.isArray(report.testResults)); assert.equal(report.testResults.length, SUITES.length);
  const expected = SUITES.map(suite => resolve(packageRoot, suite));
  assert.deepEqual(report.testResults.map(suite => suite.name).sort(), [...expected].sort(), 'Both exact suites must exist once');
  const counts = report.testResults.map(suite => {
    assert.equal(suite.status, 'passed', `${suite.name} must pass`);
    assert.ok(Number.isFinite(suite.startTime) && suite.startTime > 0);
    assert.ok(Number.isFinite(suite.endTime) && suite.endTime >= suite.startTime);
    assert.ok(Array.isArray(suite.assertionResults) && suite.assertionResults.length > 0, 'Each suite must execute positive tests');
    for (const result of suite.assertionResults) assert.equal(result.status, 'passed', 'No skipped, pending, todo or failed tests');
    return { suite: suite.name, tests: suite.assertionResults.length };
  });
  assert.equal(counts.reduce((sum, suite) => sum + suite.tests, 0), report.numTotalTests);
  return counts;
}

// Commands are argument arrays, never shell strings. Only sanitized environments enter children.
async function execute(command, args, { cwd, env, signal } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, env, signal, stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    let spawnError;
    child.once('error', error => { spawnError = error; });
    child.once('close', (code, killedBy) => {
      if (spawnError) fail(spawnError);
      else if (code !== 0) fail(new Error(`${command} failed (${killedBy ?? code})\n${stdout}\n${stderr}`));
      else done({ stdout, stderr });
    });
  });
}

export async function discoverPostgres(run, env, checkExecutable = path => accessSync(path, constants.X_OK)) {
  const candidates = ['/usr/lib/postgresql/16/bin', '/usr/local/lib/postgresql/16/bin'];
  try {
    const configured = (await run('pg_config', ['--bindir'], { env })).stdout.trim();
    if (configured.startsWith('/')) candidates.unshift(configured);
  } catch { /* An installed version-specific path is also supported. */ }
  for (const bin of new Set(candidates)) {
    try {
      for (const binary of ['postgres','initdb','pg_ctl','psql','createdb']) checkExecutable(join(bin, binary));
      const version = (await run(join(bin, 'postgres'), ['--version'], { env })).stdout.trim();
      if (/^postgres \(PostgreSQL\) 16\./.test(version)) return { bin, version };
    } catch { /* Try the next already-installed PG16 path, never install or change major. */ }
  }
  throw new Error('Installed PostgreSQL 16 server binaries are required; no installation or other-major fallback is allowed');
}

async function assertPortFree() {
  await new Promise((done, fail) => {
    const server = createServer();
    server.once('error', () => fail(new Error(`Port ${port} is occupied; refusing to reuse any database`)));
    server.listen({ host: '127.0.0.1', port: Number(port), exclusive: true }, () => server.close(error => error ? fail(error) : done()));
  });
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
function assertDirectory(owner, isAlive) {
  assert.match(owner.directory, /^\/tmp\/bjj-authority-retention-pg-[A-Za-z0-9]+$/, 'Invalid ownership path');
  const stat = lstatSync(owner.directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(owner.directory) === owner.directory,
    'Cluster ownership directory changed');
  assert.ok(stat.dev === owner.dev && stat.ino === owner.ino && stat.uid === owner.uid && (stat.mode & 0o777) === 0o700,
    'Cluster ownership directory identity/mode changed');
  const marker = lstatSync(join(owner.directory, 'owner'));
  assert.ok(marker.isFile() && !marker.isSymbolicLink() && marker.uid === owner.uid && (marker.mode & 0o077) === 0,
    'Cluster ownership marker changed');
  assert.equal(readFileSync(join(owner.directory, 'owner'), 'utf8'), String(owner.pid), 'Cluster ownership marker PID changed');
  assert.ok(isAlive(owner.pid), 'Cluster ownership PID is no longer live');
}
function postmasterIdentity(owner, isAlive) {
  assertDirectory(owner, isAlive);
  const data = join(owner.directory, 'data'), stat = lstatSync(data);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === owner.uid && (stat.mode & 0o077) === 0
    && stat.dev === owner.dataDev && stat.ino === owner.dataIno,
    'Postmaster ownership data directory changed');
  const file = join(data, 'postmaster.pid'), pidStat = lstatSync(file);
  assert.ok(pidStat.isFile() && !pidStat.isSymbolicLink() && pidStat.uid === owner.uid, 'Postmaster ownership PID file changed');
  const lines = readFileSync(file, 'utf8').split('\n');
  const pid = Number(lines[0]);
  assert.ok(/^\d+$/.test(lines[0]) && Number.isSafeInteger(pid) && pid > 1 && pid !== owner.pid && isAlive(pid), 'Invalid live postmaster ownership PID');
  assert.equal(lines[1], data, 'Postmaster ownership path mismatch');
  assert.match(lines[2], /^\d+$/, 'Postmaster ownership start time missing');
  assert.equal(lines[3], port, 'Postmaster ownership port mismatch');
  assert.equal(lines[4], join(owner.directory, 'socket'), 'Postmaster ownership socket mismatch');
  assert.equal(lines[5], '127.0.0.1', 'Postmaster ownership listener mismatch');
  return { pid, identity: lines.slice(0, 6).join('\n') };
}

export async function runHarness(overrides = {}) {
  const {
    sourceEnv = process.env, uid = process.getuid?.(), run = execute,
    signals = process, log = entry => process.stdout.write(`${JSON.stringify(entry)}\n`),
    isAlive = alive, assertPortFree: portFree = assertPortFree,
    discover = discoverPostgres,
    resolveCli = name => createRequire(join(backend, 'package.json')).resolve(name),
  } = overrides;
  assert.ok(sourceEnv.CI === 'true' || sourceEnv.CI === '1', 'Real PostgreSQL harness is CI-only; local database creation is forbidden');
  assert.ok(Number.isInteger(uid) && uid > 0, 'PostgreSQL harness requires an unprivileged runner');
  const baseEnv = buildChildEnv(sourceEnv);
  const candidate = (await run('git', ['-C', root, 'rev-parse', 'HEAD'], { env: baseEnv })).stdout.trim();
  assert.match(candidate, /^[a-f0-9]{40}$/, 'Candidate SHA must be exact');
  const emit = (event, extra = {}) => log({ event, candidate, ...extra });
  const pg = await discover(run, baseEnv);
  emit('postgres-version', { binary: join(pg.bin, 'postgres'), version: pg.version });
  await portFree();
  const directory = mkdtempSync('/tmp/bjj-authority-retention-pg-');
  chmodSync(directory, 0o700);
  const stat = lstatSync(directory);
  const owner = { directory, pid: process.pid, uid, dev: stat.dev, ino: stat.ino };
  const env = buildChildEnv(sourceEnv, directory, owner.pid);
  const controller = new AbortController();
  const handlers = new Map(['SIGINT','SIGTERM','SIGHUP'].map(signal => [signal, () => controller.abort(new Error(`Interrupted by ${signal}`))]));
  let startAttempted = false, postmaster, failure;
  const command = async (binary, args, cwd = directory) => {
    controller.signal.throwIfAborted();
    assertDirectory(owner, isAlive);
    if (postmaster) assert.equal(postmasterIdentity(owner, isAlive).identity, postmaster.identity, 'Postmaster ownership changed before command');
    const result = await run(binary, args, { cwd, env, signal: controller.signal });
    controller.signal.throwIfAborted();
    return result;
  };
  try {
    writeFileSync(join(directory, 'owner'), String(owner.pid), { flag: 'wx', mode: 0o600 });
    for (const [signal, handler] of handlers) signals.on(signal, handler);
    assertDirectory(owner, isAlive);
    mkdirSync(join(directory, 'socket'), { mode: 0o700 });
    await command(join(pg.bin, 'initdb'), ['-D',join(directory,'data'),'-U',role,'--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale']);
    const initialized = lstatSync(join(directory, 'data'));
    owner.dataDev = initialized.dev; owner.dataIno = initialized.ino;
    startAttempted = true;
    await command(join(pg.bin, 'pg_ctl'), ['start','-D',join(directory,'data'),'-l',join(directory,'postgres.log'),'-w','-t','30',
      '-o',`-h 127.0.0.1 -p ${port} -k ${directory}/socket -c unix_socket_permissions=0700`]);
    postmaster = postmasterIdentity(owner, isAlive);
    emit('cluster-started', { directory, ownerPid: owner.pid, postmasterPid: postmaster.pid });
    await command(join(pg.bin, 'createdb'), ['--host','127.0.0.1','--port',port,'--username',role,'--no-password',database]);
    // Prisma CLI auto-loads dotenv relative to cwd/schema. Stage only these committed inputs
    // outside the checkout and invoke the installed CLI directly, with no package lifecycle.
    mkdirSync(join(directory, 'schema'), { mode: 0o700 });
    cpSync(join(backend,'prisma/schema.prisma'), join(directory,'schema/schema.prisma'));
    cpSync(join(backend,'prisma/migrations'), join(directory,'schema/migrations'), { recursive: true });
    await command(process.execPath, [resolveCli('prisma/build/index.js'),'migrate','deploy','--schema',join(directory,'schema/schema.prisma')]);
    emit('migrations-passed');
    await command(join(pg.bin, 'psql'), ['--no-psqlrc','--no-password','--host','127.0.0.1','--port',port,
      '--username',role,'--dbname',database,'--set','ON_ERROR_STOP=1','--file',join(backend,'prisma/scripts/verify-eformsign-contract-authority.sql')]);
    emit('verifier-passed');
    const output = join(directory, 'jest.json');
    await command(process.execPath, ['--experimental-vm-modules',resolveCli('jest/bin/jest'),'--runInBand','--runTestsByPath',...SUITES,'--json','--outputFile',output], backend);
    const suites = validateReport(JSON.parse(readFileSync(output, 'utf8')));
    emit('suites-passed', { suites });
  } catch (error) { failure = error; }
  finally {
    try {
      assertDirectory(owner, isAlive);
      if (startAttempted && existsSync(join(directory, 'data/postmaster.pid'))) {
        const current = postmasterIdentity(owner, isAlive);
        if (postmaster) assert.equal(current.identity, postmaster.identity, 'Postmaster ownership changed; refusing stop/deletion');
        await run(join(pg.bin, 'pg_ctl'), ['stop','-D',join(directory,'data'),'-m','fast','-w','-t','30'], { cwd: directory, env });
        assertDirectory(owner, isAlive);
        assert.equal(existsSync(join(directory, 'data/postmaster.pid')), false, 'Postmaster PID file remains; refusing deletion');
        assert.equal(isAlive(current.pid), false, 'Postmaster still live; refusing deletion');
      } else if (startAttempted) {
        assert.ok(postmaster && !isAlive(postmaster.pid), 'Cannot prove failed startup stopped; retaining owned directory');
      }
      assertDirectory(owner, isAlive);
      rmSync(directory, { recursive: true });
      emit('cleanup-passed', { directory, postmasterStopped: startAttempted, directoryRemoved: !existsSync(directory) });
    } catch (error) {
      emit('cleanup-failed', { directory, reason: error.message });
      failure = failure ? new AggregateError([failure, error], `${failure.message}; cleanup failed: ${error.message}`) : error;
    } finally { for (const [signal, handler] of handlers) signals.removeListener(signal, handler); }
  }
  if (controller.signal.aborted && !failure) failure = controller.signal.reason;
  if (failure) throw failure;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runHarness(); }
  catch (error) { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; }
}
