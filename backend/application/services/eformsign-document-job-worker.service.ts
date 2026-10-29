import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";

import type { ContractDataDto } from "application/dto/contract.dto";
import { EformsignDocumentJobReconciliationService } from "application/services/eformsign-document-job-reconciliation.service";
import { ContractAutoFinalizeSchedulerService } from "application/services/contract-auto-finalize-scheduler.service";
import {
    DispatchDocumentHeadlessUsecase,
    DispatchHeadlessResult,
} from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import {
    FinalizeDocumentHeadlessUsecase,
    FinalizeHeadlessResult,
} from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";
import {
    classifyRecovery,
    DISPATCH_AUTHORIZED_PROGRESS_STEP,
    EformsignDocumentJobEntity,
    isContractJob,
} from "domain/entities/eformsign-document-job.entity";
import {
    EFORMSIGN_DOCUMENT_JOB_REPOSITORY,
    IEformsignDocumentJobRepository,
} from "domain/repositories/eformsign-document-job.repository.interface";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";
import {
    CLIENT_REPOSITORY,
    IClientRepository,
} from "domain/repositories/client.repository.interface";
import type { StaffCompletionPrefillAmounts } from "application/services/eformsign.service";
import { createEformsignWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";
import { ContractSupersedeService } from "application/services/contract-supersede.service";
import { NotificationService } from "application/services/notification.service";
import { parsePrefillAmounts } from "application/services/eformsign-document-job.service";
import type {
    ServiceRecordRevisionGenerationInput,
    ServiceRecordRevisionDispatchContext,
} from "@babyjamjam/shared/types/service-record";
import {
    SERVICE_RECORD_REVISION_OPERATION_COORDINATOR,
    type ServiceRecordRevisionDocumentCoordinatorProcessInput,
    type ServiceRecordRevisionDocumentCoordinatorProcessResult,
} from "application/services/service-record-revision-document-coordinator.service";
import type { EformsignProviderPrincipal } from "application/services/eformsign-credential-boundary.service";
import {
    isRevisionDocumentDispatchAllowed,
    isValidServiceRecordDispatchContext,
} from "application/policies/service-record-revision-state.policy";

const WORKER_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_CUTOFF_MS = 5 * 60_000;
const PRE_SEND_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
const MAX_PRE_SEND_RETRIES = PRE_SEND_RETRY_DELAYS_MS.length;
const MAX_CONSECUTIVE_FINALIZE_STEPS = 3;
const WORKER_ENABLED_ENV = "EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED";
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60_000;
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60_000;
const RECOVERY_SWEEP_INTERVAL_MS = 60 * 60_000;
const RECOVERY_RENOTIFY_WINDOW_MS = 24 * 60 * 60_000;
const FALLBACK_CLIENT_NAME = "고객";
const TEMPLATE_WORKFLOW_FAILURE_REASONS = new Set([
    "template_workflow_config_invalid",
    "template_workflow_unsupported",
    "template_workflow_config_unavailable",
]);

function isTemplateWorkflowFailure(reason: unknown): reason is string {
    return typeof reason === "string" && TEMPLATE_WORKFLOW_FAILURE_REASONS.has(reason);
}

/**
 * The operation-lock service refused before the use case's browser/provider
 * body was entered (it is only raised while acquiring the lock), so no 전송
 * click could have run. Matches the exact reason: `operation_lock_lost` can
 * surface mid-flight and `operation_in_progress` belongs to another owner, so
 * neither is a verified pre-send refusal.
 */
function isLockUnavailableRefusal(
    result: DispatchHeadlessResult | FinalizeHeadlessResult,
): boolean {
    return "reason" in result
        && result.reason === "operation_lock_unavailable"
        && "outcome" in result
        && result.outcome === "NOT_APPLIED";
}

interface CreateDocumentJobPayload {
    clientId: number;
    contractData: ContractDataDto;
    progressId?: string;
    force?: boolean;
    /** The contract this re-issue replaces; cancelled once the new one is sent. */
    supersedeDocumentId?: string;
}

export const CONTRACT_SUPERSEDE_FAILED_NOTIFICATION_TYPE = "contract-supersede-failed";
export const EFORMSIGN_DOCUMENT_JOB_FAILED_NOTIFICATION_TYPE = "eformsign-document-job-failed";

interface FinalizeDocumentJobPayload {
    documentId?: string;
    prefillEndDate?: string;
    prefillAmounts?: StaffCompletionPrefillAmounts;
    progressId?: string;
}

type RevisionDocumentJobPayload = {
    kind: "service_record_revision";
    generationKind?: "REVISION_SNAPSHOT" | "INITIAL_FINALIZATION";
    context: ServiceRecordRevisionDispatchContext;
    immutablePayload: Record<string, unknown>;
    payloadFingerprint: string;
    completeness: "complete";
    revisionId?: string;
    revisionNumber?: number;
    documentStateId?: string;
    documentVersion?: number;
    snapshotReference?: string | null;
    generation?: string | null;
    manualReviewRequired?: boolean;
};

type RevisionOperationContractDescriptor = {
    documentStateId: string;
    generation: string;
};

type RevisionOperationReceiptDescriptor = {
    documentStateId: string;
    expectedGeneration: string;
};

/**
 * Operation jobs carry only persisted state identities and server-derived
 * dispatch context. Immutable snapshots and capability evidence stay behind
 * their operation services and are never accepted from a queued payload.
 */
export interface ServiceRecordRevisionOperationsJobPayload {
    kind: "service_record_revision_operations";
    context: ServiceRecordRevisionDispatchContext & { revisionId: string };
    operations: {
        contract?: RevisionOperationContractDescriptor;
        receipt?: RevisionOperationReceiptDescriptor;
    };
}

export interface ServiceRecordRevisionOperationCoordinatorPort {
    process(
        input: ServiceRecordRevisionDocumentCoordinatorProcessInput,
    ): Promise<ServiceRecordRevisionDocumentCoordinatorProcessResult>;
}

type CreateDispatchAuthorizationResult = {
    kind: "allow" | "stale" | "lost";
    reason?: string;
    /** The durable progress marker was committed before the provider call. */
    irreversible?: boolean;
};

const REVISION_JOB_KIND = "service_record_revision";
const REVISION_OPERATIONS_JOB_KIND = "service_record_revision_operations";
const INITIAL_FINALIZATION_REQUEST_PREFIX = "service-record-initial-finalization:";
const REVISION_REQUEST_PREFIX = "service-record-revision:";
const REVISION_OPERATIONS_REQUEST_PREFIX = "service-record-revision-operations:";

/**
 * Narrow caller boundary for a frozen revision generation.  The renderer is
 * provided by EformsignDocModule, but the job worker owns dispatch selection
 * and never reaches into its implementation.  Keeping this as an optional
 * token also leaves legacy test/module graphs fail-closed while a deployment
 * rolls out the renderer provider.
 */
export const SERVICE_RECORD_REVISION_GENERATION = Symbol("SERVICE_RECORD_REVISION_GENERATION");

export interface ServiceRecordRevisionGenerationPort {
    executeRevision(
        input: ServiceRecordRevisionGenerationInput,
        principal: EformsignProviderPrincipal,
    ): Promise<{
        documentIds: string[];
        documentVersion: number;
        chunkCount: number;
    }>;
}

function revisionPayload(value: unknown): RevisionDocumentJobPayload | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (row["kind"] !== REVISION_JOB_KIND) return null;
    const context = row["context"];
    if (!context || typeof context !== "object" || Array.isArray(context)) return null;
    const candidate = row as unknown as RevisionDocumentJobPayload;
    const initialGeneration = row["generationKind"] === "INITIAL_FINALIZATION";
    const outerRevisionId = row["revisionId"];
    const outerRevisionNumber = row["revisionNumber"];
    return isValidServiceRecordDispatchContext(candidate.context)
        && (!initialGeneration || (
            typeof outerRevisionId === "string"
            && outerRevisionId.length > 0
            && candidate.context.revisionId === outerRevisionId
            && Number.isInteger(outerRevisionNumber)
            && Number(outerRevisionNumber) > 0
        ))
        && candidate.completeness === "complete"
        && typeof candidate.payloadFingerprint === "string"
        && candidate.immutablePayload !== null
        && typeof candidate.immutablePayload === "object"
        && !Array.isArray(candidate.immutablePayload)
        ? candidate
        : null;
}

