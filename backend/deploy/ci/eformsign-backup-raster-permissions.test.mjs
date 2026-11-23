import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const source = new URL('../eformsign-backup/', import.meta.url);
const utility = fileURLToPath(new URL('prepare-raster-permissions.mjs', source));
const version2 = {
    version: 2,
    units: { 'doc:fixture': { files: { '기타/one.pdf': 12, '기타/audit.pdf': null },
        fingerprint: 'fixture:fixture', completed: false } },
};
const stateBytes = JSON.stringify(version2, null, 2) + '\n';
const fakeToken = 'synthetic private token bytes\n';

const observe = String.raw`
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const { readFileSync, realpathSync, openSync } = fs;
const { readFile, open } = promises;
function observeRead(path) {
    const name = typeof path === 'number' ? realpathSync('/proc/self/fd/' + path) : String(path);
    if (name === process.env.PERMISSION_TOKEN || name.endsWith('/token-sentinel') || name.endsWith('/token')) {
        fs.appendFileSync(process.env.PERMISSION_TRACE, 'token\n');
        throw Error('unexpected token access');
    }
    if (name.endsWith('.pdf')) {
        fs.appendFileSync(process.env.PERMISSION_TRACE, 'pdf\n');
        throw Error('unexpected PDF access');
    }
}
fs.readFileSync = (path, ...args) => { observeRead(path); return readFileSync(path, ...args); };
fs.openSync = (path, ...args) => { observeRead(path); return openSync(path, ...args); };
promises.readFile = (path, ...args) => { observeRead(path); return readFile(path, ...args); };
promises.open = (path, ...args) => { observeRead(path); return open(path, ...args); };
if (process.env.PERMISSION_READ_ONLY) {
    fs.chmodSync = fs.fchmodSync = () => {
        fs.appendFileSync(process.env.PERMISSION_TRACE, 'chmod\n');
        throw Error('unexpected permission write');
    };
}
globalThis.fetch = () => {
    fs.appendFileSync(process.env.PERMISSION_TRACE, 'api\n');
    throw Error('unexpected API access');
};
syncBuiltinESMExports();
`;

const swap = String.raw`
import fs from 'node:fs';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const { spawnSync } = child;
const { path, alternate, displaced, trace, kind } = JSON.parse(process.env.PERMISSION_SWAP);
child.spawnSync = (bin, ...args) => {
    const result = spawnSync(bin, ...args);
    if (bin === '/usr/bin/flock' && result.status === 0) {
        fs.renameSync(path, displaced);
        if (kind === 'parent') fs.symlinkSync(alternate, path);
        else fs.renameSync(alternate, path);
        fs.appendFileSync(trace, 'swapped\n');
    }
    return result;
};
const { fchmodSync } = fs;
fs.fchmodSync = (...args) => {
    fs.appendFileSync(trace, 'fchmod\n');
    return fchmodSync(...args);
};
syncBuiltinESMExports();
`;

const wrongIdentity = String.raw`
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const { fstatSync, lstatSync } = fs;
const leaf = process.env.PERMISSION_STAT_LEAF ?? 'state.json';
const home = process.env.PERMISSION_STAT_HOME === '1' ? lstatSync(process.env.HOME, { bigint: true }) : null;
const isHome = (info) => info.dev === home.dev && info.ino === home.ino;
fs.lstatSync = (path, ...args) => {
    const info = lstatSync(path, ...args);
    if (home) {
        if (isHome(info)) info.uid = 0n;
    } else if (String(path).endsWith('/' + leaf)) {
        if (process.env.PERMISSION_STAT_FIELD === 'gid') info.gid += 1n;
        else info.uid = 0n;
    }
    return info;
};
if (home) {
    // Model one consistent HOME inode across the path and descriptor checks.
    fs.fstatSync = (...args) => {
        const info = fstatSync(...args);
        if (isHome(info)) info.uid = 0n;
        return info;
    };
}
syncBuiltinESMExports();
`;

async function write(path, bytes, mode) {
    await fs.writeFile(path, bytes, { mode });
    await fs.chmod(path, mode);
}

