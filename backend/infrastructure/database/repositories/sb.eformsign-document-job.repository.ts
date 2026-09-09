import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
    EformsignDocumentJobEntity,
    EformsignDocumentJobPayload,
    EformsignDocumentJobSource,
    EformsignDocumentJobStatus,
    EformsignDocumentJobType,
} from "domain/entities/eformsign-document-job.entity";
import {
    EformsignDocumentJobList,
    EformsignDocumentJobSummary,
    AuthorizeEformsignDocumentJobForDispatchInput,
    EnqueueEformsignDocumentJobInput,
    IEformsignDocumentJobRepository,
} from "domain/repositories/eformsign-document-job.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    authorizeServiceRecordDispatch,
    deriveServiceRecordDocumentSyncStatus,
} from "application/policies/service-record-revision-state.policy";
import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import type {
    ServiceRecordDispatchAuthorizationResult,
    ServiceRecordRevisionDispatchContext,
} from "@babyjamjam/shared/types/service-record";

type RawJob = {
    id: string; branch_id: string; client_id: number | null; document_id: string | null;
    job_type: string; source: string; status: string; request_key: string; active_key: string | null;
    payload: Prisma.JsonValue | string | null; payload_fingerprint: string | null; progress_step: string | null;
    attempts: number; next_attempt_at: Date | string; heartbeat_at: Date | string | null;
    lease_token: string | null; auto_finalize_outcome_recorded_at: Date | string | null;
    started_at: Date | string | null; completed_at: Date | string | null; last_error_code: string | null;
    created_by_user_id: string | null; created_at: Date | string; updated_at: Date | string;
};

type DispatchJobSnapshot = Pick<
    RawJob,
    "id" | "branch_id" | "client_id" | "document_id" | "job_type" | "status"
    | "lease_token" | "progress_step" | "payload" | "payload_fingerprint"
>;

type DispatchDocumentSnapshot = {
    id: number;
    documentId: string;
    branchId: string | null;
    clientId: number | null;
    serviceRecordCaseId: string | null;
};

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function plannedSessionDatesFromJson(value: Prisma.JsonValue | string | null): Array<{
    sessionIndex: number;
    serviceDate: string;
}> {
    let parsed: Prisma.JsonValue | null = value as Prisma.JsonValue | null;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value) as Prisma.JsonValue;
        } catch {
            parsed = null;
        }
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
        .map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
            const row = entry as Record<string, Prisma.JsonValue>;
            const sessionIndex = row["sessionIndex"];
            const serviceDate = row["serviceDate"];
            if (
                typeof sessionIndex !== "number"
                || !Number.isInteger(sessionIndex)
                || typeof serviceDate !== "string"
            ) return null;
            return { sessionIndex, serviceDate };
        })
        .filter((entry): entry is { sessionIndex: number; serviceDate: string } => entry !== null)
        .sort((left, right) => left.sessionIndex - right.sessionIndex);
}

function payloadDocumentId(value: Prisma.JsonValue | string | null): string | null {
    let parsed: unknown = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value) as unknown;
        } catch {
            return null;
        }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const documentId = (parsed as Record<string, unknown>)["documentId"];
    return typeof documentId === "string" && documentId.trim() ? documentId : null;
}

const ACTIVE_STATUSES = Prisma.sql`('queued', 'processing', 'reconciling')`;
const TERMINAL_STATUSES = Prisma.sql`('completed', 'failed')`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function payloadContext(value: RawJob["payload"]): ServiceRecordRevisionDispatchContext | null {
    let parsed: unknown = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value) as unknown;
        } catch {
            return null;
        }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const context = (parsed as Record<string, unknown>)["context"];
    if (typeof context !== "object" || context === null || Array.isArray(context)) return null;
    return context as ServiceRecordRevisionDispatchContext;
}

