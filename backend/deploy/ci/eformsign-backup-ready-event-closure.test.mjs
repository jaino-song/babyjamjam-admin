import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import test from 'node:test';

import {
    baseTime, fixture, hash, json, pair, pdf, provider, providerPair, put, readReadyQueue, v1, v2,
} from './eformsign-backup-ready-event.test.mjs';
import { pollReadyEvents } from '../eformsign-backup/ready-events.mjs';
import { identity, stat } from '../eformsign-backup/raster-mirror-io.mjs';
import { readyIdentity, readyScratch } from '../eformsign-backup/ready-originals.mjs';

const lstat = (path) => fs.lstat(path, { bigint: true });
const identityAt = async (path) => identity(await lstat(path));
const recordPath = (fixture) => join(fixture.settings.stateDir, 'state.json');
const authorityHash = (value) => hash(JSON.stringify(value));

async function fileSnapshot(path) {
    const info = await lstat(path);
    return { bytes: await fs.readFile(path), id: identity(info), modified: info.mtimeNs, changed: info.ctimeNs };
}

test('ready closure F1 retains historical pair', async (t) => {
    const f = await fixture(t);
    const old = f.doc('a', [101, 102], provider);
    const oldPaths = providerPair();
    const newPaths = providerPair(' (2)');
    const raw = (path) => join(f.settings.originalArchiveDir, path);
    f.targets.set('a', f.target(v1, old));
    f.event(501, 'a', true, v1);
    assert.equal((await f.tick()).delivered, 1);

    const key = 'doc:a';
    const state = await json(recordPath(f));
    const before = state.units[key];
    const expected = old.files.map(({ sha256, byteSize }) => ({ sha256, size: byteSize }));
    const historic = await Promise.all(oldPaths.map((path) => fileSnapshot(raw(path))));
    assert.deepEqual(historic.map(({ bytes }) => bytes), [pdf(101), pdf(102)]);
    assert.deepEqual(Object.keys(before.files), oldPaths);
    state.readyOriginals.reservations[key] = {
        before, paths: oldPaths, expected,
        identity: readyIdentity({ key, completed: true, sourceRevision: v1, inputs: old.files }),
        prior: expected.map((file, i) => ({ ...file, id: historic[i].id })),
        placed: [null, null],
    };
    await put(recordPath(f), JSON.stringify(state));

    const changed = f.doc('a', [103, 104], provider);
    f.targets.set('a', f.target(v2, changed));
    f.event(502, 'a', true, v2, baseTime + 1000);
    assert.equal((await f.tick(baseTime + 2000)).delivered, 1);
    const assertPairs = async () => {
        const current = await json(recordPath(f));
        assert.deepEqual(current.units[`${key}@${before.fingerprint}`], before);
        assert.deepEqual(Object.keys(current.units[key].files), newPaths);
        assert.deepEqual(current.readyOriginals.reservations, {});
        assert.deepEqual(await Promise.all(oldPaths.map((path) => fileSnapshot(raw(path)))), historic);
        assert.deepEqual(await Promise.all(newPaths.map((path) => fs.readFile(raw(path)))), [pdf(103), pdf(104)]);
        for (const i of [0, 1]) {
            const names = await fs.readdir(dirname(raw(oldPaths[i])));
            assert.deepEqual(names.filter((name) => name.endsWith('.pdf')).sort(),
                [basename(oldPaths[i]), basename(newPaths[i])].sort());
        }
    };
    await assertPairs();
    await f.checkCopies(newPaths, [[103], [104]]);

    const delivered = await Promise.all(newPaths.map((path) => fileSnapshot(raw(path))));
    const uploads = await f.remoteUploads();
    f.event(503, 'a', true, v2, baseTime + 3000);
    assert.equal((await f.tick(baseTime + 4000)).delivered, 1);
    await assertPairs();
    assert.deepEqual(await Promise.all(newPaths.map((path) => fileSnapshot(raw(path)))), delivered);
    assert.equal(await f.remoteUploads(), uploads);
});

