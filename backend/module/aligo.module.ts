import { Module } from "@nestjs/common";
import { ALIGO_API_PORT } from "domain/ports/aligo-api.port";
import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import { SendAligoAlimtalkUsecase } from "application/usecases/aligo";
import { AligoService } from "application/services/aligo.service";
import { ALIMTALK_LOG_REPOSITORY } from "domain/repositories/alimtalk-log.repository.interface";
import { SbAlimtalkLogRepository } from "infrastructure/database/repositories/sb.alimtalk-log.repository";
import { PrismaService } from "infrastructure/database/prisma.service";

@Module({
    providers: [
        { provide: ALIGO_API_PORT, useClass: AligoApiClient },
        { provide: ALIMTALK_LOG_REPOSITORY, useClass: SbAlimtalkLogRepository },
        PrismaService,
        SendAligoAlimtalkUsecase,
        AligoService,
    ],
    exports: [AligoService, ALIMTALK_LOG_REPOSITORY, ALIGO_API_PORT],
})
export class AligoModule {}
