import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ALIGO_API_PORT } from "domain/ports/aligo-api.port";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import {
    SendAligoAlimtalkUsecase,
    SendAligoSmsUsecase,
} from "application/usecases/aligo";
import { AligoService } from "application/services/aligo.service";
import { MESSAGE_LOG_REPOSITORY } from "domain/repositories/message-log.repository.interface";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { createAligoPortClient } from "infrastructure/vendor-stubs/e2e-vendor-stubs";

@Module({
    imports: [DatabaseModule],
    providers: [
        {
            provide: AligoApiClient,
            inject: [ConfigService],
            useFactory: createAligoPortClient,
        },
        { provide: ALIGO_API_PORT, useExisting: AligoApiClient },
        { provide: ALIGO_SMS_API_PORT, useExisting: AligoApiClient },
        { provide: MESSAGE_LOG_REPOSITORY, useClass: SbMessageLogRepository },
        SendAligoAlimtalkUsecase,
        SendAligoSmsUsecase,
        AligoService,
    ],
    exports: [
        AligoService,
        SendAligoAlimtalkUsecase,
        SendAligoSmsUsecase,
        MESSAGE_LOG_REPOSITORY,
        ALIGO_API_PORT,
        ALIGO_SMS_API_PORT,
    ],
})
export class AligoModule {}