test('ready closure F2 releases obsolete intent', async (t) => {
    const f = await fixture(t);
    const withdrawn = f.target(v1, f.doc('withdrawn', [101, 102], provider));
    const withdrawnPaths = providerPair();
    f.targets.set('withdrawn', withdrawn);
    f.event(501, 'withdrawn', true, v1);
    assert.equal((await f.tick()).delivered, 1);

    const manifestPath = join(f.settings.stateDir, 'raster-mirror', 'manifest.json');
    const manifest = await json(manifestPath);
    const [path] = withdrawnPaths;
    const record = manifest.records.find(([name]) => name === path);
    const { raw, raster, mtimeMs, local, remote, history } = record[1];
    const [captured] = history;
    assert.equal(captured.local, null);
    assert.equal(captured.remote, null);
    assert.equal(manifest.intent, null);
    // Use the real captured and observed versions to represent an issued publish
    // whose local payload transferred and whose remote endpoint was verified.
    const directory = '.raster-mirror-' + randomUUID();
    const parent = join(f.settings.archiveDir, dirname(path));
    const stagePath = join(parent, directory);
    await fs.mkdir(stagePath, { mode: 0o700 });
    record[1] = { ...captured, path, retired: null, history: [captured] };
    manifest.intent = {
        kind: 'publish', path, raw, mtimeMs, target: raster,
        before: { local: captured.local, remote: captured.remote },
        remoteChain: remote.chain, remoteStarted: true, remoteAfter: remote,
        stage: {
            directory, ready: true, fileId: local.id,
            directoryId: await identityAt(stagePath),
            parentId: await identityAt(parent),
        },
        ready: { owner: authorityHash('withdrawn'), authority: authorityHash(withdrawn) },
    };
    await put(manifestPath, JSON.stringify(manifest));
    const state = await json(recordPath(f));
    state.units['doc:withdrawn'].readyPending = true;
    await put(recordPath(f), JSON.stringify(state));

    const paths = [f.settings.originalArchiveDir, f.settings.archiveDir, join(f.root, 'drive')]
        .flatMap((root) => withdrawnPaths.map((name) => join(root, name)));
    const snapshots = await Promise.all(paths.map(fileSnapshot));
    const uploads = await f.remoteUploads();
    f.calls.length = 0;
    f.targets.set('withdrawn', { status: 'ineligible', sourceUpdatedAt: v2, items: [] });
    f.targets.set('next', f.target(v2, f.doc('next', [103, 104], { title: 'Unrelated ready copy' })));
    f.event(502, 'withdrawn', true, v2, baseTime + 1000);
    f.event(503, 'next', true, v2, baseTime + 1000);

    const result = await f.tick(baseTime + 2000);
    assert.deepEqual([result.skipped, result.delivered, result.pending], [1, 1, 0]);
    const settled = await json(manifestPath);
    assert.equal(settled.intent, null);
    assert.equal(await stat(stagePath), null);
    const observed = settled.records.find(([name]) => name === path)[1];
    assert.deepEqual([observed.local, observed.remote], [local, remote]);
    assert.deepEqual(await Promise.all(paths.map(fileSnapshot)), snapshots);
    assert.deepEqual(f.calls.filter(([route]) => route === 'file').map(([, name]) => name), ['next-0-103', 'next-1-104']);
    assert.equal(await f.remoteUploads() - uploads, 2);
    await f.checkCopies(pair('기타', 'Unrelated ready copy'), [[103], [104]]);
});

function countQueueOperations(t, stateDir) {
    const counts = { pages: 0, checkpointAndJournal: 0 };
    const metadata = new Set(['ready-events.json', '.ready-events-transaction.json', '.ready-events.next']);
    const category = (paths) => {
        const files = paths.map((path) => relative(stateDir, path));
        if (files.some((file) => file.startsWith('.ready-events-pages/'))) return 'pages';
        if (files.some((file) => metadata.has(file))) return 'checkpointAndJournal';
    };
    for (const method of ['lstat', 'open', 'readdir', 'readFile', 'writeFile', 'rename', 'unlink', 'rm']) {
        const call = fs[method];
        t.mock.method(fs, method, (...args) => {
            const key = category(args.slice(0, method === 'rename' ? 2 : 1));
            if (!key) return call(...args);
            counts[key]++;
            const result = call(...args);
            if (method !== 'open') return result;
            return result.then((handle) => {
                for (const operation of ['read', 'readFile', 'write', 'writeFile']) {
                    const perform = handle[operation].bind(handle);
                    t.mock.method(handle, operation, (...parameters) => {
                        counts[key]++;
                        return perform(...parameters);
                    });
                }
                return handle;
            });
        });
    }
    syncBuiltinESMExports();
    return { counts, finish() { t.mock.restoreAll(); syncBuiltinESMExports(); } };
}

