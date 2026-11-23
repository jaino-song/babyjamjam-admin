import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const unit = new URL('../eformsign-backup/', import.meta.url);
const raster = ['--raster'];
const archive = ['--raster-archive'];
const migrate = ['--raster', '--migrate-provider-contracts'];
const SIGNED = ['signed-doc', 'signed-audit'];
const TOKEN = 'fixture-token-value';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pair = (folder, name) => [`${folder}/${name}.pdf`, `${folder}/감사추적/[감사추적]_${name}.pdf`];
const oldPair = pair('기타', 'Synthetic Private Name');
const newPair = pair('제공인력 계약서', '제공인력_계약서_Synthetic Private Name_2026-01-02');
const derivative = (bytes) => 'public-image:' + bytes;
const put = async (path, content) => {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, content, { mode: 0o600 });
};
const readJson = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));
const absent = (path) => assert.rejects(fs.lstat(path), { code: 'ENOENT' });

const fixtureMirror = String.raw`
import assert from 'node:assert/strict';
import { fstatSync, readFileSync, appendFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const { TEST_DRIVE, TEST_EVENTS, TEST_FAIL, TEST_LOCK, TEST_EXPLICIT } = process.env;
const log = (row) => appendFileSync(TEST_EVENTS, JSON.stringify(row) + '\n');
const read = (path) => fs.readFile(path, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
});
async function list(root, prefix = '') {
    const entries = await fs.readdir(join(root, prefix), { withFileTypes: true }).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
    });
    const paths = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const path = join(prefix, entry.name);
        if (entry.isDirectory()) paths.push(...await list(root, path));
        else if (entry.isFile() && path.endsWith('.pdf')) paths.push(path);
    }
    return paths.sort();
}
async function put(path, bytes) {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, bytes, { mode: 0o600 });
}
function start(call, settings, options) {
    assert.ok(Number.isInteger(options.lockFd) && fstatSync(options.lockFd).isFile());
    assert.equal(spawnSync('/usr/bin/flock', ['-n', '-E', '75', TEST_LOCK, 'true']).status, 75);
    assert.equal(options.explicitRepublish === true, TEST_EXPLICIT === 'yes');
    assert.ok(!('tokenFile' in settings));
    log({ call, settings, options });
    if (TEST_FAIL === call) throw Error(settings.originalArchiveDir + ' signed-doc Synthetic Private Name fixture-token-value');
}
export async function prepareRasterArchive(settings, options) {
    start('prepare', settings, options);
    const { archiveDir, originalArchiveDir } = settings;
    if (options.dryRun || await fs.stat(originalArchiveDir).then(() => true, () => false)) return { opaque: 301 };
    await fs.mkdir(originalArchiveDir, { mode: 0o700, recursive: true });
    for (const path of await list(archiveDir)) await put(join(originalArchiveDir, path), await read(join(archiveDir, path)));
    return { opaque: 301 };
}
export async function publishRasterArchive(settings, options) {
    start('publish', settings, options);
    const { archiveDir, originalArchiveDir, rcloneRemote } = settings;
    const roots = rcloneRemote ? [archiveDir, TEST_DRIVE] : [archiveDir];
    const moves = options.moves ?? [];
    const expected = [];
    for (const { from, to } of moves) {
        const raw = await read(join(originalArchiveDir, options.dryRun ? from : to));
        assert.notEqual(raw, null);
        const bytes = 'public-image:' + raw;
        for (const root of roots) {
            assert.ok([null, bytes].includes(await read(join(root, to))));
            assert.equal(await read(join(root, from)), bytes);
        }
        expected.push({ from, to, bytes });
    }
    if (options.dryRun) return { opaque: 302 };
    await fs.mkdir(archiveDir, { recursive: true });
    for (const path of await list(originalArchiveDir)) {
        const bytes = 'public-image:' + await read(join(originalArchiveDir, path));
        for (const root of roots) await put(join(root, path), bytes);
    }
    if (TEST_FAIL === 'move-publish' && moves.length) throw Error('Synthetic Private Name ' + originalArchiveDir);
    for (const { from, to, bytes } of expected) {
        for (const root of roots) {
            assert.equal(await read(join(root, to)), bytes);
            assert.equal(await read(join(root, from)), bytes);
            await fs.unlink(join(root, from));
        }
    }
    log({ call: 'published' });
    return { opaque: 302 };
}
export async function rollbackRasterArchive(settings, options) {
    start('rollback', settings, options);
    const { archiveDir, originalArchiveDir, rcloneRemote } = settings;
    const roots = rcloneRemote ? [archiveDir, TEST_DRIVE] : [archiveDir];
    for (const path of await list(originalArchiveDir)) {
        for (const root of roots) {
            const raw = await read(join(originalArchiveDir, path));
            await put(join(root, path), raw);
            assert.equal(await read(join(root, path)), raw);
        }
    }
    return { opaque: 303 };
}
`;

