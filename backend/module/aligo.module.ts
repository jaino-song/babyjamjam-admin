import { Module } from "@nestjs/common";
import { ALIGO_API_PORT } from "domain/ports/aligo-api.port";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import {
    SendAligoAlimtalkUsecase,
    SendAligoSmsUsecase,
} from "application/usecases/aligo";
import { AligoService } from "application/services/aligo.service";
import { ALIMTALK_LOG_REPOSITORY } from "domain/repositories/alimtalk-log.repository.interface";
import { SbAlimtalkLogRepository } from "infrastructure/database/repositories/sb.alimtalk-log.repository";
import { DatabaseModule } from "infrastructure/database/database.module";

@Module({
    imports: [DatabaseModule],
    providers: [
        AligoApiClient,
        { provide: ALIGO_API_PORT, useExisting: AligoApiClient },
        { provide: ALIGO_SMS_API_PORT, useExisting: AligoApiClient },
        { provide: ALIMTALK_LOG_REPOSITORY, useClass: SbAlimtalkLogRepository },
        SendAligoAlimtalkUsecase,
        SendAligoSmsUsecase,
        AligoService,
    ],
    exports: [AligoService, SendAligoAlimtalkUsecase, ALIMTALK_LOG_REPOSITORY, ALIGO_API_PORT, ALIGO_SMS_API_PORT],
})
export class AligoModule {}
