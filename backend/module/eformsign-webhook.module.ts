import { Module } from "@nestjs/common";
import { EformsignWebhookController } from "interface/controllers/eformsign-webhook.controller";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import {
    UpdateEformsignDocStatusUsecase,
    LinkDocumentToClientUsecase,
} from "application/usecases/eformsign-doc";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { EMPLOYEE_SCHEDULE_REPOSITORY } from "domain/repositories/employee-schedule.repository.interface";
import { EMPLOYEE_REPOSITORY } from "domain/repositories/employee.repository.interface";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { WebhookGuard } from "infrastructure/auth/webhook.guard";
import { AlimtalkModule } from "./alimtalk.module";
import { EformsignDocModule } from "./eformsign-doc.module";

@Module({
    imports: [DatabaseModule, AlimtalkModule, EformsignDocModule],
    controllers: [EformsignWebhookController],
    providers: [
        WebhookGuard,
        EformsignWebhookService,
        UpdateEformsignDocStatusUsecase,
        LinkDocumentToClientUsecase,
        {
            provide: EFORMSIGN_DOC_REPOSITORY,
            useClass: SbEformsignDocRepository,
        },
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
        {
            provide: EMPLOYEE_SCHEDULE_REPOSITORY,
            useClass: SbEmployeeScheduleRepository,
        },
        {
            provide: EMPLOYEE_REPOSITORY,
            useClass: SbEmployeeRepository,
        },
    ],
})
export class EformsignWebhookModule {}