function revisionOperationsPayload(value: unknown): ServiceRecordRevisionOperationsJobPayload | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (row["kind"] !== REVISION_OPERATIONS_JOB_KIND) return null;

    const context = row["context"];
    if (
        !context
        || typeof context !== "object"
        || Array.isArray(context)
        || !isValidServiceRecordDispatchContext(context as ServiceRecordRevisionDispatchContext)
    ) {
        return null;
    }
    const revisionId = (context as Record<string, unknown>)["revisionId"];
    if (typeof revisionId !== "string" || revisionId.trim().length === 0) return null;

    const operations = row["operations"];
    if (!operations || typeof operations !== "object" || Array.isArray(operations)) return null;
    const operationRow = operations as Record<string, unknown>;

    const contractValue = operationRow["contract"];
    const contract = contractValue === undefined
        ? undefined
        : parseRevisionOperationContractDescriptor(contractValue);
    if (contract === null) return null;

    const receiptValue = operationRow["receipt"];
    const receipt = receiptValue === undefined
        ? undefined
        : parseRevisionOperationReceiptDescriptor(receiptValue);
    if (receipt === null) return null;
    if (contract === undefined && receipt === undefined) return null;
    if (contract && receipt && contract.generation === receipt.expectedGeneration) return null;

    return {
        kind: REVISION_OPERATIONS_JOB_KIND,
        context: context as ServiceRecordRevisionOperationsJobPayload["context"],
        operations: {
            ...(contract ? { contract } : {}),
            ...(receipt ? { receipt } : {}),
        },
    };
}

function parseRevisionOperationContractDescriptor(
    value: unknown,
): RevisionOperationContractDescriptor | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const documentStateId = row["documentStateId"];
    const generation = row["generation"];
    if (typeof documentStateId !== "string" || documentStateId.trim().length === 0) return null;
    if (typeof generation !== "string" || generation.trim().length === 0) return null;
    return { documentStateId: documentStateId.trim(), generation: generation.trim() };
}

function parseRevisionOperationReceiptDescriptor(
    value: unknown,
): RevisionOperationReceiptDescriptor | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const documentStateId = row["documentStateId"];
    const expectedGeneration = row["expectedGeneration"];
    if (typeof documentStateId !== "string" || documentStateId.trim().length === 0) return null;
    if (typeof expectedGeneration !== "string" || expectedGeneration.trim().length === 0) return null;
    return {
        documentStateId: documentStateId.trim(),
        expectedGeneration: expectedGeneration.trim(),
    };
}

function toRevisionGenerationInput(
    payload: RevisionDocumentJobPayload,
): ServiceRecordRevisionGenerationInput | null {
    const context = payload.context;
    const documentStateId = payload.documentStateId;
    const documentVersion = payload.documentVersion;
    const snapshotReference = payload.snapshotReference;
    const generation = payload.generation;
    if (
        typeof documentStateId !== "string"
        || documentStateId.trim().length === 0
        || typeof documentVersion !== "number"
        || !Number.isInteger(documentVersion)
        || documentVersion < 1
        || typeof snapshotReference !== "string"
        || snapshotReference.trim().length === 0
        || typeof generation !== "string"
        || generation.trim().length === 0
        || typeof payload.payloadFingerprint !== "string"
        || !/^[0-9a-f]{64}$/i.test(payload.payloadFingerprint)
        || !payload.immutablePayload
        || typeof payload.immutablePayload !== "object"
        || Array.isArray(payload.immutablePayload)
    ) {
        return null;
    }
    return {
        ...context,
        generationKind: payload.generationKind ?? "REVISION_SNAPSHOT",
        documentStateId,
        documentVersion,
        snapshotReference,
        generation,
        immutablePayload: payload.immutablePayload,
        payloadFingerprint: payload.payloadFingerprint,
        completeness: "complete",
    };
}

function isRevisionJobMarker(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    if (
        row["kind"] === REVISION_JOB_KIND
        || row["kind"] === REVISION_OPERATIONS_JOB_KIND
        || row["generationKind"] === "INITIAL_FINALIZATION"
        || row["revisionId"] !== undefined
    ) {
        return true;
    }
    const context = row["context"];
    return Boolean(
        context
        && typeof context === "object"
        && !Array.isArray(context)
        && "revisionId" in (context as Record<string, unknown>),
    );
}

function revisionRecoveryBlockReason(job: EformsignDocumentJobEntity): string | null {
    const revisionMarker = isRevisionJobMarker(job.payload)
        || job.requestKey.startsWith(INITIAL_FINALIZATION_REQUEST_PREFIX)
        || job.requestKey.startsWith(REVISION_REQUEST_PREFIX)
        || job.requestKey.startsWith(REVISION_OPERATIONS_REQUEST_PREFIX);
    if (!revisionMarker) return null;
    return revisionPayload(job.payload)
        ? "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED"
        : "INVALID_SERVICE_RECORD_REVISION_JOB_PAYLOAD";
}

