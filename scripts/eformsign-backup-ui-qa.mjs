import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { createRequire, Module } from 'node:module';

const ENTRY = fileURLToPath(import.meta.url);
const SOURCE = path.dirname(path.dirname(ENTRY));
const UI = '/Users/jaino/Development/babyjamjam-admin/eformsign-backup-ui-socket-v8';
const ROOT = '/Users/jaino/Development/.task-evidence/eformsign-backup-execution-20261106/ui-qa-synced-runtime';
const FIXTURE = '/Users/jaino/Development/.task-evidence/eformsign-backup-execution-20261106/qa-fixture-synced-runtime';
const FIXEDCONNECTION = '/Users/jaino/Development/.task-evidence/eformsign-backup-execution-20261106/private-ui-postgres-synced/connection.json';
// Credential input remains the immutable reviewed fixture input, independent of GUI source.
const ENV = '/Users/jaino/Development/babyjamjam-admin/eformsign-backup-ui-connection/frontend/.env.local';
const NODE = '/Users/jaino/.hermes/node/bin/node';
const PNPM = '/opt/homebrew/lib/node_modules/pnpm/bin/pnpm.cjs';
const ENVIRONMENT = 'eformsign-backup-ui-qa-synced-20261107';
const A = '10000000-0000-4000-8000-000000000001';
const OWNER = '10000000-0000-4000-8000-000000000010';
const RECORD = path.join(ROOT, 'deployment.json');
const required = (ok, code) => { if (!ok) throw new Error(code); };
export function guiSocketPath(root) {
  required(typeof root === 'string' && path.isAbsolute(root), 'SOCKET_ROOT_REFUSED');
  const socket = path.join(root, 'm.sock');
  // Leave room for the terminating NUL in macOS sockaddr_un.sun_path.
  required(Buffer.byteLength(socket, 'utf8') <= 103, 'SOCKET_PATH_TOO_LONG');
  return socket;
}
const SOCKET = guiSocketPath(ROOT);
// The caller owns only these two operations and these fixed fixture resources.
export function buildFixtureArgs(mode, sha) {
  required(mode === 'start' || mode === 'self-test', 'MODE_REFUSED');
  required(typeof sha === 'string' && sha.length === 40 && /^[a-f0-9]{40}$/.test(sha), 'CANDIDATE_INVALID');
  return [path.join(SOURCE, 'backend/scripts/eformsign-backup-qa.mjs'), mode,
    '--connection-file', FIXEDCONNECTION, '--qa-env-file', ENV, '--root', FIXTURE,
    '--profile', 'pagination', '--candidate', sha];
}
export function isIdleNativeRootEntries(entries) {
  return Array.isArray(entries) && entries.includes('owner.json')
    && new Set(entries).size === entries.length
    && entries.every(name => name === 'owner.json' || name === 'native.log');
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanEnv = () => ({ PATH: '/Users/jaino/.hermes/node/bin:/opt/homebrew/bin:/usr/bin:/bin', LANG: 'C',
  NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3003', DEVELOPMENT_API_BASE_URL: 'http://127.0.0.1:3003',
  NEXT_PUBLIC_E2E_TEST: 'false', NEXT_TELEMETRY_DISABLED: '1', SENTRY_AUTH_TOKEN: '', SENTRY_DSN: '', NEXT_PUBLIC_SENTRY_DSN: '' });
function command(bin, args, cwd = SOURCE) {
  const result = spawnSync(bin, args, { cwd, env: cleanEnv(), encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  required(result.status === 0, 'IDENTITY_COMMAND_FAILED'); return result.stdout.trimEnd();
}
function head() { return command('/usr/bin/git', ['rev-parse', 'HEAD']); }
function candidate(nativeOnly = false) {
  const sha = head(); required(/^[a-f0-9]{40}$/.test(sha), 'CANDIDATE_INVALID');
  required(nativeOnly || /^[a-f0-9]{40}$/.test(process.env.CANDIDATE_SHA ?? ''), 'CANDIDATE_REQUIRED');
  if (process.env.CANDIDATE_SHA) required(process.env.CANDIDATE_SHA === sha, 'CANDIDATE_MISMATCH');
  required(command('/usr/bin/git', ['status', '--porcelain', '--untracked-files=all']) === '', 'CLEAN_CANDIDATE_REQUIRED');
  return sha;
}
async function sourceDigest() {
  const files = command('/usr/bin/git', ['ls-files', '-z']).split('\0').filter(Boolean).sort();
  const digest = createHash('sha256');
  for (const file of files) { digest.update(file + '\0'); digest.update(await fs.readFile(path.join(SOURCE, file))); }
  return digest.digest('hex');
}
async function privatePath(file, directory = false) {
  const stat = await fs.lstat(file);
  required(!stat.isSymbolicLink() && stat.uid === process.getuid() && (directory ? stat.isDirectory() : stat.isFile())
    && (stat.mode & 0o777) === (directory ? 0o700 : 0o600), 'PRIVATE_IDENTITY_REFUSED');
  return stat;
}
async function privateJson(file) { await privatePath(file); return JSON.parse(await fs.readFile(file, 'utf8')); }
async function write(file, value) { await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 }); await privatePath(file); }
async function root(create = false) {
  required(await fs.realpath(SOURCE) === SOURCE, 'SOURCE_SYMLINK_REFUSED');
  if (create) {
    try { await fs.mkdir(ROOT, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  await privatePath(ROOT, true);
  const markerFile = path.join(ROOT, 'owner.json');
  let owner;
  try { owner = await privateJson(markerFile); }
  catch (e) {
    if (!create || e.code !== 'ENOENT') throw e;
    required((await fs.readdir(ROOT)).length === 0, 'UNKNOWN_ROOT_REFUSED');
    owner = { version: 1, uid: process.getuid(), environmentId: ENVIRONMENT };
    await fs.writeFile(markerFile, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
  }
  required(owner.version === 1 && owner.uid === process.getuid() && owner.environmentId === ENVIRONMENT, 'ROOT_OWNER_REFUSED');
  const allowed = ['owner.json', 'deployment.json', 'startup.json', 'm.sock', 'manager.log', 'children.log', 'native.log', 'closed.json', 'account-state.json', 'failure.json'];
  const entries = await fs.readdir(ROOT);
  required(entries.every(name => allowed.includes(name)), 'UNKNOWN_ROOT_REFUSED');
  for (const name of entries) if (name !== 'm.sock') await privatePath(path.join(ROOT, name));
}
export function proof(pid) {
  required(Number.isInteger(pid) && pid > 1, 'PID_REFUSED');
  // A detached manager is reparented when deploy exits; PPID is live lineage,
  // not persistent identity. Keep the PID and every stable process attribute.
  const identity = command('/bin/ps', ['-p', String(pid), '-o', 'uid=,lstart=,command=']);
  const cwd = command('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find(s => s.startsWith('n'))?.slice(1);
  required(identity.trim().split(/\s+/)[0] === String(process.getuid()), 'UID_REFUSED');
  return { pid, identity, cwd };
}
function fixtureProof(pid) {
  return { identity: command('/bin/ps', ['-p', String(pid), '-o', 'uid=,lstart=,command=']).trim(),
    cwd: command('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find(s => s.startsWith('n'))?.slice(1) };
}
export function equalProof(pid, expected) { required(JSON.stringify(proof(pid)) === JSON.stringify(expected), 'PROCESS_IDENTITY_CHANGED'); }
function listeners(port) {
  const result = spawnSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'], { env: cleanEnv(), encoding: 'utf8', timeout: 5000 });
  required(result.status === 0 || result.status === 1, 'LISTENER_PROBE_FAILED');
  const rows = []; let pid;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (line.startsWith('n')) rows.push({ pid, address: line.slice(1) });
  }
  return rows;
}
function processTree() {
  return command('/bin/ps', ['-axo', 'pid=,ppid=,uid=']).split('\n').map(line => {
    const [pid, ppid, uid] = line.trim().split(/\s+/).map(Number); return { pid, ppid, uid };
  });
}
export function descendant(pid, ancestor, tree = processTree()) {
  const seen = new Set();
  while (pid > 1 && !seen.has(pid)) {
    if (pid === ancestor) return true;
    seen.add(pid); pid = tree.find(p => p.pid === pid)?.ppid ?? 0;
  }
  return false;
}
function verifyListener(port, ancestor) {
  const rows = listeners(port); required(rows.length > 0, 'LISTENER_MISSING');
  for (const row of rows) required((row.address === `127.0.0.1:${port}` || row.address === `[::1]:${port}`)
    && descendant(row.pid, ancestor), 'FOREIGN_LISTENER_REFUSED');
}
async function fetchBound(url, options = {}) {
  required(/^http:\/\/127\.0\.0\.1:(3003|63245)\//.test(url), 'HTTP_TARGET_REFUSED');
  return fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
}
async function jsonBound(url, options = {}) {
  const response = await fetchBound(url, options); const text = await response.text();
  required(text.length < 2_000_000, 'HTTP_BODY_LIMIT');
  let data; try { data = JSON.parse(text); } catch { throw new Error('HTTP_JSON_REFUSED'); }
  return { response, data };
}
async function helperControl(action) {
  const record = await privateJson(path.join(FIXTURE, 'process.json'));
  await privatePath(path.join(FIXTURE, 'capability'));
  const capability = await fs.readFile(path.join(FIXTURE, 'capability'), 'utf8');
  required(record.port === 3003 && record.worktree === SOURCE && record.uid === process.getuid(), 'FIXTURE_IDENTITY_REFUSED');
  const { verifyProcess } = await import(path.join(SOURCE, 'backend/scripts/eformsign-backup-qa.mjs'));
  verifyProcess(record, fixtureProof(record.pid), fixtureProof(record.childPid));
  verifyListener(3003, record.pid);
  const { response, data } = await jsonBound('http://127.0.0.1:3003/__qa__/control', {
    method: 'POST', headers: { 'X-QA-Capability': capability, 'X-QA-Nonce': record.nonce, 'X-QA-Action': action, 'X-QA-Profile': 'pagination' },
  });
  required(response.status === 200 && data.nonce === record.nonce, 'FIXTURE_HTTP_IDENTITY_REFUSED');
  return { record, data };
}
const safeFields = record => ({ deploymentId: record.deploymentId, environmentId: ENVIRONMENT, buildDigest: record.buildDigest, servedCommit: record.servedCommit });
async function verify(record) {
  required(SOURCE === UI && record.environmentId === ENVIRONMENT && record.source === UI, 'DEPLOYMENT_ROOT_REFUSED');
  equalProof(record.pid, record.proof);
  required(record.proof.cwd === UI && record.proof.identity.includes(ENTRY) && /^[a-f0-9-]{36}$/.test(record.deploymentId), 'MANAGER_IDENTITY_REFUSED');
  required(candidate() === record.servedCommit && await sourceDigest() === record.buildDigest, 'STALE');
  equalProof(record.frontend.pid, record.frontend.proof);
  equalProof(record.backend.pid, record.backend.proof);
  required(descendant(record.frontend.pid, record.pid) && descendant(record.backend.pid, record.pid), 'LINEAGE_REFUSED');
  verifyListener(63245, record.frontend.pid); verifyListener(3003, record.backend.pid);
  const fixture = await helperControl('readiness');
  required(fixture.data.ready === true && fixture.data.productRoutes === true, 'BACKEND_NOT_READY');
  await privatePath(path.join(ROOT, 'account-state.json'));
  const state = await privateJson(path.join(ROOT, 'account-state.json'));
  const cookie = state.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const nonce = randomUUID();
  const me = await jsonBound(`http://127.0.0.1:63245/api/auth/me?qa_nonce=${nonce}`, { headers: { Cookie: cookie } });
  required(me.response.status === 200 && me.data.id === OWNER && me.data.role === 'owner' && me.data.branchId === A, 'BFF_ME_REFUSED');
  const runs = await jsonBound('http://127.0.0.1:63245/api/eformsign-backups/runs?limit=100', { headers: { Cookie: cookie, 'X-Request-Id': nonce } });
  required(runs.response.status === 200 && Array.isArray(runs.data.items), 'BFF_BACKUP_REFUSED');
  const page = await fetchBound(`http://127.0.0.1:63245/contracts?qa_nonce=${nonce}`, { headers: { Cookie: cookie } });
  const html = await page.text();
  required(page.status === 200 && html.includes('desktop_contracts') && html.includes('contracts') && html.includes(nonce), 'CONTRACTS_PAGE_REFUSED');
  required(candidate() === record.servedCommit && await sourceDigest() === record.buildDigest, 'STALE');
  return safeFields(record);
}
function ownedChild(args, log) {
  const child = spawn(NODE, args, { cwd: SOURCE, env: cleanEnv(), stdio: ['ignore', log, log] });
  child.on('error', () => undefined); return child;
}
async function waitExit(child, timeout = 25_000) {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode ?? -1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OWNED_PROCESS_DID_NOT_CLOSE')), timeout);
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
}
async function native(log) {
  const sha = candidate();
  required(!listeners(3003).length, 'FOREIGN_BACKEND_PORT');
  const child = ownedChild(buildFixtureArgs('self-test', sha), log);
  let code;
  try { code = await waitExit(child, 75_000); }
  catch (error) { child.kill('SIGTERM'); await waitExit(child); throw error; }
  required(code === 0, 'NATIVE_PREFLIGHT_FAILED');
  const marker = await privateJson(path.join(FIXTURE, 'owner.json'));
  required(marker.phase === 'prepared' && !listeners(3003).length, 'NATIVE_CLEANUP_UNPROVEN');
  return sha;
}
async function verifyCleanDatabase() {
  const parent = await import(path.join(SOURCE, 'backend/scripts/eformsign-backup-qa.mjs'));
  const descriptor = await privateJson(parent.TARGET.connection);
  const ownership = await privateJson(parent.TARGET.ownership);
  parent.validateDescriptor(descriptor, ownership);
  await parent.physical(parent.TARGET.password, 'file');
  const password = (await fs.readFile(parent.TARGET.password, 'utf8')).trim();
  required(password && !/[\r\n\0]/.test(password), 'PASSWORD_FILE_REFUSED');
  const env = { ...cleanEnv(), PGHOST: parent.TARGET.host, PGPORT: String(parent.TARGET.port), PGDATABASE: parent.TARGET.database,
    PGUSER: parent.TARGET.user, PGPASSWORD: password, PGCONNECT_TIMEOUT: '5' };
  const sql = `BEGIN READ ONLY;
    DO $$ DECLARE r record; n bigint; BEGIN
      IF current_database() <> 'backup_exec_throwaway_ui_synced_20261107' OR current_user <> 'backup_test_owner'
        OR inet_server_addr() <> '127.0.0.1'::inet OR inet_server_port() <> 63241
        OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) <> current_user THEN RAISE EXCEPTION 'IDENTITY_REFUSED'; END IF;
      IF (SELECT array_agg(tablename::text ORDER BY tablename) FROM pg_tables WHERE schemaname='public')
        IS DISTINCT FROM ARRAY[${parent.TABLE_INVENTORY.map(name => `'${name}'`).join(',')}]::text[] THEN RAISE EXCEPTION 'TABLES_REFUSED'; END IF;
      IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND pg_get_userbyid(c.relowner) <> current_user)
        OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        AND pg_get_userbyid(p.proowner) <> current_user) THEN RAISE EXCEPTION 'OWNER_REFUSED'; END IF;
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
        EXECUTE format('SELECT count(*) FROM public.%I', r.tablename) INTO n;
        IF n <> 0 THEN RAISE EXCEPTION 'ROWS_REMAIN'; END IF;
      END LOOP;
    END $$; COMMIT;`;
  const check = spawnSync('/opt/homebrew/opt/postgresql@17/bin/psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
    { env, cwd: FIXTURE, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
  required(check.status === 0, 'DATABASE_CLEANUP_UNPROVEN');
  const dump = spawnSync('/opt/homebrew/opt/postgresql@17/bin/pg_dump', ['--schema-only', '--no-owner', '--no-comments'],
    { env, cwd: FIXTURE, encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
  required(dump.status === 0, 'SCHEMA_PROBE_FAILED');
  const marker = await privateJson(path.join(FIXTURE, 'owner.json'));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  required(marker.phase === 'prepared' && digest(parent.normalizeDump(dump.stdout)) === marker.fingerprint
    && digest(await fs.readFile(path.join(FIXTURE, 'schema.sql'))) === marker.fingerprint, 'SCHEMA_CHANGED');
  for (const [file, key] of [['schema.prisma', 'schema'], ['migration.sql', 'migration']]) {
    await privatePath(path.join(FIXTURE, file));
    required(digest(await fs.readFile(path.join(FIXTURE, file))) === marker.sources[key], 'SOURCE_COPY_CHANGED');
  }
}
async function accountState() {
  const require = createRequire(path.join(SOURCE, 'backend/package.json'));
  const frontendRequire = createRequire(path.join(SOURCE, 'frontend/package.json'));
  const { parse } = createRequire(require.resolve('@nestjs/config/package.json'))('dotenv');
  await privatePath(ENV);
  const values = parse(await fs.readFile(ENV));
  const email = values.LOCAL_AUTO_LOGIN_EMAIL; const password = values.LOCAL_AUTO_LOGIN_PASSWORD;
  required(typeof email === 'string' && typeof password === 'string' && email && password, 'QA_CREDENTIALS_MISSING');
  const login = await jsonBound('http://127.0.0.1:3003/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  required(login.response.status === 201 && login.data.success === true && typeof login.data.accessToken === 'string', 'NATIVE_LOGIN_FAILED');
  const selected = await jsonBound('http://127.0.0.1:3003/auth/select-branch', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${login.data.accessToken}` }, body: JSON.stringify({ branchId: A }) });
  required(selected.response.status === 201 && selected.data.success === true && typeof selected.data.accessToken === 'string'
    && typeof selected.data.refreshToken === 'string', 'NATIVE_SELECT_FAILED');
  // Execute the actual pure cookie policy on real session-backed tokens; never mint tokens.
  const ts = require('typescript');
  const modules = new Map();
  function load(name) {
    required(['session-policy', 'session-cookies'].includes(name), 'COOKIE_MODULE_REFUSED');
    if (modules.has(name)) return modules.get(name).exports;
    const file = path.join(SOURCE, `frontend/src/lib/auth/${name}.ts`);
    const instance = new Module(file); modules.set(name, instance);
    instance.require = spec => spec === '@/lib/auth/session-policy' ? load('session-policy') : frontendRequire(spec);
    instance._compile(ts.transpileModule(command('/bin/cat', [file]), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, file);
    return instance.exports;
  }
  const cookies = [];
  const policy = load('session-cookies');
  policy.setAuthSessionCookies({ set(name, value, options) {
    cookies.push({ name, value, domain: '127.0.0.1', path: options.path, httpOnly: options.httpOnly, secure: options.secure,
      sameSite: options.sameSite[0].toUpperCase() + options.sameSite.slice(1), expires: options.maxAge ? Math.floor(Date.now() / 1000) + options.maxAge : -1 });
  } }, { accessToken: selected.data.accessToken, refreshToken: selected.data.refreshToken, autoLogin: true });
  required(cookies.some(c => c.name === 'auth_token' && c.httpOnly && !c.secure), 'COOKIE_POLICY_REFUSED');
  await write(path.join(ROOT, 'account-state.json'), { cookies, origins: [] });
}
async function serve() {
  required(SOURCE === UI, 'GUI_SOURCE_REFUSED'); await root(true);
  required(!listeners(3003).length && !listeners(63245).length, 'FOREIGN_PORT_REFUSED');
  required(!(await fs.readdir(ROOT)).includes('failure.json'), 'INTERRUPTED_EVIDENCE_REFUSED');
  try { await fs.access(RECORD); throw new Error('EXISTING_DEPLOYMENT_REFUSED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.writeFile(path.join(ROOT, 'startup.json'), JSON.stringify({ pid: process.pid, proof: proof(process.pid), servedCommit: candidate(), source: SOURCE }), { mode: 0o600, flag: 'wx' });
  const log = await fs.open(path.join(ROOT, 'children.log'), 'a', 0o600); await privatePath(path.join(ROOT, 'children.log'));
  const backendArgs = buildFixtureArgs('start', candidate());
  let backend; let frontend; let record; let closing;
  const server = http.createServer();
  async function closeFrontend() {
    if (frontend && frontend.exitCode === null) {
      const tree = processTree();
      const depth = pid => { let n = 0; while (pid !== frontend.pid && pid > 1) { pid = tree.find(p => p.pid === pid)?.ppid ?? 0; n++; } return n; };
      const rows = tree.filter(p => p.uid === process.getuid() && descendant(p.pid, frontend.pid, tree)).sort((a, b) => depth(b.pid) - depth(a.pid));
      const proofs = rows.map(p => ({ pid: p.pid, proof: proof(p.pid) }));
      for (const row of proofs) {
        try { equalProof(row.pid, row.proof); process.kill(row.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH' && e.message !== 'IDENTITY_COMMAND_FAILED') throw e; }
      }
      await waitExit(frontend);
    }
  }
  const stop = () => closing ??= (async () => {
    await closeFrontend();
    if (backend && backend.exitCode === null) { equalProof(backend.pid, record?.backend.proof ?? proof(backend.pid)); backend.kill('SIGTERM'); required(await waitExit(backend) === 0, 'BACKEND_CLEANUP_FAILED'); }
    const marker = await privateJson(path.join(FIXTURE, 'owner.json'));
    required(marker.phase === 'prepared' && !listeners(3003).length && !listeners(63245).length, 'CLEANUP_UNPROVEN');
    await verifyCleanDatabase();
    for (const name of ['process.json', 'session', 'capability']) {
      let present = true; try { await fs.access(path.join(FIXTURE, name)); } catch (e) { if (e.code !== 'ENOENT') throw e; present = false; }
      required(!present, 'FIXTURE_CLEANUP_UNPROVEN');
    }
    await write(path.join(ROOT, 'closed.json'), { ...safeFields(record), closed: true, tableCount: 79, rowCount: 0, schemaOwnersVerified: true, schemaFingerprintVerified: true, sourceCopiesVerified: true, listeners: 0 });
    for (const file of [RECORD, path.join(ROOT, 'account-state.json'), path.join(ROOT, 'startup.json')]) {
      try { await fs.unlink(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    await log.close();
  })();
  try {
    await native(log.fd);
    const servedCommit = candidate(); const buildDigest = await sourceDigest();
    backend = ownedChild(backendArgs, log.fd);
    const deadline = Date.now() + 55_000;
    while (true) {
      required(backend.exitCode === null && Date.now() < deadline, 'BACKEND_START_FAILED');
      try { if ((await helperControl('readiness')).data.ready) break; } catch { /* Bounded startup; private log retained. */ }
      await pause(500);
    }
    frontend = ownedChild([PNPM, 'qa:fe', '--', '--port', '63245'], log.fd);
    const frontendDeadline = Date.now() + 55_000;
    while (!listeners(63245).length) { required(frontend.exitCode === null && Date.now() < frontendDeadline, 'FRONTEND_START_FAILED'); await pause(500); }
    verifyListener(63245, frontend.pid);
    verifyListener(3003, backend.pid);
    await accountState();
    record = { deploymentId: randomUUID(), environmentId: ENVIRONMENT, buildDigest, servedCommit, source: SOURCE,
      pid: process.pid, proof: proof(process.pid), capability: randomBytes(32).toString('hex'),
      backend: { pid: backend.pid, proof: proof(backend.pid) }, frontend: { pid: frontend.pid, proof: proof(frontend.pid) } };
    await verify(record); await write(RECORD, record);
    server.on('request', async (req, res) => {
      if (req.method !== 'POST' || req.headers['x-qa-capability'] !== record.capability || req.headers['x-qa-deployment'] !== record.deploymentId) { res.writeHead(403); res.end(); return; }
      try {
        if (req.url === '/readiness') { res.end(JSON.stringify(await verify(record))); return; }
        if (req.url === '/stop') {
          await stop(); res.end(JSON.stringify({ closed: true })); server.close(); return;
        }
        res.writeHead(404); res.end();
      } catch (e) { res.writeHead(503); res.end(JSON.stringify({ code: e.message === 'STALE' ? 'STALE' : 'CONTROL_FAILED' })); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(SOCKET, resolve); }); await fs.chmod(SOCKET, 0o600);
    const shutdown = () => { void stop().then(() => server.close()).catch(() => { process.exitCode = 1; server.close(); }); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    const ttl = setTimeout(shutdown, 30 * 60_000);
    await new Promise(resolve => server.once('close', resolve)); clearTimeout(ttl);
    try { await fs.unlink(SOCKET); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  } catch (e) {
    if (record) await stop();
    else {
      await closeFrontend();
      if (backend && backend.exitCode === null) { backend.kill('SIGTERM'); await waitExit(backend); }
      await log.close();
    }
    await write(path.join(ROOT, 'failure.json'), { code: 'SERVE_FAILED', retained: true });
    throw e;
  }
}
async function control(mode) {
  await root(); const record = await privateJson(RECORD);
  required(SOURCE === UI && record.source === UI && record.environmentId === ENVIRONMENT, 'CONTROL_ROOT_REFUSED');
  equalProof(record.pid, record.proof);
  required(record.proof.cwd === UI && record.proof.identity.includes(ENTRY), 'CONTROL_PROCESS_REFUSED');
  const result = await new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, path: `/${mode}`, method: 'POST', headers: {
      'X-QA-Capability': record.capability, 'X-QA-Deployment': record.deploymentId } }, res => {
      let body = ''; res.on('data', b => { body += b; if (body.length > 4096) req.destroy(); });
      res.on('end', () => { try { const value = JSON.parse(body); required(res.statusCode === 200, value.code === 'STALE' ? 'STALE' : 'CONTROL_FAILED'); resolve(value); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.setTimeout(55_000, () => req.destroy(new Error('CONTROL_TIMEOUT'))); req.end();
  });
  if (mode === 'readiness') required(JSON.stringify(result) === JSON.stringify(safeFields(record)), 'READINESS_IDENTITY_CHANGED');
  else {
    required(result.closed === true, 'STOP_UNPROVEN');
    const deadline = Date.now() + 5000;
    while (true) {
      const alive = spawnSync('/bin/ps', ['-p', String(record.pid)], { stdio: 'ignore' }).status === 0;
      if (!alive) break; required(Date.now() < deadline, 'MANAGER_REMAINS'); await pause(100);
    }
  }
  return result;
}
export async function main(args) {
  required(args.length === 1 && ['deploy', 'readiness', 'stop', 'serve', 'self-test'].includes(args[0]), 'MODE_REFUSED');
  const mode = args[0];
  if (mode === 'self-test') {
    const sha = candidate(true);
    await root(true);
    required(!(await fs.readdir(ROOT)).some(name => ['deployment.json', 'startup.json', 'failure.json', 'm.sock'].includes(name)), 'ACTIVE_OR_INTERRUPTED_GUI_REFUSED');
    const child = spawn(NODE, buildFixtureArgs('self-test', sha),
      { cwd: SOURCE, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b; if (output.length > 100_000) child.kill('SIGTERM'); });
    child.stderr.on('data', () => undefined);
    let code;
    try { code = await waitExit(child, 75_000); }
    catch (error) { child.kill('SIGTERM'); await waitExit(child); throw error; }
    await write(path.join(ROOT, 'native.log'), output);
    required(code === 0 && output.split('\n').some(line => { try { return JSON.parse(line).code === 'NATIVE_SELF_TEST_PASSED'; } catch { return false; } }), 'NATIVE_PREFLIGHT_FAILED');
    required(candidate(true) === sha, 'STALE');
    await verifyCleanDatabase();
    console.log(JSON.stringify({ code: 'NATIVE_SELF_TEST_PASSED', servedCommit: sha, nativeOnly: true, productionBuild: false })); return;
  }
  required(SOURCE === UI, 'GUI_SOURCE_REFUSED');
  if (mode === 'serve') { await serve(); return; }
  if (mode === 'stop') {
    let absent = false;
    try { await fs.lstat(ROOT); } catch (error) { if (error.code !== 'ENOENT') throw error; absent = true; }
    if (!absent) await root();
    if (absent || isIdleNativeRootEntries(await fs.readdir(ROOT))) {
      // Native-only history has no manager to signal. Retain it and prove that
      // no actors or interrupted fixture state remain before reporting closure.
      required(!listeners(3003).length && !listeners(63245).length, 'FOREIGN_PORT_REFUSED');
      const processes = command('/bin/ps', ['-axo', 'pid=,command=']);
      required(!processes.split('\n').some(line => /^\s*\d+\s+(?:\S*\/)?node\s+.*(?:^|[\s/])(?:eformsign-backup-qa\.mjs|eformsign-backup-fixture-(?:app|worker)\.(?:ts|mjs))(?:\s|$)/.test(line)),
        'ACTIVE_OR_INTERRUPTED_GUI_REFUSED');
      for (const name of ['process.json', 'session', 'capability', 'operation.json']) {
        try { await fs.lstat(path.join(FIXTURE, name)); throw new Error('ACTIVE_OR_INTERRUPTED_GUI_REFUSED'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      await verifyCleanDatabase();
      console.log(JSON.stringify({ closed: true, tableCount: 79, rowCount: 0, listeners: 0 })); return;
    }
  }
  if (mode === 'readiness' || mode === 'stop') { console.log(JSON.stringify(await control(mode))); return; }
  await root(true); candidate();
  try { await fs.access(RECORD); console.log(JSON.stringify(await control('readiness'))); return; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  required(!(await fs.readdir(ROOT)).some(name => ['startup.json', 'failure.json', 'm.sock'].includes(name)), 'ACTIVE_OR_INTERRUPTED_GUI_REFUSED');
  required(!listeners(3003).length && !listeners(63245).length, 'FOREIGN_PORT_REFUSED');
  const log = await fs.open(path.join(ROOT, 'manager.log'), 'a', 0o600); await privatePath(path.join(ROOT, 'manager.log'));
  const child = spawn(NODE, [ENTRY, 'serve'], { cwd: UI, env: { ...cleanEnv(), CANDIDATE_SHA: candidate() }, detached: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref(); await log.close();
  const deadline = Date.now() + 160_000;
  while (Date.now() < deadline) {
    try { console.log(JSON.stringify(await control('readiness'))); return; }
    catch (e) { if (e.message === 'STALE') throw e; }
    required(spawnSync('/bin/ps', ['-p', String(child.pid)], { stdio: 'ignore' }).status === 0, 'SERVE_FAILED');
    await pause(500);
  }
  throw new Error('DEPLOY_READINESS_TIMEOUT');
}
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRY) main(process.argv.slice(2)).catch(error => {
  const codes = ['STALE', 'CANDIDATE_REQUIRED', 'CANDIDATE_MISMATCH', 'CLEAN_CANDIDATE_REQUIRED', 'NATIVE_PREFLIGHT_FAILED',
    'MODE_REFUSED', 'FOREIGN_PORT_REFUSED', 'ACTIVE_OR_INTERRUPTED_GUI_REFUSED', 'GUI_SOURCE_REFUSED', 'DEPLOY_READINESS_TIMEOUT'];
  const code = codes.includes(error?.message) ? error.message : 'QA_FAILED_PRIVATE_DETAILS_RETAINED';
  console.log(JSON.stringify({ code })); process.exitCode = 1;
});