function payloadRevisionJob(value: RawJob["payload"]): {
    revisionId: string | null;
    payloadFingerprint: string | null;
    completeness: "complete" | "partial" | null;
    manualReviewRequired: boolean;
} | null {
    let parsed: unknown = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value) as unknown;
        } catch {
            return null;
        }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    const context = row["context"];
    if (!context || typeof context !== "object" || Array.isArray(context)) return null;
    const contextRevisionId = (context as Record<string, unknown>)["revisionId"];
    const revisionId = typeof row["revisionId"] === "string"
        ? row["revisionId"]
        : typeof contextRevisionId === "string"
            ? contextRevisionId
            : null;
    const payloadFingerprint = typeof row["payloadFingerprint"] === "string"
        ? row["payloadFingerprint"]
        : null;
    const completeness = row["completeness"] === "complete" || row["completeness"] === "partial"
        ? row["completeness"]
        : null;
    return {
        revisionId,
        payloadFingerprint,
        completeness,
        manualReviewRequired: row["manualReviewRequired"] === true,
    };
}

@Injectable()
export class SbEformsignDocumentJobRepository implements IEformsignDocumentJobRepository {
    constructor(private readonly prisma: PrismaService) {}

    async enqueue(input: EnqueueEformsignDocumentJobInput) {
        return this.prisma.$transaction((tx) => this.enqueueInTransaction(tx, input));
    }

    async findByRequestKeyInTransaction(
        tx: Prisma.TransactionClient,
        requestKey: string,
    ) {
        const rows = await tx.$queryRaw<RawJob[]>(Prisma.sql`
            SELECT *
            FROM "eformsign_document_job"
            WHERE request_key = ${requestKey}
            LIMIT 1
        `);
        return rows[0] ? this.toDomain(rows[0]) : null;
    }

    async enqueueInTransaction(
        tx: Prisma.TransactionClient,
        input: EnqueueEformsignDocumentJobInput,
    ) {
        const inserted = await tx.$queryRaw<RawJob[]>(Prisma.sql`
                INSERT INTO "eformsign_document_job" (
                    branch_id, client_id, document_id, job_type, source, request_key,
                    active_key, payload, payload_fingerprint, progress_step, created_by_user_id
                ) VALUES (
                    ${input.branchId}::uuid, ${input.clientId ?? null}, ${input.documentId ?? null},
                    ${input.jobType}, ${input.source}, ${input.requestKey}, ${input.activeKey},
                    ${JSON.stringify(input.payload)}::jsonb, ${input.payloadFingerprint}, 'queued',
                    ${input.createdByUserId ?? null}::uuid
                )
                ON CONFLICT DO NOTHING
                RETURNING *
            `);
        if (inserted[0]) return { job: this.toDomain(inserted[0]), existing: false };

        const existing = await tx.$queryRaw<RawJob[]>(Prisma.sql`
                SELECT * FROM "eformsign_document_job"
                WHERE request_key = ${input.requestKey} OR active_key = ${input.activeKey}
                ORDER BY CASE WHEN request_key = ${input.requestKey} THEN 0 ELSE 1 END
                LIMIT 1
            `);
        if (!existing[0]) throw new Error("EFORMSIGN_DOCUMENT_JOB_KEY_CONFLICT");
        if (existing[0].branch_id !== input.branchId) {
            throw new Error("EFORMSIGN_DOCUMENT_JOB_KEY_CONFLICT");
        }
        if (
            existing[0].request_key === input.requestKey
            && existing[0].payload_fingerprint !== input.payloadFingerprint
        ) {
            throw new Error("EFORMSIGN_DOCUMENT_JOB_IDEMPOTENCY_MISMATCH");
        }
        return { job: this.toDomain(existing[0]), existing: true };
    }

