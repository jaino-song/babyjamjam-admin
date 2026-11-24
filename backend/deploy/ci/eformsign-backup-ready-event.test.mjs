import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import nodeTest from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { inDailyHandoff } from '../eformsign-backup/ready-events.mjs';

const exec = promisify(execFile);
// The closure tests reuse the offline CLI fixture without registering these cases.
const test = process.argv[1] === fileURLToPath(import.meta.url) ? nodeTest : () => {};
const source = new URL('../eformsign-backup/', import.meta.url);
const worker = fileURLToPath(new URL('backup.mjs', source));
const token = 'synthetic-ready-event-token';
export const baseTime = Date.parse('2026-11-24T01:05:00.000Z');
export const v1 = '2026-11-24T00:01:00.000Z';
export const v2 = '2026-11-24T00:02:00.000Z';
const v3 = '2026-11-24T00:03:00.000Z';
const timestamp = (time) => new Date(time).toISOString();
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function pdf(width) {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 100] /Resources << >> >>`,
    ];
    let text = '%PDF-1.4\n';
    const offsets = objects.map((object, i) => {
        const offset = text.length;
        text += `${i + 1} 0 obj\n${object}\nendobj\n`;
        return String(offset).padStart(10, '0') + ' 00000 n \n';
    });
    return Buffer.from(text + 'xref\n0 4\n0000000000 65535 f \n' + offsets.join('')
        + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${text.length}\n%%EOF\n`);
}

export async function put(path, bytes, mode = 0o600) {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, bytes, { mode });
}
export const json = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));
export async function readReadyQueue(path) {
    const checkpoint = await json(path);
    const pending = Object.entries(checkpoint.pending);
    const seen = checkpoint.seen.flat();
    const pages = join(dirname(path), '.ready-events-pages');
    async function readRows(index, name, prefix, rows) {
        if (index.rows) {
            for (const [, key, value] of index.rows) rows.push([key, name === 'seen' ? value.at : value]);
            return;
        }
        for (const digit of Object.keys(index.children)) {
            const branch = prefix + digit;
            await readRows(await json(join(pages, name + '-' + branch)), name, branch, rows);
        }
    }
    if (checkpoint.pendingIndex) await readRows(checkpoint.pendingIndex, 'pending', '', pending);
    if (checkpoint.seenIndex) await readRows(checkpoint.seenIndex, 'seen', '', seen);
    return { ...checkpoint, pending: Object.fromEntries(pending), seen: [seen] };
}
const absent = (path) => assert.rejects(fs.lstat(path), { code: 'ENOENT' });
const reducer = (rows, key) => rows.filter(([route]) => route === key).map(([, value]) => value);
const rcloneWrapper = `#!/usr/bin/env node
const { appendFileSync, existsSync, unlinkSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
appendFileSync('remote-calls', args[0] + '\\n');
if (args[0] === 'copyto' && existsSync('delay-drive')) {
    unlinkSync('delay-drive');
    process.exit(9);
}
const child = spawnSync('rclone', ['--config', 'offline.conf', ...args], { stdio: 'inherit' });
process.exit(child.status ?? 1);
`;
const clockShim = `const NativeDate = Date;
const offset = Number(process.env.FIXTURE_READY_CLOCK) - NativeDate.now();
globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [NativeDate.now() + offset])); }
    static now() { return NativeDate.now() + offset; }
};
`;

