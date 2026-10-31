import { Injectable, Logger } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

/** Closed set shared with the web/mobile clients; never widen it without updating both. */
export type EntityChangeKind =
    | "client"
    | "employee"
    | "document"
    | "message"
    | "service-record"
    | "inquiry"
    | "call"
    | "file"
    | "holiday"
    | "settings"
    | "notification";

export interface EntityChangeInput {
    /** `null` means "branch unknown / system scope": delivered to every subscriber. */
    branchId: string | null;
    kind: EntityChangeKind;
}

export interface EntityChangedEvent {
    branchId: string | null;
    entities: EntityChangeKind[];
}

/**
 * Trailing window that coalesces a burst of writes into one event per branch, so a bulk operation wakes
 * clients once, not once per row. It is not what orders hints after a commit: the extension holds a
 * transaction's hints and emits them only after it commits.
 */
export const ENTITY_CHANGE_COALESCE_MS = 300;

interface PendingBatch {
    branchId: string | null;
    kinds: Set<EntityChangeKind>;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * In-process hint bus behind `GET /realtime/events`. The Prisma entity-change extension calls
 * `emit` after a watched write; bursts are coalesced per branch for `windowMs` (trailing) and
 * published as ONE event carrying the distinct kinds. The payload is deliberately only a
 * "something of this kind changed" hint — clients refetch, so no row data ever travels here.
 */
@Injectable()
export class EntityChangeEventBus {
    private readonly logger = new Logger(EntityChangeEventBus.name);
    private readonly subject = new Subject<EntityChangedEvent>();
    private readonly pending = new Map<string, PendingBatch>();

    readonly events$: Observable<EntityChangedEvent> = this.subject.asObservable();

    constructor(private readonly windowMs: number = ENTITY_CHANGE_COALESCE_MS) {}

    emit(input: EntityChangeInput): void {
        const key = input.branchId ?? "\u0000null";
        const existing = this.pending.get(key);
        if (existing) {
            // Fixed window: later writes join the batch but never reset the timer, so a steady
            // burst cannot postpone the event forever.
            existing.kinds.add(input.kind);
            return;
        }

        const batch: PendingBatch = {
            branchId: input.branchId,
            kinds: new Set([input.kind]),
            timer: setTimeout(() => this.flush(key), this.windowMs),
        };
        // A pending hint must not keep the process (or a test run) alive on its own.
        batch.timer.unref?.();
        this.pending.set(key, batch);
    }

    private flush(key: string): void {
        const batch = this.pending.get(key);
        if (!batch) return;
        this.pending.delete(key);
        const event: EntityChangedEvent = { branchId: batch.branchId, entities: [...batch.kinds] };
        this.logger.debug(`publish branch=${event.branchId ?? "*"} entities=${event.entities.join(",")}`);
        this.subject.next(event);
    }
}

/**
 * Module-level singleton. The Prisma extension is built inside `@Global DatabaseModule`'s
 * factory, which must not inject from `RealtimeModule` (that would close a
 * DatabaseModule -> RealtimeModule -> guards -> PrismaService cycle), so both sides share this
 * instance instead: the extension imports it, `RealtimeModule` provides it via `useValue`.
 */
export const entityChangeEventBus = new EntityChangeEventBus();