const instrument = String.raw`
import { appendFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const { readFile, link, open } = fs;
const { TEST_TOKEN, TEST_EVENTS, TEST_FAIL_LINK } = process.env;
const observeToken = (path) => {
    if (String(path) === TEST_TOKEN) appendFileSync(TEST_EVENTS, '{"call":"token"}\n');
};
fs.readFile = async (path, ...rest) => {
    observeToken(path);
    return readFile(path, ...rest);
};
fs.open = async (path, ...rest) => {
    observeToken(path);
    return open(path, ...rest);
};
fs.link = async (from, to) => {
    if (TEST_FAIL_LINK && String(to).includes('/제공인력 계약서/')) throw Error('private stage failure ' + to);
    return link(from, to);
};
syncBuiltinESMExports();
`;

const rawDrive = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_RAW_DRIVE, JSON.stringify(args) + '\n');
if (args[0] !== 'copy') process.exit(13);
fs.cpSync(args[2], process.env.TEST_DRIVE, { recursive: true });
`;

const qpdf = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const inputs = args.slice(2, -2);
if (!inputs.every((path) => path.startsWith(process.env.TEST_ORIGINALS + '/'))) process.exit(13);
fs.appendFileSync(process.env.TEST_EVENTS, JSON.stringify({ call: 'merge', inputs }) + '\n');
fs.writeFileSync(args.at(-1), 'merged:' + inputs.map((path) => fs.readFileSync(path, 'utf8')).join('|'));
`;

