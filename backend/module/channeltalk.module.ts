import { Module } from "@nestjs/common";
import { CHANNELTALK_API_PORT } from "domain/ports/channeltalk-api.port";
import { ChannelTalkApiClient } from "infrastructure/api/channeltalk-api.client";
import {
    UpsertUserUsecase,
    CreateEventUsecase,
    SendAlimtalkUsecase,
} from "application/usecases/channeltalk";
import { ChannelTalkService } from "application/services/channeltalk.service";

@Module({
    providers: [
        // Port -> Adapter binding (DI)
        { provide: CHANNELTALK_API_PORT, useClass: ChannelTalkApiClient },
        // Use cases
        UpsertUserUsecase,
        CreateEventUsecase,
        SendAlimtalkUsecase,
        ChannelTalkService,
    ],
    exports: [ChannelTalkService],
})
export class ChannelTalkModule {}
