import * as fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { checkPrivate, readJson, stat, syncDir } from './raster-mirror-io.mjs';

const minute = 60_000;
const day = 24 * 60 * minute;
const retention = 90 * day;
const overlap = 5 * minute;
const pageSize = 50;
const prefix = '/internal/eformsign-backup/';
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sameId = (value) => typeof value === 'string' && value.length <= 255 && /^[^\s\p{Cc}]+$/u.test(value);
const epoch = (value) => value === null ? -Infinity : Date.parse(value);

export function inDailyHandoff(now) {
    const kst = new Date(now + 9 * 60 * minute);
    const time = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    return time >= 176 && time < 181;
}

export async function readyJson(request, path) {
    const response = await request(prefix + path);
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error('ready_metadata_unavailable');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) throw new Error('ready_metadata_limit');
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

function readPage(body, window) {
    let last = window.afterId;
    if (!Array.isArray(body?.items) || body.items.length > pageSize) throw new Error('ready_page_invalid');
    for (const row of body.items) {
        const created = Date.parse(row?.createdAt);
        if (!Number.isSafeInteger(row?.id) || row.id <= last || !sameId(row.docId)
            || typeof row.completed !== 'boolean' || !(row.sourceUpdatedAt === null || timestamp(row.sourceUpdatedAt))
            || !(created >= window.since && created < window.until)) throw new Error('ready_page_invalid');
        last = row.id;
    }
    if (body.nextCursor !== null && (!Number.isSafeInteger(body.nextCursor)
        || body.nextCursor < last || body.nextCursor <= window.afterId)) throw new Error('ready_page_invalid');
    return body;
}

function enqueue(pending, event, now, fresh) {
    const existing = Object.hasOwn(pending, event.docId) ? pending[event.docId] : null;
    const at = Date.parse(event.createdAt);
    if (!existing) {
        Object.defineProperty(pending, event.docId, {
            value: { revision: event.sourceUpdatedAt, completed: event.completed, at, next: now, tries: 0 },
            writable: true, enumerable: true, configurable: true,
        });
        fresh.add(event.docId);
        return;
    }
    const strongerRevision = epoch(event.sourceUpdatedAt) > epoch(existing.revision);
    if (strongerRevision || (event.completed && !existing.completed)) {
        existing.next = now;
        existing.tries = 0;
    }
    if (strongerRevision) existing.revision = event.sourceUpdatedAt;
    existing.completed ||= event.completed;
    existing.at = Math.max(existing.at, at);
}

function seenPages(seen) {
    const pages = [];
    for (const row of seen) {
        if (!pages.length || pages.at(-1).length === pageSize) pages.push([]);
        pages.at(-1).push(row);
    }
    return pages;
}

function newWindow(state, now) {
    if (state.window) return state.window;
    if (state.watermark !== null && now <= state.watermark) return null;
    const since = state.watermark === null ? now - day : Math.max(now - retention, state.watermark - overlap);
    return { since, until: now, afterId: 0 };
}

async function saveQueue(stateDir, path, queue) {
    const scratch = resolve(stateDir, '.ready-events.next');
    const previous = await stat(scratch);
    if (previous) {
        checkPrivate(previous, 0o600);
        if (!previous.isFile() || previous.nlink !== 1n) throw new Error('ready_state_scratch');
        await fs.unlink(scratch);
    }
    const out = await fs.open(scratch, 'wx', 0o600);
    try {
        await out.writeFile(JSON.stringify(queue));
        await out.sync();
    } finally { await out.close(); }
    await fs.rename(scratch, path);
    await syncDir(stateDir);
}