async function fixture(t, { explicit = false, remote = true } = {}) {
    const home = await fs.mkdtemp(join(tmpdir(), 'eformsign-raster-cli-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const worker = join(home, 'worker');
    await fs.mkdir(worker);
    for (const name of ['backup.mjs', 'provider-contract-migration.mjs', 'provider-contract-paths.mjs', 'provider-contract-publication.mjs']) {
        await fs.copyFile(new URL(name, unit), join(worker, name));
    }
    const publisher = join(worker, 'raster-mirror.mjs');
    const publicRoot = join(home, 'archive');
    const originals = explicit ? join(home, 'separate-originals') : publicRoot + '.originals';
    const stateRoot = join(home, '.local/state/eformsign-backup');
    const guard = join(stateRoot, 'raster-cutover.json');
    const journal = join(stateRoot, 'provider-contract-migration/journal.json');
    const state = join(stateRoot, 'state.json');
    const drive = join(home, 'drive');
    const events = join(home, 'events');
    const rawLog = join(home, 'rclone-log');
    const tokenFile = join(home, 'token-file');
    const settingsPath = join(home, 'settings.json');
    const lock = join(stateRoot, 'run.lock');
    const qpdfBin = join(worker, 'qpdf');
    const rcloneBin = join(worker, 'rclone');
    await Promise.all([
        put(lock, ''),
        fs.writeFile(publisher, fixtureMirror),
        fs.writeFile(join(worker, 'instrument.mjs'), instrument),
        fs.writeFile(qpdfBin, qpdf, { mode: 0o700 }),
        fs.writeFile(rcloneBin, rawDrive, { mode: 0o700 }),
    ]);

    const listing = { docs: [], status: 200, nextCursor: null };
    const requests = [];
    const reports = [];
    const files = new Map();
    const server = createServer(async (req, res) => {
        const { pathname, searchParams } = new URL(req.url, 'http://localhost');
        assert.equal(req.headers.authorization, 'Bearer ' + TOKEN);
        if (pathname.endsWith('/documents')) {
            requests.push('listing');
            if (searchParams.has('cursor')) { res.writeHead(503).end(); return; }
            res.writeHead(listing.status).end(JSON.stringify({ items: listing.docs, nextCursor: listing.nextCursor }));
        } else if (req.method === 'POST' && pathname.endsWith('/runs')) {
            requests.push('report');
            const parts = [];
            for await (const part of req) parts.push(part);
            reports.push(JSON.parse(Buffer.concat(parts)));
            await fs.appendFile(events, '{"call":"report"}\n');
            res.writeHead(201).end();
        } else {
            requests.push('file');
            const data = files.get(decodeURIComponent(pathname.split('/').at(-1)));
            if (data === undefined) res.writeHead(404).end();
            else res.end(data);
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
        server.closeAllConnections();
        return new Promise((done) => server.close(done));
    });
    const config = { apiBaseUrl: 'http://127.0.0.1:' + server.address().port, tokenFile, archiveDir: publicRoot,
        stateDir: stateRoot, rcloneBin, qpdfBin, gsBin: 'fixture-gs',
        ...(explicit ? { originalArchiveDir: originals } : {}), ...(remote ? { rcloneRemote: 'mock:backup' } : {}) };
    const settings = (overrides = {}) => fs.writeFile(settingsPath, JSON.stringify({ ...config, ...overrides }));
    await settings();
    const doc = (id, metadata = {}, bytes = SIGNED) => ({
        docId: id, title: 'Synthetic Private Name', kind: 'other', createdAt: '2026-01-03T00:00:00Z', completed: true,
        ...metadata,
        files: ['document', 'audit_trail'].map((fileType, i) => {
            const fileId = id + '-' + i;
            files.set(fileId, bytes[i]);
            return { fileId, fileType, sha256: sha(bytes[i]), byteSize: Buffer.byteLength(bytes[i]) };
        }),
    });
    const lines = async (path) => (await fs.readFile(path, 'utf8').catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return '';
    })).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const run = async (args = [], code = 0, options = {}) => {
        const start = (await lines(events)).length;
        const previousRequests = requests.length;
        const nodeArgs = ['--import', join(worker, 'instrument.mjs'), join(worker, 'backup.mjs'), '--settings', settingsPath, ...args];
        const command = options.legacyLock ? '/usr/bin/flock' : process.execPath;
        const commandArgs = options.legacyLock ? ['-n', lock, process.execPath, ...nodeArgs] : nodeArgs;
        const result = await exec(command, commandArgs, {
            timeout: 12000,
            env: { PATH: process.env.PATH, HOME: home, TEST_TOKEN: tokenFile, TEST_DRIVE: drive, TEST_EVENTS: events,
                TEST_LOCK: lock, TEST_RAW_DRIVE: rawLog, TEST_ORIGINALS: originals, TEST_FAIL: options.fail ?? '',
                TEST_FAIL_LINK: options.interruptRaw ? 'yes' : '',
                TEST_EXPLICIT: args.includes('--raster-archive') && args.includes('--apply') ? 'yes' : '' },
        }).catch((error) => error);
        assert.equal(result.code ?? 0, code, result.stdout + result.stderr);
        assert.equal(result.stderr, '');
        for (const value of [...SIGNED, TOKEN, originals, publicRoot, 'Synthetic Private Name']) {
            assert.ok(!result.stdout.includes(value), 'worker output contained a private fixture value');
        }
        return { log: result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
            events: (await lines(events)).slice(start), requests: requests.slice(previousRequests) };
    };
    const seed = (root, paths, bytes = SIGNED) => Promise.all(paths.map((path, i) => put(join(root, path), bytes[i])));
    return { home, settings, run, publisher, publicRoot, originals, drive, stateRoot, journal, state, lock, guard,
        listing, reports, doc, token: () => put(tokenFile, TOKEN), untoken: () => fs.unlink(tokenFile),
        seed, raw: () => lines(rawLog) };
}

const names = (result) => result.events.map(({ call }) => call);
const report = (f, expected) => {
    const run = f.reports.at(-1);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(run[key], value, key);
};
const expect = async (root, paths, bytes) => {
    for (const [i, path] of paths.entries()) assert.equal(await fs.readFile(join(root, path), 'utf8'), bytes[i]);
};
const expectPublished = async (f, paths, raw = SIGNED) => {
    await expect(f.originals, paths, raw);
    for (const root of [f.publicRoot, f.drive]) {
        await expect(root, paths, raw.map(derivative));
        const originals = new Set([...SIGNED, ...raw].map(sha));
        for (const path of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
            if (path.isFile()) assert.ok(!originals.has(sha(await fs.readFile(join(path.parentPath ?? path.path, path.name)))));
        }
    }
};
const stand = async (f, action, code, options) => {
    const result = await f.run([...archive, ...action], code, options);
    assert.ok(!names(result).includes('token'));
    assert.deepEqual(result.requests, []);
    return result;
};
async function snapshot(root) {
    const rows = await fs.readdir(root, { recursive: true, withFileTypes: true }).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
    });
    return Promise.all(rows.map(async (row) => {
        const path = join(row.parentPath ?? row.path, row.name);
        const { mode, size, mtimeMs, ino } = await fs.lstat(path);
        return [path, mode, size, mtimeMs, ino, row.isFile() ? sha(await fs.readFile(path)) : null];
    })).then((entries) => entries.sort(([a], [b]) => a.localeCompare(b)));
}
const tree = (f) => Promise.all([f.publicRoot, f.originals, f.stateRoot, f.drive].map(snapshot));

