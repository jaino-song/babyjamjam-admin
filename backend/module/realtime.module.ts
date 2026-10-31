import { Module } from "@nestjs/common";

import { EntityChangeEventBus, entityChangeEventBus } from "application/services/entity-change-event-bus.service";
import { createEntityChangeTransport } from "infrastructure/realtime/create-entity-change-transport";
import { ENTITY_CHANGE_TRANSPORT } from "infrastructure/realtime/entity-change-transport";
import { RealtimeController } from "interface/controllers/realtime.controller";

/**
 * Serves the branch-scoped `GET /realtime/events` stream. The bus is the process-wide singleton
 * (not a class provider) because the Prisma entity-change extension, built inside the @Global
 * DatabaseModule factory, has to emit into the very same instance. JwtGuard/TenantGuard resolve
 * through the global TenantModule and the app-wide passport strategy, as in other controllers.
 *
 * The transport (Valkey stream when `VALKEY_URL` is set, in-process otherwise) is what lets every
 * backend instance serve every connection; Nest closes its Valkey connections on shutdown.
 */
@Module({
    controllers: [RealtimeController],
    providers: [
        { provide: EntityChangeEventBus, useValue: entityChangeEventBus },
        {
            provide: ENTITY_CHANGE_TRANSPORT,
            useFactory: (bus: EntityChangeEventBus) => createEntityChangeTransport(bus),
            inject: [EntityChangeEventBus],
        },
    ],
    exports: [EntityChangeEventBus],
})
export class RealtimeModule {}
