import { Controller, Headers, Inject, MessageEvent, Optional, Query, Sse, UseGuards } from "@nestjs/common";
import { Observable, interval } from "rxjs";

import { EntityChangeEventBus } from "application/services/entity-change-event-bus.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { compareCursors, isValidCursor } from "infrastructure/realtime/entity-change-cursor";
import { ENTITY_CHANGE_TRANSPORT } from "infrastructure/realtime/entity-change-transport";
import type { DeliveredBatch, EntityChangeTransport, TransportSignal } from "infrastructure/realtime/entity-change-transport";
import { InProcessEntityChangeTransport } from "infrastructure/realtime/in-process-entity-change-transport";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";

@Controller("realtime")
@UseGuards(JwtGuard, TenantGuard)
export class RealtimeController {
    private readonly transport: EntityChangeTransport;

    constructor(
        eventBus: EntityChangeEventBus,
        @Optional() @Inject(ENTITY_CHANGE_TRANSPORT) transport?: EntityChangeTransport,
    ) {
        this.transport = transport ?? new InProcessEntityChangeTransport(eventBus);
    }

    /**
     * GET /realtime/events[?since=<cursor>]
     * Server-Sent Events. Every message carries `id` = this connection's position in the batch
     * stream (the last cursor it passed, including batches it did not receive because they belong to
     * another branch), so a client that reconnects with it (`?since=` or `Last-Event-ID`) can be
     * resumed without gaps or duplicates.
     *
     * - `ready` `{resumed}` opens every connection; `resumed: true` means `since` was honoured and
     *   the retained batches after it follow immediately, then live ones.
     * - `entity-changed` `{entities: [...kinds]}` for the caller's branch or an unscoped system write.
     *   It carries no row data and never the branch id; clients refetch their own lists.
     * - `reset` `{}` when continuity can no longer be promised (transport switch, Valkey loss).
     * - `ping` every 30s, carrying the position so a quiet branch still advances its cursor.
     */
    @Sse("events")
    events(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("since") since?: unknown,
        @Headers("last-event-id") lastEventId?: unknown,
    ): Observable<MessageEvent> {
        const branchId = tenant.branchId ?? "";
        const requested = pickRequestedCursor(since, lastEventId);

        return new Observable<MessageEvent>((subscriber) => {
            let position = this.transport.position();
            let ready = false;
            // Highest cursor already sent through replay; live batches at or below it are duplicates.
            let dedupeUpTo: string | null = null;
            const held: TransportSignal[] = [];

            const handle = (signal: TransportSignal): void => {
                if (signal.type === "reset") {
                    position = signal.position;
                    dedupeUpTo = null;
                    subscriber.next({ id: position, type: "reset", data: {} });
                    return;
                }
                if (dedupeUpTo !== null) {
                    const order = compareCursors(signal.cursor, dedupeUpTo);
                    if (order !== null && order <= 0) return;
                }
                position = signal.cursor;
                // A `null` branch is a broadcast (system scope / unknown branch).
                if (signal.branchId === null || signal.branchId === branchId) {
                    subscriber.next({ id: signal.cursor, type: "entity-changed", data: { entities: signal.entities } });
                }
            };

            // Live first, replay second: nothing that happens while the retained range is being read can
            // fall between the two.
            const live = this.transport.signals$.subscribe({
                next: (signal) => (ready ? handle(signal) : held.push(signal)),
                complete: () => subscriber.complete(),
            });

            const open = (resumed: boolean, replay: DeliveredBatch[]): void => {
                ready = true;
                subscriber.next({ id: position, type: "ready", data: { resumed } });
                for (const batch of replay) handle(batch);
                // Live batches the replay already covered are dropped by cursor; the rest follow in order.
                const newest = replay[replay.length - 1];
                if (newest) dedupeUpTo = newest.cursor;
                for (const signal of held.splice(0)) handle(signal);
            };

            const openFresh = (): void => {
                // The client refetches everything; batches that arrived while we decided are already
                // reflected in the position it starts from.
                position = this.transport.position();
                dedupeUpTo = position;
                open(false, []);
            };

            if (requested === null) {
                open(false, []);
            } else if (requested === INVALID_CURSOR) {
                openFresh();
            } else {
                void this.transport.replayAfter(requested).then(
                    (result) => {
                        if (subscriber.closed) return;
                        if (result.honoured) {
                            position = requested;
                            dedupeUpTo = requested;
                            open(true, result.batches);
                        } else {
                            openFresh();
                        }
                    },
                    () => {
                        if (!subscriber.closed) openFresh();
                    },
                );
            }

            const heartbeat = interval(30000).subscribe(() => {
                if (ready) subscriber.next({ id: position, type: "ping", data: { at: Date.now() } });
            });

            return () => {
                live.unsubscribe();
                heartbeat.unsubscribe();
            };
        });
    }
}

const INVALID_CURSOR = Symbol("invalid-cursor");

/** Query wins over the header; an empty value counts as absent; anything unusable is not honoured. */
function pickRequestedCursor(since: unknown, lastEventId: unknown): string | typeof INVALID_CURSOR | null {
    const raw = since !== undefined && since !== "" ? since : lastEventId;
    if (raw === undefined || raw === "") return null;
    return isValidCursor(raw) ? raw : INVALID_CURSOR;
}