test('service switch and settings-only opt-in download and report only after publishing a distinct pair', async (t) => {
    const service = await fs.readFile(new URL('eformsign-backup.service', unit), 'utf8');
    const start = service.match(/^ExecStart=(.*)$/m)[1].split(' ');
    assert.deepEqual(start, ['/usr/bin/env', 'node', '%h/eformsign-backup/backup.mjs', '--settings',
        '%h/.config/eformsign-backup/settings.json', '--raster']);
    for (const explicit of [false, true]) {
        const f = await fixture(t, { explicit });
        await stand(f, ['--apply'], 0);
        await f.token();
        f.listing.docs = [f.doc('first')];
        const args = explicit ? [] : start.slice(5);
        const first = await f.run(args);
        assert.deepEqual(first.requests, ['listing', 'file', 'file', 'report']);
        assert.deepEqual(names(first), ['token', 'prepare', 'publish', 'published', 'report']);
        const settings = first.events.find(({ call }) => call === 'prepare').settings;
        assert.deepEqual([settings.archiveDir, settings.originalArchiveDir, settings.stateDir, settings.rcloneRemote, settings.gsBin],
            [f.publicRoot, f.originals, f.stateRoot, 'mock:backup', 'fixture-gs']);
        report(f, { totalDocs: 1, savedFiles: 2, skippedFiles: 0, status: 'success', driveStatus: 'ok' });
        await expectPublished(f, oldPair);
        const entry = (await readJson(f.state)).units['doc:first'];
        assert.deepEqual(entry.files, Object.fromEntries(oldPair.map((path, i) => [path, SIGNED[i].length])));
        assert.equal(entry.fingerprint, SIGNED.map(sha).join(':'));
        const repeat = await f.run(args);
        assert.deepEqual(repeat.requests, ['listing', 'report']);
        report(f, { savedFiles: 0, skippedFiles: 2, status: 'success', driveStatus: 'ok' });
        assert.deepEqual(await f.raw(), []);
    }
});

test('historical folders, private chunks and both merged PDFs are published', async (t) => {
    const f = await fixture(t);
    const historic = ['서비스계약서/old.pdf', '제공기록지/old.pdf', '제공기록지/원본/old.pdf',
        '제공인력 계약서/old.pdf', '기타/old.pdf'];
    await f.seed(f.publicRoot, historic, historic.map(() => 'historic-raw'));
    await put(join(f.publicRoot, '.old/hidden.pdf'), 'hidden');
    await stand(f, ['--apply'], 0);
    await f.token();
    const chunk = (i) => ({ kind: 'service_record', customerName: 'Fixture', serviceStartDate: '2026-01-02',
        serviceRecordChunk: { caseId: 'x', snapshotVersion: 1, chunkCount: 2, chunkIndex: i, firstSessionIndex: i } });
    const second = ['signed-doc-second', 'signed-audit-second'];
    f.listing.docs = [f.doc('two', chunk(1), second), f.doc('one', chunk(0))];
    const result = await f.run(raster);
    const title = '제공기록지_Fixture_2026-01-02';
    const chunks = [pair('제공기록지/원본', title + '_1장'), pair('제공기록지/원본', title + '_2장')];
    await expectPublished(f, chunks[0]);
    await expectPublished(f, chunks[1], second);
    await expectPublished(f, pair('제공기록지', title), SIGNED.map((value, i) => 'merged:' + value + '|' + second[i]));
    await expectPublished(f, historic, historic.map(() => 'historic-raw'));
    const merges = result.events.filter(({ call }) => call === 'merge');
    assert.deepEqual(merges.map(({ inputs }) => inputs), [0, 1].map((i) => chunks.map((paths) => join(f.originals, paths[i]))));
    report(f, { savedFiles: 6, skippedFiles: 0, status: 'success' });
    assert.deepEqual(await f.raw(), []);
});

