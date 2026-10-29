import { Controller, MessageEvent, Sse, UseGuards } from "@nestjs/common";
import { Observable, filter, interval, map, merge } from "rxjs";

import { EntityChangeEventBus } from "application/services/entity-change-event-bus.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";

@Controller("realtime")
@UseGuards(JwtGuard, TenantGuard)
export class RealtimeController {
    constructor(private readonly eventBus: EntityChangeEventBus) {}

    /**
     * GET /realtime/events
     * Server-Sent Events: an `entity-changed` hint (`{ entities: [...kinds] }`) whenever a watched
     * entity of the caller's branch — or an unscoped system write — changes, plus a `ping` every
     * 30s. The hint carries no row data and never the branch id; clients refetch their own lists.
     */
    @Sse("events")
    events(@CurrentTenant() tenant: { branchId?: string }): Observable<MessageEvent> {
        const branchId = tenant.branchId ?? "";

        const changes = this.eventBus.events$.pipe(
            // A `null` branch is a broadcast (system scope / unknown branch).
            filter((e) => e.branchId === null || e.branchId === branchId),
            map((e) => ({ data: { entities: e.entities }, type: "entity-changed" } as MessageEvent)),
        );

        const heartbeat = interval(30000).pipe(
            map(() => ({ data: { at: Date.now() }, type: "ping" } as MessageEvent)),
        );

        return merge(changes, heartbeat);
    }
}