async function snapshot(path) {
    const info = await fs.lstat(path, { bigint: true });
    const base = { mode: Number(info.mode & 0o7777n), dev: info.dev, ino: info.ino,
        uid: info.uid, gid: info.gid, mtime: info.mtimeNs };
    if (info.isSymbolicLink()) return { ...base, link: await fs.readlink(path) };
    if (info.isFile()) return { ...base, bytes: Uint8Array.from(await fs.readFile(path)) };
    if (!info.isDirectory()) return base;
    const names = await fs.readdir(path);
    return { ...base, entries: Object.fromEntries(await Promise.all(names.map(async (name) => [name, await snapshot(join(path, name))]))) };
}

async function present(path) {
    return await fs.lstat(path).then(() => true, (error) => {
        if (error.code !== 'ENOENT') throw error;
        return false;
    });
}

async function fixture(t, { productionLayout = false, shared = productionLayout, stateData = stateBytes, nestedHome = false } = {}) {
    const root = await fs.mkdtemp('/tmp/eformsign-permission-test-');
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const home = nestedHome ? join(root, 'home') : root;
    const lockAncestor = join(home, '.local');
    const lockDir = join(lockAncestor, 'state/eformsign-backup');
    const stateDir = shared ? lockDir : join(home, 'dedicated-state');
    const lock = join(lockDir, 'run.lock');
    const state = join(stateDir, 'state.json');
    const archive = join(home, productionLayout ? 'eformsign-archive' : 'public');
    const originals = productionLayout ? archive + '.originals' : join(home, 'private');
    const config = productionLayout ? join(home, '.config') : home;
    const settingsDir = productionLayout ? join(config, 'eformsign-backup') : home;
    const token = join(settingsDir, productionLayout ? 'token' : 'token-sentinel');
    const settings = join(settingsDir, 'settings.json');
    const neighbor = join(home, 'other-file');
    const trace = join(home, 'access-trace');
    const rclone = join(home, 'mock-rclone');
    const preload = join(home, 'observe.mjs');
    for (const dir of new Set([lockDir, stateDir, archive])) await fs.mkdir(dir, { recursive: true, mode: 0o755 });
    for (const dir of new Set([lockDir, stateDir, archive])) await fs.chmod(dir, 0o755);
    if (productionLayout) {
        await fs.chmod(home, 0o750);
        for (const dir of [lockAncestor, dirname(lockDir)]) await fs.chmod(dir, 0o775);
        for (const dir of [config, settingsDir]) {
            await fs.mkdir(dir, { mode: 0o700 });
            await fs.chmod(dir, 0o700);
        }
    } else {
        await fs.mkdir(originals, { mode: 0o700 });
        await fs.chmod(originals, 0o700);
        await write(join(originals, 'private.pdf'), 'private sentinel\n', 0o600);
    }
    await write(lock, 'keep lock bytes\n', 0o644);
    if (stateData !== null) await write(state, stateData, 0o664);
    await write(token, fakeToken, productionLayout ? 0o600 : 0o644);
    await write(neighbor, 'keep neighbor bytes\n', 0o644);
    if (stateData !== null) await write(join(stateDir, 'ignored.txt'), 'keep state sibling\n', 0o644);
    await write(join(archive, 'visible.pdf'), 'public sentinel\n', 0o644);
    await write(preload, observe, 0o600);
    await write(rclone, '#!/bin/sh\nprintf "rclone\\n" >> "$PERMISSION_TRACE"\nexit 9\n', 0o700);
    const configure = (extra = {}) => write(settings, JSON.stringify({
        apiBaseUrl: 'http://127.0.0.1:1', archiveDir: archive, originalArchiveDir: originals, stateDir,
        tokenFile: token, rcloneRemote: 'fixture:backup', rcloneBin: rclone, ...extra,
    }), 0o600);
    await configure();
    const run = async ({ apply = false, code = 0, extraPreload, worker, env = {} } = {}) => {
        const cli = ['--import', preload, ...(extraPreload ? ['--import', extraPreload] : []),
            worker ?? utility, '--settings', settings, ...(worker ? ['--raster-archive'] : []), ...(apply ? ['--apply'] : [])];
        const result = await exec(process.execPath, cli, { timeout: 10000, env: {
            PATH: process.env.PATH, HOME: home, PERMISSION_TOKEN: token, PERMISSION_TRACE: trace,
            ...(!apply || code !== 0 ? { PERMISSION_READ_ONLY: '1' } : {}), ...env,
        } }).catch((error) => error);
        assert.equal(await present(trace), false, 'preflight attempted token, PDF, API or rclone access or an unexpected chmod');
        assert.equal(result.code ?? 0, code, result.stdout + result.stderr);
        assert.equal(result.stderr, '');
        assert.ok(!result.stdout.includes(home) && !result.stdout.includes(fakeToken.trim()));
        return JSON.parse(result.stdout);
    };
    return { root, home, lockAncestor, lockDir, stateDir, lock, state, archive, originals, config, settingsDir, settings, token, configure, run };
}

