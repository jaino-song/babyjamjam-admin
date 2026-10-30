import { Logger } from "@nestjs/common";
import Redis from "ioredis";
import { randomBytes } from "node:crypto";
import { Observable, Subject, Subscription } from "rxjs";

import type { EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { compareCursors, formatStreamCursor, parseCursor } from "./entity-change-cursor";
import { CursorCodec, isEncodableCursor } from "./entity-change-cursor-codec";
import { decodeBatchFields, encodeBatchFields } from "./entity-change-stream-codec";
import { REALTIME_RETENTION, RealtimeRingBuffer } from "./in-process-entity-change-transport";
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

/** What one round trip to the stream and its incarnation record says about the stream right now. */
interface StreamState {
    incarnation: string;
    lastGeneratedId: string;
    /** Oldest raw stream id whose successors are all still retained, see `oldestHonourable`. */
    oldestHonourableId: string;
}

/**
 * Atomic "who is this stream" step, run before every append and on every reader check.
 *
 * The incarnation record (`<stream>:incarnation`, a hash) names one life of the stream. A DEL
 * followed by an XADD recreates the stream with counters restarted from zero, so without it a
 * cursor from the destroyed history would look valid against the new one and skip hints. A new
 * incarnation is minted when
 *  - there is no record yet (first use: state `o`, "nothing written", while the stream is absent,
 *    so a cursor taken at the origin keeps resuming once the first batch creates the stream), or
 *  - the stream held history (`w`) and is now absent, or its counters went backwards, or the same
 *    count shows a different newest id (a raw DEL + XADD that no writer of ours saw).
 * Doing it in one script makes concurrent recreations converge on whichever candidate id wins.
 * KEYS = [stream, record]; ARGV = [candidate id, append "1"|"0", maxLen, ...entry fields].
 * Residual: a stream recreated AND refilled with at least as many raw entries as the record last
 * saw, all before any settle (a reader settles at least every `blockMs`), is indistinguishable.
 * Needs both keys on one node (a Cluster deployment would need a hash tag).
 */
const SETTLE_SCRIPT = `
local S, I = KEYS[1], KEYS[2]
local function info()
  local t = {}
  if redis.call('EXISTS', S) == 1 then
    local r = redis.call('XINFO', 'STREAM', S)
    for i = 1, #r, 2 do t[r[i]] = r[i + 1] end
  end
  return t
end
local t = info()
local exists = next(t) ~= nil
local added = tonumber(t['entries-added'] or 0)
local last = t['last-generated-id'] or '0-0'
local inc = redis.call('HGET', I, 'inc')
local st = redis.call('HGET', I, 'st')
local recAdded = tonumber(redis.call('HGET', I, 'added') or 0)
local recLast = redis.call('HGET', I, 'last')
local fresh = false
if not inc then
  fresh = true
elseif st == 'w' and ((not exists) or added < recAdded or (added == recAdded and last ~= recLast)) then
  fresh = true
end
if fresh then
  inc = ARGV[1]
  st = exists and 'w' or 'o'
elseif exists then
  st = 'w'
end
if ARGV[2] == '1' then
  last = redis.call('XADD', S, 'MAXLEN', '~', ARGV[3], '*', unpack(ARGV, 4))
  added = added + 1
  st = 'w'
  t = info()
end
redis.call('HSET', I, 'inc', inc, 'st', st, 'added', added, 'last', last)
return {
  inc,
  t['last-generated-id'] or '0-0',
  tostring(t['length'] or 0),
  tostring(t['entries-added'] or 0),
  t['recorded-first-entry-id'] or '0-0',
  t['max-deleted-entry-id'] or '0-0',
}
`;

/**
 * Multi-instance transport. Each flushed bus batch is appended to a Valkey Stream; every
 * instance's reader (its own connection, `XREAD BLOCK`) pushes what it reads to its local
 * subscribers, including this instance's own batches, so nothing is delivered twice. The stream
 * id plus the stream's incarnation is the cursor handed to clients.
 *
 * Valkey is optional and must never take the app down or block a write: when it fails, the
 * transport falls back to an in-process ring (delivering the batch that could not be published
 * locally), tells every open connection to `reset`, and switches back — with another `reset`,
 * because the cursors change id space — once the connections are healthy again. The reader also
 * resets connections when it finds it can no longer vouch for continuity (retention overran it, or
 * the stream was recreated).
 */
export class ValkeyEntityChangeTransport implements EntityChangeTransport {
    private readonly logger = new Logger(ValkeyEntityChangeTransport.name);
    private readonly subject = new Subject<TransportSignal>();
    private readonly fallback: RealtimeRingBuffer;
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
        const connection = { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2_000, autoResendUnfulfilledCommands: false };
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
            // Range first, state check second: a trim that races the read can only make the check fail
            // (conservative), never leave a hole that goes unnoticed.
            const rows = await this.publisher.xrange(this.streamKey, `(${parsed.ms}-${parsed.seq}`, "+");
            const state = await this.settle(this.publisher);
            // Another incarnation means the history the cursor pointed into is gone.
            if (state.incarnation !== parsed.inc) return { honoured: false };
            const afterNewest = compareCursors(since, formatStreamCursor(state.lastGeneratedId, state.incarnation));
            const beforeOldest = compareCursors(since, formatStreamCursor(state.oldestHonourableId, state.incarnation));
            if (afterNewest === null || beforeOldest === null || afterNewest > 0 || beforeOldest < 0) {
                return { honoured: false };
            }
            const batches: DeliveredBatch[] = [];
            for (const [id, fields] of rows) {
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
            await this.settle(this.publisher, encodeBatchFields(event));
        } catch (error) {
            if (this.closed) return;
            // The batch is not on the stream, so this instance's own clients must still hear about it.
            this.deliverLocally(event);
            this.enterFallback(error);
        }
    }

    private deliverLocally(event: EntityChangedEvent): void {
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
                const reply = await this.reader.call(
                    "XREAD", "COUNT", "100", "BLOCK", String(this.blockMs), "STREAMS", this.streamKey, this.lastDelivered,
                );
                if (this.closed) return;
                // One check per read (not per entry): before handing out what was read, make sure this
                // reader can still vouch for everything between its previous position and it.
                const lost = await this.checkContinuity();
                if (lost?.kind === "recreated") {
                    // The reply came from a history that no longer exists; the reset already covers it. Carry on
                    // from the new stream's newest id.
                    this.lastDelivered = lost.newestId;
                    continue;
                }
                if (lost?.kind === "overrun" && !hasEntries(reply)) this.lastDelivered = lost.newestId;
                this.deliver(reply);
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
        const state = await this.settle(this.publisher);
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
     * Continuity is lost when the stream is a different incarnation than the one this reader has
     * been following, or when retention trimmed past this reader's position (entries between the
     * two are gone, and a hint that mattered to some branch may have been among them). Connections
     * are told to `reset`; the surviving entries are then delivered as usual. The reset position is
     * the stream's newest id: everything up to it was published before this check, so a client that
     * refetches in response to the reset already sees it.
     */
    private async checkContinuity(): Promise<{ kind: "recreated" | "overrun"; newestId: string } | null> {
        const state = await this.settle(this.publisher);
        const incarnationChanged = state.incarnation !== this.incarnation;
        const trimmedPast =
            !incarnationChanged &&
            compareCursors(
                formatStreamCursor(this.lastDelivered, state.incarnation),
                formatStreamCursor(state.oldestHonourableId, state.incarnation),
            ) === -1;
        if (!incarnationChanged && !trimmedPast) return null;
        this.logger.warn(
            incarnationChanged
                ? "Realtime stream was recreated; resetting connections"
                : "Realtime reader fell behind stream retention; resetting connections",
        );
        this.incarnation = state.incarnation;
        this.subject.next({ type: "reset", position: formatStreamCursor(state.lastGeneratedId, state.incarnation) });
        return { kind: incarnationChanged ? "recreated" : "overrun", newestId: state.lastGeneratedId };
    }

    private deliver(reply: unknown): void {
        if (!Array.isArray(reply)) return;
        for (const stream of reply as Array<[string, Array<[string, string[]]>]>) {
            for (const [id, fields] of stream[1]) {
                // A stale read can return after the transport already switched; its ids belong to a
                // position the connections were told to abandon.
                if (this.mode !== "valkey") return;
                this.lastDelivered = id;
                const batch = this.toBatch(id, fields, this.incarnation);
                if (batch) this.subject.next(batch);
            }
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
        this.subject.next({ type: "reset", position: this.fallback.position() });
    }

    private async ensureReady(client: Redis): Promise<void> {
        if (client.status === "wait") await client.connect();
        if (client.status !== "ready") throw new Error(`Valkey connection is ${client.status}`);
    }

    /** Runs the settle script; with `entryFields` it also appends that entry (atomically after settling). */
    private async settle(client: Redis, entryFields?: string[]): Promise<StreamState> {
        const reply = await client.eval(
            SETTLE_SCRIPT,
            2,
            this.streamKey,
            this.incarnationKey,
            randomBytes(8).toString("hex"),
            entryFields ? "1" : "0",
            String(this.maxLen),
            ...(entryFields ?? []),
        );
        if (!Array.isArray(reply) || reply.length !== 6) throw new Error("unexpected reply from the realtime settle script");
        const [incarnation, last, length, added, first, deleted] = reply.map(String) as [string, string, string, string, string, string];
        return {
            incarnation,
            lastGeneratedId: last,
            oldestHonourableId: oldestHonourable({ length: Number(length), added: Number(added), first, deleted, last }),
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

function hasEntries(reply: unknown): boolean {
    return Array.isArray(reply) && reply.some((stream) => Array.isArray(stream) && Array.isArray(stream[1]) && stream[1].length > 0);
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
