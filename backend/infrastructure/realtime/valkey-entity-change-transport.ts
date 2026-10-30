import { Logger } from "@nestjs/common";
import Redis from "ioredis";
import { randomBytes } from "node:crypto";
import { Observable, Subject, Subscription } from "rxjs";

import type { EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { compareCursors, formatStreamCursor, parseCursor } from "./entity-change-cursor";
import { CursorCodec, isEncodableCursor } from "./entity-change-cursor-codec";
import { decodeBatchFields, encodeBatchFields } from "./entity-change-stream-codec";
import { REALTIME_RETENTION, RealtimeRingBuffer } from "./in-process-entity-change-transport";
import { REALTIME_REPLAY_LIMIT } from "./entity-change-transport";
import type { DeliveredBatch, EntityChangeTransport, ReplayResult, TransportSignal } from "./entity-change-transport";

export const REALTIME_STREAM_KEY = "realtime:entity-changes";

export interface ValkeyTransportOptions {
    url: string;
    /** 32-byte key for client cursor tokens; must be the same on every instance (see `deriveRealtimeCursorKey`). */
    cursorKey: Buffer;
    streamKey?: string;
    maxLen?: number;
    /** First wait after a Valkey failure; doubles up to `maxRetryDelayMs`. */
    retryDelayMs?: number;
    maxRetryDelayMs?: number;
    /** `XREAD BLOCK` timeout; also how long a stale read can outlive a transport switch. */
    blockMs?: number;
}

type Mode = "valkey" | "fallback";

/** One stream row as Valkey returns it: `[id, [field, value, ...]]`. */
type StreamRow = [string, string[]];

/** Rows a reader takes from the stream per round trip. */
const READER_PAGE = 100;

/** What one atomic settle says about the stream right now (and, for a range call, the rows after a cursor). */
interface StreamState {
    incarnation: string;
    lastGeneratedId: string;
    /** Oldest raw stream id whose successors are all still retained, see `oldestHonourable`. */
    oldestHonourableId: string;
    /** Rows after the requested id, already proven to carry `incarnation`; empty unless a range was asked for. */
    rows: StreamRow[];
}

interface SettleOptions {
    /** Append this entry (the script stamps `g`) after settling. */
    append?: string[];
    /** Also return up to `count` rows strictly after the raw stream id `after`. */
    range?: { after: string; count: number };
    /** Force a new incarnation (mode "4"): every cursor issued so far stops being honoured, on every instance. */
    fence?: boolean;
}

/**
 * Exact stream-id comparison for the settle script. Both halves of a stream id are uint64, so they
 * can exceed 2^53 (explicit ids; the server accepts them), where Lua's `tonumber` doubles collapse
 * neighbouring ids. Canonical decimal strings (no leading zeros, as the server emits them) compare
 * by length first, then lexicographically; ms before seq. Exported so a test can run this exact code.
 */
export const STREAM_ID_COMPARE_LUA = `
local function cmpnum(a, b)
  if #a ~= #b then return #a < #b and -1 or 1 end
  if a == b then return 0 end
  return a < b and -1 or 1
end
local function cmpid(a, b)
  local am, as = string.match(a, '^(%d+)-(%d+)$')
  local bm, bs = string.match(b, '^(%d+)-(%d+)$')
  local c = cmpnum(am, bm)
  if c ~= 0 then return c end
  return cmpnum(as, bs)
end
`;

/**
 * Atomic "is this still the stream that cursors were issued on" step. One script serves every
 * caller: before each append, for each resume (with the replay range), and for each reader batch,
 * so the continuity verdict and the rows handed out always come from the same instant.
 *
 * Continuity is proven by three witnesses, all kept server-side next to the stream:
 *  - the generation record (`<stream>:incarnation`, a hash): the incarnation `inc` (random, named in
 *    every cursor and stamped as `g` on every entry we write), `st` (`o` = nothing written yet, `w`
 *    = history exists), `h` (high-water mark: the largest stream id ever generated, which only a
 *    rollback can lower) and `f`, the runtime identity of the Valkey that wrote it;
 *  - the runtime identity F = (run_id, master_replid), read from the executing server in this very
 *    script. A restart from an RDB/AOF, a replica promotion (also a demote and re-promote in one
 *    process) and a different node all change it; stream, hash, counters and `g` roll back
 *    together under a restore, so F is the one witness a restore cannot take back with it. `role`
 *    must be master (anything else: continuity unavailable, the caller falls back to in-process);
 *  - the stream itself: its first and last entry (and every row a caller is handed) must carry `g`.
 * A NEW incarnation is minted, the old transport stream discarded (DEL) and clean origin metadata
 * written (`o`, `h` 0-0, current F) when: the record is missing or invalid; F differs; history was
 * written and the stream is absent or empty; the stream's newest generated id is below `h`; the
 * stream was written by someone else while we had written nothing; or a boundary entry / a row we
 * are about to hand out lacks `g` or carries another one. An append in such a call is written under
 * the NEW incarnation. Entry counts prove nothing about identity (a refill can be larger) and are
 * not used for it. Only the explicit origin state (`o`, no stream) keeps a `0-0@g` cursor usable.
 * Out of scope (supported-recovery contract, A5): live `RESTORE ... REPLACE` of a single key whose
 * contents are coherent with the record, a coherent forgery by an unrestricted admin, a restore of
 * the whole VM, and two primaries at once. Dataset restores go through the fenced procedure
 * (writers stopped, restore into a fresh process, identity verified changed).
 *
 * Deployment assumption: the app connects as a user that may run `INFO` (it is in `@dangerous`; an
 * ACL such as `-@dangerous` or `-info` breaks this). That is not hidden: `INFO` is `pcall`ed and a
 * refusal comes back as status `unavailable`, which the transport treats like an outage
 * (in-process delivery, `reset`, resumed:false) rather than as proof of anything. Production uses
 * the default user.
 *
 * Mode "4" (fence) mints unconditionally. It is how an instance that delivered hints only locally while it
 * could not reach this Valkey (see `ValkeyEntityChangeTransport.recover`) tells every instance's clients that
 * their cursors no longer cover everything: the stream never saw those hints, so a cursor taken before them
 * must not resume across the gap.
 *
 * KEYS = [stream, record]; ARGV = [candidate incarnation, mode "0" settle | "1" append | "3" range | "4" fence,
 * maxLen, range-after id, range count, ...entry fields]. Needs both keys on one node (a Cluster
 * deployment would need a hash tag). Reply: [ "ok", incarnation, last-generated-id, length,
 * entries-added, recorded-first-entry-id, max-deleted-entry-id, rows ] or [ "unavailable", reason ].
 */
const SETTLE_SCRIPT = `${STREAM_ID_COMPARE_LUA}
local S, I = KEYS[1], KEYS[2]
local mode = ARGV[2]

local srv = redis.pcall('INFO', 'server')
local rpl = redis.pcall('INFO', 'replication')
if type(srv) ~= 'string' or type(rpl) ~= 'string' then return { 'unavailable', 'INFO is not permitted' } end
local runId = string.match(srv, 'run_id:(%x+)')
local replId = string.match(rpl, 'master_replid:(%x+)')
if not runId or not replId then return { 'unavailable', 'no runtime identity' } end
if string.match(rpl, 'role:(%a+)') ~= 'master' then return { 'unavailable', 'not a master' } end
local F = runId .. ':' .. replId

local function streamInfo()
  local t = { exists = false, len = 0, added = 0, last = '0-0', first = false, tail = false, firstRecorded = '0-0', deleted = '0-0' }
  if redis.call('EXISTS', S) == 1 then
    local r = redis.call('XINFO', 'STREAM', S)
    local m = {}
    for i = 1, #r, 2 do m[r[i]] = r[i + 1] end
    t.exists = true
    t.len = m['length']
    t.added = m['entries-added'] or 0
    t.last = m['last-generated-id']
    t.first = m['first-entry']
    t.tail = m['last-entry']
    t.firstRecorded = m['recorded-first-entry-id'] or '0-0'
    t.deleted = m['max-deleted-entry-id'] or '0-0'
  end
  return t
end

local rec = redis.call('HMGET', I, 'inc', 'st', 'h', 'f')
local inc, st, H, f = rec[1], rec[2], rec[3], rec[4]
local dirty = false

local function gOf(fields)
  local g = nil
  for i = 1, #fields, 2 do
    if fields[i] == 'g' then
      if g then return nil end
      g = fields[i + 1]
    end
  end
  return g
end
local function foreign(fields) return gOf(fields) ~= inc end

local s = streamInfo()
local function mint()
  redis.call('DEL', S)
  inc, st, H, f = ARGV[1], 'o', '0-0', F
  s = streamInfo()
  dirty = true
end

local newGeneration
if mode == '4' then
  newGeneration = true
elseif not inc or not f or (st ~= 'o' and st ~= 'w') or not H or not string.match(H, '^%d+-%d+$') then
  newGeneration = true
elseif f ~= F then
  newGeneration = true
elseif st == 'w' and ((not s.exists) or s.len == 0) then
  newGeneration = true
elseif s.exists and cmpid(s.last, H) < 0 then
  newGeneration = true
elseif st == 'o' and s.exists and (s.len > 0 or s.last ~= '0-0') then
  newGeneration = true
elseif (s.first and foreign(s.first[2])) or (s.tail and foreign(s.tail[2])) then
  newGeneration = true
end
if newGeneration then
  mint()
elseif s.exists and cmpid(s.last, H) > 0 then
  H = s.last
  dirty = true
end

if mode == '1' then
  local args = { 'XADD', S, 'MAXLEN', '~', ARGV[3], '*' }
  for i = 6, #ARGV do args[#args + 1] = ARGV[i] end
  args[#args + 1] = 'g'
  args[#args + 1] = inc
  redis.call(unpack(args))
  s = streamInfo()
  H = s.last
  st = 'w'
  dirty = true
end

local rows = {}
if mode == '3' then
  rows = redis.call('XRANGE', S, '(' .. ARGV[4], '+', 'COUNT', ARGV[5])
  for _, row in ipairs(rows) do
    if foreign(row[2]) then
      mint()
      rows = {}
      break
    end
  end
end

if dirty then redis.call('HSET', I, 'inc', inc, 'st', st, 'h', H, 'f', f) end
return { 'ok', inc, s.last, tostring(s.len), tostring(s.added), s.firstRecorded, s.deleted, rows }
`;

/**
 * Multi-instance transport. Each flushed bus batch is appended to a Valkey Stream; every
 * instance's reader (its own connection, `XREAD BLOCK`) pushes what it reads to its local
 * subscribers, including this instance's own batches, so nothing is delivered twice. The stream
 * id plus the stream's incarnation is the cursor handed to clients. `XREAD BLOCK` is only the
 * wake-up: what is delivered, and whether continuity still holds, come from one atomic settle
 * call (see SETTLE_SCRIPT), never from a snapshot validated separately.
 *
 * Valkey is optional and must never take the app down or block a write: when it fails, the
 * transport falls back to an in-process ring (delivering the batch that could not be published
 * locally), tells every open connection to `reset`, and switches back — with another `reset`,
 * because the cursors change id space — once the connections are healthy again. A hint delivered
 * only locally is a hole in the stream every other client's cursor would silently skip, so before
 * the stream path is re-enabled such an instance fences: it forces a new incarnation, which no
 * older cursor (on any instance) survives. Each fallback interval also gets its own ring epoch, so
 * an in-process cursor is never honoured across two separate intervals (the stream publications in
 * between would be skipped). A recovery without any locally delivered hint fences nothing and
 * cursors keep resuming across it.
 *
 * The reader also resets connections when it finds it can no longer vouch for continuity (retention
 * overran it, or the generation changed: the stream was recreated, restored or failed over, or
 * another instance fenced).
 */
export class ValkeyEntityChangeTransport implements EntityChangeTransport {
    private readonly logger = new Logger(ValkeyEntityChangeTransport.name);
    private readonly subject = new Subject<TransportSignal>();
    /** The in-process ring of the current fallback interval; a fresh one (new epoch) for every interval. */
    private fallback: RealtimeRingBuffer;
    private readonly publisher: Redis;
    private readonly reader: Redis;
    private readonly busSubscription: Subscription;
    private readonly streamKey: string;
    private readonly incarnationKey: string;
    private readonly maxLen: number;
    private readonly retryDelayMs: number;
    private readonly maxRetryDelayMs: number;
    private readonly blockMs: number;

    private mode: Mode = "fallback";
    /** Hints delivered to local subscribers only (never on the stream) since the last successful fence. */
    private localHints = 0;
    private lastDelivered = "0-0";
    private incarnation = "";
    private closed = false;
    private outageLogged = false;
    private everConnected = false;
    private sleepTimer: ReturnType<typeof setTimeout> | null = null;
    private wake: (() => void) | null = null;

    readonly signals$: Observable<TransportSignal> = this.subject.asObservable();
    readonly cursors: CursorCodec;

    constructor(bus: { events$: Observable<EntityChangedEvent> }, options: ValkeyTransportOptions) {
        this.cursors = new CursorCodec(options.cursorKey);
        this.streamKey = options.streamKey ?? REALTIME_STREAM_KEY;
        this.incarnationKey = `${this.streamKey}:incarnation`;
        this.maxLen = options.maxLen ?? REALTIME_RETENTION;
        this.retryDelayMs = options.retryDelayMs ?? 250;
        this.maxRetryDelayMs = options.maxRetryDelayMs ?? 5_000;
        this.blockMs = options.blockMs ?? 5_000;
        this.fallback = new RealtimeRingBuffer(this.maxLen);

        // Fail fast instead of queueing: a batch XADDed "later" would reach clients out of order and
        // after the in-process fallback already delivered it. Commands in flight when a connection
        // drops are not replayed for the same reason.
        // `disconnectTimeout: 0`: ioredis' `disconnect()` ends the socket gracefully and keeps a (ref'd) 2 s timer that
        // destroys it if it has not closed by then. A transport closed while still connecting (or against an
        // unreachable Valkey) never sees that close, so the timer outlived the owner and kept a test worker or a
        // shutting-down process alive for 2 s. Destroying the socket right away costs nothing: nothing is pending.
        const connection = {
            lazyConnect: true,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            connectTimeout: 2_000,
            autoResendUnfulfilledCommands: false,
            disconnectTimeout: 0,
        };
        this.publisher = new Redis(options.url, { ...connection, commandTimeout: 2_000 });
        this.reader = new Redis(options.url, { ...connection, commandTimeout: this.blockMs + 3_000 });
        // Failures are handled (and logged once per outage) by the loops below; an `error` event with no
        // listener would otherwise print on every reconnect attempt.
        this.publisher.on("error", () => undefined);
        this.reader.on("error", () => undefined);

        this.busSubscription = bus.events$.subscribe((event) => this.publish(event));
        void this.runReader();
    }

    /** Which path new batches take right now; exposed for tests and diagnostics. */
    get activeMode(): Mode {
        return this.mode;
    }

    position(): string {
        return this.mode === "valkey" ? formatStreamCursor(this.lastDelivered, this.incarnation) : this.fallback.position();
    }

    publish(event: EntityChangedEvent): void {
        if (this.mode === "fallback") {
            this.deliverLocally(event);
            return;
        }
        void this.append(event);
    }

    async replayAfter(since: string): Promise<ReplayResult> {
        if (this.mode === "fallback") return this.fallback.replayAfter(since);
        const parsed = parseCursor(since);
        if (!parsed || parsed.kind !== "stream") return { honoured: false };
        try {
            // One atomic call: it settles the generation (a restored, failed-over or refilled stream comes back as
            // another incarnation), proves every returned row carries it, and reads the range, so the verdict and
            // the rows below describe the same instant. One row more than the bound is read to tell "exactly the
            // bound" from "more than the bound".
            const state = await this.settle(this.publisher, {
                range: { after: `${parsed.ms}-${parsed.seq}`, count: REALTIME_REPLAY_LIMIT + 1 },
            });
            if (state.incarnation !== parsed.inc) return { honoured: false };
            // Never hand out a partial replay as if it were complete.
            if (state.rows.length > REALTIME_REPLAY_LIMIT) return { honoured: false };
            const afterNewest = compareCursors(since, formatStreamCursor(state.lastGeneratedId, state.incarnation));
            const beforeOldest = compareCursors(since, formatStreamCursor(state.oldestHonourableId, state.incarnation));
            if (afterNewest === null || beforeOldest === null || afterNewest > 0 || beforeOldest < 0) {
                return { honoured: false };
            }
            const batches: DeliveredBatch[] = [];
            for (const [id, fields] of state.rows) {
                const batch = this.toBatch(id, fields, state.incarnation);
                if (batch) batches.push(batch);
            }
            return { honoured: true, batches };
        } catch {
            return { honoured: false };
        }
    }

    onModuleDestroy(): void {
        this.closed = true;
        this.busSubscription.unsubscribe();
        if (this.sleepTimer) clearTimeout(this.sleepTimer);
        this.wake?.();
        this.reader.disconnect();
        this.publisher.disconnect();
        this.subject.complete();
    }

    private async append(event: EntityChangedEvent): Promise<void> {
        try {
            await this.settle(this.publisher, { append: encodeBatchFields(event) });
        } catch (error) {
            if (this.closed) return;
            // The batch is not on the stream, so this instance's own clients must still hear about it. The
            // interval starts first, so the hint lands in the new ring (after the reset) and not in a stale one.
            this.enterFallback(error);
            this.deliverLocally(event);
        }
    }

    private deliverLocally(event: EntityChangedEvent): void {
        // No other instance will ever see this hint: `recover` has to fence before the stream is used again.
        this.localHints += 1;
        this.subject.next(this.fallback.append(event));
    }

    private async runReader(): Promise<void> {
        let delay = this.retryDelayMs;
        while (!this.closed) {
            try {
                if (this.mode !== "valkey") {
                    await this.recover();
                    delay = this.retryDelayMs;
                }
                // Only a wake-up: the reply is ignored, because the rows and the continuity verdict must come from
                // the same atomic call (below). It also times out when idle, which is when a rolled-back or
                // failed-over server is noticed.
                await this.reader.call("XREAD", "COUNT", "1", "BLOCK", String(this.blockMs), "STREAMS", this.streamKey, this.lastDelivered);
                if (this.closed) return;
                await this.pump();
            } catch (error) {
                if (this.closed) return;
                this.enterFallback(error);
                await this.sleep(delay);
                delay = Math.min(delay * 2, this.maxRetryDelayMs);
            }
        }
    }

    /** (Re)start the stream path: both connections usable, reader positioned at the stream's newest id. */
    private async recover(): Promise<void> {
        await this.ensureReady(this.publisher);
        await this.ensureReady(this.reader);
        await this.publisher.ping();
        // Start from the newest id, never `$`: `$` is resolved by the server at read time, so entries
        // added between this call and the read would be skipped, and the id handed to clients as the
        // "current position" would not be where the reader actually starts.
        //
        // Hints that only local subscribers heard (delivered while this instance could not publish) are missing
        // from the stream, so any cursor issued before them, on any instance, would resume across the gap and
        // never learn of them. Before the stream path is back, force a new incarnation. If the fence fails we
        // stay in fallback (the error propagates) and the next attempt fences again, because `localHints` is
        // only cleared below. A hint delivered locally while the fence was in flight is not covered by it, so
        // the check and the switch to "valkey" happen with no await in between, and the fence repeats until
        // nothing slipped through. A recovery with no such hint mints nothing (healthy restarts and brief
        // blips keep resuming).
        let state: StreamState;
        for (;;) {
            const unfenced = this.localHints;
            state = await this.settle(this.publisher, unfenced > 0 ? { fence: true } : {});
            if (this.closed) return;
            if (this.localHints === unfenced) break;
        }
        this.localHints = 0;
        this.incarnation = state.incarnation;
        this.lastDelivered = state.lastGeneratedId;
        this.mode = "valkey";
        this.logger.log(this.everConnected ? "Valkey realtime transport recovered" : "Valkey realtime transport connected");
        this.everConnected = true;
        this.outageLogged = false;
        // Clients may hold in-process cursors from the fallback period; they cannot be resumed here.
        this.subject.next({ type: "reset", position: this.position() });
    }

    /**
     * One page for the reader: the settle call returns the next rows AND whether they are still part of the
     * history this reader has been following.
     *
     * Continuity is lost when the generation changed (the stream was recreated, restored or failed over:
     * the rows belong to a history that no longer exists, so they are dropped) or when retention trimmed past
     * this reader's position (entries between the two are gone, and a hint that mattered to some branch may
     * have been among them; the survivors are then delivered after the reset). Connections are told to
     * `reset`; the reset position is the stream's newest id, because everything up to it was published
     * before this check, so a client that refetches in response to the reset already sees it.
     */
    private async pump(): Promise<void> {
        const state = await this.settle(this.publisher, { range: { after: this.lastDelivered, count: READER_PAGE } });
        if (this.mode !== "valkey") return;
        if (state.incarnation !== this.incarnation) {
            this.logger.warn("Realtime stream generation changed (recreated, restored or failed over); resetting connections");
            this.incarnation = state.incarnation;
            this.lastDelivered = state.lastGeneratedId;
            this.subject.next({ type: "reset", position: formatStreamCursor(state.lastGeneratedId, state.incarnation) });
            return;
        }
        const trimmedPast =
            compareCursors(
                formatStreamCursor(this.lastDelivered, state.incarnation),
                formatStreamCursor(state.oldestHonourableId, state.incarnation),
            ) === -1;
        if (trimmedPast) {
            this.logger.warn("Realtime reader fell behind stream retention; resetting connections");
            this.subject.next({ type: "reset", position: formatStreamCursor(state.lastGeneratedId, state.incarnation) });
            if (state.rows.length === 0) this.lastDelivered = state.lastGeneratedId;
        }
        this.deliver(state.rows);
    }

    private deliver(rows: StreamRow[]): void {
        for (const [id, fields] of rows) {
            // A stale call can return after the transport already switched; its ids belong to a
            // position the connections were told to abandon.
            if (this.mode !== "valkey") return;
            this.lastDelivered = id;
            const batch = this.toBatch(id, fields, this.incarnation);
            if (batch) this.subject.next(batch);
        }
    }

    /** `null` for an entry that is malformed or whose id no cursor token could carry; the reader still moves past it. */
    private toBatch(streamId: string, fields: string[], incarnation: string): DeliveredBatch | null {
        const cursor = formatStreamCursor(streamId, incarnation);
        return isEncodableCursor(cursor) ? decodeBatchFields(cursor, fields) : null;
    }

    private enterFallback(error: unknown): void {
        if (!this.outageLogged) {
            this.outageLogged = true;
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Valkey realtime transport unavailable, delivering in-process only: ${reason}`);
        }
        if (this.mode === "fallback") return;
        this.mode = "fallback";
        // A new interval, a new epoch: an in-process cursor from an earlier interval skipped whatever was
        // published on the stream in between, so it must not be honoured now.
        this.fallback = new RealtimeRingBuffer(this.maxLen);
        this.subject.next({ type: "reset", position: this.fallback.position() });
    }

    private async ensureReady(client: Redis): Promise<void> {
        if (client.status === "wait") await client.connect();
        if (client.status !== "ready") throw new Error(`Valkey connection is ${client.status}`);
    }

    /**
     * Runs the settle script (see SETTLE_SCRIPT), optionally appending an entry and/or reading a range in
     * the same atomic call. "Continuity unavailable" (INFO refused, not a master) is an error here: callers
     * treat it like any other outage, so it is never mistaken for proof.
     */
    private async settle(client: Redis, options: SettleOptions = {}): Promise<StreamState> {
        const reply = await client.eval(
            SETTLE_SCRIPT,
            2,
            this.streamKey,
            this.incarnationKey,
            randomBytes(8).toString("hex"),
            options.fence ? "4" : options.append ? "1" : options.range ? "3" : "0",
            String(this.maxLen),
            options.range?.after ?? "0-0",
            String(options.range?.count ?? 0),
            ...(options.append ?? []),
        );
        if (!Array.isArray(reply)) throw new Error("unexpected reply from the realtime settle script");
        if (reply[0] === "unavailable") throw new Error(`realtime continuity unavailable: ${String(reply[1])}`);
        if (reply[0] !== "ok" || reply.length !== 8) throw new Error("unexpected reply from the realtime settle script");
        const [, incarnation, last, length, added, first, deleted] = reply.slice(0, 7).map(String) as string[];
        return {
            incarnation: incarnation as string,
            lastGeneratedId: last as string,
            oldestHonourableId: oldestHonourable({
                length: Number(length),
                added: Number(added),
                first: first as string,
                deleted: deleted as string,
                last: last as string,
            }),
            rows: reply[7] as StreamRow[],
        };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => {
            this.wake = resolve;
            this.sleepTimer = setTimeout(resolve, ms);
            this.sleepTimer.unref?.();
        });
    }
}

/**
 * The oldest raw stream id whose successors are all still on the stream. `max-deleted-entry-id`
 * only tracks XDEL and Valkey 8 leaves it at 0-0 on XTRIM (our `MAXLEN ~`), so a trim has to be
 * read off the counters: if more entries were ever added than are retained, everything before the
 * first retained id may be gone, and a cursor older than that cannot be vouched for (the id of the
 * last trimmed entry is refused too, since the gap after it cannot be seen). A stream that was
 * never trimmed keeps every id back to 0-0 honourable. An XDEL'd entry newer than that floor
 * raises it to `max-deleted-entry-id`. (Ids here are raw `<ms>-<seq>`; compared via a shared dummy
 * incarnation so the numeric comparison is the one used everywhere else.)
 */
function oldestHonourable(info: { length: number; added: number; first: string; deleted: string; last: string }): string {
    const dummy = "0000000000000000";
    let floor = "0-0";
    if (info.length === 0) floor = info.last;
    else if (info.added > info.length) floor = info.first;
    return compareCursors(formatStreamCursor(info.deleted, dummy), formatStreamCursor(floor, dummy)) === 1 ? info.deleted : floor;
}
