import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { checkDirectory, checkPrivate, MAX_JSON, mirrorErrorCode, readJson, stat, syncDir } from './raster-mirror-io.mjs';

const minute = 60_000;
const day = 24 * 60 * minute;
const kstOffset = 9 * 60 * minute;
const handoffStart = 176 * minute;
const handoffEnd = 181 * minute;
const retention = 90 * day;
const overlap = 5 * minute;
const pageSize = 50;
const intakePages = 2;
const cleanupPages = intakePages + 1;
const queuePageSize = 64;
const deliveryLimit = 8;
const journalLimit = 64 * 1024 * 1024;
const prefix = '/internal/eformsign-backup/';
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sameId = (value) => typeof value === 'string' && value.length <= 255 && /^[^\s\p{Cc}]+$/u.test(value);
const epoch = (value) => value === null ? -Infinity : Date.parse(value);

const kstTimeOfDay = (now) => ((now + kstOffset) % day + day) % day;

export function dailyHandoffEnd(now) {
    const time = kstTimeOfDay(now);
    return time >= handoffStart && time < handoffEnd ? now + handoffEnd - time : null;
}

export function readyBatchBudget(now) {
    const time = kstTimeOfDay(now);
    if (time >= handoffStart && time < handoffEnd) return 0;
    return (handoffStart - time + day) % day;
}

export const inDailyHandoff = (now) => dailyHandoffEnd(now) !== null;

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

async function enqueue(pending, event, now, fresh) {
    const existing = await pending.get(event.docId);
    const at = Date.parse(event.createdAt);
    if (!existing) {
        await pending.set(event.docId, {
            revision: event.sourceUpdatedAt, completed: event.completed, at, next: now, tries: 0,
        });
        fresh.add(event.docId);
        return;
    }
    const target = { ...existing, at: Math.max(existing.at, at) };
    const strongerRevision = epoch(event.sourceUpdatedAt) > epoch(existing.revision);
    if (strongerRevision || (event.completed && !existing.completed)) {
        target.next = now;
        target.tries = 0;
    }
    if (strongerRevision) target.revision = event.sourceUpdatedAt;
    target.completed ||= event.completed;
    await pending.set(event.docId, target);
}

function seenPages(seen) {
    const pages = [];
    for (const row of seen) {
        if (!pages.length || pages.at(-1).length === pageSize) pages.push([]);
        pages.at(-1).push(row);
    }
    return pages;
}

function newWindow(watermark, until, refresh) {
    if (!refresh && watermark !== null && until <= watermark) return null;
    const since = watermark === null ? until - day : Math.max(until - retention, Math.min(watermark, until) - overlap);
    return { since, until, afterId: 0 };
}

async function saveQueue(path, value, { syncParent = true, maxBytes = MAX_JSON } = {}) {
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > maxBytes) throw new Error('ready_state_size');
    const parent = dirname(path);
    const scratch = resolve(parent, '.ready-events.next');
    const previous = await stat(scratch);
    if (previous) {
        checkPrivate(previous, 0o600);
        if (!previous.isFile() || previous.nlink !== 1n) throw new Error('ready_state_scratch');
        await fs.unlink(scratch);
    }
    const out = await fs.open(scratch, 'wx', 0o600);
    try {
        await out.writeFile(bytes);
        await out.sync();
    } finally { await out.close(); }
    await fs.rename(scratch, path);
    if (syncParent) await syncDir(parent);
}

const digest = (key) => createHash('sha256').update(String(key)).digest('hex');
const emptyPage = () => ({ rows: [] });
const makeRow = (key, value) => [digest(key), key, value];
const compareRank = ([a, b, key], [x, y, other]) => a - x || b - y || (key < other ? -1 : Number(key > other));
const oldestRank = ([hash, , row]) => [row.at, 0, hash];
const dueRank = ([hash, , row]) => [row.next, row.at, hash];
const pendingRanks = {
    oldest: oldestRank,
    due: dueRank,
    untried: (entry) => entry[2].tries === 0 ? dueRank(entry) : null,
};