export async function fixture(t, initialise = true) {
    const root = await fs.mkdtemp(join(tmpdir(), 'ready-archive-'));
    t.after(() => fs.rm(root, { force: true, recursive: true }));
    const home = join(root, 'home');
    const lock = join(home, '.local/state/eformsign-backup/run.lock');
    const settings = {
        tokenFile: join(root, 'token'), archiveDir: join(root, 'public'), originalArchiveDir: join(root, 'private'),
        stateDir: join(root, 'state'), rcloneRemote: 'fixture:drive', rcloneBin: join(root, 'local-rclone.cjs'),
    };
    const guardPath = join(dirname(lock), 'raster-cutover.json');
    const configPath = join(root, 'settings.json');
    const shim = join(root, 'clock.mjs');
    const queuePath = join(settings.stateDir, 'ready-events.json');
    const calls = [];
    const ledger = [];
    const files = new Map();
    const targets = new Map();
    const dailyDocs = [];
    const server = createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const route = url.pathname.split('/').at(-1);
        const send = (data) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        };
        if (req.headers.authorization !== 'Bearer ' + token) return res.writeHead(401).end();
        if (route === 'ready-events') {
            calls.push([route, Object.fromEntries(url.searchParams)]);
            const after = Number(url.searchParams.get('afterId'));
            const since = Date.parse(url.searchParams.get('since'));
            const until = Date.parse(url.searchParams.get('until'));
            const limit = Number(url.searchParams.get('limit'));
            const rows = ledger.filter((row) => row.id > after && Date.parse(row.createdAt) >= since
                && Date.parse(row.createdAt) < until).sort((a, b) => a.id - b.id);
            const items = rows.slice(0, limit);
            return send({ items, nextCursor: rows.length >= limit ? items.at(-1).id : null });
        }
        if (route === 'ready-documents') {
            const id = url.searchParams.get('docId');
            calls.push([route, id]);
            const lookup = targets.get(id);
            return send(typeof lookup === 'function' ? lookup() : lookup ?? { status: 'pending', sourceUpdatedAt: null, items: [] });
        }
        if (url.pathname.includes('/files/')) {
            const bytes = files.get(route);
            calls.push(['file', route]);
            if (bytes) return res.end(bytes);
        } else {
            calls.push([route, req.method]);
            if (route === 'documents') return send({ items: dailyDocs, nextCursor: null });
            if (route === 'runs') return res.writeHead(201).end();
        }
        return res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    settings.apiBaseUrl = 'http://127.0.0.1:' + server.address().port;
    const config = (value = settings) => put(configPath, JSON.stringify(value));
    await config();
    await put(shim, clockShim);
    await put(settings.tokenFile, token);
    await put(lock, '');
    await put(settings.rcloneBin, rcloneWrapper, 0o700);
    await put(join(root, 'offline.conf'), '[fixture]\ntype = local\n');
    for (const folder of [settings.archiveDir, settings.originalArchiveDir, settings.stateDir, join(root, 'drive')]) {
        await fs.mkdir(folder, { mode: 0o700 });
    }
    const run = (args, now = baseTime) => exec(process.execPath, ['--import', shim, worker, '--settings', configPath, ...args], {
        cwd: root, env: { ...process.env, HOME: home, FIXTURE_READY_CLOCK: String(now) }, timeout: 30_000,
    });
    if (initialise) {
        const result = await run(['--raster-archive', '--apply']);
        assert.deepEqual(JSON.parse(result.stdout.trim()), { rasterArchive: 'apply', exitCode: 0 });
    }
    const tick = async (now = baseTime) => {
        const { stdout, stderr } = await run(['--raster', '--ready-events'], now);
        assert.equal(stderr, '');
        return stdout.trim() ? JSON.parse(stdout.trim()).readyEvents : null;
    };
    const doc = (docId, widths, options = {}) => ({
        docId, kind: 'other', title: 'Synthetic name', createdAt: v1, customerName: null, serviceStartDate: null,
        serviceRecordChunk: null, completed: widths.length === 2, ...options,
        files: widths.map((width, index) => {
            const bytes = pdf(width);
            const fileId = `${docId}-${index}-${width}`;
            files.set(fileId, bytes);
            return { fileId, fileType: index ? 'audit_trail' : 'document', sha256: hash(bytes), byteSize: bytes.length };
        }),
    });
    const target = (revision, ...items) => ({ status: 'ready', sourceUpdatedAt: revision, items });
    const event = (id, docId, completed, sourceUpdatedAt, created = baseTime - 10_000) =>
        ledger.push({ id, docId, completed, sourceUpdatedAt, createdAt: timestamp(created) });
    const remoteCalls = async () => (await fs.readFile(join(root, 'remote-calls'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
    const checkCopies = async (paths, expected) => {
        for (const [i, rel] of paths.entries()) {
            const local = join(settings.archiveDir, rel);
            const remote = join(root, 'drive', rel);
            const raw = join(settings.originalArchiveDir, rel);
            assert.deepEqual(await fs.readFile(remote), await fs.readFile(local));
            assert.notDeepEqual(await fs.readFile(local), await fs.readFile(raw));
            const { stdout } = await exec('qpdf', ['--json', local]);
            const parsed = JSON.parse(stdout);
            assert.equal(parsed.pages.length, expected[i].length);
            assert.ok(parsed.pages.every(({ images }) => images.length === 1));
            assert.deepEqual(parsed.pages.map(({ object }) => Math.round(parsed.qpdf[1]['obj:' + object].value['/MediaBox'][2])), expected[i]);
        }
    };
    return { root, settings, calls, targets, files, dailyDocs, doc, event, target, tick, run, guardPath, lock, config,
        queue: () => readReadyQueue(queuePath),
        queuePath, checkCopies, remoteCalls, remoteUploads: async () => (await remoteCalls()).filter((command) => command === 'copyto').length };
}

export const pair = (folder, name) => [`${folder}/${name}.pdf`, `${folder}/감사추적/[감사추적]_${name}.pdf`];
export const providerPair = (suffix = '') => pair('제공인력 계약서', '제공인력_계약서_Synthetic Reviewer_2026-11-24' + suffix);
export const provider = { providerContract: { signerName: 'Synthetic Reviewer', signedDate: '2026-11-24' } };

test('delivers a healthy review while completion is pending, then resumes Drive and deduplicates current copies', async (t) => {
    const f = await fixture(t);
    const before = (await f.remoteCalls()).length;
    assert.equal(await f.tick(), null);
    assert.equal((await f.remoteCalls()).length, before);
    assert.deepEqual(f.calls.map(([route]) => route), ['ready-events']);
    assert.equal((await fs.stat(f.queuePath)).mode & 0o777, 0o600);

    f.event(501, 'a', true, v2, baseTime + 300);
    f.event(502, 'a', true, v2, baseTime + 400);
    f.event(503, 'b', false, v1, baseTime + 500);
    f.targets.set('a', f.target(v1, f.doc('a', [101], provider)));
    f.targets.set('b', f.target(v1, f.doc('b', [101], provider)));
    f.targets.set('c', f.target(v1, f.doc('c', [102])));
    const held = spawn('/usr/bin/flock', [f.lock, 'sh', '-c', 'printf locked; read release'], { stdio: ['pipe', 'pipe', 'ignore'] });
    try {
        await once(held.stdout, 'data');
        assert.equal(await f.tick(baseTime + 750), null);
        assert.equal(f.calls.length, 1);
    } finally {
        held.stdin.end('release\n');
        await once(held, 'close');
    }
    const first = await f.tick(baseTime + 1000);
    assert.equal(first.delivered, 1);
    assert.deepEqual(Object.keys((await f.queue()).pending), ['a']);
    await f.checkCopies(providerPair().slice(0, 1), [[101]]);
    const a = f.doc('a', [101, 102], provider);
    f.targets.set('a', f.target(v2, a));
    await put(join(f.root, 'delay-drive'), '');
    const retry = await f.tick(baseTime + 32_000);
    assert.equal(retry.delivered, 0);
    assert.ok((await f.queue()).pending.a);
    const uploadsAfterFailure = await f.remoteUploads();
    const fetchesAfterFailure = reducer(f.calls, 'file').length;
    assert.equal((await f.tick(baseTime + 94_000)).delivered, 1);
    assert.equal(reducer(f.calls, 'file').length, fetchesAfterFailure);
    assert.equal(await f.remoteUploads(), uploadsAfterFailure + 2);
    assert.deepEqual(Object.keys((await f.queue()).pending), []);
    await f.checkCopies(providerPair(' (2)'), [[101], [102]]);

    f.event(505, 'a', true, v2, baseTime + 95_000);
    f.event(500, 'a', false, v1, baseTime + 350); // committed after earlier IDs
    const stableUploads = await f.remoteUploads();
    const stableDownloads = reducer(f.calls, 'file').length;
    assert.equal((await f.tick(baseTime + 100_000)).delivered, 1);
    assert.equal(await f.remoteUploads(), stableUploads);
    assert.equal(reducer(f.calls, 'file').length, stableDownloads);

    f.event(506, 'a', true, v3, baseTime + 101_000);
    f.targets.set('a', f.target(v3, f.doc('a', [103, 104], provider)));
    assert.equal((await f.tick(baseTime + 102_000)).delivered, 1);
    await f.checkCopies(providerPair(' (3)'), [[103], [104]]);
    await f.checkCopies(providerPair(' (2)'), [[101], [102]]);
    assert.ok(!reducer(f.calls, 'ready-documents').includes('c'));
    assert.ok(!reducer(f.calls, 'file').some((id) => id.startsWith('c-')));
    assert.ok(!f.calls.some(([route]) => route === 'documents' || route === 'runs'));
});

test('publishes available chunk pairs early, then merges only the exact snapshot in first-session order', async (t) => {
    const f = await fixture(t);
    const chunk = (i, snapshotVersion = 2) => ({
        kind: 'service_record', customerName: 'Synthetic Cat', serviceStartDate: '2026-11-24',
        serviceRecordChunk: { caseId: 'case-cat', snapshotVersion, chunkIndex: i, chunkCount: 2, firstSessionIndex: 1 + i * 10 },
    });
    const late = f.doc('cat-late', [103, 104], chunk(1));
    const early = f.doc('cat-early', [101, 102], chunk(0));
    f.targets.set('cat-v1', f.target(v1, f.doc('cat-v1', [105, 106], chunk(0, 1))));
    f.event(501, late.docId, true, null);
    f.targets.set(late.docId, f.target(v2, late));
    assert.equal((await f.tick()).delivered, 0);
    const name = '제공기록지_Synthetic Cat_2026-11-24';
    await f.checkCopies(pair('제공기록지/원본', name + '_2장'), [[103], [104]]);
    await absent(join(f.settings.archiveDir, pair('제공기록지', name)[0]));
    f.targets.set(late.docId, f.target(v2, late, early));
    assert.equal((await f.tick(baseTime + 31_000)).delivered, 1);
    await f.checkCopies(pair('제공기록지', name), [[101, 103], [102, 104]]);
    await f.checkCopies(pair('제공기록지/원본', name + '_1장'), [[101], [102]]);
    assert.equal(reducer(f.calls, 'file').length, 4);
    assert.ok(!reducer(f.calls, 'ready-documents').includes('cat-v1'));
});

async function writePendingMigration(settings) {
    const from = pair('기타', 'Synthetic old name');
    const to = providerPair();
    const bytes = [pdf(107), pdf(108)];
    const move = {
        key: 'doc:moving',
        before: { completed: true, fingerprint: bytes.map(hash).join(':'),
            files: Object.fromEntries(from.map((path, i) => [path, bytes[i].length])) },
        after: { completed: true, fingerprint: bytes.map(hash).join(':'),
            files: Object.fromEntries(to.map((path, i) => [path, bytes[i].length])),
            providerBase: '제공인력_계약서_Synthetic Reviewer_2026-11-24' },
        files: from.map((path, i) => ({ old: path, new: to[i], hash: hash(bytes[i]), bytes: bytes[i].length })),
    };
    const path = join(settings.stateDir, 'provider-contract-migration/journal.json');
    await put(path, JSON.stringify({
        id: '01234567-0123-0123-0123-0123456789ab', version: 1, phase: 'applying', moves: [move],
        archive: settings.originalArchiveDir, remote: settings.rcloneRemote,
        raster: { pending: true, direction: 'forward', publicRoot: settings.archiveDir, stateRoot: settings.stateDir,
            moves: from.map((path, i) => ({ from: path, to: to[i] })) },
    }));
    return path;
}

test('retains the target through missing Drive or an inactive cutover and observes purge or change before publication', async (t) => {
    const f = await fixture(t);
    const active = await json(f.guardPath);
    const a = f.doc('a', [101, 102], provider);
    f.targets.set('a', f.target(v2, a));
    f.event(501, 'a', true, v2);
    const localOnly = { ...f.settings };
    delete localOnly.rcloneRemote;
    const before = (await f.remoteCalls()).length;
    await f.config(localOnly);
    assert.equal((await f.tick()).delivered, 0);
    await f.config();
    await put(f.guardPath, JSON.stringify({ ...active, phase: 'partial' }));
    assert.equal((await f.tick(baseTime + 31_000)).delivered, 0);
    assert.equal((await f.remoteCalls()).length, before);
    await absent(join(f.settings.archiveDir, providerPair()[0]));
    await absent(join(f.settings.originalArchiveDir, providerPair()[0]));
    assert.ok((await f.queue()).pending.a);

    await put(f.guardPath, JSON.stringify(active));
    const migration = await writePendingMigration(f.settings);
    const originalJournal = await fs.readFile(migration);
    assert.equal((await f.tick(baseTime + 93_000)).delivered, 0);
    assert.equal((await f.remoteCalls()).length, before);
    assert.deepEqual(await fs.readFile(migration), originalJournal);
    await absent(join(f.settings.originalArchiveDir, providerPair()[0]));
    await fs.unlink(migration);
    const pending = { status: 'ineligible', sourceUpdatedAt: v2, items: [] };
    let checks = 0;
    f.targets.set('a', () => ++checks === 1 ? f.target(v2, a) : pending);
    const purged = await f.tick(baseTime + 214_000);
    assert.equal(purged.delivered, 0);
    assert.equal(purged.skipped, 1);
    assert.equal(await f.remoteUploads(), 0);
    await absent(join(f.settings.archiveDir, providerPair()[0]));
    assert.deepEqual((await f.queue()).pending, {});

    f.targets.set('a', f.target(v3, f.doc('a', [103, 104], provider)));
    f.event(502, 'a', true, v3, baseTime + 215_000);
    assert.equal((await f.tick(baseTime + 216_000)).delivered, 1);
    await f.checkCopies(providerPair(' (2)'), [[103], [104]]);
    assert.deepEqual(Object.keys((await f.queue()).pending), []);
    assert.ok(!f.calls.some(([route]) => route === 'runs' || route === 'documents'));
    const daily = await f.run(['--raster'], Date.parse('2026-11-24T18:00:00Z'));
    assert.equal(JSON.parse(daily.stdout.trim()).status, 'success');
    await absent(join(f.settings.archiveDir, providerPair()[0]));
    assert.equal(reducer(f.calls, 'runs').length, 1);
});

test('resumes the same pending delivery after Drive is configured', async (t) => {
    const f = await fixture(t);
    const localOnly = { ...f.settings };
    delete localOnly.rcloneRemote;
    await f.config(localOnly);
    f.event(501, 'a', true, v2);
    f.targets.set('a', f.target(v2, f.doc('a', [101, 102], provider)));
    const before = (await f.remoteCalls()).length;
    assert.equal((await f.tick()).delivered, 0);
    assert.equal((await f.remoteCalls()).length, before);
    await absent(join(f.settings.archiveDir, providerPair()[0]));
    await absent(join(f.settings.originalArchiveDir, providerPair()[0]));
    assert.ok((await f.queue()).pending.a);
    await f.config();
    assert.equal((await f.tick(baseTime + 31_000)).delivered, 1);
    await f.checkCopies(providerPair(), [[101], [102]]);
    assert.deepEqual((await f.queue()).pending, {});
    assert.equal(await f.remoteUploads(), 2);
    assert.ok(!f.calls.some(([route]) => route === 'runs' || route === 'documents'));
});

test('keeps the write-ahead ordinal when the audit arrives after a same-name delivery', async (t) => {
    const f = await fixture(t);
    const a = f.doc('a', [101, 102], provider);
    const audit = f.files.get(a.files[1].fileId);
    f.files.delete(a.files[1].fileId);
    f.targets.set('a', f.target(v2, a));
    f.event(501, 'a', true, v2);
    assert.equal((await f.tick()).delivered, 0);
    const state = await json(join(f.settings.stateDir, 'state.json'));
    assert.deepEqual(state.readyOriginals.reservations['doc:a'].paths, providerPair());
    await absent(join(f.settings.archiveDir, providerPair()[0]));
    assert.deepEqual(await fs.readFile(join(f.settings.originalArchiveDir, providerPair()[0])), pdf(101));

    f.event(502, 'b', true, v2, baseTime + 1000);
    f.targets.set('b', f.target(v2, f.doc('b', [103, 104], provider)));
    assert.equal((await f.tick(baseTime + 2000)).delivered, 1);
    await f.checkCopies(providerPair(' (2)'), [[103], [104]]);

    const dailyDoc = f.doc('daily-peer', [105, 106], provider);
    f.dailyDocs.push(dailyDoc);
    await assert.rejects(f.run(['--raster'], Date.parse('2026-11-24T18:00:00Z')), { code: 2 });
    await f.checkCopies(providerPair(' (3)'), [[105], [106]]);
    await absent(join(f.settings.archiveDir, providerPair()[0]));

    f.files.set(a.files[1].fileId, audit);
    assert.equal((await f.tick(baseTime + 31_000)).delivered, 1);
    await f.checkCopies(providerPair(), [[101], [102]]);
    assert.equal(reducer(f.calls, 'file').filter((id) => id === a.files[0].fileId).length, 1);
    assert.deepEqual((await json(join(f.settings.stateDir, 'state.json'))).readyOriginals.reservations, {});
});

test('rechecks authority again after verified placement before acknowledging the queue', async (t) => {
    const f = await fixture(t);
    const old = f.doc('a', [101, 102], provider);
    const current = f.doc('a', [103, 104], provider);
    const remotePair = providerPair().map((path) => join(f.root, 'drive', path));
    f.targets.set('a', () => remotePair.every(existsSync) ? f.target(v3, current) : f.target(v2, old));
    f.event(501, 'a', true, v2);
    assert.equal((await f.tick()).delivered, 0);
    assert.ok((await f.queue()).pending.a);
    await f.checkCopies(providerPair(), [[101], [102]]);
    f.event(502, 'a', true, v3, baseTime + 29_000);
    assert.equal((await f.tick(baseTime + 31_000)).delivered, 1);
    await f.checkCopies(providerPair(' (2)'), [[103], [104]]);
    assert.deepEqual((await f.queue()).pending, {});
});

test('systemd keeps the nightly schedule and gates bounded ready work around 03:00 KST', async () => {
    const read = (name) => fs.readFile(new URL('eformsign-backup' + name, source), 'utf8');
    const [timer, service, daily, dailyService] = await Promise.all([
        read('-ready-events.timer'), read('-ready-events.service'), read('.timer'), read('.service'),
    ]);
    assert.match(timer, /^OnBootSec=30s$/m);
    assert.match(timer, /^OnUnitInactiveSec=30s$/m);
    assert.match(timer, /^AccuracySec=1s$/m);
    assert.match(timer, /^WantedBy=timers.target$/m);
    assert.match(service, /--raster --ready-events$/m);
    assert.match(service, /^TimeoutStartSec=120s$/m);
    assert.match(service, /^TimeoutStopSec=10s$/m);
    assert.match(service, /^KillMode=control-group$/m);
    assert.match(daily, /^OnCalendar=\*-\*-\* 03:00:00 Asia\/Seoul$/m);
    assert.match(dailyService, /--raster$/m);
    for (const [hour, expected] of [['17:55:59', false], ['17:56:00', true], ['18:00:59', true], ['18:01:00', false]]) {
        assert.equal(inDailyHandoff(Date.parse(`2026-11-24T${hour}Z`)), expected);
    }
});
