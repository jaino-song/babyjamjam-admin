import { Module } from "@nestjs/common";
import { EformsignWebhookController } from "interface/controllers/eformsign-webhook.controller";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import {
    UpdateEformsignDocStatusUsecase,
    LinkDocumentToClientUsecase,
} from "application/usecases/eformsign-doc";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { PrismaService } from "infrastructure/database/prisma.service";

@Module({
    controllers: [EformsignWebhookController],
    providers: [
        // Service
        EformsignWebhookService,
        // Use cases
        UpdateEformsignDocStatusUsecase,
        LinkDocumentToClientUsecase,
        // Infrastructure
        PrismaService,
        // Repository bindings
        {
            provide: EFORMSIGN_DOC_REPOSITORY,
            useClass: SbEformsignDocRepository,
        },
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
    ],
})
export class EformsignWebhookModule {}
