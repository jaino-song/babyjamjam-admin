import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const qpdf = '/usr/bin/qpdf';
const source = new URL('../eformsign-backup/', import.meta.url);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const timestamp = '2026-01-02T03:04:05Z';
const secret = 'synthetic-api-token';
const signer = 'Synthetic Signer';

function pdf(width) {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 100] /Resources << >> >>`,
    ];
    let bytes = '%PDF-1.4\n';
    const offsets = objects.map((object, i) => {
        const offset = bytes.length;
        bytes += `${i + 1} 0 obj\n${object}\nendobj\n`;
        return String(offset).padStart(10, '0') + ' 00000 n \n';
    });
    return Buffer.from(bytes + 'xref\n0 4\n0000000000 65535 f \n' + offsets.join('')
        + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${bytes.length}\n%%EOF\n`);
}

async function temp(t, prefix, parent = '/tmp') {
    const dir = await fs.mkdtemp(join(parent, prefix));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    return dir;
}

async function put(path, bytes, mode = 0o600) {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, bytes, { mode });
}

function checkedPages(path) {
    const check = (...args) => execFileSync(qpdf, args, { encoding: 'utf8' });
    assert.match(check('--check', path), /No syntax or stream encoding errors/);
    const json = JSON.parse(check('--json', path));
    assert.equal(Number(check('--show-npages', path)), json.pages.length);
    return json.pages.map(({ object }) => json.qpdf[1]['obj:' + object].value['/MediaBox'][2]);
}

test('host preflight: real qpdf merges two valid pages into a pre-created private PDF', async (t) => {
    const dir = await temp(t, 'eformsign-qpdf-preflight-');
    const paths = ['one.pdf', 'two.pdf', 'merged.pdf'].map((name) => join(dir, name));
    await put(paths[0], pdf(101));
    await put(paths[1], pdf(102));
    await put(paths[2], '');
    const ino = (await fs.stat(paths[2])).ino;
    await exec(qpdf, ['--empty', '--pages', ...paths.slice(0, 2), '--', paths[2]]);
    assert.deepEqual(checkedPages(paths[2]), [101, 102]);
    assert.equal((await fs.stat(paths[2])).ino, ino);
});

// Enforce the relevant profile filename rules even on an unconfined CI host.
// The fixture runs without a shell and delegates permitted merges to real qpdf.
const wrapper = String.raw`#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const names = [...args.slice(2, -2), args.at(-1)];
const permitted = (name) => {
    const relativeHome = path.relative(process.env.PROFILE_HOME, name);
    if (!relativeHome.startsWith('..' + path.sep)) return !relativeHome.startsWith('.') && name.endsWith('.pdf');
    return name.startsWith('/tmp/') && name.endsWith('.pdf');
};
if (!names.every(permitted)) process.exit(13);
if (process.env.QPDF_FIXTURE_LOG) {
    const root = path.dirname(names[0]);
    const info = fs.statSync(root);
    assert.match(root, /^\/tmp\/eformsign-backup-qpdf-[^/]+$/);
    assert.equal(info.uid, process.getuid());
    assert.equal(info.mode & 0o7777, 0o700);
    for (const name of names) {
        const file = fs.lstatSync(name);
        assert.equal(path.dirname(name), root);
        assert.ok(file.isFile());
        assert.equal(file.uid, process.getuid());
        assert.equal(file.mode & 0o7777, 0o600);
    }
    fs.appendFileSync(process.env.QPDF_FIXTURE_LOG, root + '\n');
    const n = fs.readFileSync(process.env.QPDF_FIXTURE_LOG, 'utf8').trim().split('\n').length;
    if (n === Number(process.env.QPDF_FIXTURE_FAIL)) {
        fs.writeFileSync(names.at(-1), 'discarded qpdf bytes');
        process.exit(9);
    }
    if (n === Number(process.env.QPDF_FIXTURE_EMPTY)) process.exit(0);
}
const child = spawnSync('/usr/bin/qpdf', args, { stdio: 'inherit' });
process.exit(child.status ?? 1);
`;