/**
 * Polls durable eformsign jobs and starts every claimed provider operation
 * immediately. The repository owns the global three-job boundary and lease;
 * this service owns retry safety and heartbeat/progress updates.
 */
@Injectable()
export class EformsignDocumentJobWorkerService {
    private readonly logger = new Logger(EformsignDocumentJobWorkerService.name);
    private running = false;
    private lastRetentionSweepAt = 0;
    private lastRecoverySweepAt = 0;

    constructor(
        private readonly configService: ConfigService,
        @Inject(EFORMSIGN_DOCUMENT_JOB_REPOSITORY)
        private readonly repository: IEformsignDocumentJobRepository,
        private readonly dispatchUsecase: DispatchDocumentHeadlessUsecase,
        private readonly finalizeUsecase: FinalizeDocumentHeadlessUsecase,
        private readonly reconciliationService: EformsignDocumentJobReconciliationService,
        private readonly autoFinalizeScheduler: ContractAutoFinalizeSchedulerService,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        private readonly schedulerLease: SchedulerLeaseService,
        private readonly contractSupersedeService: ContractSupersedeService,
        private readonly notificationService: NotificationService,
        @Optional()
        @Inject(SERVICE_RECORD_REVISION_GENERATION)
        private readonly revisionGenerator?: ServiceRecordRevisionGenerationPort,
        @Optional()
        @Inject(SERVICE_RECORD_REVISION_OPERATION_COORDINATOR)
        private readonly revisionOperationCoordinator?: ServiceRecordRevisionOperationCoordinatorPort,
    ) {}

    @Interval(WORKER_INTERVAL_MS)
    async processDueJobs(): Promise<void> {
        if (!this.schedulerLease.holdsLease()) {
            return;
        }
        if (!this.isEnabled() || this.running) return;
        this.running = true;
        try {
            this.sweepExpiredTerminalJobs();
            void this.sweepStaffFailureRecovery();
            const stale = await this.repository.recoverStale(
                new Date(Date.now() - STALE_CUTOFF_MS),
            );
            for (const job of stale) {
                if (job.status === "reconciling") {
                    await this.reconcile(job);
                }
            }

            const jobs = await this.repository.claimDue(3);
            await Promise.all(jobs.map((job) => this.processClaimedJob(job)));
        } catch {
            this.logger.warn("Eformsign document job worker tick failed");
        } finally {
            this.running = false;
        }
    }

    private async processClaimedJob(job: EformsignDocumentJobEntity): Promise<void> {
        if (!job.leaseToken) {
            this.logger.warn(`Eformsign document job ${job.id} has no lease`);
            return;
        }
        if (!(await this.ownsTarget(job))) {
            const attention = await this.repository.markRequiresAttention(
                job.id,
                job.leaseToken,
                "JOB_TARGET_NOT_OWNED_BY_BRANCH",
            );
            await this.recordAutoFinalizeTerminalOutcome(
                job,
                attention,
                "JOB_TARGET_NOT_OWNED_BY_BRANCH",
            );
            this.notifyTransition(attention);
            return;
        }
        if (!job.payload) {
            const attention = await this.repository.markRequiresAttention(
                job.id,
                job.leaseToken,
                "MISSING_JOB_PAYLOAD",
            );
            await this.recordAutoFinalizeTerminalOutcome(job, attention, "MISSING_JOB_PAYLOAD");
            this.notifyTransition(attention);
            return;
        }

        // Send evidence is latched for the whole attempt and seeded from the
        // claimed row, so a marker an earlier attempt persisted survives into
        // this one. It is captured before authorization mirrors its own
        // `dispatch_authorized` marker onto the claim. That marker proves
        // exclusivity only: it is never send evidence, so only a real
        // `creating`/`sent` step latches here.
        const sendEvidence: SendEvidence = { step: dispatchEvidenceOf(job.progressStep) };

        let revisionAuthorization: CreateDispatchAuthorizationResult;
        try {
            revisionAuthorization = await this.authorizeRevisionJob(job);
        } catch {
            if (sendEvidence.step) {
                await this.markAndReconcile(job, sendEvidence.step);
                return;
            }
            await this.handlePreSendFailure(job, "SERVICE_RECORD_REVISION_AUTHORIZATION_FAILURE");
            return;
        }
        if (revisionAuthorization.kind !== "allow") {
            const attention = await this.repository.markRequiresAttention(
                job.id,
                job.leaseToken,
                revisionAuthorization.reason ?? "SERVICE_RECORD_REVISION_DISPATCH_NOT_AUTHORIZED",
            );
            await this.recordAutoFinalizeTerminalOutcome(
                job,
                attention,
                revisionAuthorization.reason ?? "SERVICE_RECORD_REVISION_DISPATCH_NOT_AUTHORIZED",
            );
            this.notifyTransition(attention);
            return;
        }
        if (revisionAuthorization.irreversible) {
            // The database marker is the source of truth for exclusivity and
            // confirm races; mirror it on this claimed copy so the attempt
            // keeps the fence up (progress writes stay `dispatch_authorized`
            // until real send evidence latches). It is not send evidence: an
            // exception before the 전송 click still follows the pre-send retry
            // path.
            Object.assign(job, { progressStep: DISPATCH_AUTHORIZED_PROGRESS_STEP });
        }

        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        const heartbeat = this.startHeartbeat(
            job.id,
            job.leaseToken,
            () => latestProgressStep,
            () => dispatchFenceOf(sendEvidence, job.progressStep),
        );
        try {
            if (job.jobType === "create_document") {
                const revisionOperations = revisionOperationsPayload(job.payload);
                if (revisionOperations || revisionPayload(job.payload)) {
                    // Revision paths send through their own coordinators and
                    // report no progress steps, so nothing here can prove a
                    // failure is pre-send: any throw after authorization keeps
                    // reconciling instead of entering the pre-send retry.
                    observeSendEvidence(sendEvidence, "creating");
                }
                if (revisionOperations) {
                    await this.processRevisionOperations(job, revisionOperations);
                } else {
                    const revision = revisionPayload(job.payload);
                    if (revision) {
                        await this.processRevision(job, revision);
                    } else {
                        await this.processCreation(job, sendEvidence, (step) => {
                            latestProgressStep = step;
                        });
                    }
                }
            } else if (job.jobType === "finalize_document") {
                await this.processFinalization(job, sendEvidence, (step) => {
                    latestProgressStep = step;
                });
            } else {
                const failed = await this.repository.markFailed(
                    job.id,
                    job.leaseToken,
                    "UNSUPPORTED_JOB_TYPE",
                );
                await this.recordAutoFinalizeTerminalOutcome(job, failed, "UNSUPPORTED_JOB_TYPE");
                this.notifyTransition(failed);
            }
        } catch {
            this.logger.warn(`Eformsign document job ${job.id} failed`);
            await this.handleExecutionFailure(job, sendEvidence, latestProgressStep);
        } finally {
            clearInterval(heartbeat);
        }
    }