test('accepts owner-bound 0775 home ancestors and tightens only the combined state and lock metadata', async (t) => {
    const f = await fixture(t, { productionLayout: true });
    const before = await snapshot(f.home);
    const local = before.entries['.local'];
    const state = local.entries.state;
    const legacyRoot = state.entries['eformsign-backup'];
    const config = before.entries['.config'];
    const settings = config.entries['eformsign-backup'];
    const operator = userInfo();
    for (const [entry, expectedMode] of [
        [before, 0o750], [local, 0o775], [state, 0o775], [legacyRoot, 0o755],
        [legacyRoot.entries['run.lock'], 0o644], [legacyRoot.entries['state.json'], 0o664],
        [config, 0o700], [settings, 0o700], [settings.entries['settings.json'], 0o600],
        [settings.entries.token, 0o600], [before.entries['eformsign-archive'], 0o755],
    ]) {
        assert.equal(entry.mode, expectedMode);
        assert.equal(entry.uid, BigInt(operator.uid));
        assert.equal(entry.gid, BigInt(operator.gid));
    }
    assert.equal(await present(f.originals), false);

    const expected = { status: 'ready', directories: 1, files: 2, needsChanges: 3, changed: 0 };
    try {
        assert.deepEqual(await f.run(), expected);
    } finally {
        assert.deepEqual(await snapshot(f.home), before);
    }

    assert.deepEqual(await f.run({ apply: true }), { ...expected, changed: 3 });
    const tightened = structuredClone(before);
    const root = tightened.entries['.local'].entries.state.entries['eformsign-backup'];
    root.mode = 0o700;
    root.entries['run.lock'].mode = 0o600;
    root.entries['state.json'].mode = 0o600;
    assert.deepEqual(await snapshot(f.home), tightened);
    for (const apply of [false, true]) {
        assert.deepEqual(await f.run({ apply }), { ...expected, needsChanges: 0 });
        assert.deepEqual(await snapshot(f.home), tightened);
    }
});

async function assertUnsafeDirectory(f, options) {
    const before = await snapshot(f.root);
    for (const apply of [false, true]) {
        try {
            const result = await f.run({ ...options, apply, code: 1 });
            assert.equal(result.status, 'refused');
            assert.equal(result.reason, 'unsafe_directory');
            assert.equal(result.changed, 0);
        } finally {
            assert.deepEqual(await snapshot(f.root), before);
        }
    }
}

test('refuses 0775 ancestors below HOME nested inside a temporary fixture', async (t) => {
    const f = await fixture(t, { productionLayout: true, nestedHome: true });
    await assertUnsafeDirectory(f);
});

