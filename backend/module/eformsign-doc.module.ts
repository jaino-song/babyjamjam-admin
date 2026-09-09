import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    FindEformsignDocByIdUsecase,
    FindEformsignDocByDocumentIdUsecase,
    FindEformsignDocsByClientIdUsecase,
    ListEformsignDocsUsecase,
    ListOtherBranchDocumentIdsUsecase,
    ListEformsignDocDisplayFieldsUsecase,
    FetchAllEformsignDocsFromApiUsecase,
    FetchEformsignDocFromApiUsecase,
    UpdateEformsignDocStatusUsecase,
    LinkDocumentToClientUsecase,
    CreateEformsignDocUsecase,
    CreateAndSendContractUsecase,
    ListClientNamesByBranchUsecase,
    ListReviewStageContractsUsecase,
    SyncClientEndDateUsecase,
    DispatchDocumentHeadlessUsecase,
    FinalizeDocumentHeadlessUsecase,
    AdoptEformsignDocUsecase,
    MirrorUnassignedEformsignDocUsecase,
    BackfillEformsignDocsUsecase,
    LinkMirroredEformsignDocByPhoneUsecase,
    GetContractClientCandidateUsecase,
} from "application/usecases/eformsign-doc";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { EFORMSIGN_CLIENT_REPOSITORY } from "domain/repositories/eformsign.client.interface";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { createEformsignClientRepository } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignCredentialBoundary } from "application/services/eformsign-credential-boundary.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { AreaTemplateModule } from "module/area-template.module";
import { MessageModule } from "module/message.module";
import { SystemSettingModule } from "module/system-setting.module";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import { EformsignDocReconcileSchedulerService } from "application/services/eformsign-doc-reconcile-scheduler.service";
import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { EFORMSIGN_WEBHOOK_EVENT_REPOSITORY } from "domain/repositories/eformsign-webhook-event.repository.interface";
import { SbEformsignWebhookEventRepository } from "infrastructure/database/repositories/sb.eformsign-webhook-event.repository";
import { ContractAutoFinalizeSchedulerService } from "application/services/contract-auto-finalize-scheduler.service";
import { NotificationModule } from "module/notification.module";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY } from "domain/repositories/eformsign-document-mirror.repository.interface";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";
import {
    createEformsignBackfillRedisClient,
    EFORMSIGN_BACKFILL_REDIS_CLIENT,
    EformsignBackfillLockService,
} from "infrastructure/locking/eformsign-backfill-lock.service";
import { EformsignOperationLockService } from "infrastructure/locking/eformsign-operation-lock.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { EformsignMirrorReadinessService } from "application/services/eformsign-mirror-readiness.service";
import { ReconcileCompletedMirroredEformsignDocUsecase } from "application/usecases/eformsign-doc/reconcile-completed-mirrored-eformsign-doc.usecase";
import { EformsignAgentCapabilitiesProvider } from "application/usecases/eformsign-doc/eformsign-agent-capabilities.provider";
import { ContractExternalAgentCapabilitiesProvider } from "application/usecases/eformsign-doc/contract-external-agent-capabilities.provider";
import { FindClientByIdUsecase } from "application/usecases/client/find-client-by-id.usecase";
import { CreateEmployeeUsecase } from "application/usecases/employee/create-employee.usecase";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { EformsignDocumentJobWorkerService } from "application/services/eformsign-document-job-worker.service";
import {
    SERVICE_RECORD_REVISION_GENERATION,
} from "application/services/eformsign-document-job-worker.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { SERVICE_RECORD_EDIT_REPOSITORY } from "domain/repositories/service-record-edit.repository.interface";
import { EformsignDocumentJobReconciliationService } from "application/services/eformsign-document-job-reconciliation.service";
import { EFORMSIGN_DOCUMENT_JOB_REPOSITORY } from "domain/repositories/eformsign-document-job.repository.interface";
import { EMPLOYEE_REPOSITORY } from "domain/repositories/employee.repository.interface";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { EFORMSIGN_DISPATCH_INTENT_REPOSITORY } from "domain/repositories/eformsign-dispatch-intent.repository.interface";
import { SbEformsignDispatchIntentRepository } from "infrastructure/database/repositories/sb.eformsign-dispatch-intent.repository";
import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
import {
    ServiceRecordContractRevisionService,
    SERVICE_RECORD_CONTRACT_REVISION_PROVIDER,
    SERVICE_RECORD_CONTRACT_REVISION_DISPATCH,
} from "application/services/service-record-contract-revision.service";
import {
    ReceiptLinkRevisionRefreshService,
    RECEIPT_LINK_REVISION_PDF_SOURCE,
    RECEIPT_LINK_REVISION_RASTERIZER,
    RECEIPT_LINK_REVISION_PDF_VERIFIER,
} from "application/services/receipt-link-revision-refresh.service";
import {
    SERVICE_RECORD_REVISION_OPERATION_COORDINATOR,
    ServiceRecordRevisionDocumentCoordinator,
} from "application/services/service-record-revision-document-coordinator.service";
import {
    UnverifiedReceiptLinkRevisionPdfSource,
    UnverifiedServiceRecordContractRevisionDispatch,
    UnverifiedServiceRecordContractRevisionProvider,
} from "application/services/service-record-revision-unverified-adapters.service";
import { FILE_STORAGE_PORT } from "domain/ports/file-storage.port";
import { RECEIPT_LINK_TOKEN_REPOSITORY } from "domain/repositories/receipt-link-token.repository.interface";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { SupabaseStorageAdapter } from "infrastructure/adapters/supabase-storage.adapter";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";
import { ReceiptPdfVerifierService } from "infrastructure/pdf/receipt-pdf-verifier.service";

