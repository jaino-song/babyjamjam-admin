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
import { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
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
import { createEformsignWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";
import type {
    ServiceRecordRevisionGenerationInput,
    ServiceRecordRevisionDispatchContext,
} from "@babyjamjam/shared/types/service-record";
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

interface CreateDocumentJobPayload {
    clientId: number;
    contractData: ContractDataDto;
    progressId?: string;
    force?: boolean;
}

interface FinalizeDocumentJobPayload {
    documentId?: string;
    prefillEndDate?: string;
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

type CreateDispatchAuthorizationResult = {
    kind: "allow" | "stale" | "lost";
    reason?: string;
    /** The durable progress marker was committed before the provider call. */
    irreversible?: boolean;
};

const REVISION_JOB_KIND = "service_record_revision";
const INITIAL_FINALIZATION_REQUEST_PREFIX = "service-record-initial-finalization:";
const REVISION_REQUEST_PREFIX = "service-record-revision:";

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
        || job.requestKey.startsWith(REVISION_REQUEST_PREFIX);
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
        @Optional()
        @Inject(SERVICE_RECORD_REVISION_GENERATION)
        private readonly revisionGenerator?: ServiceRecordRevisionGenerationPort,
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
            return;
        }
        if (!job.payload) {
            const attention = await this.repository.markRequiresAttention(
                job.id,
                job.leaseToken,
                "MISSING_JOB_PAYLOAD",
            );
            await this.recordAutoFinalizeTerminalOutcome(job, attention, "MISSING_JOB_PAYLOAD");
            return;
        }

        let revisionAuthorization: CreateDispatchAuthorizationResult;
        try {
            revisionAuthorization = await this.authorizeRevisionJob(job);
        } catch {
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
            return;
        }
        if (revisionAuthorization.irreversible) {
            // The database marker is the source of truth for confirm races;
            // mirror it on this claimed copy so any exception after the
            // marker follows reconciliation instead of a retry path.
            Object.assign(job, { progressStep: "creating" });
        }

        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        const heartbeat = this.startHeartbeat(
            job.id,
            job.leaseToken,
            () => latestProgressStep,
            job.progressStep === "creating" || job.progressStep === "sent",
        );
        try {
            if (job.jobType === "create_document") {
                const revision = revisionPayload(job.payload);
                if (revision) {
                    await this.processRevision(job, revision);
                } else {
                    await this.processCreation(job, (step) => {
                    latestProgressStep = step;
                    });
                }
            } else if (job.jobType === "finalize_document") {
                await this.processFinalization(job, (step) => {
                    latestProgressStep = step;
                });
            } else {
                const failed = await this.repository.markFailed(
                    job.id,
                    job.leaseToken,
                    "UNSUPPORTED_JOB_TYPE",
                );
                await this.recordAutoFinalizeTerminalOutcome(job, failed, "UNSUPPORTED_JOB_TYPE");
            }
        } catch {
            this.logger.warn(`Eformsign document job ${job.id} failed`);
            await this.handleExecutionFailure(job, latestProgressStep);
        } finally {
            clearInterval(heartbeat);
        }
    }

    /**
     * A revision job carries a complete immutable generation input rather than
     * legacy contractData.  Route it only through the renderer boundary after
     * repository authorization has committed the durable `creating` marker;
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
                    onProgressStep?.(step);
                    await this.recordProgress(
                        job.id,
                        leaseToken,
                        step,
                        job.progressStep === "creating" || job.progressStep === "sent",
                    );
                },
            },
            createEformsignWorkerPrincipal(job.branchId),
        );

        if (result.ok) {
            await this.repository.markCompleted(job.id, leaseToken, result.documentId);
            return;
        }
        if (this.isAmbiguous(result, latestProgressStep)) {
            await this.markAndReconcile(job, latestProgressStep);
            return;
        }
        if (job.progressStep === "creating") {
            // A durable pre-send authorization marker makes this attempt
            // irreversible from the confirm race's perspective. Even when
            // the provider reports a synchronous failure before its callback,
            // reconcile instead of reopening a second send via retry.
            await this.markAndReconcile(job, "creating");
            return;
        }
        await this.handlePreSendFailure(job, "HEADLESS_CREATE_PRE_SEND_FAILURE");
    }

    /**
     * The worker owns provider orchestration only. The repository owns the
     * transaction, aggregate locks, authoritative rereads, and durable
     * creating marker so every caller reaches the same dispatch boundary.
     */
    private async authorizeRevisionJob(
        job: EformsignDocumentJobEntity,
    ): Promise<CreateDispatchAuthorizationResult> {
        if (!job.leaseToken) return { kind: "lost", reason: "invalid_job_claim" };
        if (job.jobType === "create_document") {
            const rawPayload = job.payload ?? {};
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
            return;
        }

        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        for (let step = 0; step < MAX_CONSECUTIVE_FINALIZE_STEPS; step += 1) {
            const result = await this.finalizeUsecase.execute(
                {
                    branchId: job.branchId,
                    documentId,
                    prefillEndDate: payload.prefillEndDate,
                    progressId: payload.progressId,
                    onProgress: async (progressStep) => {
                        latestProgressStep = progressStep;
                        onProgressStep?.(progressStep);
                        await this.recordProgress(
                            job.id,
                            leaseToken,
                            progressStep,
                            job.progressStep === "creating" || job.progressStep === "sent",
                        );
                    },
                },
                createEformsignWorkerPrincipal(job.branchId),
            );

            if (!result.ok) {
                if (this.isAmbiguous(result, latestProgressStep)) {
                    await this.markAndReconcile(job, latestProgressStep);
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

        await this.markAndReconcile(job, "reconciling");
    }

    private async handleExecutionFailure(
        job: EformsignDocumentJobEntity,
        latestProgressStep?: EformsignHeadlessProgressStep,
    ): Promise<void> {
        const sendAttempted = latestProgressStep === "creating"
            || latestProgressStep === "sent"
            || job.progressStep === "creating"
            || job.progressStep === "sent";
        if (sendAttempted) {
            await this.markAndReconcile(
                job,
                latestProgressStep ?? job.progressStep ?? "reconciling",
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
            return;
        }
        if (!(await this.ownsTarget(job))) {
            if (job.leaseToken) {
                await this.repository.markRequiresAttention(
                    job.id,
                    job.leaseToken,
                    "JOB_TARGET_NOT_OWNED_BY_BRANCH",
                );
            }
            return;
        }
        const result = await this.reconciliationService.reconcile(
            job,
            createEformsignWorkerPrincipal(job.branchId),
        );
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
    }

    private startHeartbeat(
        jobId: string,
        jobLeaseToken: string,
        progressStep: () => string | undefined,
        preserveDispatchMarker = false,
    ): ReturnType<typeof setInterval> {
        const heartbeat = setInterval(() => {
            const observed = progressStep();
            const persisted = preserveDispatchMarker
                ? observed === "sent" ? "sent" : "creating"
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
        preserveDispatchMarker = false,
    ): Promise<void> {
        const persistedStep = preserveDispatchMarker && step !== "sent" ? "creating" : step;
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

function parseCreatePayload(payload: Record<string, unknown>): CreateDocumentJobPayload | null {
    const clientId = payload["clientId"];
    const contractData = payload["contractData"];
    if (typeof clientId !== "number" || !isContractData(contractData)) return null;
    return {
        clientId,
        contractData,
        ...(readOptionalString(payload["progressId"]) ? { progressId: readOptionalString(payload["progressId"]) } : {}),
        ...(payload["force"] === true ? { force: true } : {}),
    };
}

function parseFinalizePayload(payload: Record<string, unknown>): FinalizeDocumentJobPayload | null {
    const documentId = readOptionalString(payload["documentId"]);
    const prefillEndDate = readOptionalString(payload["prefillEndDate"]);
    const progressId = readOptionalString(payload["progressId"]);
    if (payload["documentId"] !== undefined && !documentId) return null;
    if (payload["prefillEndDate"] !== undefined && !prefillEndDate) return null;
    if (payload["progressId"] !== undefined && !progressId) return null;
    return {
        ...(documentId ? { documentId } : {}),
        ...(prefillEndDate ? { prefillEndDate } : {}),
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