for (const [name, setup] of [
    ['0775 combined state and lock root', (f) => fs.chmod(f.stateDir, 0o775)],
    ['0777 combined state and lock root', (f) => fs.chmod(f.stateDir, 0o777)],
    ['0770 HOME', (f) => fs.chmod(f.home, 0o770)],
    ['0775 HOME', (f) => fs.chmod(f.home, 0o775)],
    ['0775 ancestors below a root-owned 0750 HOME', async (f) => {
        const extraPreload = join(f.home, 'wrong-home-owner.mjs');
        await write(extraPreload, wrongIdentity, 0o600);
        return { extraPreload, env: { PERMISSION_STAT_HOME: '1' } };
    }],
    ['0775 settings directory', (f) => fs.chmod(f.settingsDir, 0o775)],
    ['0775 public root', (f) => fs.chmod(f.archive, 0o775)],
    ['0775 private originals root', async (f) => {
        await fs.mkdir(f.originals);
        await fs.chmod(f.originals, 0o775);
        await write(join(f.originals, 'private.pdf'), 'private sentinel\n', 0o600);
    }],
    ['cached 0775 settings ancestor used as public root', async (f) => {
        await fs.chmod(f.config, 0o775);
        await f.configure({ archiveDir: f.config, originalArchiveDir: f.originals });
    }],
    ['cached 0775 settings ancestor used as token parent', async (f) => {
        await fs.chmod(f.config, 0o775);
        const tokenFile = join(f.config, 'token');
        await write(tokenFile, fakeToken, 0o600);
        await f.configure({ tokenFile });
    }],
    ['uncached 0775 token parent', async (f) => {
        const tokenParent = join(f.config, 'tok');
        await fs.mkdir(tokenParent);
        await fs.chmod(tokenParent, 0o775);
        const tokenFile = join(tokenParent, 'token');
        await write(tokenFile, fakeToken, 0o600);
        await f.configure({ tokenFile });
    }],
    ...['uid', 'gid'].map((field) => [`0775 ancestor with mismatched ${field}`, async (f) => {
        const extraPreload = join(f.home, 'wrong-identity.mjs');
        await write(extraPreload, wrongIdentity, 0o600);
        return { extraPreload, env: { PERMISSION_STAT_LEAF: '.local', PERMISSION_STAT_FIELD: field } };
    }]),
]) {
    test('refuses ' + name + ' without changing the production-layout fixture', async (t) => {
        const f = await fixture(t, { productionLayout: true });
        await assertUnsafeDirectory(f, await setup(f));
    });
}

test('separate and shared legacy roots tighten in place, keep bytes and are idempotent', async (t) => {
    for (const shared of [false, true]) {
        const f = await fixture(t, { shared });
        const before = await snapshot(f.home);
        const expected = { status: 'ready', directories: shared ? 1 : 2, files: 2, needsChanges: shared ? 3 : 4, changed: 0 };
        assert.deepEqual(await f.run(), expected);
        assert.deepEqual(await snapshot(f.home), before);

        assert.deepEqual(await f.run({ apply: true }), { ...expected, changed: expected.needsChanges });
        const tightened = structuredClone(before);
        const lockDir = tightened.entries['.local'].entries.state.entries['eformsign-backup'];
        lockDir.mode = 0o700;
        lockDir.entries['run.lock'].mode = 0o600;
        const stateDir = shared ? lockDir : tightened.entries['dedicated-state'];
        stateDir.mode = 0o700;
        stateDir.entries['state.json'].mode = 0o600;
        assert.deepEqual(await snapshot(f.home), tightened);
        assert.deepEqual(await f.run({ apply: true }), { ...expected, needsChanges: 0, changed: 0 });
        assert.deepEqual(await snapshot(f.home), tightened);
    }
});

test('empty shared lock root and attributable version 1 are supported', async (t) => {
    const f = await fixture(t, { shared: true, stateData: null });
    assert.deepEqual(await f.run({ apply: true }), { status: 'ready', directories: 1, files: 1, needsChanges: 2, changed: 2 });
    assert.equal(await present(f.state), false);
    const v1 = await fixture(t, { stateData: JSON.stringify({ version: 1,
        units: { 'doc:old:123:456': { files: { '기타/one.pdf': 21, '기타/audit.pdf': 10 } } } }) });
    assert.equal((await v1.run({ apply: true })).changed, 4);
});