    /**
     * Authorize a claimed job through the repository-owned transaction. The
     * worker only supplies the claim token and optional revision context; all
     * branch, client, document, case, and revision ownership is discovered
     * from durable rows here before the marker CAS runs.
     */
    async authorizeForDispatch(
        input: AuthorizeEformsignDocumentJobForDispatchInput,
    ): Promise<ServiceRecordDispatchAuthorizationResult> {
        if (!UUID_PATTERN.test(input.jobId) || !UUID_PATTERN.test(input.leaseToken)) {
            return { kind: "lost", reason: "invalid_job_claim" } as const;
        }

        try {
            return await this.prisma.$transaction(async (tx) => {
                const initial = await this.readDispatchJob(tx, input.jobId, false);
                if (!initial) return { kind: "lost", reason: "job_not_found" } as const;

                const expected = input.expectedContext;
                // Phase0 has not verified the revised-record provider path.
                // A revision-bound claim therefore remains manual-review only,
                // even if a forged worker context says pending/completed.
                if (expected?.revisionId !== null && expected?.revisionId !== undefined) {
                    return {
                        kind: "stale",
                        reason: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED",
                    } as const;
                }
                const isFinalize = initial.job_type === "finalize_document";
                const isCreate = initial.job_type === "create_document";
                if (!isFinalize && !isCreate) {
                    return { kind: "lost", reason: "unsupported_job_type" } as const;
                }

                let branchId = initial.branch_id;
                let clientId = initial.client_id;
                let caseId: string | null = expected?.serviceRecordCaseId ?? null;
                const documentId = initial.document_id ?? payloadDocumentId(initial.payload);
                let document: DispatchDocumentSnapshot | null = null;

                if (expected) {
                    if (
                        !isCreate
                        || initial.branch_id !== expected.branchId
                        || initial.client_id !== expected.clientId
                    ) {
                        return { kind: "lost", reason: "ownership_changed" } as const;
                    }
                    branchId = expected.branchId;
                    clientId = expected.clientId;
                    caseId = expected.serviceRecordCaseId;
                } else if (isFinalize) {
                    if (!documentId) {
                        return {
                            kind: "stale",
                            reason: "SERVICE_RECORD_FINALIZE_OWNER_UNAVAILABLE",
                        } as const;
                    }
                    document = await this.findDispatchDocument(tx, documentId);
                    if (
                        !document
                        || document.documentId !== documentId
                        || document.branchId !== initial.branch_id
                        || document.clientId === null
                        || (initial.client_id !== null && initial.client_id !== document.clientId)
                    ) {
                        return {
                            kind: "stale",
                            reason: "SERVICE_RECORD_FINALIZE_OWNER_UNAVAILABLE",
                        } as const;
                    }
                    branchId = initial.branch_id;
                    clientId = document.clientId;
                    caseId = document.serviceRecordCaseId;
                }

                if (clientId !== null) {
                    await lockServiceRecordWriteSet(tx, {
                        branchId,
                        clientId,
                        caseId,
                        ...(document ? { documentIds: [document.id] } : {}),
                    });
                } else if (isFinalize) {
                    return {
                        kind: "stale",
                        reason: "SERVICE_RECORD_FINALIZE_OWNER_UNAVAILABLE",
                    } as const;
                }

                // Common locks are acquired before the job lock. This reread
                // proves that a confirm or ownership change which won first
                // cannot be followed by an old provider operation.
                const current = await this.readDispatchJob(tx, input.jobId, true);
                if (
                    !current
                    || current.branch_id !== branchId
                    || current.job_type !== initial.job_type
                    || current.document_id !== initial.document_id
                    || current.client_id !== initial.client_id
                ) {
                    return { kind: "lost", reason: "ownership_changed" } as const;
                }

                if (isFinalize) {
                    if (!documentId) {
                        return {
                            kind: "stale",
                            reason: "SERVICE_RECORD_FINALIZE_OWNER_UNAVAILABLE",
                        } as const;
                    }
                    const currentDocument = await this.findDispatchDocument(tx, documentId);
                    if (
                        !currentDocument
                        || currentDocument.id !== document?.id
                        || currentDocument.documentId !== documentId
                        || currentDocument.branchId !== branchId
                        || currentDocument.clientId !== clientId
                        || currentDocument.serviceRecordCaseId !== caseId
                        || (current.document_id !== null && current.document_id !== documentId)
                        || payloadDocumentId(current.payload) !== (current.document_id ?? documentId)
                    ) {
                        return {
                            kind: "stale",
                            reason: "SERVICE_RECORD_FINALIZE_OWNER_CHANGED",
                        } as const;
                    }
                }

                if (expected) {
                    const caseDelegate = tx.service_record_case as unknown as {
                        findUnique?: (args: unknown) => Promise<{
                            id: string;
                            branchId: string;
                            clientId: number | null;
                            requiredSessionCount: number | null;
                            plannedSessions: Prisma.JsonValue | null;
                            currentRevisionId: string | null;
                            currentUsableRevisionId: string | null;
                            currentUsableDocumentVersion: number | null;
                            formVersion: number;
                            status: string;
                        } | null>;
                    } | undefined;
                    const revisionDelegate = tx.service_record_revision as unknown as {
                        findUnique?: (args: unknown) => Promise<{
                            revisionNumber: number;
                            payload: Prisma.JsonValue;
                        } | null>;
                    } | undefined;
                    if (typeof caseDelegate?.findUnique !== "function") {
                        return { kind: "lost", reason: "SERVICE_RECORD_REVISION_CASE_UNAVAILABLE" } as const;
                    }
                    const currentCase = await caseDelegate.findUnique({
                        where: { id: expected.serviceRecordCaseId },
                        select: {
                            id: true,
                            branchId: true,
                            clientId: true,
                            requiredSessionCount: true,
                            plannedSessions: true,
                            currentRevisionId: true,
                            currentUsableRevisionId: true,
                            currentUsableDocumentVersion: true,
                            formVersion: true,
                            status: true,
                        },
                    });
                    if (
                        !currentCase
                        || currentCase.id !== expected.serviceRecordCaseId
                        || currentCase.branchId !== expected.branchId
                        || currentCase.clientId !== expected.clientId
                    ) {
                        return { kind: "lost", reason: "SERVICE_RECORD_REVISION_OWNERSHIP_CHANGED" } as const;
                    }

                    let revisionNumber = currentCase.currentRevisionId === null
                        ? null
                        : expected.revisionNumber;
                    let businessFingerprint = expected.businessFingerprint;
                    if (currentCase.currentRevisionId !== null) {
                        if (typeof revisionDelegate?.findUnique !== "function") {
                            return { kind: "lost", reason: "SERVICE_RECORD_REVISION_UNAVAILABLE" } as const;
                        }
                        const revision = await revisionDelegate.findUnique({
                            where: { id: currentCase.currentRevisionId },
                            select: { revisionNumber: true, payload: true },
                        });
                        if (!revision) {
                            return { kind: "lost", reason: "SERVICE_RECORD_REVISION_MISSING" } as const;
                        }
                        revisionNumber = revision.revisionNumber;
                        businessFingerprint = createHash("sha256")
                            .update(stableJson(revision.payload))
                            .digest("hex");
                    }

                    const persistedRevisionJob = payloadRevisionJob(current.payload);
                    const documentSyncStatus = expected.revisionId === null
                        ? expected.documentSyncStatus
                        : deriveServiceRecordDocumentSyncStatus({
                            currentRevisionId: currentCase.currentRevisionId,
                            currentUsableRevisionId: currentCase.currentUsableRevisionId,
                            currentUsableDocumentVersion: currentCase.currentUsableDocumentVersion,
                            revisionJob: persistedRevisionJob
                                ? {
                                    ...persistedRevisionJob,
                                    status: current.status,
                                    progressStep: current.progress_step,
                                }
                                : null,
                        });
                    const authorization = authorizeServiceRecordDispatch(expected, {
                        branchId: currentCase.branchId,
                        clientId: currentCase.clientId!,
                        serviceRecordCaseId: currentCase.id,
                        revisionId: currentCase.currentRevisionId,
                        revisionNumber,
                        businessFingerprint,
                        plannedSessionCount: currentCase.requiredSessionCount,
                        plannedSessionDates: plannedSessionDatesFromJson(currentCase.plannedSessions),
                        documentSyncStatus,
                        lifecycleStatus: currentCase.status,
                        formVersion: currentCase.formVersion,
                    });
                    if (authorization.kind !== "allow") return authorization;
                }

                return this.authorizeForDispatchInTransaction(tx, {
                    ...input,
                    expectedContext: expected,
                });
            });
        } catch (error) {
            if (error instanceof ConflictException) {
                return { kind: "lost", reason: "SERVICE_RECORD_WRITE_TARGET_CHANGED" } as const;
            }
            throw error;
        }
    }

