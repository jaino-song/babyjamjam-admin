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
     * Server-Sent Events. Every message carries `id` = an opaque token for this connection's
     * position in the batch stream, so a client that reconnects with it (`?since=` or
     * `Last-Event-ID`) can be resumed without gaps or duplicates.
     *
     * The position advances only on batches this connection actually receives. Batches of other
     * branches change nothing it can see: ids and pings stay identical while only other branches
     * write, so a branch cannot count or time another branch's writes. The one exception is the
     * connect itself, where the position moves to the end of what the server scanned (everything
     * visible up to there has been delivered), so a quiet branch still resumes later without
     * falling out of retention.
     *
     * - `ready` `{resumed}` opens every connection; `resumed: true` means `since` was honoured and
     *   the retained batches after it follow immediately, then live ones.
     * - `entity-changed` `{entities: [...kinds]}` for the caller's branch or an unscoped system write.
     *   It carries no row data and never the branch id; clients refetch their own lists.
     * - `reset` `{}` when continuity can no longer be promised (transport switch, Valkey loss).
     * - `ping` every 30s, carrying the current position token.
     */
    @Sse("events")
    events(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("since") since?: unknown,
        @Headers("last-event-id") lastEventId?: unknown,
    ): Observable<MessageEvent> {
        const branchId = tenant.branchId ?? "";
        const codec = this.transport.cursors;
        const requested = pickRequestedCursor(since, lastEventId);
        // Token validity (length, charset, authenticity) is decided here, in one place: anything
        // unusable is treated like an expired cursor.
        const requestedCursor = typeof requested === "string" ? codec.decode(requested) : null;

        return new Observable<MessageEvent>((subscriber) => {
            let position = this.transport.position();
            // Encrypted once per position change and reused, so repeated pings on an unchanged
            // position carry an identical id.
            let positionToken: string | null = null;
            const setPosition = (next: string): void => {
                if (next === position) return;
                position = next;
                positionToken = null;
            };
            const idOfPosition = (): string => (positionToken ??= codec.encode(position));

            let ready = false;
            // Highest cursor already sent through replay; live batches at or below it are duplicates.
            let dedupeUpTo: string | null = null;
            const held: TransportSignal[] = [];

            const handle = (signal: TransportSignal): void => {
                if (signal.type === "reset") {
                    setPosition(signal.position);
                    dedupeUpTo = null;
                    subscriber.next({ id: idOfPosition(), type: "reset", data: {} });
                    return;
                }
                if (dedupeUpTo !== null) {
                    const order = compareCursors(signal.cursor, dedupeUpTo);
                    if (order !== null && order <= 0) return;
                }
                // A `null` branch is a broadcast (system scope / unknown branch). A batch for another
                // branch is invisible here: it must not move the position or produce any message.
                if (signal.branchId !== null && signal.branchId !== branchId) return;
                setPosition(signal.cursor);
                subscriber.next({ id: idOfPosition(), type: "entity-changed", data: { entities: signal.entities } });
            };

            // Live first, replay second: nothing that happens while the retained range is being read can
            // fall between the two.
            const live = this.transport.signals$.subscribe({
                next: (signal) => (ready ? handle(signal) : held.push(signal)),
                complete: () => subscriber.complete(),
            });

            const open = (resumed: boolean, replay: DeliveredBatch[]): void => {
                ready = true;
                subscriber.next({ id: idOfPosition(), type: "ready", data: { resumed } });
                for (const batch of replay) handle(batch);
                // Live batches the replay already covered are dropped by cursor; the rest follow in order.
                const newest = replay[replay.length - 1];
                if (newest) dedupeUpTo = newest.cursor;
                for (const signal of held.splice(0)) handle(signal);
                if (resumed) {
                    // Every visible batch up to the transport's position is delivered by now (replayed,
                    // held, or live), so the connection may claim it: a quiet branch keeps a position that
                    // has not fallen behind the retained range. Never backwards, never across id spaces.
                    const end = this.transport.position();
                    const order = compareCursors(end, position);
                    if (order !== null && order > 0) setPosition(end);
                }
            };

            const openFresh = (): void => {
                // The client refetches everything; batches that arrived while we decided are already
                // reflected in the position it starts from.
                setPosition(this.transport.position());
                dedupeUpTo = position;
                open(false, []);
            };

            if (requested === null) {
                open(false, []);
            } else if (requestedCursor === null) {
                openFresh();
            } else {
                void this.transport.replayAfter(requestedCursor).then(
                    (result) => {
                        if (subscriber.closed) return;
                        if (result.honoured) {
                            setPosition(requestedCursor);
                            dedupeUpTo = requestedCursor;
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
                if (ready) subscriber.next({ id: idOfPosition(), type: "ping", data: { at: Date.now() } });
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