test('ordinary publication failure preserves raw bytes and retry does not download; setup and listing fail closed', async (t) => {
    const f = await fixture(t);
    await f.token();
    f.listing.docs = [f.doc('first')];
    const before = await f.run(raster, 1);
    assert.deepEqual(before.requests, ['report']);
    report(f, { status: 'failed', driveStatus: 'failed', savedFiles: 0 });
    await f.untoken();
    await stand(f, ['--apply'], 0);
    await f.token();
    const failed = await f.run(raster, 2, { fail: 'publish' });
    assert.deepEqual(failed.requests, ['listing', 'file', 'file', 'report']);
    report(f, { status: 'partial', driveStatus: 'failed', savedFiles: 2 });
    await expect(f.originals, oldPair, SIGNED);
    for (const path of oldPair) {
        await absent(join(f.publicRoot, path));
        await absent(join(f.drive, path));
    }
    assert.deepEqual((await f.run(raster)).requests, ['listing', 'report']);
    report(f, { status: 'success', savedFiles: 0, skippedFiles: 2 });
    await expectPublished(f, oldPair);

    const prepare = await f.run(raster, 1, { fail: 'prepare' });
    assert.deepEqual(prepare.requests, ['report']);
    assert.ok(prepare.log.some(({ reason }) => reason === 'raster_prepare_failed'));
    report(f, { status: 'failed', driveStatus: 'failed', savedFiles: 0 });
    f.listing.nextCursor = 'next';
    const listing = await f.run(raster, 1);
    assert.deepEqual(listing.requests, ['listing', 'listing', 'report']);
    assert.deepEqual(names(listing), ['token', 'prepare', 'report']);
    report(f, { status: 'failed', driveStatus: 'failed', savedFiles: 0 });

    f.listing.nextCursor = null;
    await put(join(f.originals, oldPair[0]), 'forged-doc');
    const tampered = await f.run(raster, 1);
    assert.deepEqual(names(tampered), ['token', 'prepare', 'report']);
    assert.equal(f.reports.at(-1).failures[0].reason, 'original_sha256_mismatch');
    await expect(f.publicRoot, oldPair, SIGNED.map(derivative));
    await fs.unlink(f.publisher);
    const missing = await f.run(raster, 1);
    assert.deepEqual(missing.requests, ['report']);
    assert.ok(missing.log.some(({ reason }) => reason === 'raster_publisher_unavailable'));
    report(f, { status: 'failed', driveStatus: 'failed', savedFiles: 0 });
    assert.deepEqual(await f.raw(), []);
});

test('standalone lifecycle is offline and immutable in dry-run; rollback gates legacy raw copy', async (t) => {
    const f = await fixture(t);
    await f.seed(f.publicRoot, oldPair);
    await f.seed(f.drive, oldPair);
    const initial = await tree(f);
    assert.deepEqual(names(await stand(f, [], 0)), ['prepare', 'publish']);
    assert.deepEqual(await tree(f), initial);
    await stand(f, ['--apply'], 1, { fail: 'prepare' });
    assert.equal((await readJson(f.guard)).phase, 'preparing');
    await stand(f, ['--apply'], 1, { fail: 'publish' });
    assert.equal((await readJson(f.guard)).phase, 'preparing');
    const refused = await f.run([], 1);
    assert.deepEqual(refused.requests, []);
    assert.deepEqual(names(refused), []);
    await stand(f, ['--apply'], 0);
    assert.equal((await readJson(f.guard)).phase, 'active');
    assert.equal((await fs.stat(f.guard)).mode & 0o777, 0o600);
    await expectPublished(f, oldPair);
    await stand(f, ['--apply'], 1, { fail: 'publish' });
    assert.equal((await readJson(f.guard)).phase, 'preparing');
    await stand(f, ['--apply'], 0);
    await stand(f, ['--rollback'], 1, { fail: 'rollback' });
    assert.equal((await readJson(f.guard)).phase, 'rollingBack');
    await stand(f, ['--apply'], 1);
    await stand(f, ['--rollback'], 0);
    await absent(f.guard);
    await expect(f.publicRoot, oldPair, SIGNED);
    await expect(f.drive, oldPair, SIGNED);
    await expect(f.originals, oldPair, SIGNED);
    assert.deepEqual(await f.raw(), []);
    // The pre-cutover invocation takes the lock externally; an uninstalled mirror is fine.
    await fs.unlink(f.publisher);
    await f.token();
    await f.run([], 0, { legacyLock: true });
    assert.equal((await f.raw())[0][0], 'copy');
});

