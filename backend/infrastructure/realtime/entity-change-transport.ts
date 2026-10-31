import type { Observable } from "rxjs";

import type { EntityChangeKind } from "application/services/entity-change-event-bus.service";
import type { CursorCodec } from "./entity-change-cursor-codec";

/** One flushed bus batch, stamped with the cursor of the stream it travelled on. */
export interface DeliveredBatch {
    type: "batch";
    cursor: string;
    branchId: string | null;
    entities: EntityChangeKind[];
}

/**
 * The transport can no longer promise continuity (it switched between Valkey and in-process, or
 * Valkey was lost or came back). `position` is the cursor to carry on from in the new id space.
 */
export interface TransportReset {
    type: "reset";
    position: string;
}

export type TransportSignal = DeliveredBatch | TransportReset;

/**
 * A resume replays at most this many raw stream rows (all branches, before the controller filters
 * by branch). A client that missed more gets `resumed: false` and one full refetch instead of a
 * partial replay presented as complete. Applies to resume replay only: the live reader pages
 * through any backlog.
 */
export const REALTIME_REPLAY_LIMIT = 2000;

export type ReplayResult = { honoured: true; batches: DeliveredBatch[] } | { honoured: false };

/**
 * Carries bus batches to every open SSE connection, on this instance and (for Valkey) on the
 * others. `signals$` is hot: batches that this instance's own bus produced arrive through it too,
 * so a connection sees each batch exactly once.
 */
export interface EntityChangeTransport {
    readonly signals$: Observable<TransportSignal>;
    /** Turns internal cursors into the opaque ids clients see (shared key on every Valkey instance). */
    readonly cursors: CursorCodec;
    /** Cursor of the last batch this instance has delivered; never ahead of what `signals$` emitted. */
    position(): string;
    /**
     * Retained batches strictly after `since` (any branch, in stream order), or `honoured: false`
     * when `since` is unknown, expired, from another id space, or the stream cannot be read.
     */
    replayAfter(since: string): Promise<ReplayResult>;
}

export const ENTITY_CHANGE_TRANSPORT = Symbol("ENTITY_CHANGE_TRANSPORT");
