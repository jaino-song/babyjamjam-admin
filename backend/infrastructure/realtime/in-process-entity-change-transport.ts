import { randomBytes } from "node:crypto";
import { Observable, Subject, Subscription } from "rxjs";

import type { EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { formatRingCursor, parseCursor } from "./entity-change-cursor";
import { CursorCodec, randomRealtimeCursorKey } from "./entity-change-cursor-codec";
import { REALTIME_REPLAY_LIMIT } from "./entity-change-transport";
import type { DeliveredBatch, EntityChangeTransport, ReplayResult, TransportSignal } from "./entity-change-transport";

/** Same order of magnitude as the Valkey stream's `MAXLEN ~`. */
export const REALTIME_RETENTION = 10_000;

/**
 * Bounded history of delivered batches with `<epoch>:<seq>` cursors. The epoch is random per
 * process boot, so a cursor from before a restart is recognised as foreign instead of being
 * mistaken for a position in this process's (fresh) sequence.
 */
export class RealtimeRingBuffer {
    readonly epoch = randomBytes(6).toString("hex");
    private readonly items: DeliveredBatch[] = [];
    private lastSeq = 0;

    constructor(private readonly capacity: number = REALTIME_RETENTION) {}

    position(): string {
        return formatRingCursor(this.epoch, this.lastSeq);
    }

    append(event: EntityChangedEvent): DeliveredBatch {
        this.lastSeq += 1;
        const batch: DeliveredBatch = {
            type: "batch",
            cursor: formatRingCursor(this.epoch, this.lastSeq),
            branchId: event.branchId,
            entities: event.entities,
        };
        this.items.push(batch);
        if (this.items.length > this.capacity) this.items.shift();
        return batch;
    }

    replayAfter(since: string): ReplayResult {
        const parsed = parseCursor(since);
        if (!parsed || parsed.kind !== "ring" || parsed.epoch !== this.epoch) return { honoured: false };
        const seq = Number(parsed.seq);
        // `since` must name a batch we still hold the successor of (or the newest one), and must not
        // be from the future of this process.
        const firstRetainedSeq = this.lastSeq - this.items.length + 1;
        if (seq > this.lastSeq || seq < firstRetainedSeq - 1) return { honoured: false };
        const batches = this.items.slice(seq - (firstRetainedSeq - 1));
        // Same bound as the Valkey transport (see REALTIME_REPLAY_LIMIT): never a partial replay presented as complete.
        if (batches.length > REALTIME_REPLAY_LIMIT) return { honoured: false };
        return { honoured: true, batches };
    }
}

/**
 * Single-instance transport: batches go straight from the bus to local subscribers, synchronously
 * at flush time, and into a ring buffer for replay. Also the fallback inside the Valkey transport.
 */
export class InProcessEntityChangeTransport implements EntityChangeTransport {
    readonly ring: RealtimeRingBuffer;
    private readonly subject = new Subject<TransportSignal>();
    private readonly subscription: Subscription;

    readonly signals$: Observable<TransportSignal> = this.subject.asObservable();
    readonly cursors: CursorCodec;

    constructor(
        bus: { events$: Observable<EntityChangedEvent> },
        capacity: number = REALTIME_RETENTION,
        cursorKey: Buffer = randomRealtimeCursorKey(),
    ) {
        this.cursors = new CursorCodec(cursorKey);
        this.ring = new RealtimeRingBuffer(capacity);
        this.subscription = bus.events$.subscribe((event) => this.publish(event));
    }

    position(): string {
        return this.ring.position();
    }

    publish(event: EntityChangedEvent): void {
        this.subject.next(this.ring.append(event));
    }

    replayAfter(since: string): Promise<ReplayResult> {
        return Promise.resolve(this.ring.replayAfter(since));
    }

    onModuleDestroy(): void {
        this.subscription.unsubscribe();
        this.subject.complete();
    }
}
