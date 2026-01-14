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
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientService } from "application/services/client.service";
import { ClientController } from "interface/controllers/client.controller";
import { ChannelTalkModule } from "./channeltalk.module";

@Module({
    imports: [ChannelTalkModule],
    controllers: [ClientController],
    providers: [
        CreateClientUsecase,
        DeleteClientUsecase,
        FindClientByIdUsecase,
        ListClientsUsecase,
        ListClientsPaginatedUsecase,
        UpdateClientUsecase,
        ClientService,
        PrismaService,
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
    ],
    exports: [ClientService],
})
export class ClientModule {}