test('the actual standalone raster dry-run accepts the remediated metadata', async (t) => {
    const f = await fixture(t);
    const worker = join(f.home, 'worker-fixture');
    await fs.mkdir(worker);
    for (const file of ['backup.mjs', 'provider-contract-migration.mjs', 'provider-contract-paths.mjs', 'provider-contract-publication.mjs']) {
        await fs.copyFile(new URL(file, source), join(worker, file));
    }
    await fs.writeFile(join(worker, 'raster-mirror.mjs'), `
import assert from 'node:assert/strict';
import { fstatSync, statSync } from 'node:fs';
function check({ archiveDir, stateDir }, { dryRun, lockFd }) {
    assert.equal(dryRun, true);
    assert.equal(statSync(archiveDir).mode & 0o7777, 0o755);
    assert.equal(statSync(stateDir).mode & 0o7777, 0o700);
    assert.equal(statSync(stateDir + '/state.json').mode & 0o7777, 0o600);
    assert.equal(fstatSync(lockFd).mode & 0o7777, 0o600);
}
export const inspectRasterArchive = () => ({ manifestPresent: false, unpublished: true, retiredPaths: [], phase: null });
export const prepareRasterArchive = check;
export const publishRasterArchive = check;
export const rollbackRasterArchive = () => { throw Error('unexpected rollback'); };
`);
    const legacy = await snapshot(f.home);
    assert.deepEqual(await f.run({ worker: join(worker, 'backup.mjs'), code: 1 }),
        { rasterArchive: 'dry-run', reason: 'unsafe_raster_directory', exitCode: 1 });
    assert.deepEqual(await snapshot(f.home), legacy);
    await f.run({ apply: true });
    const tightened = await snapshot(f.home);
    assert.deepEqual(await f.run({ worker: join(worker, 'backup.mjs') }), { rasterArchive: 'dry-run', exitCode: 0 });
    assert.deepEqual(await snapshot(f.home), tightened);
});

const cases = {
    'group-writable target': (f) => fs.chmod(f.stateDir, 0o775),
    'world-writable ancestor': (f) => fs.chmod(f.lockAncestor, 0o777),
    'special directory mode': (f) => fs.chmod(f.stateDir, 0o1755),
    'group-writable lock': (f) => fs.chmod(f.lock, 0o664),
    'world-writable state': (f) => fs.chmod(f.state, 0o666),
    'state root symlink': async (f) => {
        await fs.rename(f.stateDir, f.stateDir + '-old');
        await fs.symlink(f.stateDir + '-old', f.stateDir);
    },
    'lock ancestor symlink': async (f) => {
        await fs.rename(f.lockAncestor, f.lockAncestor + '-old');
        await fs.symlink(f.lockAncestor + '-old', f.lockAncestor);
    },
    'lock hardlink': (f) => fs.link(f.lock, join(f.home, 'lock-hardlink')),
    'state hardlink': (f) => fs.link(f.state, join(f.home, 'state-hardlink')),
    'lock symlink': async (f) => {
        await fs.rename(f.lock, f.lock + '-old');
        await fs.symlink(f.lock + '-old', f.lock);
    },
    'state symlink': async (f) => {
        await fs.rename(f.state, f.state + '-old');
        await fs.symlink(f.state + '-old', f.state);
    },
    'lock directory in place of regular file': async (f) => {
        await fs.unlink(f.lock);
        await fs.mkdir(f.lock);
    },
    'state directory in place of regular file': async (f) => {
        await fs.unlink(f.state);
        await fs.mkdir(f.state);
    },
    'state socket in place of regular file': async (f, t) => {
        const { createServer } = await import('node:net');
        const server = createServer();
        await fs.unlink(f.state);
        server.listen(f.state);
        await once(server, 'listening');
        t.after(() => new Promise((done) => server.close(done)));
    },
    'missing lock': (f) => fs.unlink(f.lock),
    'absent state in a separate unproven directory': async (f) => {
        await fs.unlink(f.state);
        await fs.unlink(join(f.stateDir, 'ignored.txt'));
    },
    'invalid state JSON': (f) => write(f.state, '{malformed fixture', 0o664),
    'invalid state shape': (f) => write(f.state, '{"version":2,"units":{"doc:fake":{"files":{}}}}', 0o664),
    'settings with insecure permissions': (f) => fs.chmod(f.settings, 0o664),
    'filesystem root': (f) => f.configure({ stateDir: '/' }),
    'project directory': (f) => f.configure({ stateDir: fileURLToPath(new URL('../../../', import.meta.url)).slice(0, -1) }),
    'application directory': async (f) => {
        const app = join(f.home, 'eformsign-backup');
        await fs.mkdir(app, { mode: 0o755 });
        await write(join(app, 'state.json'), stateBytes, 0o664);
        await f.configure({ stateDir: app });
    },
    'ambiguous state path': (f) => f.configure({ stateDir: f.stateDir + '/.' }),
    'state equal to public root': (f) => f.configure({ stateDir: f.archive }),
    'originals nested inside the public archive': (f) => f.configure({ originalArchiveDir: join(f.archive, 'nested') }),
    'state parent of private root': (f) => f.configure({ originalArchiveDir: join(f.stateDir, 'other') }),
    'token points to metadata': (f) => f.configure({ tokenFile: f.state }),
    'token path is a symlink alias of metadata': async (f) => {
        const alias = join(f.home, 'token-alias');
        await fs.symlink(f.state, alias);
        await f.configure({ tokenFile: alias });
    },
};

