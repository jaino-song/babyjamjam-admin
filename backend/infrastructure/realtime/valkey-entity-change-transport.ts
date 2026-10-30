import { Logger } from "@nestjs/common";
import Redis from "ioredis";
import { Observable, Subject, Subscription } from "rxjs";

import type { EntityChangedEvent, EntityChangeKind } from "application/services/entity-change-event-bus.service";
import { compareCursors, parseCursor } from "./entity-change-cursor";
import { REALTIME_RETENTION, RealtimeRingBuffer } from "./in-process-entity-change-transport";
import type { DeliveredBatch, EntityChangeTransport, ReplayResult, TransportSignal } from "./entity-change-transport";

export const REALTIME_STREAM_KEY = "realtime:entity-changes";

export interface ValkeyTransportOptions {
    url: string;
    streamKey?: string;
    maxLen?: number;
    /** First wait after a Valkey failure; doubles up to `maxRetryDelayMs`. */
    retryDelayMs?: number;
    maxRetryDelayMs?: number;
    /** `XREAD BLOCK` timeout; also how long a stale read can outlive a transport switch. */
    blockMs?: number;
}

type Mode = "valkey" | "fallback";

interface StreamInfo {
    lastGeneratedId: string;
    /** Oldest cursor `replayAfter` can still vouch for, see `oldestHonourable`. */
    oldestHonourableId: string;
}

/**
 * Multi-instance transport. Each flushed bus batch is appended to a Valkey Stream; every
 * instance's reader (its own connection, `XREAD BLOCK`) pushes what it reads to its local
 * subscribers, including this instance's own batches, so nothing is delivered twice. The stream
 * id is the cursor handed to clients.
 *
 * Valkey is optional and must never take the app down or block a write: when it fails, the
 * transport falls back to an in-process ring (delivering the batch that could not be published
 * locally), tells every open connection to `reset`, and switches back — with another `reset`,
 * because the cursors change id space — once the connections are healthy again.
 */
export class ValkeyEntityChangeTransport implements EntityChangeTransport {
    private readonly logger = new Logger(ValkeyEntityChangeTransport.name);
    private readonly subject = new Subject<TransportSignal>();
    private readonly fallback: RealtimeRingBuffer;
    private readonly publisher: Redis;
    private readonly reader: Redis;
    private readonly busSubscription: Subscription;
    private readonly streamKey: string;
    private readonly maxLen: number;
    private readonly retryDelayMs: number;
    private readonly maxRetryDelayMs: number;
    private readonly blockMs: number;

    private mode: Mode = "fallback";
    private lastDelivered = "0-0";
    private closed = false;
    private outageLogged = false;
    private everConnected = false;
    private sleepTimer: ReturnType<typeof setTimeout> | null = null;
    private wake: (() => void) | null = null;

    readonly signals$: Observable<TransportSignal> = this.subject.asObservable();