const mirror = String.raw`
import * as fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
export async function prepareRasterArchive() {}
export async function publishRasterArchive({ originalArchiveDir, archiveDir }, { dryRun }) {
    if (dryRun) return;
    const paths = await fs.readdir(originalArchiveDir, { recursive: true });
    for (const path of paths.filter((path) => path.endsWith('.pdf'))) {
        const bytes = await fs.readFile(join(originalArchiveDir, path));
        const derived = Buffer.concat([Buffer.from('fixture derivative\n'), bytes]);
        for (const root of [archiveDir, process.env.TEST_DRIVE]) {
            const final = join(root, path);
            if (await fs.readFile(final).then((old) => old.equals(derived), () => false)) continue;
            await fs.mkdir(dirname(final), { recursive: true });
            await fs.writeFile(final, derived);
        }
    }
}
export async function rollbackRasterArchive() { throw new Error('unexpected rollback'); }
`;

async function fixture(t, { originalsMount } = {}) {
    const home = await temp(t, 'eformsign-real-qpdf-');
    const worker = join(home, 'worker');
    const profileHome = join(home, 'profile-home');
    const archive = join(home, 'archive');
    const originalHost = originalsMount ? await temp(t, 'eformsign-private-archive-', originalsMount) : profileHome;
    const originals = join(originalHost, '.private', 'archive');
    const drive = join(home, 'mock-drive');
    const lockDir = join(home, '.local/state/eformsign-backup');
    const qpdfBin = join(worker, 'qpdf');
    const qpdfLog = join(home, 'qpdf-log');
    const settingsPath = join(home, 'settings.json');
    const tokenFile = join(home, 'token');
    await fs.mkdir(worker);
    for (const name of ['backup.mjs', 'provider-contract-migration.mjs', 'provider-contract-paths.mjs', 'provider-contract-publication.mjs']) {
        await fs.copyFile(fileURLToPath(new URL(name, source)), join(worker, name));
    }
    await put(qpdfBin, wrapper, 0o700);
    await put(join(worker, 'raster-mirror.mjs'), mirror);
    await put(join(lockDir, 'run.lock'), '');
    await put(tokenFile, secret);
    await fs.mkdir(archive, { mode: 0o755 });
    await fs.mkdir(originals, { recursive: true, mode: 0o700 });

    const files = new Map();
    const requests = [];
    const reports = [];
    const doc = (id, widths, metadata) => ({
        docId: id, title: signer, kind: 'other', createdAt: timestamp, completed: true, ...metadata,
        files: ['document', 'audit_trail'].map((fileType, i) => {
            const fileId = id + '-' + i;
            const bytes = pdf(widths[i]);
            files.set(fileId, bytes);
            return { fileId, fileType, sha256: digest(bytes), byteSize: bytes.length };
        }),
    });
    const chunk = (i) => ({ kind: 'service_record', customerName: signer, serviceStartDate: '2026-01-02',
        serviceRecordChunk: { caseId: 'test-case', snapshotVersion: 1, chunkCount: 2, chunkIndex: i, firstSessionIndex: i } });
    const docs = [
        doc('second', [202, 302], chunk(1)),
        doc('provider', [401, 402], { providerContract: { signerName: signer, signedDate: '2026-01-02' } }),
        doc('first', [201, 301], chunk(0)),
    ];
    const server = createServer(async (req, res) => {
        assert.equal(req.headers.authorization, 'Bearer ' + secret);
        if (req.url.startsWith('/internal/eformsign-backup/documents')) {
            requests.push('listing');
            res.end(JSON.stringify({ items: docs, nextCursor: null }));
        } else if (req.url === '/internal/eformsign-backup/runs' && req.method === 'POST') {
            requests.push('report');
            const body = [];
            for await (const part of req) body.push(part);
            reports.push(JSON.parse(Buffer.concat(body)));
            res.writeHead(201).end();
        } else {
            const id = req.url.split('/').at(-1);
            requests.push(id);
            if (!files.has(id)) res.writeHead(404);
            res.end(files.get(id));
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
        server.closeAllConnections();
        return new Promise((done) => server.close(done));
    });
    await put(settingsPath, JSON.stringify({ apiBaseUrl: 'http://127.0.0.1:' + server.address().port,
        tokenFile, archiveDir: archive, originalArchiveDir: originals, stateDir: lockDir, qpdfBin,
        rcloneRemote: 'mock:drive', rcloneBin: '/bin/false' }));
    const run = async ({ args = ['--raster'], code = 0, fail = 0, empty = 0 } = {}) => {
        const start = requests.length;
        const result = await exec(process.execPath, [join(worker, 'backup.mjs'), '--settings', settingsPath, ...args], {
            timeout: 15000,
            env: { PATH: process.env.PATH, HOME: home, PROFILE_HOME: profileHome, TEST_DRIVE: drive,
                QPDF_FIXTURE_LOG: qpdfLog, QPDF_FIXTURE_FAIL: String(fail), QPDF_FIXTURE_EMPTY: String(empty) },
        }).catch((error) => error);
        assert.equal(result.code ?? 0, code, result.stdout + result.stderr);
        assert.equal(result.stderr, '');
        for (const privateValue of [originals, basename(dirname(originals)), signer, secret, '%PDF', 'discarded qpdf bytes']) {
            assert.ok(!result.stdout.includes(privateValue), 'worker output disclosed fixture data');
        }
        return requests.slice(start);
    };
    await run({ args: ['--raster-archive', '--apply'] });
    const scratch = async (count) => {
        const names = (await fs.readFile(qpdfLog, 'utf8')).trim().split('\n');
        assert.equal(names.length, count);
        for (const path of new Set(names)) await assert.rejects(fs.lstat(path), { code: 'ENOENT' });
    };
    const reviseChunks = () => {
        docs[0] = doc('second', [212, 312], chunk(1));
        docs[2] = doc('first', [211, 311], chunk(0));
    };
    return { home, profileHome, archive, originals, drive, qpdfBin, files, reports, run, scratch, reviseChunks };
}

async function tree(root) {
    const rows = await fs.readdir(root, { recursive: true, withFileTypes: true });
    const result = {};
    for (const row of rows.filter((entry) => entry.isFile())) {
        const path = join(row.parentPath ?? row.path, row.name);
        const name = path.slice(root.length + 1);
        assert.ok(name.endsWith('.pdf'), 'unexpected temporary file');
        const info = await fs.stat(path);
        result[name] = { bytes: await fs.readFile(path), mtime: info.mtimeMs, mode: info.mode & 0o777 };
    }
    return result;
}

async function verifiedOutputs(f) {
    const raw = await tree(f.originals);
    const local = await tree(f.archive);
    const drive = await tree(f.drive);
    assert.deepEqual(Object.keys(local).sort(), Object.keys(raw).sort());
    assert.deepEqual(Object.keys(drive).sort(), Object.keys(raw).sort());
    assert.equal(Object.keys(raw).length, 8);
    assert.equal(new Set(Object.values(raw).map(({ bytes }) => digest(bytes))).size, 8);
    for (const file of f.files.values()) assert.ok(Object.values(raw).some(({ bytes }) => bytes.equals(file)));
    assert.equal(Object.keys(raw).filter((name) => name.startsWith('제공인력 계약서/')).length, 2);
    const merged = Object.keys(raw).filter((name) => name.startsWith('제공기록지/') && !name.includes('/원본/'));
    assert.equal(merged.length, 2);
    for (const name of merged) {
        // Inspect only synthetic test output, with filenames permitted by the host profile.
        const checkPath = join(f.home, name.includes('감사추적') ? 'check-audit.pdf' : 'check-doc.pdf');
        await put(checkPath, raw[name].bytes);
        assert.deepEqual(checkedPages(checkPath), name.includes('감사추적') ? [301, 302] : [201, 202]);
    }
    for (const [name, { bytes, mtime, mode }] of Object.entries(raw)) {
        assert.equal(mode, 0o600);
        assert.equal(mtime, Date.parse(timestamp));
        const expected = Buffer.concat([Buffer.from('fixture derivative\n'), bytes]);
        assert.deepEqual(local[name].bytes, expected);
        assert.deepEqual(drive[name].bytes, expected);
    }
    return [raw, local, drive];
}

test('scheduled qpdf merges work with the hidden-home and extension policy; unchanged run makes no file GETs', async (t) => {
    const f = await fixture(t);
    const visible = join(f.profileHome, 'old-input.pdf');
    const hidden = join(f.originals, 'hidden-input.pdf');
    const oldOutput = join(f.profileHome, 'old-output.pdf.id.tmp');
    await put(visible, pdf(101));
    await put(hidden, pdf(102));
    const oldMerge = (inputs, output) => exec(f.qpdfBin, ['--empty', '--pages', ...inputs, '--', output],
        { env: { PATH: process.env.PATH, PROFILE_HOME: f.profileHome } });
    await assert.rejects(oldMerge([visible, visible], oldOutput), { code: 13 });
    await assert.rejects(oldMerge([visible, hidden], join(f.home, 'permitted-output.pdf')), { code: 13 });
    await fs.unlink(hidden);

    const requests = await f.run();
    assert.equal(requests[0], 'listing');
    assert.equal(requests.at(-1), 'report');
    assert.deepEqual(requests.slice(1, -1).sort(), [...f.files.keys()].sort());
    const { status, driveStatus, savedFiles } = f.reports.at(-1);
    assert.deepEqual([status, driveStatus, savedFiles], ['success', 'ok', 8]);
    await f.scratch(2);
    const before = await verifiedOutputs(f);
    assert.deepEqual(await f.run(), ['listing', 'report']);
    assert.deepEqual(await verifiedOutputs(f), before);
    await f.scratch(2);
});

test('copies the completed qpdf result to a different archive filesystem', async (t) => {
    const sharedMemory = await fs.stat('/dev/shm').catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
    });
    if (!sharedMemory || sharedMemory.dev === (await fs.stat('/tmp')).dev) {
        t.skip('host has no separate /dev/shm filesystem');
        return;
    }
    const f = await fixture(t, { originalsMount: '/dev/shm' });
    assert.notEqual((await fs.stat(f.originals)).dev, (await fs.stat('/tmp')).dev);
    await f.run();
    await verifiedOutputs(f);
    await f.scratch(2);
});

