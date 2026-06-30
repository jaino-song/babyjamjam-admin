import { Module } from "@nestjs/common";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsUsecase,
    ListClientsPaginatedUsecase,
    UpdateClientUsecase,
} from "application/usecases/client";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { ClientService } from "application/services/client.service";
import { ClientDueDateSchedulerService } from "application/services/client-due-date-scheduler.service";
import { ClientController } from "interface/controllers/client.controller";
import { AlimtalkModule } from "./alimtalk.module";
import { AligoModule } from "./aligo.module";
import { SystemSettingModule } from "./system-setting.module";
import { SystemTemplateModule } from "./system-template.module";

@Module({
    imports: [DatabaseModule, AlimtalkModule, AligoModule, SystemSettingModule, SystemTemplateModule],
    controllers: [ClientController],
    providers: [
        CreateClientUsecase,
        DeleteClientUsecase,
        FindClientByIdUsecase,
        ListClientsUsecase,
        ListClientsPaginatedUsecase,
        UpdateClientUsecase,
        ClientService,
        ClientDueDateSchedulerService,
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
    ],
    exports: [ClientService],
})
export class ClientModule {}