// Leaf pages split by hash prefix. Child summaries let an idle tick check due
// and expiry times in the checkpoint without reading any queue pages.
class QueueIndex {
    constructor(files, name, indexedRoot, inline, ranks) {
        this.files = files;
        this.name = name;
        this.root = indexedRoot ?? { rows: inline.map(([key, value]) => makeRow(key, value)) };
        this.ranks = ranks;
    }

    summary(page) {
        const rows = page.rows;
        const children = rows ? null : Object.values(page.children);
        const heads = {};
        for (const [name, rank] of Object.entries(this.ranks)) {
            const choices = rows ? rows.map(rank) : children.map((child) => child.heads[name]);
            for (const choice of choices) {
                if (choice && (!heads[name] || compareRank(choice, heads[name]) < 0)) heads[name] = choice;
            }
        }
        return { heads, count: rows ? rows.length : children.reduce((sum, child) => sum + child.count, 0) };
    }

    async leaf(hash) {
        let page = this.root;
        let prefix = '';
        while (page.children) {
            const digit = hash[prefix.length];
            if (!Object.hasOwn(page.children, digit)) return null;
            prefix += digit;
            page = await this.files.read(this.name + '-' + prefix);
        }
        return page.rows.find(([rowHash]) => rowHash === hash) ?? null;
    }

    async get(key) {
        const entry = await this.leaf(digest(key));
        if (entry && entry[1] !== key) throw new Error('ready_queue_key_collision');
        return entry?.[2];
    }

    async first(order, through) {
        const rank = this.summary(this.root).heads[order];
        if (!rank || rank[0] > through) return null;
        const entry = await this.leaf(rank[2]);
        if (!entry) throw new Error('ready_queue_index');
        return [entry[1], entry[2]];
    }

    async set(key, value) {
        this.root = await this.update(this.root, '', makeRow(key, value));
    }

    async update(page, prefix, entry) {
        const [hash, key, value] = entry;
        if (page.rows) {
            const rows = [...page.rows];
            const index = rows.findIndex(([rowHash]) => rowHash === hash);
            if (index >= 0 && rows[index][1] !== key) throw new Error('ready_queue_key_collision');
            if (value === null) {
                if (index >= 0) rows.splice(index, 1);
            } else if (index >= 0) rows[index] = entry;
            else rows.push(entry);
            return this.split(prefix, rows);
        }

        const digit = hash[prefix.length];
        const name = this.name + '-' + prefix + digit;
        const children = { ...page.children };
        const child = Object.hasOwn(children, digit) ? await this.files.read(name) : emptyPage();
        const updated = await this.update(child, prefix + digit, entry);
        const summary = this.summary(updated);
        if (summary.count) children[digit] = summary;
        else delete children[digit];
        this.files.edits.set(name, summary.count ? updated : null);
        return Object.keys(children).length ? { children } : emptyPage();
    }

    split(prefix, rows) {
        if (rows.length <= queuePageSize) return { rows };
        if (prefix.length >= 64) throw new Error('ready_queue_key_collision');
        const groups = new Map();
        for (const row of rows) {
            const digit = row[0][prefix.length];
            if (!groups.has(digit)) groups.set(digit, []);
            groups.get(digit).push(row);
        }
        const children = {};
        for (const [digit, group] of groups) {
            const child = this.split(prefix + digit, group);
            this.files.edits.set(this.name + '-' + prefix + digit, child);
            children[digit] = this.summary(child);
        }
        return { children };
    }

    inline() {
        return this.root.rows?.map(([, key, value]) => [key, value]) ?? [];
    }
}

class QueueFiles {
    constructor(stateDir) {
        this.stateDir = stateDir;
        this.path = resolve(stateDir, 'ready-events.json');
        this.journal = resolve(stateDir, '.ready-events-transaction.json');
        this.pages = resolve(stateDir, '.ready-events-pages');
        this.edits = new Map();
        this.cache = new Map();
    }

