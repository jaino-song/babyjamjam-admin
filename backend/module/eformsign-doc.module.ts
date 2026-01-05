import { Module } from "@nestjs/common";
import {
    FindEformsignDocByIdUsecase,
    FindEformsignDocByDocumentIdUsecase,
    FindEformsignDocsByClientIdUsecase,
    ListEformsignDocsUsecase,
    GetEformsignAccessTokenUsecase,
    RefreshEformsignAccessTokenUsecase,
    FetchAllEformsignDocsFromApiUsecase,
    FetchEformsignDocFromApiUsecase,
    CreateEformsignDocUsecase,
} from "application/usecases/eformsign-doc";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { EFORMSIGN_CLIENT_REPOSITORY } from "domain/repositories/eformsign.client.interface";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";

@Module({
    controllers: [EformsignDocController],
    providers: [
        // Use cases - Local DB
        FindEformsignDocByIdUsecase,
        FindEformsignDocByDocumentIdUsecase,
        FindEformsignDocsByClientIdUsecase,
        ListEformsignDocsUsecase,
        CreateEformsignDocUsecase,
        // Use cases - External API
        GetEformsignAccessTokenUsecase,
        RefreshEformsignAccessTokenUsecase,
        FetchAllEformsignDocsFromApiUsecase,
        FetchEformsignDocFromApiUsecase,
        // Service
        EformsignDocService,
        // Infrastructure
        PrismaService,
        // Repository bindings
        {
            provide: EFORMSIGN_DOC_REPOSITORY,
            useClass: SbEformsignDocRepository,
        },
        {
            provide: EFORMSIGN_CLIENT_REPOSITORY,
            useClass: EformsignApiClient,
        },
    ],
    exports: [EformsignDocService],
})
export class EformsignDocModule {}