    /**
     * Revision operation jobs resume the persisted contract-period and receipt
     * state rows through the coordinator. They must never fall through to the
     * legacy mutable contract renderer or the immutable record renderer.
     */
    private async processRevisionOperations(
        job: EformsignDocumentJobEntity,
        payload: ServiceRecordRevisionOperationsJobPayload,
    ): Promise<void> {
        const leaseToken = job.leaseToken;
        if (!leaseToken) return;
        if (!this.revisionOperationCoordinator) {
            const attention = await this.repository.markRequiresAttention(
                job.id,
                leaseToken,
                "SERVICE_RECORD_REVISION_OPERATION_COORDINATOR_UNAVAILABLE",
            );
            await this.recordAutoFinalizeTerminalOutcome(
                job,
                attention,
                "SERVICE_RECORD_REVISION_OPERATION_COORDINATOR_UNAVAILABLE",
            );
            this.notifyTransition(attention);
            return;
        }

        const input: ServiceRecordRevisionDocumentCoordinatorProcessInput = {
            ...payload.context,
            ...(payload.operations.contract ? { contract: payload.operations.contract } : {}),
            ...(payload.operations.receipt ? { receipt: payload.operations.receipt } : {}),
        };

        let result: ServiceRecordRevisionDocumentCoordinatorProcessResult;
        try {
            result = await this.revisionOperationCoordinator.process(input);
        } catch {
            const attention = await this.repository.markRequiresAttention(
                job.id,
                leaseToken,
                "SERVICE_RECORD_REVISION_OPERATION_COORDINATOR_FAILURE",
            );
            await this.recordAutoFinalizeTerminalOutcome(
                job,
                attention,
                "SERVICE_RECORD_REVISION_OPERATION_COORDINATOR_FAILURE",
            );
            this.notifyTransition(attention);
            return;
        }

        if (!result || typeof result !== "object" || typeof result.status !== "string") {
            const attention = await this.repository.markRequiresAttention(
                job.id,
                leaseToken,
                "INVALID_SERVICE_RECORD_REVISION_OPERATION_RESULT",
            );
            await this.recordAutoFinalizeTerminalOutcome(
                job,
                attention,
                "INVALID_SERVICE_RECORD_REVISION_OPERATION_RESULT",
            );
            this.notifyTransition(attention);
            return;
        }

        if (result.status === "completed" || result.status === "not_required") {
            await this.repository.markCompleted(job.id, leaseToken, job.documentId ?? undefined);
            return;
        }

        const reason = (typeof result.reason === "string" ? result.reason.trim() : "")
            || `SERVICE_RECORD_REVISION_OPERATION_${result.status.toUpperCase()}`;
        const attention = await this.repository.markRequiresAttention(job.id, leaseToken, reason);
        await this.recordAutoFinalizeTerminalOutcome(job, attention, reason);
        this.notifyTransition(attention);
    }

    /**
     * A revision job carries a complete immutable generation input rather than
     * legacy contractData.  Route it only through the renderer boundary after
     * repository authorization has committed the durable `dispatch_authorized` marker;
     * malformed/missing renderer wiring is a terminal attention outcome and
     * never falls back to the mutable live-case renderer or contract sender.
     */
    private async processRevision(
        job: EformsignDocumentJobEntity,
        payload: RevisionDocumentJobPayload,
    ): Promise<void> {
        const leaseToken = job.leaseToken;
        if (!leaseToken) return;
        const input = toRevisionGenerationInput(payload);
        if (!input || !this.revisionGenerator) {
            const attention = await this.repository.markRequiresAttention(
                job.id,
                leaseToken,
                !input
                    ? "INVALID_SERVICE_RECORD_REVISION_JOB_PAYLOAD"
                    : "SERVICE_RECORD_REVISION_RENDERER_UNAVAILABLE",
            );
            await this.recordAutoFinalizeTerminalOutcome(
                job,
                attention,
                !input
                    ? "INVALID_SERVICE_RECORD_REVISION_JOB_PAYLOAD"
                    : "SERVICE_RECORD_REVISION_RENDERER_UNAVAILABLE",
            );
            this.notifyTransition(attention);
            return;
        }

        try {
            const result = await this.revisionGenerator.executeRevision(
                input,
                createEformsignWorkerPrincipal(job.branchId),
            );
            if (!Number.isInteger(result.documentVersion) || result.documentVersion < 1
                || !Number.isInteger(result.chunkCount) || result.chunkCount < 1
                || !Array.isArray(result.documentIds)
                || result.documentIds.length !== result.chunkCount
                || result.documentIds.some((documentId) => typeof documentId !== "string" || documentId.length === 0)) {
                throw new Error("SERVICE_RECORD_REVISION_RENDERER_RESULT_INVALID");
            }
            await this.repository.markCompleted(
                job.id,
                leaseToken,
                result.documentIds[0],
            );
        } catch {
            // A renderer failure after the durable marker cannot be retried as
            // a new generation. Keep the existing job reconciliation path and
            // immutable payload available for an operator/reconciler.
            await this.markAndReconcile(job, "creating");
        }
    }

    private async ownsTarget(job: EformsignDocumentJobEntity): Promise<boolean> {
        if (job.jobType === "create_document") {
            if (!job.clientId) return false;
            return Boolean(await this.clientRepository.findById(job.branchId, job.clientId));
        }
        if (!job.documentId) return false;
        return Boolean(await this.eformsignDocRepository.findByDocumentId(
            job.branchId,
            job.documentId,
        ));
    }