export async function pollReadyEvents({ stateDir, binding, request, deliver, now = Date.now(), canStart = () => true }) {
    const path = resolve(stateDir, 'ready-events.json');
    // Fail closed on an absent state root. Ready mode never creates or repairs an archive.
    const stored = await readJson(path, { sync: true, maxBytes: Infinity });
    if (stored && (stored.version !== 1 || !isDeepStrictEqual(stored.binding, binding))) throw new Error('ready_state_binding');
    const state = stored ?? { version: 1, binding, watermark: null, window: null, newest: 0, pending: {}, seen: [] };
    const report = { pages: 0, events: 0, delivered: 0, skipped: 0, retried: 0, expired: 0, pending: 0, intakeFailed: false };
    const save = () => saveQueue(stateDir, path, state);
    const fresh = new Set();
    const window = newWindow(state, now);
    if (window) {
        if (!state.window) {
            state.window = window;
            await save();
        }
        const seen = new Map(state.seen.flat());
        for (let page = 0; page < 2 && canStart(); page++) {
            const query = new URLSearchParams({
                since: new Date(window.since).toISOString(), until: new Date(window.until).toISOString(),
                afterId: String(window.afterId), limit: String(pageSize),
            });
            let response;
            try { response = readPage(await readyJson(request, 'ready-events?' + query), window); }
            catch { report.intakeFailed = true; break; }
            const { items, nextCursor } = response;
            for (const event of items) {
                if (seen.has(event.id)) continue;
                const at = Date.parse(event.createdAt);
                state.newest = Math.max(state.newest, at);
                enqueue(state.pending, event, now, fresh);
                if (at >= window.until - overlap) seen.set(event.id, at);
                report.events++;
            }
            if (nextCursor === null) {
                state.watermark = window.until;
                state.window = null;
            } else {
                window.afterId = nextCursor;
                state.window = window;
            }
            state.seen = seenPages([...seen].filter(([, at]) => at >= (state.watermark ?? window.until) - overlap));
            await save();
            report.pages++;
            if (nextCursor === null) break;
        }
    }

    // A prolonged quiet period also ages out targets after the ledger replay horizon.
    const oldest = Math.max(state.newest, state.watermark ?? 0) - retention;
    for (const [id, target] of Object.entries(state.pending)) {
        if (target.at >= oldest) continue;
        delete state.pending[id];
        report.expired++;
    }
    if (report.expired) await save();

    const due = Object.entries(state.pending).filter(([, target]) => target.next <= now)
        .sort(([, a], [, b]) => a.next - b.next || a.at - b.at);
    const firstFresh = due.findIndex(([id]) => fresh.has(id));
    const firstUntried = firstFresh < 0 ? due.findIndex(([, target]) => target.tries === 0) : firstFresh;
    if (firstUntried > 0) due.unshift(...due.splice(firstUntried, 1));
    for (const [docId, expected] of due.slice(0, 8)) {
        if (!canStart()) break;
        let result;
        try { result = await deliver(docId, expected); } catch { result = 'pending'; }
        if (result === 'delivered' || result === 'ineligible') {
            delete state.pending[docId];
            report[result === 'delivered' ? 'delivered' : 'skipped']++;
        } else {
            expected.next = now + Math.min(30 * minute, 30_000 * 2 ** expected.tries);
            expected.tries = Math.min(expected.tries + 1, 6);
            report.retried++;
        }
        await save();
    }
    report.pending = Object.keys(state.pending).length;
    return report;
}

export async function readyTarget(request, docId, expected) {
    const result = await readyJson(request, 'ready-documents?' + new URLSearchParams({ docId }));
    if (result?.status === 'ineligible' && Array.isArray(result.items) && result.items.length === 0) return 'ineligible';
    if (result?.status !== 'ready' || !timestamp(result.sourceUpdatedAt) || !Array.isArray(result.items)
        || result.items.length > 200 || epoch(result.sourceUpdatedAt) < epoch(expected.revision)) return 'pending';
    const seed = result.items.find((doc) => doc.docId === docId);
    if (!seed || (expected.completed && seed.completed !== true)) return 'pending';
    const group = seed.serviceRecordChunk;
    const ids = new Set();
    for (const doc of result.items) {
        if (!sameId(doc.docId) || ids.has(doc.docId) || !timestamp(doc.createdAt)
            || !['contract', 'service_record', 'other'].includes(doc.kind)
            || typeof doc.completed !== 'boolean' || !Array.isArray(doc.files)) return 'pending';
        ids.add(doc.docId);
        if (doc.docId !== docId && (!group || doc.serviceRecordChunk?.caseId !== group.caseId
            || doc.serviceRecordChunk?.snapshotVersion !== group.snapshotVersion)) return 'pending';
        const chunk = doc.serviceRecordChunk;
        if (chunk && (doc.kind !== 'service_record' || !sameId(chunk.caseId) || !Number.isInteger(chunk.snapshotVersion)
            || !Number.isInteger(chunk.chunkCount) || chunk.chunkCount < 1 || !Number.isInteger(chunk.chunkIndex)
            || chunk.chunkIndex < 0 || chunk.chunkIndex >= chunk.chunkCount || !Number.isInteger(chunk.firstSessionIndex))) return 'pending';
        const types = new Set();
        for (const file of doc.files) {
            if (!['document', 'audit_trail'].includes(file.fileType) || types.has(file.fileType) || !sameId(file.fileId)
                || !/^[a-f0-9]{64}$/i.test(file.sha256) || !Number.isInteger(file.byteSize) || file.byteSize <= 0) return 'pending';
            types.add(file.fileType);
        }
        if (!types.has('document') || (doc.completed && !types.has('audit_trail'))) return 'pending';
        doc.files.sort((a, b) => a.fileType < b.fileType ? -1 : Number(a.fileType > b.fileType));
    }
    result.items.sort((a, b) => a.docId < b.docId ? -1 : Number(a.docId > b.docId));
    return result;
}