    private async readDispatchJob(
        tx: Prisma.TransactionClient,
        jobId: string,
        forUpdate: boolean,
    ): Promise<DispatchJobSnapshot | null> {
        const rows = await tx.$queryRaw<DispatchJobSnapshot[]>(Prisma.sql`
            SELECT
                "id", "branch_id", "client_id", "document_id", "job_type", "status",
                "lease_token", "progress_step", "payload", "payload_fingerprint"
            FROM "eformsign_document_job"
            WHERE "id" = ${jobId}::uuid
            ${forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty}
        `);
        return rows[0] ?? null;
    }

    private async findDispatchDocument(
        tx: Prisma.TransactionClient,
        documentId: string,
    ): Promise<DispatchDocumentSnapshot | null> {
        const delegate = tx.eformsign_doc as unknown as {
            findUnique?: (args: unknown) => Promise<DispatchDocumentSnapshot | null>;
        } | undefined;
        if (typeof delegate?.findUnique !== "function") return null;
        return delegate.findUnique({
            where: { documentId },
            select: {
                id: true,
                documentId: true,
                branchId: true,
                clientId: true,
                serviceRecordCaseId: true,
            },
        });
    }

    /**
     * Lock a claimed job and commit the irreversible provider marker before
     * the worker leaves the caller-owned transaction. No transaction is
     * opened here; callers must already hold the service-record common lock
     * order (client -> employees -> case -> children -> jobs).
     */
    async authorizeForDispatchInTransaction(
        tx: Prisma.TransactionClient,
        input: AuthorizeEformsignDocumentJobForDispatchInput,
    ) {
        if (!UUID_PATTERN.test(input.jobId) || !UUID_PATTERN.test(input.leaseToken)) {
            return { kind: "lost", reason: "invalid_job_claim" } as const;
        }
        if (input.expectedContext?.revisionId !== null && input.expectedContext?.revisionId !== undefined) {
            return {
                kind: "stale",
                reason: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED",
            } as const;
        }

        const rows = await tx.$queryRaw<RawJob[]>(Prisma.sql`
            SELECT *
            FROM "eformsign_document_job"
            WHERE id = ${input.jobId}::uuid
            FOR UPDATE
        `);
        const current = rows[0];
        if (!current) return { kind: "lost", reason: "job_not_found" } as const;
        if (current.status !== "processing") {
            return { kind: "lost", reason: "job_not_active" } as const;
        }
        if (current.lease_token !== input.leaseToken) {
            return { kind: "lost", reason: "lease_lost" } as const;
        }
        if (current.progress_step === "creating" || current.progress_step === "sent") {
            return { kind: "lost", reason: "dispatch_already_claimed" } as const;
        }

        if (input.expectedContext) {
            const observed = payloadContext(current.payload);
            if (
                !observed
                || current.branch_id !== input.expectedContext.branchId
                || current.client_id !== input.expectedContext.clientId
            ) {
                return { kind: "lost", reason: "ownership_changed" } as const;
            }
            const authorization = authorizeServiceRecordDispatch(input.expectedContext, observed);
            if (authorization.kind !== "allow") return authorization;
        }

        const claimed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            UPDATE "eformsign_document_job"
            SET progress_step = 'creating', heartbeat_at = now(), updated_at = now()
            WHERE id = ${input.jobId}::uuid
              AND lease_token = ${input.leaseToken}::uuid
              AND status = 'processing'
              AND COALESCE(progress_step, '') NOT IN ('creating', 'sent')
            RETURNING id
        `);
        return claimed.length > 0
            ? { kind: "allow" as const }
            : { kind: "lost" as const, reason: "lease_lost" };
    }

    async claimDue(limit = 1): Promise<EformsignDocumentJobEntity[]> {
        const requested = Math.max(1, Math.min(limit, 3));
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(240813, 3)`);
            const counts = await tx.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
                SELECT count(*)::int AS count FROM "eformsign_document_job"
                WHERE status IN ('processing', 'reconciling')
            `);
            const available = Math.max(0, 3 - Number(counts[0]?.count ?? 0));
            if (available === 0) return [];
            const take = Math.min(requested, available);
            const rows = await tx.$queryRaw<RawJob[]>(Prisma.sql`
                WITH picked AS (
                    SELECT id FROM "eformsign_document_job"
                    WHERE status = 'queued' AND next_attempt_at <= now()
                    ORDER BY next_attempt_at ASC, created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT ${take}
                )
                UPDATE "eformsign_document_job" job
                SET status = 'processing', attempts = attempts + 1,
                    started_at = COALESCE(started_at, now()), heartbeat_at = now(),
                    lease_token = gen_random_uuid(), updated_at = now()
                FROM picked WHERE job.id = picked.id
                RETURNING job.*
            `);
            return rows.map((row) => this.toDomain(row));
        });
    }

    async updateProgress(id: string, leaseToken: string, progressStep: string, heartbeatAt = new Date()) {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET progress_step = ${progressStep},
                heartbeat_at = ${heartbeatAt}, updated_at = now()
            WHERE id = ${id}::uuid AND lease_token = ${leaseToken}::uuid
              AND status IN ('processing', 'reconciling') RETURNING *
        `);
    }

    async scheduleRetry(id: string, leaseToken: string, nextAttemptAt: Date, errorCode: string) {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = 'queued', next_attempt_at = ${nextAttemptAt},
                last_error_code = ${errorCode}, heartbeat_at = NULL, lease_token = NULL, updated_at = now()
            WHERE id = ${id}::uuid AND lease_token = ${leaseToken}::uuid
              AND status = 'processing' RETURNING *
        `);
    }

    async markReconciling(id: string, leaseToken: string, progressStep = "reconciling") {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = 'reconciling', progress_step = ${progressStep},
                payload = CASE
                    WHEN jsonb_typeof(payload) = 'object'
                        AND payload->>'kind' = 'service_record_revision' THEN payload
                    ELSE NULL
                END,
                heartbeat_at = now(), updated_at = now()
            WHERE id = ${id}::uuid AND lease_token = ${leaseToken}::uuid
              AND status IN ('processing', 'reconciling') RETURNING *
        `);
    }

    async markCompleted(id: string, leaseToken: string, documentId?: string) {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = 'completed',
                document_id = COALESCE(${documentId ?? null}, document_id), completed_at = now(),
                payload = CASE
                    WHEN jsonb_typeof(payload) = 'object'
                        AND payload->>'kind' = 'service_record_revision' THEN payload
                    ELSE NULL
                END,
                active_key = NULL, heartbeat_at = NULL, lease_token = NULL,
                last_error_code = NULL, updated_at = now()
            WHERE id = ${id}::uuid AND lease_token = ${leaseToken}::uuid
              AND status IN ('processing', 'reconciling') RETURNING *
        `);
    }

    async markFailed(id: string, leaseToken: string, errorCode: string) {
        return this.terminal(id, leaseToken, "failed", errorCode, true);
    }

    async markRequiresAttention(id: string, leaseToken: string, errorCode: string) {
        return this.terminal(id, leaseToken, "requires_attention", errorCode, false);
    }

    async recoverStale(cutoff: Date) {
        const rows = await this.prisma.$queryRaw<RawJob[]>(Prisma.sql`
            UPDATE "eformsign_document_job" SET
                status = CASE
                    WHEN progress_step IS NULL OR progress_step IN ('queued', 'validating', 'preparing') THEN 'queued'
                    ELSE 'reconciling'
                END,
                next_attempt_at = CASE
                    WHEN progress_step IS NULL OR progress_step IN ('queued', 'validating', 'preparing') THEN now()
                    ELSE next_attempt_at
                END,
                payload = CASE
                    WHEN progress_step IS NULL OR progress_step IN ('queued', 'validating', 'preparing') THEN payload
                    WHEN jsonb_typeof(payload) = 'object'
                        AND payload->>'kind' = 'service_record_revision' THEN payload
                    ELSE NULL
                END,
                heartbeat_at = NULL,
                lease_token = CASE
                    WHEN progress_step IS NULL OR progress_step IN ('queued', 'validating', 'preparing') THEN NULL
                    ELSE gen_random_uuid()
                END,
                updated_at = now()
            WHERE status IN ('processing', 'reconciling')
              AND COALESCE(heartbeat_at, updated_at) < ${cutoff}
            RETURNING *
        `);
        return rows.map((row) => this.toDomain(row));
    }

    async getSummary(branchId: string): Promise<EformsignDocumentJobSummary> {
        const rows = await this.prisma.$queryRaw<Array<{ active_count: number; attention_count: number }>>(Prisma.sql`
            SELECT count(*) FILTER (WHERE status IN ${ACTIVE_STATUSES})::int AS active_count,
                   count(*) FILTER (WHERE status = 'requires_attention')::int AS attention_count
            FROM "eformsign_document_job" WHERE branch_id = ${branchId}::uuid
        `);
        return { activeCount: Number(rows[0]?.active_count ?? 0), requiresAttentionCount: Number(rows[0]?.attention_count ?? 0) };
    }

    async listForBranch(branchId: string, terminalSince: Date, terminalLimit = 50): Promise<EformsignDocumentJobList> {
        const limit = Math.max(1, Math.min(terminalLimit, 50));
        const [active, requiresAttention, recent] = await Promise.all([
            this.prisma.$queryRaw<RawJob[]>(Prisma.sql`SELECT * FROM "eformsign_document_job" WHERE branch_id = ${branchId}::uuid AND status IN ${ACTIVE_STATUSES} ORDER BY created_at ASC`),
            this.prisma.$queryRaw<RawJob[]>(Prisma.sql`SELECT * FROM "eformsign_document_job" WHERE branch_id = ${branchId}::uuid AND status = 'requires_attention' ORDER BY updated_at DESC LIMIT 50`),
            this.prisma.$queryRaw<RawJob[]>(Prisma.sql`SELECT * FROM "eformsign_document_job" WHERE branch_id = ${branchId}::uuid AND status IN ${TERMINAL_STATUSES} AND completed_at >= ${terminalSince} ORDER BY completed_at DESC LIMIT ${limit}`),
        ]);
        return { active: active.map(this.toDomain), requiresAttention: requiresAttention.map(this.toDomain), recent: recent.map(this.toDomain) };
    }

    async deleteExpiredTerminal(cutoff: Date) {
        const count = await this.prisma.$executeRaw(Prisma.sql`
            DELETE FROM "eformsign_document_job"
            WHERE status IN ${TERMINAL_STATUSES}
              AND completed_at < ${cutoff}
              AND NOT (
                  COALESCE(jsonb_typeof(payload) = 'object', false)
                  AND COALESCE(payload->>'kind' = 'service_record_revision', false)
              )
        `);
        return Number(count);
    }

    private async terminal(
        id: string,
        leaseToken: string,
        status: "failed" | "requires_attention",
        errorCode: string,
        releaseActiveKey: boolean,
    ) {
        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<RawJob[]>(Prisma.sql`
                UPDATE "eformsign_document_job" SET status = ${status}, last_error_code = ${errorCode},
                    completed_at = now(),
                    payload = CASE
                        WHEN jsonb_typeof(payload) = 'object'
                            AND payload->>'kind' = 'service_record_revision' THEN payload
                        ELSE NULL
                    END,
                    active_key = CASE
                        WHEN ${releaseActiveKey} AND source <> 'auto_finalize' THEN NULL
                        ELSE active_key
                    END,
                    heartbeat_at = NULL, lease_token = NULL, updated_at = now()
                WHERE id = ${id}::uuid AND lease_token = ${leaseToken}::uuid
                  AND status IN ('processing', 'reconciling') RETURNING *
            `);
            const row = rows[0];
            if (!row) return null;

            let recordedAttempts: number | null = null;
            if (
                row.source === "auto_finalize"
                && row.document_id
                && !row.auto_finalize_outcome_recorded_at
            ) {
                const updated = await tx.eformsign_doc.update({
                    where: { documentId: row.document_id },
                    data: {
                        autoFinalizeAttempts: { increment: 1 },
                        autoFinalizeLastAttemptAt: new Date(),
                        autoFinalizeLastError: errorCode,
                    },
                    select: { autoFinalizeAttempts: true },
                });
                recordedAttempts = updated.autoFinalizeAttempts;
                const recordedAt = new Date();
                await tx.$executeRaw(Prisma.sql`
                    UPDATE "eformsign_document_job"
                    SET auto_finalize_outcome_recorded_at = ${recordedAt}
                    WHERE id = ${id}::uuid
                `);
                row.auto_finalize_outcome_recorded_at = recordedAt;
            }
            if (status === "failed" && recordedAttempts !== null) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE "eformsign_document_job"
                    SET active_key = ${recordedAttempts < 3 ? null : row.active_key}
                    WHERE id = ${id}::uuid
                `);
                if (recordedAttempts < 3) row.active_key = null;
            }
            return new EformsignDocumentJobEntity({
                ...this.toDomain(row),
                autoFinalizeOutcomeAttempts: recordedAttempts,
            });
        });
    }

    private async updateOne(query: Prisma.Sql) {
        const rows = await this.prisma.$queryRaw<RawJob[]>(query);
        return rows[0] ? this.toDomain(rows[0]) : null;
    }

    private toDomain = (row: RawJob): EformsignDocumentJobEntity => new EformsignDocumentJobEntity({
        id: row.id, branchId: row.branch_id, clientId: row.client_id, documentId: row.document_id,
        jobType: row.job_type as EformsignDocumentJobType, source: row.source as EformsignDocumentJobSource,
        status: row.status as EformsignDocumentJobStatus, requestKey: row.request_key, activeKey: row.active_key,
        payload: this.parsePayload(row.payload), payloadFingerprint: row.payload_fingerprint,
        progressStep: row.progress_step, attempts: row.attempts, nextAttemptAt: new Date(row.next_attempt_at),
        heartbeatAt: row.heartbeat_at ? new Date(row.heartbeat_at) : null,
        leaseToken: row.lease_token,
        autoFinalizeOutcomeRecordedAt: row.auto_finalize_outcome_recorded_at
            ? new Date(row.auto_finalize_outcome_recorded_at)
            : null,
        autoFinalizeOutcomeAttempts: null,
        startedAt: row.started_at ? new Date(row.started_at) : null,
        completedAt: row.completed_at ? new Date(row.completed_at) : null, lastErrorCode: row.last_error_code,
        createdByUserId: row.created_by_user_id, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
    });

    private parsePayload(value: RawJob["payload"]): EformsignDocumentJobPayload | null {
        if (value === null) return null;
        return (typeof value === "string" ? JSON.parse(value) : value) as EformsignDocumentJobPayload;
    }
}