    private async processCreation(
        job: EformsignDocumentJobEntity,
        sendEvidence: SendEvidence,
        onProgressStep?: (step: EformsignHeadlessProgressStep) => void,
    ): Promise<void> {
        const leaseToken = job.leaseToken;
        if (!leaseToken) return;
        const payload = parseCreatePayload(job.payload ?? {});
        if (!payload) {
            const attention = await this.repository.markRequiresAttention(
                job.id,
                leaseToken,
                "INVALID_CREATE_JOB_PAYLOAD",
            );
            await this.recordAutoFinalizeTerminalOutcome(job, attention, "INVALID_CREATE_JOB_PAYLOAD");
            this.notifyTransition(attention);
            return;
        }

        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        const result = await this.dispatchUsecase.execute(
            job.branchId,
            {
                contractData: payload.contractData,
                clientId: payload.clientId,
                progressId: payload.progressId,
                force: payload.force,
                onProgress: async (step) => {
                    latestProgressStep = step;
                    observeSendEvidence(sendEvidence, step);
                    onProgressStep?.(step);
                    await this.recordProgress(
                        job.id,
                        leaseToken,
                        step,
                        dispatchFenceOf(sendEvidence, job.progressStep),
                    );
                },
            },
            createEformsignWorkerPrincipal(job.branchId),
        );

        if (result.ok) {
            const completed = await this.repository.markCompleted(job.id, leaseToken, result.documentId);
            // Only the holder of the lease may act on the completion; a lost lease
            // means another run owns this job's outcome.
            if (completed) await this.supersedeAfterReissue(job, result.documentId);
            return;
        }
        if (isTemplateWorkflowFailure(result.reason)) {
            // Workflow validation/read failures happen before the provider send
            // boundary. Keep them on the deterministic pre-send path;
            // reconciling such a run would imply a provider submission that was
            // never attempted.
            await this.handlePreSendFailure(job, result.reason);
            return;
        }
        if (
            !sendEvidence.step
            && latestProgressStep !== "creating"
            && latestProgressStep !== "sent"
            && isLockUnavailableRefusal(result)
        ) {
            // Refused before execution started: retry on the pre-send schedule
            // instead of treating the lock hint as an unknown outcome.
            await this.handlePreSendFailure(job, result.reason);
            return;
        }
        if (sendEvidence.step || this.isAmbiguous(result, latestProgressStep)) {
            await this.markAndReconcile(job, sendEvidence.step ?? latestProgressStep);
            return;
        }
        // No send evidence and not ambiguous: the failure happened before the
        // 전송 click could have run. The `dispatch_authorized` marker only
        // fences concurrent owners, so it never forces reconciliation.
        await this.handlePreSendFailure(job, "HEADLESS_CREATE_PRE_SEND_FAILURE");
    }

    /**
     * Cancel the contract a server-side re-issue replaced, after the new one
     * exists. Shared by the normal success branch and the reconciliation
     * completion so an ambiguous send never leaves the old contract live
     * silently. A failure here never fails or retries the create job (the new
     * contract was already sent): it notifies the branch and logs ids only.
     */
    private async supersedeAfterReissue(
        job: EformsignDocumentJobEntity,
        newDocumentId: string | undefined,
    ): Promise<void> {
        const payload = parseCreatePayload(job.payload ?? {});
        const oldDocumentId = payload?.supersedeDocumentId;
        if (!payload || !oldDocumentId || !newDocumentId || oldDocumentId === newDocumentId) return;
        try {
            // `job.clientId` is the value ownsTarget verified against the job's
            // branch; the payload's copy is only a cross-check.
            if (job.clientId === null || payload.clientId !== job.clientId) {
                throw new Error("SUPERSEDE_CLIENT_MISMATCH");
            }
            // The same branch visibility the HTTP route enforces; the document lookup
            // inside the service is not branch-scoped.
            if (!(await this.contractSupersedeService.isDocumentVisibleToBranch(job.branchId, oldDocumentId))) {
                throw new Error("SUPERSEDE_DOCUMENT_NOT_VISIBLE");
            }
            // The replacement is only safe to rely on once the client points at it. The
            // create flow swallows a failed client link (warning only), so a fresh
            // branch-scoped read must confirm it before the old contract is cancelled
            // and purged (the purge would otherwise leave the client with no contract).
            const client = await this.clientRepository.findById(job.branchId, job.clientId);
            if (!client || client.eDocId !== newDocumentId) {
                throw new Error("SUPERSEDE_REPLACEMENT_NOT_LINKED");
            }
            await this.contractSupersedeService.supersede({
                branchId: job.branchId,
                clientId: job.clientId,
                documentId: oldDocumentId,
                principal: createEformsignWorkerPrincipal(job.branchId),
            });
        } catch (error) {
            this.logger.warn(
                `[Service Stop] could not supersede oldDocumentId=${oldDocumentId} newDocumentId=${newDocumentId}: ${errorClassName(error)}`,
            );
            await this.notificationService.sendToBranchUsers(
                job.branchId,
                "기존 계약서 취소 실패",
                "새 계약서는 보냈지만 기존 계약서를 취소하지 못했어요. 전자문서 목록에서 확인해 주세요",
                {
                    type: CONTRACT_SUPERSEDE_FAILED_NOTIFICATION_TYPE,
                    documentId: oldDocumentId,
                    url: `/contracts?documentId=${encodeURIComponent(oldDocumentId)}`,
                },
                { dedupe: { type: CONTRACT_SUPERSEDE_FAILED_NOTIFICATION_TYPE, documentId: oldDocumentId } },
            ).catch(() => undefined);
        }
    }