    constructor(bus: { events$: Observable<EntityChangedEvent> }, options: ValkeyTransportOptions) {
        this.streamKey = options.streamKey ?? REALTIME_STREAM_KEY;
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
        return this.mode === "valkey" ? this.lastDelivered : this.fallback.position();
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
            // Range first, trim check second: a trim that races the read can only make the check fail
            // (conservative), never leave a hole that goes unnoticed.
            const rows = await this.publisher.xrange(this.streamKey, `(${since}`, "+");
            const info = await this.streamInfo(this.publisher);
            const lastGenerated = info?.lastGeneratedId ?? "0-0";
            const oldest = info?.oldestHonourableId ?? "0-0";
            const afterNewest = compareCursors(since, lastGenerated);
            const beforeOldest = compareCursors(since, oldest);
            if (afterNewest === null || beforeOldest === null || afterNewest > 0 || beforeOldest < 0) {
                return { honoured: false };
            }
            const batches: DeliveredBatch[] = [];
            for (const [id, fields] of rows) {
                const batch = toBatch(id, fields);
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
            await this.publisher.xadd(
                this.streamKey,
                "MAXLEN",
                "~",
                this.maxLen,
                "*",
                "b",
                event.branchId ?? "",
                "e",
                JSON.stringify(event.entities),
            );
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
        const info = await this.streamInfo(this.publisher);
        this.lastDelivered = info?.lastGeneratedId ?? "0-0";
        this.mode = "valkey";
        this.logger.log(this.everConnected ? "Valkey realtime transport recovered" : "Valkey realtime transport connected");
        this.everConnected = true;
        this.outageLogged = false;
        // Clients may hold in-process cursors from the fallback period; they cannot be resumed here.
        this.subject.next({ type: "reset", position: this.lastDelivered });
    }

    private deliver(reply: unknown): void {
        if (!Array.isArray(reply)) return;
        for (const stream of reply as Array<[string, Array<[string, string[]]>]>) {
            for (const [id, fields] of stream[1]) {
                // A stale read can return after the transport already switched; its ids belong to a
                // position the connections were told to abandon.
                if (this.mode !== "valkey") return;
                this.lastDelivered = id;
                const batch = toBatch(id, fields);
                if (batch) this.subject.next(batch);
            }
        }
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

    private async streamInfo(client: Redis): Promise<StreamInfo | null> {
        let reply: unknown;
        try {
            reply = await client.xinfo("STREAM", this.streamKey);
        } catch (error) {
            // A stream nobody has written to yet does not exist; its position is the origin.
            if (error instanceof Error && /no such key/i.test(error.message)) return null;
            throw error;
        }
        const fields = new Map<string, unknown>();
        if (Array.isArray(reply)) {
            for (let i = 0; i + 1 < reply.length; i += 2) fields.set(String(reply[i]), reply[i + 1]);
        }
        const last = fields.get("last-generated-id");
        if (typeof last !== "string") throw new Error("XINFO STREAM returned no last-generated-id");
        return { lastGeneratedId: last, oldestHonourableId: oldestHonourable(fields, last) };
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
 * The oldest `since` whose successors are all still on the stream. `max-deleted-entry-id` only
 * tracks XDEL and Valkey 8 leaves it at 0-0 on XTRIM (our `MAXLEN ~`), so a trim has to be read
 * off the counters: if more entries were ever added than are retained, everything before the
 * first retained id may be gone, and a cursor older than that cannot be vouched for (the id of the
 * last trimmed entry is refused too, since the gap after it cannot be seen). A stream that was
 * never trimmed keeps every id back to 0-0 honourable. An XDEL'd entry newer than that floor
 * raises it to `max-deleted-entry-id`.
 */
function oldestHonourable(fields: Map<string, unknown>, lastGeneratedId: string): string {
    const length = Number(fields.get("length"));
    const added = fields.get("entries-added");
    const trimmedOrDeleted = typeof added === "number" ? added > length : true;
    let floor = "0-0";
    if (length === 0) floor = lastGeneratedId;
    else if (trimmedOrDeleted) {
        const first = fields.get("recorded-first-entry-id");
        floor = typeof first === "string" ? first : lastGeneratedId;
    }
    const deleted = fields.get("max-deleted-entry-id");
    return typeof deleted === "string" && compareCursors(deleted, floor) === 1 ? deleted : floor;
}

function toBatch(id: string, fields: string[]): DeliveredBatch | null {
    let branch: string | null = null;
    let entities: unknown;
    for (let i = 0; i + 1 < fields.length; i += 2) {
        if (fields[i] === "b") branch = fields[i + 1] ?? "";
        else if (fields[i] === "e") {
            try {
                entities = JSON.parse(fields[i + 1] ?? "");
            } catch {
                return null;
            }
        }
    }
    if (!Array.isArray(entities) || entities.some((kind) => typeof kind !== "string")) return null;
    return { type: "batch", cursor: id, branchId: branch === "" ? null : branch, entities: entities as EntityChangeKind[] };
}
