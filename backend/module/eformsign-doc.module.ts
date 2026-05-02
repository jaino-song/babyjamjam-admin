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
    CreateAndSendContractUsecase,
    ListPendingStaffCompletionUsecase,
    SyncClientEndDateUsecase,
} from "application/usecases/eformsign-doc";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { EFORMSIGN_CLIENT_REPOSITORY } from "domain/repositories/eformsign.client.interface";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [EformsignDocController],
    providers: [
        // Use cases - Local DB
        FindEformsignDocByIdUsecase,
        FindEformsignDocByDocumentIdUsecase,
        FindEformsignDocsByClientIdUsecase,
        ListEformsignDocsUsecase,
        CreateEformsignDocUsecase,
        ListPendingStaffCompletionUsecase,
        SyncClientEndDateUsecase,
        // Use cases - External API
        GetEformsignAccessTokenUsecase,
        RefreshEformsignAccessTokenUsecase,
        FetchAllEformsignDocsFromApiUsecase,
        FetchEformsignDocFromApiUsecase,
        // Use cases - Contract creation
        CreateAndSendContractUsecase,
        // Service
        EformsignDocService,
        // Repository bindings
        {
            provide: EFORMSIGN_DOC_REPOSITORY,
            useClass: SbEformsignDocRepository,
        },
        {
            provide: EFORMSIGN_CLIENT_REPOSITORY,
            useClass: EformsignApiClient,
        },
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
    ],
    exports: [EformsignDocService, SyncClientEndDateUsecase, EFORMSIGN_CLIENT_REPOSITORY],
})
export class EformsignDocModule {}