for (const [name, setup] of Object.entries(cases)) {
    test('refuses ' + name + ' before changing any permissions', async (t) => {
        const f = await fixture(t);
        await setup(f, t);
        const before = await snapshot(f.home);
        for (const apply of [false, true]) {
            const result = await f.run({ apply, code: 1 });
            assert.equal(result.status, 'refused');
            assert.equal(result.changed, 0);
            assert.deepEqual(await snapshot(f.home), before);
        }
    });
}

for (const [directory, reason] of [
    ['.', 'overlapping_roots'],
    ['.local/state', 'overlapping_roots'],
    // Documents is disjoint from the timer lock and all protected paths in the fixture.
    ['Documents', 'out_of_scope_path'],
]) {
    test('refuses attributable backup state under ~/' + directory, async (t) => {
        const f = await fixture(t);
        const stateDir = join(f.home, directory);
        await fs.mkdir(stateDir, { recursive: true });
        await fs.chmod(stateDir, 0o755);
        await write(join(stateDir, 'state.json'), stateBytes, 0o664);
        await f.configure({ stateDir });

        const before = await snapshot(f.home);
        for (const apply of [false, true]) {
            await t.test(apply ? 'apply' : 'dry run', async () => {
                const result = await f.run({ apply, code: 1 });
                assert.equal(result.status, 'refused');
                assert.equal(result.reason, reason);
                assert.equal(result.changed, 0);
                assert.deepEqual(await snapshot(f.home), before);
            });
        }
    });
}

test('rejects a foreign-owned state inode using a preload confined to the child', async (t) => {
    const f = await fixture(t);
    const extraPreload = join(f.home, 'wrong-owner.mjs');
    await write(extraPreload, wrongIdentity, 0o600);
    const before = await snapshot(f.home);
    const result = await f.run({ apply: true, code: 1, extraPreload });
    assert.equal(result.reason, 'unsafe_metadata_file');
    assert.equal(result.changed, 0);
    assert.deepEqual(await snapshot(f.home), before);
});