@Module({
    imports: [
        DatabaseModule,
        AreaTemplateModule,
        MessageModule,
        SystemSettingModule,
        NotificationModule,
    ],
    controllers: [EformsignDocController],
    providers: [
        CreateEmployeeUsecase,
        // Use cases - Local DB
        FindEformsignDocByIdUsecase,
        FindEformsignDocByDocumentIdUsecase,
        FindEformsignDocsByClientIdUsecase,
        ListEformsignDocsUsecase,
        ListOtherBranchDocumentIdsUsecase,
        ListEformsignDocDisplayFieldsUsecase,
        CreateEformsignDocUsecase,
        UpdateEformsignDocStatusUsecase,
        LinkDocumentToClientUsecase,
        ListClientNamesByBranchUsecase,
        ListReviewStageContractsUsecase,
        FindClientByIdUsecase,
        SyncClientEndDateUsecase,
        // Use cases - External API
        FetchAllEformsignDocsFromApiUsecase,
        FetchEformsignDocFromApiUsecase,
        // Use cases - Contract creation
        CreateAndSendContractUsecase,
        // Use case - Service record snapshot (BJJ-247)
        CreateAndSendServiceRecordSnapshotUsecase,
        // Use cases - Headless dispatch (BJJ-90)
        DispatchDocumentHeadlessUsecase,
        FinalizeDocumentHeadlessUsecase,
        AdoptEformsignDocUsecase,
        MirrorUnassignedEformsignDocUsecase,
        LinkMirroredEformsignDocByPhoneUsecase,
        GetContractClientCandidateUsecase,
        ReconcileCompletedMirroredEformsignDocUsecase,
        BackfillEformsignDocsUsecase,
        // Services
        EformsignDocService,
        EformsignService,
        EformsignCredentialBoundary,
        EformsignHeadlessService,
        EformsignDocsEventBus,
        EformsignHeadlessProgressService,
        ContractClientAssignmentGuardService,
        EformsignDocumentSnapshotService,
        EformsignBackfillLockService,
        EformsignOperationLockService,
        EformsignDocReconcileSchedulerService,
        // The scheduler owns the ledger's retention sweep; the writer itself is
        // also provided by the webhook module, which has its own instance.
        EformsignWebhookEventWriter,
        {
            provide: EFORMSIGN_WEBHOOK_EVENT_REPOSITORY,
            useClass: SbEformsignWebhookEventRepository,
        },
        ContractAutoFinalizeSchedulerService,
        EformsignDocumentMirrorService,
        ServiceRecordLifecycleService,
        EformsignMirrorReadinessService,
        EformsignAgentCapabilitiesProvider,
        ContractExternalAgentCapabilitiesProvider,
        EformsignDocumentJobService,
        EformsignDocumentJobWorkerService,
        EformsignDocumentJobReconciliationService,
        // Revision document operations.  Revised provider capability is
        // intentionally fail-closed until an identity-bound Phase0 registry
        // entry exists; the adapter bindings below never call a vendor.
        ServiceRecordContractRevisionService,
        ReceiptLinkRevisionRefreshService,
        ServiceRecordRevisionDocumentCoordinator,
        UnverifiedServiceRecordContractRevisionProvider,
        UnverifiedServiceRecordContractRevisionDispatch,
        UnverifiedReceiptLinkRevisionPdfSource,
        ReceiptPdfVerifierService,
        PdfPageRasterizerService,
        SupabaseStorageAdapter,
        {
            provide: SERVICE_RECORD_REVISION_OPERATION_COORDINATOR,
            useExisting: ServiceRecordRevisionDocumentCoordinator,
        },
        {
            provide: SERVICE_RECORD_CONTRACT_REVISION_PROVIDER,
            useExisting: UnverifiedServiceRecordContractRevisionProvider,
        },
        {
            provide: SERVICE_RECORD_CONTRACT_REVISION_DISPATCH,
            useExisting: UnverifiedServiceRecordContractRevisionDispatch,
        },
        {
            provide: RECEIPT_LINK_REVISION_PDF_SOURCE,
            useExisting: UnverifiedReceiptLinkRevisionPdfSource,
        },
        {
            provide: RECEIPT_LINK_REVISION_RASTERIZER,
            useExisting: PdfPageRasterizerService,
        },
        {
            provide: RECEIPT_LINK_REVISION_PDF_VERIFIER,
            useExisting: ReceiptPdfVerifierService,
        },
        {
            provide: FILE_STORAGE_PORT,
            useExisting: SupabaseStorageAdapter,
        },
        {
            provide: RECEIPT_LINK_TOKEN_REPOSITORY,
            useClass: SbReceiptLinkTokenRepository,
        },
        // The snapshot renderer owns the revision-generation implementation;
        // the worker consumes it through a narrow token so legacy contract
        // jobs never receive revision payloads as mutable contractData.
        {
            provide: SERVICE_RECORD_REVISION_GENERATION,
            useExisting: CreateAndSendServiceRecordSnapshotUsecase,
        },
        EformsignDispatchBoundaryService,
        // Repository bindings
        {
            provide: EFORMSIGN_DOC_REPOSITORY,
            useClass: SbEformsignDocRepository,
        },
        {
            provide: EFORMSIGN_CLIENT_REPOSITORY,
            inject: [ConfigService],
            useFactory: createEformsignClientRepository,
        },
        {
            provide: EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY,
            useClass: SbEformsignDocumentMirrorRepository,
        },
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
        {
            provide: EMPLOYEE_REPOSITORY,
            useClass: SbEmployeeRepository,
        },
        {
            provide: EFORMSIGN_DOCUMENT_JOB_REPOSITORY,
            useClass: SbEformsignDocumentJobRepository,
        },
        // EformsignDocModule is also used as a standalone worker graph. Keep
        // its snapshot renderer's transaction-bound repository available
        // without importing ServiceRecordEntryModule (which imports this
        // module and would create a cycle).
        {
            provide: SERVICE_RECORD_EDIT_REPOSITORY,
            useClass: ServiceRecordEditRepository,
        },
        {
            provide: EFORMSIGN_DISPATCH_INTENT_REPOSITORY,
            useClass: SbEformsignDispatchIntentRepository,
        },
        {
            provide: EFORMSIGN_BACKFILL_REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: createEformsignBackfillRedisClient,
        },
    ],
    exports: [
        EformsignDocService,
        EformsignCredentialBoundary,
        SyncClientEndDateUsecase,
        EformsignDocsEventBus,
        EformsignHeadlessProgressService,
        EFORMSIGN_CLIENT_REPOSITORY,
        EFORMSIGN_DOC_REPOSITORY,
        CreateAndSendServiceRecordSnapshotUsecase,
        EformsignDocumentSnapshotService,
        MirrorUnassignedEformsignDocUsecase,
        BackfillEformsignDocsUsecase,
        EformsignBackfillLockService,
        EformsignDocumentMirrorService,
        EformsignMirrorReadinessService,
        ReconcileCompletedMirroredEformsignDocUsecase,
        LinkMirroredEformsignDocByPhoneUsecase,
        GetContractClientCandidateUsecase,
        EformsignDocumentJobService,
        EformsignDispatchBoundaryService,
        ServiceRecordRevisionDocumentCoordinator,
        SERVICE_RECORD_REVISION_OPERATION_COORDINATOR,
        ServiceRecordContractRevisionService,
        ReceiptLinkRevisionRefreshService,
    ],
})
export class EformsignDocModule {}
