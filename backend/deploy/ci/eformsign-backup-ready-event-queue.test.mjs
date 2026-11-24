import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { pollReadyEvents } from '../eformsign-backup/ready-events.mjs';

const day = 86_400_000;
const t0 = Date.parse('2026-11-24T01:05:00.000Z');
const revision = (minutes) => new Date(t0 - minutes * 60_000).toISOString();
const event = (id, docId, date, completed = false, sourceUpdatedAt = null) =>
    ({ id, docId, completed, sourceUpdatedAt, createdAt: new Date(date).toISOString() });

test('resumes the fixed cursor, retains stronger duplicates and admits fresh work over at least eight delayed rows', async (t) => {
    const stateDir = await fs.mkdtemp(join(tmpdir(), 'ready-queue-'));
    t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
    const file = join(stateDir, 'ready-events.json');
    const load = async () => JSON.parse(await fs.readFile(file, 'utf8'));
    const cursorQueries = [];
    const deliveries = [];
    let interrupted = true;
    const firstPage = Array.from({ length: 50 }, (_, i) => event(100 + i, 'delayed-' + i, t0 - 1000));
    const secondPage = [event(150, 'delayed-1', t0 - 900, true, revision(2)),
        event(151, 'delayed-1', t0 - 901, false, revision(1)), event(152, 'healthy', t0 - 500)];
    const poll = (now) => pollReadyEvents({
        now, stateDir, binding: {},
        async request(path) {
            const url = new URL(path, 'http://127.0.0.1');
            const after = Number(url.searchParams.get('afterId'));
            cursorQueries.push([after, url.searchParams.get('since'), url.searchParams.get('until')]);
            if (after === 149 && interrupted) throw new Error('synthetic temporary HTTP outage');
            if (after === 0 && cursorQueries.length === 1) return Response.json({ items: firstPage, nextCursor: 149 });
            if (after === 149) return Response.json({ items: secondPage, nextCursor: 152 });
            if (after === 152) return Response.json({ items: [], nextCursor: null });
            return Response.json({ items: [event(99, 'late', t0 - 300)], nextCursor: null });
        },
        async deliver(id, expected) {
            deliveries.push([id, expected.completed, expected.revision]);
            return id === 'healthy' || id === 'late' ? 'delivered' : 'pending';
        },
    });
    const partial = await poll(t0);
    assert.equal(partial.intakeFailed, true);
    assert.equal(partial.pages, 1);
    assert.equal(partial.retried, 8);
    assert.equal((await load()).pending['delayed-49'].tries, 0);
    assert.equal((await load()).window.afterId, 149);
    assert.equal((await load()).watermark, null);
    assert.deepEqual(cursorQueries[0], [0, new Date(t0 - day).toISOString(), new Date(t0).toISOString()]);

    interrupted = false;
    const resumed = await poll(t0 + 31_000);
    assert.equal(resumed.pages, 2);
    assert.equal(resumed.delivered, 1);
    assert.deepEqual(cursorQueries[2], cursorQueries[1]);
    const stored = await load();
    assert.equal(stored.watermark, t0);
    assert.equal(stored.window, null);
    assert.equal(stored.pending['delayed-1'].revision, revision(1));
    assert.equal(stored.pending['delayed-1'].completed, true);
    assert.ok(deliveries.some(([id]) => id === 'healthy'));
    const overlap = await poll(t0 + 32_000);
    assert.equal(overlap.delivered, 1);
    assert.ok(deliveries.some(([id]) => id === 'late'));
    assert.equal((await load()).pending.healthy, undefined);
});

test('expires prolonged pending into the nightly fallback count and preserves a monotonic completed watermark', async (t) => {
    const stateDir = await fs.mkdtemp(join(tmpdir(), 'ready-queue-age-'));
    t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
    const file = join(stateDir, 'ready-events.json');
    let now = t0;
    let requestCount = 0;
    const poll = () => pollReadyEvents({
        now, stateDir, binding: {},
        request() {
            requestCount++;
            const items = requestCount === 1 ? [event(501, 'old', t0 - 1000)]
                : [event(502, 'healthy', now - 1000)];
            return Response.json({ items, nextCursor: null });
        },
        deliver: (id) => id === 'old' ? 'pending' : 'delivered',
    });
    assert.equal((await poll()).retried, 1);
    now += 91 * day;
    const current = await poll();
    assert.equal(current.expired, 1);
    assert.equal(current.delivered, 1);
    const after = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(after.pending, {});
    assert.deepEqual(after.seen.flat().map(([id]) => id), [502]);

    now -= 30_000;
    assert.equal((await poll()).pages, 0);
    assert.equal(requestCount, 2);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).watermark, after.watermark);
});