for (const scenario of [
    { name: 'first qpdf fails', fail: 1, calls: 1 },
    { name: 'second qpdf fails after document merge', fail: 2, calls: 2 },
    { name: 'qpdf reports success with an empty result', empty: 2, calls: 2 },
]) {
    test(scenario.name + ' preserves sources and prior outputs and supports retry', async (t) => {
        const f = await fixture(t);
        const sentinel = join(f.home, 'other-file');
        await put(sentinel, 'untouched', 0o644);
        for (const root of [f.archive, f.drive]) await put(join(root, 'existing.pdf'), 'prior output');
        await f.run({ ...scenario, code: 2 });
        const { status, driveStatus, savedFiles, failedFiles } = f.reports.at(-1);
        assert.deepEqual([status, driveStatus, savedFiles, failedFiles], ['partial', 'ok', 6, 1]);
        await f.scratch(scenario.calls);
        const [raw, local, drive] = await Promise.all([f.originals, f.archive, f.drive].map(tree));
        assert.equal(Object.keys(raw).length, 6);
        assert.equal(Object.keys(local).length, 7);
        assert.deepEqual(Object.keys(drive).sort(), Object.keys(local).sort());
        for (const file of f.files.values()) assert.ok(Object.values(raw).some(({ bytes }) => bytes.equals(file)));
        for (const root of [f.archive, f.drive]) assert.equal(await fs.readFile(join(root, 'existing.pdf'), 'utf8'), 'prior output');
        assert.equal(await fs.readFile(sentinel, 'utf8'), 'untouched');
        assert.equal((await fs.stat(sentinel)).mode & 0o777, 0o644);
        assert.deepEqual(await f.run(), ['listing', 'report']);
        await f.scratch(scenario.calls + 2);
        for (const root of [f.archive, f.drive]) {
            assert.equal(await fs.readFile(join(root, 'existing.pdf'), 'utf8'), 'prior output');
            await fs.unlink(join(root, 'existing.pdf'));
        }
        await verifiedOutputs(f);
    });
}

test('a failed second merge for revised chunks leaves the previous merged pair intact', async (t) => {
    const f = await fixture(t);
    await f.run();
    const roots = [f.originals, f.archive, f.drive];
    const before = await Promise.all(roots.map(tree));
    f.reviseChunks();
    await f.run({ code: 2, fail: 4 });
    await f.scratch(4);
    const failed = await Promise.all(roots.map(tree));
    for (const [i, old] of before.entries()) {
        assert.equal(Object.keys(failed[i]).length, 12);
        for (const [path, entry] of Object.entries(old)) assert.deepEqual(failed[i][path], entry);
        for (const path of Object.keys(failed[i]).filter((path) => !(path in old))) assert.match(path, /\/원본\//);
    }
    assert.deepEqual(await f.run(), ['listing', 'report']);
    await f.scratch(6);
    const retried = await Promise.all(roots.map(tree));
    for (const [i, previous] of failed.entries()) {
        assert.equal(Object.keys(retried[i]).length, 14);
        for (const [path, entry] of Object.entries(previous)) assert.deepEqual(retried[i][path], entry);
    }
});