    async checkPages(create = false) {
        let info = await stat(this.pages);
        if (!info && create) {
            await fs.mkdir(this.pages, { mode: 0o700 });
            await syncDir(this.stateDir);
            info = await stat(this.pages);
        }
        checkDirectory(info);
        checkPrivate(info, 0o700);
    }

    async read(name) {
        if (this.edits.has(name)) return this.edits.get(name);
        if (!this.cache.has(name)) {
            await this.checkPages();
            const page = await readJson(resolve(this.pages, name));
            if (!page) throw new Error('ready_queue_page_missing');
            this.cache.set(name, page);
        }
        return this.cache.get(name);
    }

    async writePages(edits) {
        await this.checkPages(true);
        for (const [name, page] of edits) {
            if (!/^(pending|seen)-[a-f0-9]{1,64}$/.test(name)) throw new Error('ready_queue_page_name');
            const path = resolve(this.pages, name);
            if (page) await saveQueue(path, page, { syncParent: false });
            else await fs.rm(path, { force: true });
        }
        await syncDir(this.pages);
    }

    async replay({ checkpoint, edits }) {
        await this.writePages(edits);
        await saveQueue(this.path, checkpoint);
        await fs.unlink(this.journal);
        await syncDir(this.stateDir);
    }

    async commit(checkpoint, importing = false) {
        const edits = [...this.edits];
        if (edits.length && !importing) {
            // A durable redo record commits the cursor and touched pages together.
            // Recovery completes it before any selection or further feed requests.
            const transaction = { checkpoint, edits };
            await saveQueue(this.journal, transaction, { maxBytes: journalLimit });
            await this.replay(transaction);
        } else {
            // During legacy import, all pages are new and unreachable until this rename.
            if (edits.length) await this.writePages(edits);
            await saveQueue(this.path, checkpoint);
        }
        this.edits.clear();
        this.cache.clear();
    }
}

function checkBinding(state, binding) {
    if (state && (![1, 2].includes(state.version) || !isDeepStrictEqual(state.binding, binding))) {
        throw new Error('ready_state_binding');
    }
}

async function readCheckpoint(path) {
    try {
        return await readJson(path, { sync: true });
    } catch (error) {
        if (mirrorErrorCode(error) !== 'raster_archive_state_size') throw error;
        // Only the old monolithic format can legitimately exceed the JSON limit.
        const legacyPrefix = Buffer.from('{"version":1,');
        const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const info = await handle.stat({ bigint: true });
            checkPrivate(info, 0o600);
            if (!info.isFile() || info.nlink !== 1n) throw error;
            const bytes = Buffer.alloc(legacyPrefix.length);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (bytesRead !== bytes.length || !legacyPrefix.equals(bytes)) throw error;
        } finally { await handle.close(); }
        return readJson(path, { sync: true, maxBytes: Infinity });
    }
}

async function expire(index, cutoff, canStart, save) {
    let removed = 0;
    // Each index can reclaim more entries per tick than the feed can add.
    for (let page = 0; page < cleanupPages && canStart(); page++) {
        let count = 0;
        while (count < pageSize && canStart()) {
            const entry = await index.first('oldest', cutoff - 1);
            if (!entry) break;
            await index.set(entry[0], null);
            count++;
        }
        if (count) await save();
        removed += count;
        if (count < pageSize) break;
    }
    return removed;
}

