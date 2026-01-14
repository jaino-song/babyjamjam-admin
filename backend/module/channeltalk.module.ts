import { Module } from "@nestjs/common";
import { CHANNELTALK_API_PORT } from "domain/ports/channeltalk-api.port";
import { ChannelTalkApiClient } from "infrastructure/api/channeltalk-api.client";
import {
    UpsertUserUsecase,
    CreateEventUsecase,
    SendAlimtalkUsecase,
} from "application/usecases/channeltalk";
import { ChannelTalkService } from "application/services/channeltalk.service";
import { ChannelTalkSchedulerService } from "application/services/channeltalk-scheduler.service";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { PrismaService } from "infrastructure/database/prisma.service";

@Module({
    providers: [
        // Port -> Adapter binding (DI)
        { provide: CHANNELTALK_API_PORT, useClass: ChannelTalkApiClient },
        // Repository binding for scheduler (avoids circular dependency with ClientModule)
        { provide: CLIENT_REPOSITORY, useClass: SbClientRepository },
        PrismaService,
        // Use cases
        UpsertUserUsecase,
        CreateEventUsecase,
        SendAlimtalkUsecase,
        // Application services
        ChannelTalkService,
        // Scheduler service (P3 - cron jobs)
        ChannelTalkSchedulerService,
    ],
    exports: [
        // Export ChannelTalkService so other modules (ClientModule, etc.) can use it
        ChannelTalkService,
    ],
})
export class ChannelTalkModule {}
