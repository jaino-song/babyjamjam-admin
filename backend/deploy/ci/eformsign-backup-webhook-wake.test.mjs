import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { promisify } from 'node:util';

import { pollReadyEvents } from '../eformsign-backup/ready-events.mjs';
import { createReadyWorkQueue } from '../eformsign-backup/ready-wake.mjs';
import { baseTime, fixture, pair, put, v1 } from './eformsign-backup-ready-event.test.mjs';

const exec = promisify(execFile);

async function eventually(read, description) {
    const deadline = performance.now() + 60_000;
    do {
        const value = await read();
        if (value) return value;
        await wait(20);
    } while (performance.now() < deadline);
    assert.fail('Timed out waiting for ' + description);
}

test('the installed daemon turns an in-flight wake into targeted signed-original and raster delivery', async (t) => {
    const f = await fixture(t);
    const child = f.startWake();
    const stopped = once(child, 'close');
    const reports = [];
    const stderr = [];
    const delivered = () => reports.reduce((count, { readyEvents }) => count + (readyEvents?.delivered ?? 0), 0);
    createInterface({ input: child.stdout }).on('line', (line) => reports.push(JSON.parse(line)));
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    try {
        await eventually(() => f.wake.connections === 1, 'notification connection');
        f.wake.send('heartbeat');
        assert.deepEqual(f.calls, []);
        f.wake.send('ready');
        await eventually(() => f.calls.some(([route]) => route === 'ready-events'), 'startup catch-up');
        const alpha = 'First synthetic document';
        const beta = 'Second synthetic document';
        f.targets.set('first', f.target(v1, f.doc('first', [101, 102], { title: alpha })));
        f.targets.set('second', f.target(v1, f.doc('second', [103, 104], { title: beta })));
        f.wake.cutoff = baseTime + 5_000; // The archive clock is behind the database.
        f.event(501, 'first', true, v1, f.wake.cutoff - 1);
        f.wake.afterPage = () => {
            f.wake.afterPage = undefined;
            f.event(502, 'second', true, v1, f.wake.cutoff);
            f.wake.cutoff++;
            f.wake.send('wake');
        };
        f.wake.send('wake');
        await eventually(() => delivered() === 2,
            'both targeted deliveries without a third wake');
        await f.checkCopies(pair('기타', alpha), [[101], [102]]);
        await f.checkCopies(pair('기타', beta), [[103], [104]]);
        assert.deepEqual(f.calls.filter(([route]) => route === 'file').map(([, id]) => id),
            ['first-0-101', 'first-1-102', 'second-0-103', 'second-1-104']);
        assert.ok(f.calls.every(([route]) => ['cutoff', 'ready-events', 'ready-documents', 'file'].includes(route)));

        const before = await f.remoteUploads();
        f.event(503, 'second', true, v1, f.wake.cutoff);
        f.wake.cutoff++;
        f.wake.send('wake');
        await eventually(() => delivered() === 3,
            'duplicate processing');
        assert.equal(await f.remoteUploads(), before);
        assert.equal(f.calls.filter(([route]) => route === 'file').length, 4);
        await exec('/usr/bin/flock', ['-n', f.lock, '/usr/bin/true']);
        assert.equal(f.wake.connections, 1);
    } finally {
        child.kill('SIGTERM');
        const [code, signal] = await stopped;
        assert.deepEqual([code, signal, stderr], [0, null, []]);
    }
});

function fakeClock(start) {
    let now = start;
    const timers = new Map();
    return {
        now: () => now,
        setTimer(callback, delay) {
            const handle = Symbol();
            timers.set(handle, { at: now + delay, callback });
            return handle;
        },
        clearTimer: (handle) => timers.delete(handle),
        get pending() { return timers.size; },
        async advanceTo(end) {
            for (let step = 0; step < 100; step++) {
                const next = [...timers].sort(([, a], [, b]) => a.at - b.at)[0];
                if (!next || next[1].at > end) {
                    now = end;
                    return;
                }
                const [handle, { at, callback }] = next;
                timers.delete(handle);
                now = at;
                await callback();
            }
            assert.fail('excessive ready work timers');
        },
    };
}