test('held timer flock exits before mutations and the same lock works after release', async (t) => {
    const f = await fixture(t);
    const holder = spawn('/usr/bin/flock', ['-n', f.lock, process.execPath, '-e',
        'process.stdout.write("held"); process.stdin.resume()'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = once(holder, 'close');
    try {
        assert.equal(String((await once(holder.stdout, 'data'))[0]), 'held');
        const before = await snapshot(f.home);
        const result = await f.run({ apply: true, code: 1 });
        assert.equal(result.reason, 'timer_lock_held');
        assert.equal(result.changed, 0);
        assert.deepEqual(await snapshot(f.home), before);
    } finally {
        holder.stdin.end();
        await closed;
    }
    assert.equal((await f.run({ apply: true })).changed, 4);
});

for (const kind of ['file', 'parent']) {
    test('refuses live ' + kind + ' replacement after verified lock acquisition and before fchmod', async (t) => {
        const f = await fixture(t);
        const extraPreload = join(f.home, 'swap.mjs');
        const alt = join(f.home, 'alternate');
        const trace = join(f.home, 'swap-trace');
        const path = kind === 'file' ? f.state : f.stateDir;
        const displaced = path + '-displaced';
        await write(extraPreload, swap, 0o600);
        if (kind === 'file') await write(alt, stateBytes + '\n', 0o664);
        else {
            await fs.mkdir(alt, { mode: 0o755 });
            await write(join(alt, 'state.json'), stateBytes + '\n', 0o664);
            await write(join(alt, 'unrelated'), 'sentinel\n', 0o644);
        }
        await write(trace, '', 0o600);
        const before = await snapshot(f.home);
        const result = await f.run({ apply: true, code: 1, extraPreload,
            env: { PERMISSION_SWAP: JSON.stringify({ kind, path, alternate: alt, displaced, trace }) } });
        assert.equal(result.reason, 'entry_changed');
        assert.equal(result.changed, 0);
        assert.equal(await fs.readFile(trace, 'utf8'), 'swapped\n');
        if (kind === 'file') {
            assert.deepEqual(await snapshot(displaced), before.entries['dedicated-state'].entries['state.json']);
            assert.deepEqual(await snapshot(path), before.entries.alternate);
            await fs.rename(path, alt);
        } else {
            assert.deepEqual(await snapshot(displaced), before.entries['dedicated-state']);
            assert.deepEqual(await snapshot(alt), before.entries.alternate);
            assert.equal(await fs.readlink(path), alt);
            await fs.unlink(path);
        }
        await fs.rename(displaced, path);
        const after = await snapshot(f.home);
        // The preload moved names and wrote its trace. Verify every remaining inode and mode.
        delete before.entries['swap-trace'];
        delete after.entries['swap-trace'];
        after.mtime = before.mtime;
        after.entries['dedicated-state'].mtime = before.entries['dedicated-state'].mtime;
        assert.deepEqual(after, before);
    });
}

test('README glob installs all release modules, including transitive raster-mirror siblings', async (t) => {
    const f = await fixture(t);
    const modules = join(f.home, 'backend/deploy/eformsign-backup');
    const installDir = join(f.home, 'eformsign-backup');
    await fs.mkdir(modules, { recursive: true });
    await fs.mkdir(installDir, { mode: 0o700 });
    const actual = (await fs.readdir(source)).filter((name) => name.endsWith('.mjs'));
    for (const name of actual) await fs.copyFile(new URL(name, source), join(modules, name));
    const synthetic = {
        'raster-mirror.mjs': "import './raster-mirror-helper.mjs';\n",
        'raster-mirror-helper.mjs': "import './raster-mirror-transitive.mjs';\n",
        'raster-mirror-transitive.mjs': 'export const sentinel = true;\n',
    };
    for (const [name, bytes] of Object.entries(synthetic)) {
        if (!actual.includes(name)) await fs.writeFile(join(modules, name), bytes);
    }
    await fs.writeFile(join(modules, 'do-not-copy.txt'), 'unrelated');
    const readme = await fs.readFile(new URL('README.md', source), 'utf8');
    const command = readme.split('\n').map((line) => line.trim()).find((line) => line.startsWith('install -m 600'));
    assert.equal(command, 'install -m 600 backend/deploy/eformsign-backup/*.mjs ~/eformsign-backup/');
    await exec('/bin/sh', ['-c', command], { cwd: f.home, env: { PATH: process.env.PATH, HOME: f.home } });
    const expected = [...new Set([...actual, ...Object.keys(synthetic)])].sort();
    assert.deepEqual((await fs.readdir(installDir)).sort(), expected);
    for (const name of expected) {
        assert.equal(basename(name), name);
        assert.deepEqual(await fs.readFile(join(installDir, name)), await fs.readFile(join(modules, name)));
        assert.equal((await fs.stat(join(installDir, name))).mode & 0o7777, 0o600);
    }
});
