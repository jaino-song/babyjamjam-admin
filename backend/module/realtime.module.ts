import { Module } from "@nestjs/common";

import { EntityChangeEventBus, entityChangeEventBus } from "application/services/entity-change-event-bus.service";
import { RealtimeController } from "interface/controllers/realtime.controller";

/**
 * Serves the branch-scoped `GET /realtime/events` stream. The bus is the process-wide singleton
 * (not a class provider) because the Prisma entity-change extension, built inside the @Global
 * DatabaseModule factory, has to emit into the very same instance. JwtGuard/TenantGuard resolve
 * through the global TenantModule and the app-wide passport strategy, as in other controllers.
 */
@Module({
    controllers: [RealtimeController],
    providers: [{ provide: EntityChangeEventBus, useValue: entityChangeEventBus }],
    exports: [EntityChangeEventBus],
})
export class RealtimeModule {}