test('invalid modes, unsafe roots, damaged guards and lock contention leave state and API untouched', async (t) => {
    const f = await fixture(t);
    const initial = await tree(f);
    for (const args of [['--raster', '--raster'], [...archive, '--apply', '--rollback'], [...archive, '--limit', '1']]) {
        const result = await f.run(args, 1);
        assert.deepEqual(result.events, []);
        assert.deepEqual(result.requests, []);
    }
    await f.settings({ originalArchiveDir: join(f.publicRoot, 'private') });
    assert.deepEqual((await f.run(raster, 1)).events, []);
    await fs.symlink(f.stateRoot, join(f.home, 'symlink-state'));
    await f.settings({ stateDir: join(f.home, 'symlink-state') });
    assert.deepEqual((await f.run(raster, 1)).events, []);
    await f.settings();
    assert.deepEqual(await tree(f), initial);

    const holder = spawn('/usr/bin/flock', ['-n', f.lock, 'sh', '-c', 'printf held; read gate'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = once(holder, 'close');
    try {
        assert.equal(String((await once(holder.stdout, 'data'))[0]), 'held');
        const result = await stand(f, ['--apply'], 1);
        assert.equal(result.log[0].reason, 'timer_lock_held');
        assert.deepEqual(await tree(f), initial);
    } finally {
        holder.stdin.end('\n');
        await closed;
    }
    await put(f.guard, '{broken');
    const damaged = await stand(f, ['--apply'], 1);
    assert.equal(damaged.log[0].reason, 'invalid_raster_cutover');
    assert.deepEqual((await f.run([], 1)).events, []);
    await fs.unlink(f.guard);
    await stand(f, ['--apply'], 0);
    const active = await tree(f);
    await f.settings({ stateDir: join(f.home, 'foreign-state') });
    const foreign = await f.run(raster, 1);
    assert.deepEqual(foreign.events, []);
    assert.equal(foreign.log[0].reason, 'raster_cutover_settings_changed');
    await f.settings({ rcloneRemote: 'mock:backup/' });
    assert.equal((await stand(f, [], 1)).log[0].reason, 'raster_cutover_settings_changed');
    await f.settings();
    await fs.chmod(f.guard, 0o644);
    assert.equal((await stand(f, [], 1)).log[0].reason, 'unsafe_raster_cutover');
    await fs.chmod(f.guard, 0o600);
    assert.deepEqual(await tree(f), active);
    await fs.unlink(join(f.home, 'settings.json'));
    const missing = await f.run([], 1);
    assert.deepEqual(missing.events, []);
    assert.deepEqual(missing.requests, []);
    assert.deepEqual(await f.raw(), []);
});

test('cutover refuses public scratch and old receipts; preserves only a finished bound predecessor', async (t) => {
    const f = await fixture(t);
    const legacyJournal = { version: 1, id: '12345678-1234-1234-1234-123456789abc', archive: f.publicRoot,
        remote: 'mock:backup', phase: 'applying', moves: [] };
    for (const phase of ['applying', 'rollingBack']) {
        await put(f.journal, JSON.stringify({ ...legacyJournal, phase }));
        assert.equal((await stand(f, ['--apply'], 1)).log[0].reason, 'finish_legacy_provider_migration_first');
        await absent(f.guard);
    }
    await put(f.journal, JSON.stringify({ ...legacyJournal, archive: join(f.home, 'foreign'), phase: 'applied' }));
    assert.equal((await stand(f, ['--apply'], 1)).log[0].reason, 'foreign_pre_raster_migration');
    await fs.unlink(f.journal);
    for (const path of [join(f.stateRoot, 'provider-contract-publication.json'), join(f.stateRoot, 'provider-contract-prepared-stages.json'),
        join(f.publicRoot, 'folder/copy.tmp'), join(f.publicRoot, '.provider-contract-x/unsafe'),
        join(f.publicRoot, '.provider-publication-x/unsafe')]) {
        await put(path, 'do not remove');
        const before = await tree(f);
        await stand(f, [], 1);
        await stand(f, ['--apply'], 1);
        assert.deepEqual(await tree(f), before);
        await fs.rm(path.includes('/.provider-') ? dirname(path) : path, { recursive: true });
        await absent(f.guard);
    }
    const savedBytes = JSON.stringify({ ...legacyJournal, phase: 'applied' }, null, 4);
    await put(f.journal, savedBytes);
    const before = await tree(f);
    await stand(f, [], 0);
    assert.deepEqual(await tree(f), before);
    await stand(f, ['--apply'], 1, { fail: 'prepare' });
    const saved = join(dirname(f.journal), 'records/pre-raster-' + legacyJournal.id + '-applied.json');
    assert.equal(await fs.readFile(saved, 'utf8'), savedBytes);
    assert.deepEqual((await readJson(f.guard)).predecessor, { id: legacyJournal.id, phase: 'applied' });
    await absent(f.journal);
    await stand(f, ['--apply'], 0);
    assert.equal(await fs.readFile(saved, 'utf8'), savedBytes);
    assert.equal((await f.run([...migrate, '--rollback'], 1)).log[0].reason, 'pre_raster_rollback_requires_archive_rollback');
    await stand(f, ['--rollback'], 0);
    assert.equal(await fs.readFile(saved, 'utf8'), savedBytes);
    assert.deepEqual(await f.raw(), []);
});

async function providerFixture(t) {
    const f = await fixture(t);
    await stand(f, ['--apply'], 0);
    await f.token();
    const original = f.doc('provider');
    const sentinel = f.doc('sentinel', { title: 'Synthetic Sentinel' }, ['fixture-doc', 'fixture-audit']);
    f.listing.docs = [original, sentinel];
    await f.run(raster);
    f.listing.docs = [{ ...original, providerContract: { signerName: 'Synthetic Private Name', signedDate: '2026-01-02' } }, sentinel];
    return { ...f, sentinelPaths: pair('기타', sentinel.title) };
}

const movesOf = (result, call = 'publish', dryRun = false) => result.events
    .filter((event) => event.call === call && Boolean(event.options.dryRun) === dryRun && event.options.moves?.length)
    .map((event) => event.options.moves);
const forward = oldPair.map((path, i) => ({ from: path, to: newPair[i] }));
const reverse = forward.map(({ from, to }) => ({ from: to, to: from }));

test('provider forward and reverse publish exact moves, retain durable intent, and replay only the unfinished direction', async (t) => {
    const f = await providerFixture(t);
    const before = await tree(f);
    const plan = await f.run(migrate);
    assert.deepEqual(plan.requests, ['listing']);
    assert.deepEqual(movesOf(plan, 'publish', true), [forward]);
    assert.deepEqual(await tree(f), before);
    const apply = await f.run([...migrate, '--apply'], 1, { fail: 'move-publish' });
    assert.deepEqual(apply.requests, ['listing']);
    assert.deepEqual(movesOf(apply), [forward]);
    assert.ok(names(apply).indexOf('published') < names(apply).lastIndexOf('publish'));
    assert.deepEqual(movesOf(apply, 'prepare'), [forward]);
    let journal = await readJson(f.journal);
    assert.equal(journal.phase, 'applied');
    assert.deepEqual([journal.raster.direction, journal.raster.pending, journal.raster.moves], ['forward', true, forward]);
    await expect(f.originals, newPair, SIGNED);
    for (const path of oldPair) await absent(join(f.originals, path));
    assert.deepEqual((await f.run([...migrate, '--rollback'], 1)).events, []);
    await stand(f, ['--rollback'], 1);
    await f.untoken();
    f.listing.status = 503;
    const retry = await f.run([...migrate, '--apply']);
    assert.deepEqual(retry.requests, []);
    assert.deepEqual(movesOf(retry), [forward]);
    assert.deepEqual(movesOf(retry, 'prepare'), [forward]);
    assert.ok(!names(retry).includes('token'));
    await expectPublished(f, newPair);
    for (const root of [f.publicRoot, f.drive]) for (const path of oldPair) await absent(join(root, path));
    assert.equal((await readJson(f.journal)).raster.pending, false);
    await f.token();
    f.listing.status = 200;
    assert.deepEqual(movesOf(await f.run([...migrate, '--apply'])), []);
    await f.untoken();

    const failedReverse = await f.run([...migrate, '--rollback'], 1, { fail: 'move-publish' });
    assert.deepEqual(failedReverse.requests, []);
    assert.deepEqual(movesOf(failedReverse), [reverse]);
    journal = await readJson(f.journal);
    assert.equal(journal.phase, 'rolledBack');
    assert.deepEqual([journal.raster.direction, journal.raster.pending, journal.raster.moves], ['reverse', true, reverse]);
    assert.deepEqual((await f.run([...migrate, '--apply'], 1)).events, []);
    await f.token();
    const ordinary = await f.run(raster);
    assert.deepEqual(movesOf(ordinary), [reverse]);
    assert.deepEqual(movesOf(ordinary, 'prepare'), [reverse]);
    assert.deepEqual(names(ordinary), ['token', 'prepare', 'publish', 'published', 'prepare', 'publish', 'published', 'report']);
    assert.deepEqual(ordinary.requests, ['listing', 'report']);
    assert.equal((await readJson(f.journal)).raster.pending, false);
    await expectPublished(f, oldPair);
    for (const root of [f.originals, f.publicRoot, f.drive]) for (const path of newPair) await absent(join(root, path));
    assert.deepEqual(movesOf(await f.run([...migrate, '--rollback'])), []);
    assert.deepEqual(movesOf(await f.run(raster)), []);
    await expectPublished(f, f.sentinelPaths, ['fixture-doc', 'fixture-audit']);
    assert.deepEqual(await f.raw(), []);
});

test('provider validates foreign state, collisions, and refuses ordinary polling while raw relocation is incomplete', async (t) => {
    const f = await providerFixture(t);
    await put(join(f.originals, newPair[0]), 'foreign');
    const target = await f.run([...migrate, '--apply'], 1);
    assert.equal(target.log[0].reason, 'local_target_exists');
    assert.deepEqual(names(target), ['token']);
    await fs.unlink(join(f.originals, newPair[0]));
    await put(join(f.drive, newPair[0]), 'foreign');
    const conflict = await f.run(migrate, 1);
    assert.equal(conflict.log[0].reason, 'raster_publish_failed');
    assert.equal((await f.run([...migrate, '--apply'], 1)).log[0].reason, 'raster_publish_failed');
    assert.equal(await fs.readFile(join(f.drive, newPair[0]), 'utf8'), 'foreign');
    await expect(f.originals, oldPair, SIGNED);
    await absent(f.journal);
    await fs.unlink(join(f.drive, newPair[0]));

    const interrupted = await f.run([...migrate, '--apply'], 1, { interruptRaw: true });
    assert.deepEqual(movesOf(interrupted), []);
    const saved = await readJson(f.journal);
    assert.equal(saved.phase, 'applying');
    assert.deepEqual([saved.raster.pending, saved.raster.moves], [true, forward]);
    assert.deepEqual((await f.run(raster, 1)).requests, ['report']);
    report(f, { status: 'failed', driveStatus: 'failed', savedFiles: 0 });
    await stand(f, ['--rollback'], 1);
    await put(f.journal, JSON.stringify({ ...saved, archive: '/foreign-originals' }));
    assert.equal((await f.run([...migrate, '--apply'], 1)).log[0].reason, 'migration_settings_changed');
    await put(f.journal, JSON.stringify(saved));
    await f.untoken();
    const retry = await f.run([...migrate, '--apply']);
    assert.deepEqual(retry.requests, []);
    assert.deepEqual(movesOf(retry), [forward]);
    await expectPublished(f, newPair);
    assert.deepEqual(await f.raw(), []);
});

test('without Drive local publishing is still required and the run reports skipped/partial', async (t) => {
    const f = await fixture(t, { remote: false });
    await stand(f, [], 0);
    await stand(f, ['--apply'], 0);
    await f.token();
    f.listing.docs = [f.doc('first')];
    assert.deepEqual(names(await f.run([...raster, '--limit', '1'], 2)), ['token', 'prepare', 'publish', 'published', 'report']);
    report(f, { savedFiles: 2, skippedFiles: 0, status: 'partial', driveStatus: 'skipped', limited: true });
    await expect(f.originals, oldPair, SIGNED);
    await expect(f.publicRoot, oldPair, SIGNED.map(derivative));
    await absent(f.drive);
    assert.deepEqual(await f.raw(), []);
});
