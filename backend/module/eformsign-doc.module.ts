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
    ListClientNamesByBranchUsecase,
    SyncClientEndDateUsecase,
    DispatchDocumentHeadlessUsecase,
    FinalizeDocumentHeadlessUsecase,
} from "application/usecases/eformsign-doc";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { EFORMSIGN_CLIENT_REPOSITORY } from "domain/repositories/eformsign.client.interface";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { AreaTemplateModule } from "module/area-template.module";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";

@Module({
    imports: [DatabaseModule, AreaTemplateModule],
    controllers: [EformsignDocController],
    providers: [
        // Use cases - Local DB
        FindEformsignDocByIdUsecase,
        FindEformsignDocByDocumentIdUsecase,
        FindEformsignDocsByClientIdUsecase,
        ListEformsignDocsUsecase,
        CreateEformsignDocUsecase,
        ListPendingStaffCompletionUsecase,
        ListClientNamesByBranchUsecase,
        SyncClientEndDateUsecase,
        // Use cases - External API
        GetEformsignAccessTokenUsecase,
        RefreshEformsignAccessTokenUsecase,
        FetchAllEformsignDocsFromApiUsecase,
        FetchEformsignDocFromApiUsecase,
        // Use cases - Contract creation
        CreateAndSendContractUsecase,
        // Use cases - Headless dispatch (BJJ-90)
        DispatchDocumentHeadlessUsecase,
        FinalizeDocumentHeadlessUsecase,
        // Services
        EformsignDocService,
        EformsignService,
        EformsignHeadlessService,
        EformsignDocsEventBus,
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
    exports: [EformsignDocService, SyncClientEndDateUsecase, EformsignDocsEventBus, EFORMSIGN_CLIENT_REPOSITORY],
})
export class EformsignDocModule {}
