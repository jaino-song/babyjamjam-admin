import { Module } from "@nestjs/common";
import { ALIGO_API_PORT } from "domain/ports/aligo-api.port";
import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import { SendAligoAlimtalkUsecase } from "application/usecases/aligo";
import { AligoService } from "application/services/aligo.service";

@Module({
    providers: [
        { provide: ALIGO_API_PORT, useClass: AligoApiClient },
        SendAligoAlimtalkUsecase,
        AligoService,
    ],
    exports: [AligoService],
})
export class AligoModule {}