test('continues pages and the per-run cap, retries due targets locally, and stays quiet while idle', async (t) => {
    const stateDir = await mkdtemp(join(tmpdir(), 'wake-queue-'));
    t.after(() => rm(stateDir, { recursive: true, force: true }));
    const clock = fakeClock(baseTime);
    const targets = Array.from({ length: 101 }, (_, index) => ({
        id: index + 1, docId: 'fixture-' + index, sourceUpdatedAt: v1, completed: true,
        createdAt: new Date(baseTime - 1).toISOString(),
    }));
    const calls = [];
    const batches = [];
    const queue = createReadyWorkQueue({
        ...clock,
        async work(refresh) {
            const report = await pollReadyEvents({
                stateDir, binding: {}, now: clock.now(), resumeOnly: !refresh,
                refreshUntil: refresh ? () => baseTime : undefined,
                async request(path) {
                    const { searchParams } = new URL(path, 'http://127.0.0.1');
                    const afterId = Number(searchParams.get('afterId'));
                    calls.push(afterId);
                    const items = targets.filter(({ id }) => id > afterId).slice(0, 50);
                    return Response.json({ items, nextCursor: items.length === 50 ? items.at(-1).id : null });
                },
                deliver(docId, expected) {
                    return docId === 'fixture-0' && expected.tries === 0 ? 'pending' : 'delivered';
                },
            });
            batches.push(report);
            return report;
        },
    });
    t.after(() => queue.stop());
    queue.wake();
    await clock.advanceTo(baseTime + 29_999);
    assert.deepEqual(calls, [0, 50, 100]);
    assert.ok(batches.every(({ delivered, retried }) => delivered + retried <= 8));
    assert.equal(batches.reduce((total, { delivered }) => total + delivered, 0), 100);
    assert.equal(batches.at(-1).pending, 1);
    await clock.advanceTo(baseTime + 30_000);
    assert.equal(batches.at(-1).delivered, 1);
    assert.deepEqual(calls, [0, 50, 100]);
    const settled = batches.length;
    await clock.advanceTo(baseTime + 120_000);
    assert.equal(batches.length, settled);
    assert.equal(clock.pending, 0);

    queue.wake();
    await clock.advanceTo(baseTime + 120_000);
    assert.deepEqual(calls, [0, 50, 100, 0, 50]);
    await clock.advanceTo(baseTime + 120_100);
    assert.deepEqual(calls, [0, 50, 100, 0, 50, 100]);
    assert.equal(batches.at(-1).events, 0);
});

test('defers for the daily owner and backs off only while work is outstanding', async (t) => {
    const handoff = Date.parse('2026-11-24T17:56:00Z');
    const release = Date.parse('2026-11-24T18:01:00Z');
    const clock = fakeClock(handoff);
    const attempts = [];
    const queue = createReadyWorkQueue({
        ...clock,
        async work(refresh) {
            attempts.push([clock.now(), refresh]);
            if (attempts.length === 1) throw new Error('fixture flock contention');
            return { startedWindow: true, continueIntake: false, pendingAt: null, intakeFailed: false };
        },
    });
    t.after(() => queue.stop());
    queue.wake();
    await clock.advanceTo(release - 1);
    assert.deepEqual(attempts, []);
    await clock.advanceTo(release + 30_000);
    assert.deepEqual(attempts, [[release, true], [release + 1_000, true]]);
    assert.equal(clock.pending, 0);
});

test('expires an aged retry without rescanning the feed or requesting its target', async (t) => {
    const stateDir = await mkdtemp(join(tmpdir(), 'wake-expiry-'));
    t.after(() => rm(stateDir, { recursive: true, force: true }));
    await put(join(stateDir, 'ready-events.json'), JSON.stringify({
        version: 1, binding: {}, watermark: baseTime, window: null, newest: baseTime, seen: [],
        pending: { stale: { revision: v1, completed: true, at: baseTime, next: baseTime + 30_000, tries: 1 } },
    }));
    let requests = 0;
    const report = await pollReadyEvents({
        stateDir, binding: {}, now: baseTime + 91 * 86_400_000, resumeOnly: true,
        request() { requests++; },
        deliver() { requests++; },
    });
    assert.equal(requests, 0);
    assert.equal(report.expired, 1);
    assert.equal(report.pendingAt, null);
});