export async function pollReadyEvents({
    stateDir, binding, request, deliver, now = Date.now(), canStart = () => true, refreshUntil, resumeOnly = false,
}) {
    // Fail closed on an absent state root. Ready mode never creates or repairs an archive.
    const files = new QueueFiles(stateDir);
    let stored = await readCheckpoint(files.path);
    checkBinding(stored, binding);
    const transaction = await readJson(files.journal, { sync: true, maxBytes: journalLimit });
    if (transaction) {
        if (transaction.checkpoint?.version !== 2) throw new Error('ready_queue_transaction');
        checkBinding(transaction.checkpoint, binding);
        await syncDir(stateDir);
        await files.replay(transaction);
        stored = transaction.checkpoint;
    }
    const { watermark = null, window: savedWindow = null, newest = 0 } = stored ?? {};
    const state = { watermark, window: savedWindow, newest };
    const pending = new QueueIndex(files, 'pending', stored?.pendingIndex, Object.entries(stored?.pending ?? {}), pendingRanks);
    const seen = new QueueIndex(files, 'seen', stored?.seenIndex,
        (stored?.seen ?? []).flat().map(([id, at]) => [id, { at }]), { oldest: oldestRank });
    const report = { pages: 0, events: 0, delivered: 0, skipped: 0, retried: 0, expired: 0, pending: 0, intakeFailed: false };
    const save = (importing = false) => files.commit({
        version: 2, binding, ...state, pending: Object.fromEntries(pending.inline()),
        seen: seenPages(seen.inline().map(([id, row]) => [id, row.at])),
        pendingIndex: pending.root.children ? pending.root : null,
        seenIndex: seen.root.children ? seen.root : null,
    }, importing);
    if (stored?.version === 1) {
        pending.root = pending.split('', pending.root.rows);
        seen.root = seen.split('', seen.root.rows);
        await save(true);
    }
    const fresh = new Set();
    let window = savedWindow;
    if (!window && !resumeOnly && canStart()) {
        try { window = newWindow(state.watermark, refreshUntil ? await refreshUntil() : now, Boolean(refreshUntil)); }
        catch { report.intakeFailed = true; }
    }
    if (window) {
        state.window = window;
        for (let page = 0; page < intakePages && canStart(); page++) {
            const query = new URLSearchParams({
                since: new Date(window.since).toISOString(), until: new Date(window.until).toISOString(),
                afterId: String(window.afterId), limit: String(pageSize),
            });
            let response;
            try { response = readPage(await readyJson(request, 'ready-events?' + query), window); }
            catch {
                report.intakeFailed = true;
                if (!savedWindow && report.pages === 0) await save();
                break;
            }
            const { items, nextCursor } = response;
            for (const event of items) {
                if (await seen.get(event.id)) continue;
                const at = Date.parse(event.createdAt);
                state.newest = Math.max(state.newest, at);
                await enqueue(pending, event, now, fresh);
                if (at >= window.until - overlap) await seen.set(event.id, { at });
                report.events++;
            }
            if (nextCursor === null) {
                state.watermark = window.until;
                state.window = null;
            } else {
                window.afterId = nextCursor;
                state.window = window;
            }
            await save();
            report.pages++;
            if (nextCursor === null) break;
        }
    }

    // A prolonged quiet period also ages out targets after the ledger replay horizon.
    const oldest = Math.max(now, state.newest, state.watermark ?? 0) - retention;
    let firstFresh;
    for (const id of fresh) {
        if (!canStart()) break;
        const target = await pending.get(id);
        if (target && target.at >= oldest) {
            firstFresh = [id, target];
            break;
        }
    }
    for (let slot = 0; slot < deliveryLimit && canStart(); slot++) {
        const entry = (slot === 0 && (firstFresh ?? await pending.first('untried', now))) || await pending.first('due', now);
        if (!entry) break;
        const [docId, expected] = entry;
        if (expected.at < oldest) {
            await pending.set(docId, null);
            await save();
            report.expired++;
            continue;
        }
        let result;
        try { result = await deliver(docId, expected); } catch { result = 'pending'; }
        if (result === 'delivered' || result === 'ineligible') {
            await pending.set(docId, null);
            report[result === 'delivered' ? 'delivered' : 'skipped']++;
        } else {
            await pending.set(docId, { ...expected,
                next: now + Math.min(30 * minute, 30_000 * 2 ** expected.tries), tries: Math.min(expected.tries + 1, 6),
            });
            report.retried++;
        }
        await save();
    }
    report.expired += await expire(pending, oldest, canStart, save);
    if (state.watermark !== null) await expire(seen, state.watermark - overlap, canStart, save);
    const { count, heads } = pending.summary(pending.root);
    report.pending = count;
    return {
        ...report,
        startedWindow: Boolean(window && !savedWindow && report.pages),
        continueIntake: state.window !== null,
        pendingAt: heads.due?.[0] ?? null,
    };
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