test('ready closure F3 bounds quiet queue work', async (t) => {
    const stateDir = await fs.mkdtemp(join(tmpdir(), 'ready-closure-queue-'));
    t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
    const checkpoint = join(stateDir, 'ready-events.json');
    const pending = Object.fromEntries(Array.from({ length: 1024 }, (_, i) => [
        `later-${i}`, { revision: v1, completed: true, at: baseTime - 1000, next: baseTime + 120_000, tries: 1 },
    ]));
    await put(checkpoint, JSON.stringify({
        version: 1, binding: {}, watermark: baseTime, window: null, newest: baseTime - 1000, pending, seen: [],
    }));
    let deliveries = 0;
    let requests = 0;
    const poll = (now) => pollReadyEvents({
        now, stateDir, binding: {},
        request() { requests++; return Response.json({ items: [], nextCursor: null }); },
        deliver() { deliveries++; return 'delivered'; },
    });
    assert.equal((await poll(baseTime)).pending, 1024);
    const indexed = await json(checkpoint);
    assert.equal(indexed.version, 2);
    assert.ok(indexed.pendingIndex?.children);
    assert.deepEqual(indexed.pending, {});

    const measurement = countQueueOperations(t, stateDir);
    let result;
    try { result = await poll(baseTime + 30_000); }
    finally { measurement.finish(); }
    const { pages, checkpointAndJournal } = measurement.counts;
    assert.equal(pages, 0);
    assert.ok(checkpointAndJournal > 0 && checkpointAndJournal <= 16, String(checkpointAndJournal));
    assert.equal(requests, 1);
    assert.equal(deliveries, 0);
    assert.deepEqual([result.events, result.expired, result.pending], [0, 0, 1024]);
    assert.deepEqual((await readReadyQueue(checkpoint)).pending, pending);
    t.diagnostic(`${pages} page operations, ${checkpointAndJournal} checkpoint/journal operations, ${result.pending} pending`);
});

test('ready closure F4 reclaims only owned scratch', async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), 'ready-closure-scratch-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const binding = {
        originalRoot: join(root, 'originals'), stateRoot: join(root, 'state'), lockRoot: join(root, 'lock'), uid: process.getuid(),
    };
    await Promise.all([binding.originalRoot, binding.stateRoot, binding.lockRoot].map((path) => fs.mkdir(path, { mode: 0o700 })));
    const final = join(binding.originalRoot, 'ready.pdf');
    const sibling = join(binding.originalRoot, 'kept.pdf');
    await put(sibling, pdf(101));
    const siblingBefore = await fileSnapshot(sibling);
    const journal = join(binding.stateRoot, 'ready-original-scratch.json');
    for (const width of [102, 103]) {
        const scratch = readyScratch(binding);
        await scratch.recover();
        let owned;
        await scratch.stage(final, false, async (payload, qpdf) => {
            const receipt = await json(journal);
            assert.equal(receipt.version, 1);
            assert.deepEqual(receipt.binding, binding);
            assert.equal((await lstat(journal)).mode & 0o777n, 0o600n);
            assert.equal(receipt.stages.length, 1);
            const [stage] = receipt.stages;
            assert.equal(stage.kind, 'original');
            assert.equal(stage.parent, binding.originalRoot);
            assert.deepEqual(stage.parentId, await identityAt(stage.parent));
            owned = join(stage.parent, stage.name);
            const info = await lstat(owned);
            assert.deepEqual(stage.id, identity(info));
            assert.equal(info.mode & 0o777n, 0o700n);
            assert.equal(info.uid, BigInt(binding.uid));
            assert.equal(qpdf, undefined);
            assert.equal(payload, join(dirname(payload), 'payload.tmp'));
            assert.equal(await fs.realpath(dirname(payload)), owned);
            assert.deepEqual((await fs.readdir(binding.originalRoot)).sort(), (await stat(final)
                ? [stage.name, 'kept.pdf', 'ready.pdf'] : [stage.name, 'kept.pdf']).sort());
            await fs.writeFile(payload, pdf(width), { flag: 'wx', mode: 0o600 });
            assert.equal((await lstat(payload)).mode & 0o777n, 0o600n);
            assert.deepEqual(await fs.readFile(join(owned, 'payload.tmp')), pdf(width));
            await fs.rename(payload, final);
        });
        assert.equal(await stat(owned), null);
        assert.equal(await stat(journal), null);
        assert.deepEqual(await fs.readFile(final), pdf(width));
        assert.deepEqual(await fileSnapshot(sibling), siblingBefore);
    }
});