    /**
     * The worker owns provider orchestration only. The repository owns the
     * transaction, aggregate locks, authoritative rereads, and durable
     * `dispatch_authorized` marker so every caller reaches the same dispatch
     * boundary.
     */
    private async authorizeRevisionJob(
        job: EformsignDocumentJobEntity,
    ): Promise<CreateDispatchAuthorizationResult> {
        if (!job.leaseToken) return { kind: "lost", reason: "invalid_job_claim" };
        if (job.jobType === "create_document") {
            const rawPayload = job.payload ?? {};
            const operations = revisionOperationsPayload(rawPayload);
            if (rawPayload["kind"] === REVISION_OPERATIONS_JOB_KIND) {
                if (!operations) {
                    return { kind: "stale", reason: "INVALID_SERVICE_RECORD_REVISION_OPERATION_JOB_PAYLOAD" };
                }
                return this.authorizeThroughRepository(job, operations.context);
            }
            const payload = revisionPayload(rawPayload);
            if (payload?.generationKind === "INITIAL_FINALIZATION") {
                // Initial revised finalization is a persisted manual-review
                // generation intent. Phase0 has not proved the provider path,
                // so this discriminator must never reach a live credential or
                // document-generation call even if a forged context says it
                // is pending or complete.
                return { kind: "stale", reason: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" };
            }
            if (payload && !isRevisionDocumentDispatchAllowed(payload.context)) {
                return { kind: "stale", reason: "SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED" };
            }
            if (!payload && rawPayload["kind"] !== undefined) {
                return { kind: "stale", reason: "INVALID_SERVICE_RECORD_REVISION_JOB_PAYLOAD" };
            }
            return this.authorizeThroughRepository(job, payload?.context ?? null);
        }
        if (job.jobType === "finalize_document") {
            const payload = parseFinalizePayload(job.payload ?? {});
            const documentId = job.documentId ?? payload?.documentId;
            if (!payload || !documentId) {
                return { kind: "stale", reason: "INVALID_FINALIZE_JOB_PAYLOAD" };
            }
            return this.authorizeThroughRepository(job, null);
        }
        return { kind: "allow" };
    }

    private async authorizeThroughRepository(
        job: EformsignDocumentJobEntity,
        expectedContext: ServiceRecordRevisionDispatchContext | null,
    ): Promise<CreateDispatchAuthorizationResult> {
        const authorization = await this.repository.authorizeForDispatch({
            jobId: job.id,
            leaseToken: job.leaseToken!,
            expectedContext,
        });
        return authorization.kind === "allow"
            ? { kind: "allow", irreversible: true }
            : authorization;
    }

    private async processFinalization(
        job: EformsignDocumentJobEntity,
        sendEvidence: SendEvidence,
        onProgressStep?: (step: EformsignHeadlessProgressStep) => void,
    ): Promise<void> {
        const leaseToken = job.leaseToken;
        if (!leaseToken) return;
        const payload = parseFinalizePayload(job.payload ?? {});
        const documentId = job.documentId ?? payload?.documentId;
        if (!payload || !documentId) {
            const attention = await this.repository.markRequiresAttention(
                job.id,
                leaseToken,
                "INVALID_FINALIZE_JOB_PAYLOAD",
            );
            await this.recordAutoFinalizeTerminalOutcome(job, attention, "INVALID_FINALIZE_JOB_PAYLOAD");
            this.notifyTransition(attention);
            return;
        }

        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        for (let step = 0; step < MAX_CONSECUTIVE_FINALIZE_STEPS; step += 1) {
            const result = await this.finalizeUsecase.execute(
                {
                    branchId: job.branchId,
                    documentId,
                    prefillEndDate: payload.prefillEndDate,
                    prefillAmounts: payload.prefillAmounts,
                    progressId: payload.progressId,
                    onProgress: async (progressStep) => {
                        latestProgressStep = progressStep;
                        observeSendEvidence(sendEvidence, progressStep);
                        onProgressStep?.(progressStep);
                        await this.recordProgress(
                            job.id,
                            leaseToken,
                            progressStep,
                            dispatchFenceOf(sendEvidence, job.progressStep),
                        );
                    },
                },
                createEformsignWorkerPrincipal(job.branchId),
            );

            if (!result.ok) {
                // A later step's failure must not erase an earlier step's send:
                // `latestProgressStep` only remembers the most recent step.
                if (
                    !sendEvidence.step
                    && latestProgressStep !== "creating"
                    && latestProgressStep !== "sent"
                    && isLockUnavailableRefusal(result)
                ) {
                    await this.handlePreSendFailure(job, result.reason);
                    return;
                }
                if (sendEvidence.step || this.isAmbiguous(result, latestProgressStep)) {
                    await this.markAndReconcile(job, sendEvidence.step ?? latestProgressStep);
                    return;
                }
                await this.handlePreSendFailure(job, "HEADLESS_FINALIZE_PRE_SEND_FAILURE");
                return;
            }
            if (result.completed) {
                await this.repository.markCompleted(job.id, leaseToken, documentId);
                return;
            }
        }

        await this.markAndReconcile(job, sendEvidence.step ?? "reconciling");
    }

    private async handleExecutionFailure(
        job: EformsignDocumentJobEntity,
        sendEvidence: SendEvidence,
        latestProgressStep?: EformsignHeadlessProgressStep,
    ): Promise<void> {
        const sendAttempted = Boolean(sendEvidence.step)
            || latestProgressStep === "creating"
            || latestProgressStep === "sent"
            || job.progressStep === "creating"
            || job.progressStep === "sent";
        if (sendAttempted) {
            // Never persist a step that is behind the evidence already seen.
            await this.markAndReconcile(
                job,
                sendEvidence.step
                    ?? dispatchEvidenceOf(job.progressStep)
                    ?? latestProgressStep
                    ?? "reconciling",
            );
            return;
        }
        await this.handlePreSendFailure(job, "HEADLESS_EXECUTION_FAILURE");
    }

    private async handlePreSendFailure(job: EformsignDocumentJobEntity, errorCode: string): Promise<void> {
        const leaseToken = job.leaseToken;
        if (!leaseToken) return;
        if (job.attempts <= MAX_PRE_SEND_RETRIES) {
            const delayMs = PRE_SEND_RETRY_DELAYS_MS[job.attempts - 1] ?? PRE_SEND_RETRY_DELAYS_MS.at(-1)!;
            await this.repository.scheduleRetry(
                job.id,
                leaseToken,
                new Date(Date.now() + delayMs),
                errorCode,
            );
            return;
        }
        const failed = await this.repository.markFailed(
            job.id,
            leaseToken,
            "PRE_SEND_RETRY_EXHAUSTED",
        );
        await this.recordAutoFinalizeTerminalOutcome(job, failed, "PRE_SEND_RETRY_EXHAUSTED");
        this.notifyTransition(failed);
    }

    private async markAndReconcile(
        job: EformsignDocumentJobEntity,
        progressStep?: string,
    ): Promise<void> {
        const leaseToken = job.leaseToken;
        if (!leaseToken) return;
        const reconciling = await this.repository.markReconciling(
            job.id,
            leaseToken,
            progressStep ?? "reconciling",
        );
        if (!reconciling) return;
        // Legacy jobs may redact their payload on reconciliation. Revision
        // jobs retain the immutable generation input in the repository, while
        // this fallback keeps older adapters compatible with their claimed
        // in-memory hints for the immediate reconciliation attempt.
        const reconciliationJob = reconciling && !reconciling.payload
            ? new EformsignDocumentJobEntity({ ...reconciling, payload: job.payload })
            : reconciling ?? job;
        await this.reconcile(reconciliationJob);
    }

    private async reconcile(job: EformsignDocumentJobEntity): Promise<void> {
        const revisionBlockReason = revisionRecoveryBlockReason(job);
        if (revisionBlockReason) {
            if (!job.leaseToken) {
                this.logger.warn(`Eformsign revision job ${job.id} has no recovery lease`);
                return;
            }
            const attention = await this.repository.markRequiresAttention(
                job.id,
                job.leaseToken,
                revisionBlockReason,
            );
            await this.recordAutoFinalizeTerminalOutcome(job, attention, revisionBlockReason);
            this.notifyTransition(attention);
            return;
        }
        if (!(await this.ownsTarget(job))) {
            if (job.leaseToken) {
                const attention = await this.repository.markRequiresAttention(
                    job.id,
                    job.leaseToken,
                    "JOB_TARGET_NOT_OWNED_BY_BRANCH",
                );
                this.notifyTransition(attention);
            }
            return;
        }
        const result = await this.reconciliationService.reconcile(
            job,
            createEformsignWorkerPrincipal(job.branchId),
        );
        if (
            result.status === "completed"
            && result.completionRecorded === true
            && job.jobType === "create_document"
        ) {
            await this.supersedeAfterReissue(job, result.documentId);
        }
        if (
            result.status === "requires_attention"
            && job.source === "auto_finalize"
            && job.documentId
        ) {
            await this.autoFinalizeScheduler.recordTerminalFailure(
                job.documentId,
                result.reason ?? "RECONCILIATION_REQUIRES_ATTENTION",
                result.recordedAttempts ?? null,
            );
        }
        // `result.status` alone is not proof of a transition: only a row this run
        // actually moved (lease still held) may be announced.
        if (result.status === "requires_attention") this.notifyTransition(result.transitioned);
    }

    private startHeartbeat(
        jobId: string,
        jobLeaseToken: string,
        progressStep: () => string | undefined,
        dispatchFence: () => DispatchFence | undefined,
    ): ReturnType<typeof setInterval> {
        const heartbeat = setInterval(() => {
            const observed = progressStep();
            const fence = dispatchFence();
            const persisted = fence
                ? persistedFenceStep(fence, observed)
                : observed ?? "processing";
            void this.repository.updateProgress(jobId, jobLeaseToken, persisted, new Date()).catch(() => {
                this.logger.warn(`Eformsign document job ${jobId} heartbeat failed`);
            });
        }, HEARTBEAT_INTERVAL_MS);
        if (typeof heartbeat !== "number") heartbeat.unref?.();
        return heartbeat;
    }

    private async recordProgress(
        jobId: string,
        leaseToken: string,
        step: EformsignHeadlessProgressStep,
        dispatchFence?: DispatchFence,
    ): Promise<void> {
        // While the attempt holds the dispatch fence the persisted step may
        // only move `dispatch_authorized` -> `creating` -> `sent`, never back
        // to an ordinary progress step; a latched `creating`/`sent` stays put
        // through every later step.
        const persistedStep = dispatchFence ? persistedFenceStep(dispatchFence, step) : step;
        const updated = await this.repository.updateProgress(jobId, leaseToken, persistedStep, new Date());
        if (!updated) {
            throw new Error("EFORMSIGN_DOCUMENT_JOB_LEASE_LOST");
        }
    }

    private async recordAutoFinalizeTerminalOutcome(
        job: EformsignDocumentJobEntity,
        transitioned: EformsignDocumentJobEntity | null,
        reason: string,
    ): Promise<void> {
        if (!transitioned || job.source !== "auto_finalize" || !job.documentId) return;
        await this.autoFinalizeScheduler.recordTerminalFailure(
            job.documentId,
            reason,
            transitioned.autoFinalizeOutcomeAttempts,
        );
    }

    private sweepExpiredTerminalJobs(): void {
        const now = Date.now();
        if (now - this.lastRetentionSweepAt < RETENTION_SWEEP_INTERVAL_MS) return;
        this.lastRetentionSweepAt = now;
        void this.repository
            .deleteExpiredTerminal(new Date(now - TERMINAL_RETENTION_MS))
            .catch(() => this.logger.warn("Eformsign document job retention sweep failed"));
    }

    /**
     * Hourly: drop the payloads of aged `requires_attention` contract jobs, then
     * re-announce the staff contract failures of the last day. Each half has its
     * own catch so one failing never stops the other, and nothing here can throw
     * into the tick (which would skip `claimDue`).
     *
     * Accepted behaviour: notification dedupe is per recipient over their latest
     * 100 notifications and is check-then-send, so a rare duplicate is possible.
     * The first sweep after a deploy notifies every unresolved staff contract
     * failure of the past 24 h; that is intended, staff were never told about them.
     */
    private async sweepStaffFailureRecovery(): Promise<void> {
        try {
            const now = Date.now();
            if (now - this.lastRecoverySweepAt < RECOVERY_SWEEP_INTERVAL_MS) return;
            this.lastRecoverySweepAt = now;
            try {
                await this.repository.purgeExpiredAttentionPayloads(new Date(now));
            } catch (error) {
                this.logger.warn(
                    `Eformsign document job attention payload purge failed: ${errorClassName(error)}`,
                );
            }
            try {
                const failures = await this.repository.listRecentStaffFailures(
                    new Date(now - RECOVERY_RENOTIFY_WINDOW_MS),
                );
                for (const job of failures) await this.notifyStaffFailure(job);
            } catch (error) {
                this.logger.warn(
                    `Eformsign document job failure re-notification failed: ${errorClassName(error)}`,
                );
            }
        } catch (error) {
            this.logger.warn(`Eformsign document job recovery sweep failed: ${errorClassName(error)}`);
        }
    }

    /** Fire-and-forget: `sendToBranchUsers` also emails and must not stall the tick. */
    private notifyTransition(transitioned: EformsignDocumentJobEntity | null | undefined): void {
        if (!transitioned) return;
        void this.notifyStaffFailure(transitioned);
    }

    /**
     * Tell every user of the branch that a staff contract job ended in `failed` or
     * `requires_attention`. Never throws; logs ids and the error class only.
     */
    private async notifyStaffFailure(job: EformsignDocumentJobEntity): Promise<void> {
        try {
            if (!isContractJob(job)) return;
            const recoveryKind = classifyRecovery(job);
            if (!recoveryKind) return;

            const clientName = await this.resolveClientName(job);
            const copy = recoveryKind === "verify_result"
                ? {
                    title: `전자문서 결과 확인 필요 · ${clientName}`,
                    body: "전송 여부를 확인하지 못했어요. 눌러서 결과를 확인해 주세요.",
                }
                : job.jobType === "finalize_document"
                    ? {
                        title: `검토완료 자동 처리 실패 · ${clientName}`,
                        body: "자동 처리에 실패했어요. 눌러서 직접 처리해 주세요.",
                    }
                    : {
                        title: `계약서 자동 전송 실패 · ${clientName}`,
                        body: "자동 전송에 실패했어요. 눌러서 직접 작성해 주세요.",
                    };
            const documentId = `eformsign-document-job:${job.id}`;
            await this.notificationService.sendToBranchUsers(
                job.branchId,
                copy.title,
                copy.body,
                {
                    type: EFORMSIGN_DOCUMENT_JOB_FAILED_NOTIFICATION_TYPE,
                    documentId,
                    jobId: job.id,
                    recoveryKind,
                    url: `/contracts?recoverJobId=${encodeURIComponent(job.id)}`,
                },
                { dedupe: { type: EFORMSIGN_DOCUMENT_JOB_FAILED_NOTIFICATION_TYPE, documentId } },
            );
        } catch (error) {
            this.logger.warn(
                `Eformsign document job ${job.id} failure notification failed: ${errorClassName(error)}`,
            );
        }
    }

    private async resolveClientName(job: EformsignDocumentJobEntity): Promise<string> {
        const joined = job.clientName?.trim();
        if (joined) return joined;
        if (job.clientId === null) return FALLBACK_CLIENT_NAME;
        try {
            const client = await this.clientRepository.findById(job.branchId, job.clientId);
            return client?.name?.trim() || FALLBACK_CLIENT_NAME;
        } catch {
            return FALLBACK_CLIENT_NAME;
        }
    }

    private isEnabled(): boolean {
        return this.configService.get<string>(WORKER_ENABLED_ENV)?.trim().toLowerCase() === "true";
    }

    private isAmbiguous(
        result: DispatchHeadlessResult | FinalizeHeadlessResult,
        latestProgressStep: EformsignHeadlessProgressStep | undefined,
    ): boolean {
        if (latestProgressStep === "creating" || latestProgressStep === "sent") return true;
        if ("remoteDocumentId" in result && Boolean(result.remoteDocumentId)) return true;
        if ("fallbackHint" in result && result.fallbackHint === "manual_check") return true;
        return "reason" in result
            && ["remote_unconfirmed", "ambiguous", "provider_timeout", "send_outcome_unknown"]
                .some((reason) => result.reason === reason);
    }
}

type DispatchEvidence = "creating" | "sent";

/**
 * What the attempt has durably claimed. `authorized` is the exclusivity marker
 * only (no send evidence); `creating`/`sent` are real or possible send
 * evidence. Ordering: authorized < creating < sent.
 */
type DispatchFence = "authorized" | DispatchEvidence;

/**
 * The fence an attempt holds: latched in-attempt evidence first, otherwise
 * whatever the claimed copy carries (`dispatch_authorized` after a successful
 * authorization). Undefined when the attempt holds no authorization.
 */
function dispatchFenceOf(
    evidence: SendEvidence,
    claimedStep: string | null | undefined,
): DispatchFence | undefined {
    const claimedEvidence = dispatchEvidenceOf(claimedStep);
    if (evidence.step === "sent" || claimedEvidence === "sent") return "sent";
    if (evidence.step === "creating" || claimedEvidence === "creating") return "creating";
    return claimedStep === DISPATCH_AUTHORIZED_PROGRESS_STEP ? "authorized" : undefined;
}

/** The step to persist while the fence is up: never behind the fence or the step. */
function persistedFenceStep(fence: DispatchFence, step: string | undefined): string {
    if (fence === "sent" || step === "sent") return "sent";
    if (fence === "creating" || step === "creating") return "creating";
    return DISPATCH_AUTHORIZED_PROGRESS_STEP;
}

/**
 * Whether a job's provider send may have happened, latched across every step
 * and attempt of one job. A step that only reports ordinary progress after a
 * `creating`/`sent` step must never clear it.
 */
interface SendEvidence {
    step: DispatchEvidence | undefined;
}

function dispatchEvidenceOf(step: string | null | undefined): DispatchEvidence | undefined {
    return step === "creating" || step === "sent" ? step : undefined;
}

function observeSendEvidence(evidence: SendEvidence, step: string): void {
    if (step === "sent") evidence.step = "sent";
    else if (step === "creating" && evidence.step !== "sent") evidence.step = "creating";
}

function parseCreatePayload(payload: Record<string, unknown>): CreateDocumentJobPayload | null {
    const clientId = payload["clientId"];
    const contractData = payload["contractData"];
    if (typeof clientId !== "number" || !isContractData(contractData)) return null;
    return {
        clientId,
        contractData,
        ...(readOptionalString(payload["progressId"]) ? { progressId: readOptionalString(payload["progressId"]) } : {}),
        ...(payload["force"] === true ? { force: true } : {}),
        ...(readOptionalString(payload["supersedeDocumentId"])
            ? { supersedeDocumentId: readOptionalString(payload["supersedeDocumentId"]) }
            : {}),
    };
}

function parseFinalizePayload(payload: Record<string, unknown>): FinalizeDocumentJobPayload | null {
    const documentId = readOptionalString(payload["documentId"]);
    const prefillEndDate = readOptionalString(payload["prefillEndDate"]);
    const progressId = readOptionalString(payload["progressId"]);
    if (payload["documentId"] !== undefined && !documentId) return null;
    if (payload["prefillEndDate"] !== undefined && !prefillEndDate) return null;
    if (payload["progressId"] !== undefined && !progressId) return null;
    const prefillAmounts = parsePrefillAmounts(payload["prefillAmounts"]);
    if (prefillAmounts === null) return null;
    return {
        ...(documentId ? { documentId } : {}),
        ...(prefillEndDate ? { prefillEndDate } : {}),
        ...(prefillAmounts ? { prefillAmounts } : {}),
        ...(progressId ? { progressId } : {}),
    };
}

function isContractData(value: unknown): value is ContractDataDto {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    const required = [
        "customerName", "customerContact", "customerDOB", "customerAddress",
        "caretaker1Name", "caretaker1Contact", "type", "days", "area",
        "contractDuration", "startYear", "startMonth", "startDay", "startDate",
        "endYear", "endMonth", "endDay", "endDate", "paymentYear", "paymentMonth",
        "paymentDay", "fullPrice", "grant", "actualPrice",
    ];
    return required.every((key) => typeof record[key] === "string")
        && (record["issuerPhone"] === undefined || typeof record["issuerPhone"] === "string");
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
}

function errorClassName(error: unknown): string {
    return error instanceof Error ? error.constructor.name : typeof error;
}
