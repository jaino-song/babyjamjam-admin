import { ConflictException, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { toJobErrorCode } from "domain/value-objects/eformsign-job-error-code";

import { isInitialFinalizationJobIdentity, isInitialFinalizationWorkflowScope } from "application/policies/service-record-initial-finalization.policy";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import {
    CANCELLED_PROGRESS_STEP,
    DISPATCH_AUTHORIZED_PROGRESS_STEP,
    EformsignDocumentJobEntity,
    EformsignDocumentJobPayload,
    EformsignDocumentJobSource,
    EformsignDocumentJobStatus,
    EformsignDocumentJobType,
    MANUAL_RESOLVED_PROGRESS_STEP,
    SUPERSEDED_PROGRESS_STEP,
    buildManualClaimStep,
    parseManualClaim,
    isContractJob,
} from "domain/entities/eformsign-document-job.entity";
import {
    DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG,
    normalizeContractAutoFinalizeConfig,
} from "domain/entities/system-setting.entity";
import {
    ClaimRecoveryResult,
    CancelDocumentJobResult,
    EformsignDocumentJobList,
    EformsignDocumentJobSummary,
    AuthorizeEformsignDocumentJobForDispatchInput,
    EnqueueEformsignDocumentJobInput,
    IEformsignDocumentJobRepository,
    ManualRecoveryInput,
    ResolveManuallyResult,
    RequeueInitialFinalizationJobResult,
    DiagnoseInitialFinalizationJobResult,
} from "domain/repositories/eformsign-document-job.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ContractRecoveryError } from "domain/repositories/eformsign-contract-recovery.repository.interface";
import { withoutEntityChangeHints } from "infrastructure/database/entity-change-suppression";
import { normalizeVerifiedAuthority, retireProvenNoEffect } from "../utils/eformsign-contract-authority-release";
import { AuthorityConflictError, lockAuthorityScope, reserveAuthority } from "../utils/eformsign-contract-authority";
import {
    authorizeServiceRecordDispatch,
    deriveServiceRecordDocumentSyncStatus,
    isValidServiceRecordDispatchContext,
} from "application/policies/service-record-revision-state.policy";
import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import type {
    ServiceRecordDispatchAuthorizationResult,
    ServiceRecordRevisionDispatchContext,
} from "@babyjamjam/shared/types/service-record";

type RawJob = {
    cancellable?: boolean;
    contract_generation?: string | null;
    id: string; branch_id: string; client_id: number | null; document_id: string | null;
    job_type: string; source: string; status: string; request_key: string; active_key: string | null;
    payload: Prisma.JsonValue | string | null; payload_fingerprint: string | null; progress_step: string | null; progress_detail: string | null;
    attempts: number; next_attempt_at: Date | string; heartbeat_at: Date | string | null;
    lease_token: string | null; auto_finalize_outcome_recorded_at: Date | string | null;
    started_at: Date | string | null; completed_at: Date | string | null; last_error_code: string | null;
    created_by_user_id: string | null; created_at: Date | string; updated_at: Date | string;
    client_name?: string | null;
};

type DispatchJobSnapshot = Pick<
    RawJob,
    "id" | "branch_id" | "client_id" | "document_id" | "job_type" | "status"
    | "lease_token" | "progress_step" | "payload" | "payload_fingerprint" | "source" | "request_key"
>;

type DispatchDocumentSnapshot = {
    id: number;
    documentId: string;
    branchId: string | null;
    clientId: number | null;
    serviceRecordCaseId: string | null;
};

function initialFinalizationJobIneligibility(job: DispatchJobSnapshot): string | undefined {
    if (!["", "queued", "validating", "preparing"].includes(job.progress_step ?? "")) {
        return "SERVICE_RECORD_INITIAL_FINALIZATION_SEND_EVIDENCE_PRESENT";
    }
    if (!["requires_attention", "failed"].includes(job.status)) {
        return "SERVICE_RECORD_INITIAL_FINALIZATION_JOB_NOT_STOPPED";
    }
    return undefined;
}

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
const RECOVERABLE_STATUSES = Prisma.sql`('failed', 'requires_attention')`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Failed staff jobs are deleted and attention payloads purged this long after completed_at.
const RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60_000;
// A claim user id is written into the 80-character progress_step and matched with LIKE:
// no ':' (the separator) and no LIKE wildcards.
const MANUAL_CLAIM_USER_PATTERN = /^[0-9A-Za-z-]{1,40}$/;

/**
 * SQL form of `isContractJob`: a staff create/finalize job from the contract flow.
 * Service-record revision jobs share the table but are never contract jobs: they
 * have a `service-record-` request key and a payload `kind`. Pass the table alias
 * when the query joins another table, so the columns stay unambiguous.
 */
function contractJobSql(alias = ""): Prisma.Sql {
    const column = (name: string) => (alias ? `${alias}.${name}` : name);
    return Prisma.raw(
        `(${column("source")} = 'staff'`
        + ` AND ${column("job_type")} IN ('create_document', 'finalize_document')`
        + ` AND ${column("request_key")} NOT LIKE 'service-record-%'`
        + ` AND (${column("payload")} IS NULL OR NOT (${column("payload")} ? 'kind')))`,
    );
}

/** SQL display proof. POST additionally locks, validates linked identities and vetoes live claims. */
function cancellableJobSql(): Prisma.Sql {
    const noEffect = (alias: string) => {
        // Aliases are source-owned identifiers, never request input.
        const i = Prisma.raw(alias);
        return Prisma.sql`(${i}.provider_document_id IS NULL AND (
            (${i}.status = 'prepared' AND (${i}.attempt_count = 0 OR (${i}.started_at IS NULL AND ${i}.reconciliation_reason = 'draft_released_before_open')))
            OR (${i}.status = 'reconciled_not_delivered' AND ${i}.reconciled_outcome = 'not_delivered'
                AND ${i}.reconciled_at IS NOT NULL AND ${i}.reconciled_by_user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        ))`;
    };
    return Prisma.sql`COALESCE((
        ${contractJobSql("j")} AND j.contract_generation IS NOT NULL AND j.job_type = 'create_document'
        AND j.status IN ('failed', 'requires_attention') AND j.lease_token IS NULL AND j.document_id IS NULL
        AND COALESCE(j.progress_step, '') NOT IN ('creating', 'sent', 'superseded', 'cancelled')
        AND COALESCE(j.progress_detail, '') NOT IN ('creating', 'sent')
        AND EXISTS (
            SELECT 1 FROM eformsign_contract_authority a
            JOIN client c ON c.id = a.client_id AND c.branch_id = a.branch_id
            WHERE a.creation_job_id = j.id AND a.branch_id = j.branch_id AND a.client_id = j.client_id
              AND a.generation = j.contract_generation AND a.fingerprint = j.payload_fingerprint
              AND a.phase IN ('reserved', 'creation_pending', 'creation_uncertain')
              AND a.provider_document_id IS NULL AND a.human_intent_id IS NULL
              AND c.e_doc_id IS NOT DISTINCT FROM a.prior_document_id
              AND (a.creation_intent_id IS NOT NULL OR a.draft_intent_id IS NOT NULL OR a.phase IN ('reserved', 'creation_uncertain'))
              AND (a.phase <> 'reserved' OR a.creation_intent_id IS NULL OR EXISTS (
                  SELECT 1 FROM eformsign_dispatch_intent i WHERE i.id = a.creation_intent_id AND i.status = 'reconciled_not_delivered'))
              AND NOT EXISTS (
                  SELECT 1 FROM unnest(ARRAY[a.creation_intent_id, a.draft_intent_id]) ref(id)
                  LEFT JOIN eformsign_dispatch_intent i ON i.id = ref.id
                  WHERE ref.id IS NOT NULL AND (i.id IS NULL OR NOT COALESCE(${noEffect("i")}, false)))
              AND NOT EXISTS (
                  SELECT 1 FROM eformsign_dispatch_intent d
                  WHERE d.business_key = encode(sha256(convert_to('contract-draft:' || a.generation::text, 'UTF8')), 'hex')
                    AND (NOT COALESCE(${noEffect("d")}, false) OR (d.id IS DISTINCT FROM a.draft_intent_id
                        AND NOT COALESCE((d.status = 'prepared' AND d.started_at IS NULL AND d.provider_document_id IS NULL
                            AND d.reconciliation_reason = 'draft_released_before_open'), false))))
              AND NOT EXISTS (
                  SELECT 1 FROM eformsign_dispatch_intent h
                  WHERE h.business_key = encode(sha256(convert_to('contract-human:' || a.generation::text, 'UTF8')), 'hex'))
              AND NOT EXISTS (
                  SELECT 1 FROM eformsign_dispatch_intent u WHERE u.branch_id = a.branch_id AND u.client_id = a.client_id
                    AND u.action IN ('create', 'create_draft') AND (u.status IN ('started', 'uncertain')
                        OR (u.status = 'accepted' AND (u.provider_document_id IS NULL OR btrim(u.provider_document_id) = ''))))
        )
    ), false)`;
}

/**
 * True when `userId` may take or finish the job: it carries no manual claim, the
 * claim expired, or the claim is this user's. The expiry is cast to bigint only
 * after the regex proves its shape, and CASE keeps that order.
 */
function manualClaimAvailableSql(userId: string, nowMs: number, alias = "j"): Prisma.Sql {
    const step = Prisma.raw(`${alias}.progress_step`);
    return Prisma.sql`(
        COALESCE(${step}, '') NOT LIKE 'manual_in_progress:%'
        OR (CASE WHEN ${step} ~ '^manual_in_progress:[^:]+:[0-9]{1,15}$'
                 THEN split_part(${step}, ':', 3)::bigint
                 ELSE 0 END) < ${String(nowMs)}::bigint
        OR ${step} LIKE 'manual_in_progress:' || ${userId}::text || ':%'
    )`;
}

type RecoveryMiss =
    | { kind: "not_found" }
    | { kind: "claimed_by_other"; expiresAt: Date }
    | { kind: "invalid_state"; status: EformsignDocumentJobStatus }
    | { kind: "resolved"; row: RawJob };

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

    async cancel(input: ManualRecoveryInput): Promise<CancelDocumentJobResult> {
        if (!UUID_PATTERN.test(input.jobId) || !UUID_PATTERN.test(input.branchId)) return { kind: "not_found" };
        this.assertClaimInput(input);
        try {
            return await this.prisma.$transaction(async tx => {
                // A terminal cancellation can replay without client/authority locks; eligibility is checked after locking.
                const peek = await tx.eformsign_document_job.findUnique({ where: { id: input.jobId } });
                if (!peek || peek.branchId !== input.branchId) return { kind: "not_found" };
                if (peek.status === "failed" && peek.progressStep === CANCELLED_PROGRESS_STEP) return { kind: "already_cancelled" };
                if (!peek.clientId) return { kind: "not_cancellable", reason: "unsupported_job" };
                const [authority] = await lockAuthorityScope(tx, input.branchId, [peek.clientId]);
                await tx.$queryRaw(Prisma.sql`SELECT id FROM eformsign_document_job WHERE id = ${input.jobId}::uuid AND branch_id = ${input.branchId}::uuid FOR UPDATE`);
                const job = await tx.eformsign_document_job.findUnique({ where: { id: input.jobId } });
                if (!job || job.branchId !== input.branchId) return { kind: "not_found" };
                if (job.status === "failed" && job.progressStep === CANCELLED_PROGRESS_STEP) return { kind: "already_cancelled" };
                if (!authority || authority.creationJobId !== job.id || authority.generation !== job.contractGeneration
                    || job.clientId !== peek.clientId || !job.contractGeneration || job.jobType !== "create_document"
                    || !isContractJob({ ...job, source: job.source as EformsignDocumentJobSource,
                        jobType: job.jobType as EformsignDocumentJobType, payload: this.parsePayload(job.payload) })
                    || !["failed", "requires_attention"].includes(job.status) || job.leaseToken !== null
                    || ["creating", "sent", SUPERSEDED_PROGRESS_STEP, CANCELLED_PROGRESS_STEP].includes(job.progressStep ?? "")
                    || ["creating", "sent"].includes(job.progressDetail ?? "")) return { kind: "not_cancellable", reason: "ineligible_job" };
                const client = await tx.client.findUnique({ where: { id: peek.clientId }, select: { branchId: true, eDocId: true } });
                if (!client || client.branchId !== input.branchId) return { kind: "not_cancellable", reason: "scope_changed" };
                const retired = await retireProvenNoEffect(tx, authority, client.eDocId, CANCELLED_PROGRESS_STEP,
                    { claimUserId: null, claimExpiresAt: null });
                return retired ? { kind: "cancelled" } : { kind: "not_cancellable", reason: "effect_not_disproved" };
            }, { timeout: 20000 });
        } catch (error) {
            // Let the transaction roll back first: a failed authority CAS must undo the job update too.
            if (error instanceof ContractRecoveryError || error instanceof AuthorityConflictError) {
                return { kind: "not_cancellable", reason: "proof_conflict" };
            }
            throw error;
        }
    }

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
        const contract = input.jobType === "create_document" && input.clientId && isContractJob(input);
        let generation: string | null = null, priorDocumentId: string | null = null;
        let mutatedAuthority = false;
        if (contract) {
            if (!/^[a-f0-9]{64}$/.test(input.payloadFingerprint)) throw new ConflictException({ code: "REQUEST_CONFLICT" });
            const [authority] = await lockAuthorityScope(tx, input.branchId, [input.clientId!]);
            const replay = await tx.$queryRaw<RawJob[]>(Prisma.sql`SELECT * FROM eformsign_document_job
                WHERE request_key = ${input.requestKey} LIMIT 1`);
            if (replay[0]) {
                if (replay[0].branch_id !== input.branchId) throw new Error("EFORMSIGN_DOCUMENT_JOB_KEY_CONFLICT");
                if (replay[0].payload_fingerprint !== input.payloadFingerprint) throw new Error("EFORMSIGN_DOCUMENT_JOB_IDEMPOTENCY_MISMATCH");
                return { job: this.toDomain(replay[0]), existing: true };
            }
            if (authority) {
                try {
                    mutatedAuthority = await normalizeVerifiedAuthority(tx, authority);
                } catch (error) {
                    if (error instanceof ContractRecoveryError) throw new ConflictException({ code: "REQUEST_CONFLICT" });
                    throw error;
                }
            }
            const client = await tx.client.findUnique({ where: { id: input.clientId! }, select: { eDocId: true } });
            if (!client) throw new ConflictException({ code: "REQUEST_CONFLICT" });
            const active = await tx.$queryRaw<RawJob[]>(Prisma.sql`SELECT * FROM eformsign_document_job WHERE active_key = ${input.activeKey} LIMIT 1`);
            let retired = false;
            if (authority && (!active[0] || active[0].id === authority.creationJobId)) {
                try {
                    retired = await retireProvenNoEffect(tx, authority, client.eDocId);
                } catch (error) {
                    if (error instanceof ContractRecoveryError) throw new ConflictException({ code: "REQUEST_CONFLICT" });
                    throw error;
                }
            }
            mutatedAuthority = retired || mutatedAuthority;
            if (active[0] && !retired) {
                if (mutatedAuthority) throw new ConflictException({ code: "REQUEST_CONFLICT" });
                if (active[0].branch_id !== input.branchId) throw new Error("EFORMSIGN_DOCUMENT_JOB_KEY_CONFLICT");
                return { job: this.toDomain(active[0]), existing: true };
            }
            // reserveAuthority validates replacement under the same client/authority locks.
            // A refusal rolls back the new job together with any supersession.
            const unresolved = await tx.eformsign_dispatch_intent.findFirst({ where: { branchId: input.branchId, clientId: input.clientId!, action: "create", status: { in: ["started", "uncertain"] } }, select: { id: true } });
            if (unresolved) throw new ConflictException({ code: "REQUEST_CONFLICT" });
            priorDocumentId = client.eDocId; generation = randomUUID();
        }
        const inserted = await tx.$queryRaw<RawJob[]>(Prisma.sql`
                INSERT INTO "eformsign_document_job" (
                    branch_id, client_id, document_id, job_type, source, request_key,
                    active_key, payload, payload_fingerprint, progress_step, created_by_user_id, contract_generation
                ) VALUES (
                    ${input.branchId}::uuid, ${input.clientId ?? null}, ${input.documentId ?? null},
                    ${input.jobType}, ${input.source}, ${input.requestKey}, ${input.activeKey},
                    ${JSON.stringify(input.payload)}::jsonb, ${input.payloadFingerprint}, 'queued',
                    ${input.createdByUserId ?? null}::uuid, ${generation}::uuid
                )
                ON CONFLICT DO NOTHING
                RETURNING *
            `);
        if (inserted[0]) {
            if (generation) await reserveAuthority(tx, { branchId: input.branchId, clientId: input.clientId!, jobId: inserted[0].id,
                generation, fingerprint: input.payloadFingerprint, priorDocumentId });
            return { job: this.toDomain(inserted[0]), existing: false };
        }

        if (mutatedAuthority) throw new ConflictException({ code: "REQUEST_CONFLICT" });
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
                if (expected?.revisionId != null) {
                    let payload: unknown = initial.payload;
                    try {
                        if (typeof payload === "string") payload = JSON.parse(payload);
                    } catch {
                        return { kind: "stale", reason: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" } as const;
                    }
                    if (!isInitialFinalizationJobIdentity({
                        jobType: initial.job_type,
                        source: initial.source,
                        documentId: initial.document_id,
                        requestKey: initial.request_key,
                        payload,
                    })) {
                        return { kind: "stale", reason: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" } as const;
                    }
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
                        return expected.revisionId != null
                            ? { kind: "stale", reason: "SERVICE_RECORD_INITIAL_FINALIZATION_SCOPE_CHANGED" } as const
                            : { kind: "lost", reason: "ownership_changed" } as const;
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
                    return expected?.revisionId != null
                        ? { kind: "stale", reason: "SERVICE_RECORD_INITIAL_FINALIZATION_SCOPE_CHANGED" } as const
                        : { kind: "lost", reason: "ownership_changed" } as const;
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

                if (expected?.revisionId != null) {
                    const verified = await this.verifyInitialFinalizationDispatch(tx, current, expected);
                    if (verified.kind !== "allow") return verified;
                    const authorization = await this.authorizeForDispatchCore(tx, input);
                    if (authorization.kind !== "allow") return authorization;
                    const updated = await tx.$executeRaw(Prisma.sql`
                        UPDATE "service_record_revision_document_state"
                        SET status = 'processing', step = 'dispatch_authorized', last_error_code = NULL,
                            version = version + 1, updated_at = now()
                        WHERE id = ${verified.state.id}::uuid
                          AND generation = ${verified.state.generation}
                          AND status IN ('capability_unverified', 'pending')
                    `);
                    if (updated !== 1) throw new ConflictException("SERVICE_RECORD_WRITE_TARGET_CHANGED");
                    return authorization;
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

    private async verifyInitialFinalizationDispatch(
        tx: Prisma.TransactionClient,
        job: DispatchJobSnapshot,
        expected: ServiceRecordRevisionDispatchContext,
        options: { lock: boolean } = { lock: true },
    ) {
        let payload: Record<string, unknown> | null;
        try {
            payload = typeof job.payload === "string"
                ? JSON.parse(job.payload) as Record<string, unknown> | null
                : job.payload as Record<string, unknown> | null;
        } catch {
            return { kind: "stale", reason: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" } as const;
        }
        const identity = { jobType: job.job_type, source: job.source, documentId: job.document_id,
            requestKey: job.request_key, payload };
        if (!isInitialFinalizationJobIdentity(identity)) {
            return { kind: "stale", reason: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" } as const;
        }
        const scopeChanged = { kind: "stale", reason: "SERVICE_RECORD_INITIAL_FINALIZATION_SCOPE_CHANGED" } as const;
        if (!payload || !payload["immutablePayload"] || typeof payload["immutablePayload"] !== "object"
            || Array.isArray(payload["immutablePayload"])
            || payload["payloadFingerprint"] !== job.payload_fingerprint
            || payload["payloadFingerprint"] !== sha256CanonicalJson(payload["immutablePayload"])
            || expected.businessFingerprint !== payload["payloadFingerprint"]
            || job.branch_id !== expected.branchId || job.client_id !== expected.clientId
            || typeof payload["documentStateId"] !== "string" || !UUID_PATTERN.test(payload["documentStateId"])
            || payload["revisionId"] !== expected.revisionId
            || typeof payload["generation"] !== "string"
            || !Number.isInteger(payload["documentVersion"]) || Number(payload["documentVersion"]) < 1
        ) return scopeChanged;
        const states = await tx.$queryRaw<Array<{
            id: string; branchId: string; clientId: number; serviceRecordCaseId: string;
            revisionId: string; operation: string; generation: string; documentVersion: number | null;
            inputFingerprint: string; workflowScope: Prisma.JsonValue; status: string; version: number;
        }>>(Prisma.sql`
            SELECT id, branch_id AS "branchId", client_id AS "clientId",
                service_record_case_id AS "serviceRecordCaseId", revision_id AS "revisionId",
                operation, generation, document_version AS "documentVersion",
                input_fingerprint AS "inputFingerprint", workflow_scope AS "workflowScope", status, version
            FROM "service_record_revision_document_state"
            WHERE id = ${payload["documentStateId"]}::uuid
            ${options.lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}
        `);
        const state = states[0];
        if (!state || state.branchId !== expected.branchId || state.clientId !== expected.clientId
            || state.serviceRecordCaseId !== expected.serviceRecordCaseId
            || state.operation !== "record_snapshot" || state.revisionId !== expected.revisionId
            || state.generation !== payload["generation"] || state.documentVersion !== payload["documentVersion"]
            || state.inputFingerprint !== payload["payloadFingerprint"]
            || !isInitialFinalizationWorkflowScope(state.workflowScope, job.request_key)
        ) return scopeChanged;
        if (!["capability_unverified", "pending"].includes(state.status)) {
            return { kind: "stale", reason: "SERVICE_RECORD_INITIAL_FINALIZATION_STATE_NOT_READY" } as const;
        }
        const cases = await tx.$queryRaw<Array<{
            currentRevisionId: string | null; currentUsableRevisionId: string | null;
            currentUsableDocumentVersion: number | null; status: string; formVersion: number;
            revisionNumber: number; formVersionAtConfirm: number;
        }>>(Prisma.sql`
            SELECT record.current_revision_id AS "currentRevisionId",
                record.current_usable_revision_id AS "currentUsableRevisionId",
                record.current_usable_document_version AS "currentUsableDocumentVersion",
                record.status, record.form_version AS "formVersion",
                revision.revision_number AS "revisionNumber", revision.form_version_at_confirm AS "formVersionAtConfirm"
            FROM "service_record_case" AS record
            JOIN "client" AS client ON client.id = record.client_id AND client.branch_id = record.branch_id
            JOIN "service_record_revision" AS revision ON revision.id = record.current_revision_id
                AND revision.branch_id = record.branch_id AND revision.service_record_case_id = record.id
            WHERE record.id = ${expected.serviceRecordCaseId}::uuid
              AND record.branch_id = ${expected.branchId}::uuid AND record.client_id = ${expected.clientId}
              AND client.deleted_at IS NULL
        `);
        const owner = cases[0];
        if (!owner || owner.currentRevisionId !== expected.revisionId
            || !["READY_TO_FINALIZE", "FINALIZATION_FAILED"].includes(owner.status)
            || (owner.currentUsableRevisionId !== null
                && (owner.currentUsableRevisionId !== expected.revisionId
                    || owner.currentUsableDocumentVersion !== payload["documentVersion"]))
            || owner.revisionNumber !== expected.revisionNumber
            || owner.formVersion !== expected.formVersion || owner.formVersionAtConfirm !== expected.formVersion
        ) return scopeChanged;
        return { kind: "allow", state } as const;
    }

    async diagnoseInitialFinalizationJob(
        input: { jobId: string; branchId: string },
    ): Promise<DiagnoseInitialFinalizationJobResult> {
        if (!UUID_PATTERN.test(input.jobId) || !UUID_PATTERN.test(input.branchId)) return { kind: "not_found" };
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
            const job = await this.readDispatchJob(tx, input.jobId, false);
            const context = job ? payloadContext(job.payload) : null;
            if (!job || !context || job.branch_id !== input.branchId
                || context.branchId !== input.branchId || job.client_id !== context.clientId
                || !isValidServiceRecordDispatchContext(context)) {
                return { kind: "not_found" };
            }
            const jobReason = initialFinalizationJobIneligibility(job);
            const verified = await this.verifyInitialFinalizationDispatch(tx, job, context, { lock: false });
            let payload: unknown = job.payload;
            if (typeof payload === "string") {
                try { payload = JSON.parse(payload) as unknown; } catch { payload = null; }
            }
            const stateId = payload && typeof payload === "object" && !Array.isArray(payload)
                ? (payload as Record<string, unknown>)["documentStateId"] : null;
            const states = typeof stateId === "string" && UUID_PATTERN.test(stateId)
                ? await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
                    SELECT status FROM "service_record_revision_document_state"
                    WHERE id = ${stateId}::uuid AND branch_id = ${input.branchId}::uuid
                      AND client_id = ${context.clientId}
                      AND service_record_case_id = ${context.serviceRecordCaseId}::uuid
                `) : [];
            return {
                kind: "diagnosed", jobId: job.id, verifier: verified.kind === "allow",
                ...(verified.kind !== "allow" ? { reason: verified.reason } : {}),
                jobEligible: jobReason === undefined,
                ...(jobReason === undefined ? {} : { jobReason }),
                stateStatus: states[0]?.status ?? null, progressStep: job.progress_step, payload: job.payload,
            };
        });
    }

    async requeueInitialFinalizationJob(
        input: { jobId: string; branchId: string },
    ): Promise<RequeueInitialFinalizationJobResult> {
        if (!UUID_PATTERN.test(input.jobId) || !UUID_PATTERN.test(input.branchId)) return { kind: "not_found" };
        return this.prisma.$transaction(async (tx) => {
            const initial = await this.readDispatchJob(tx, input.jobId, false);
            const context = initial ? payloadContext(initial.payload) : null;
            if (!initial || !context || initial.branch_id !== input.branchId
                || context.branchId !== input.branchId || initial.client_id !== context.clientId) {
                return { kind: "not_found" };
            }
            await lockServiceRecordWriteSet(tx, {
                branchId: input.branchId, clientId: context.clientId, caseId: context.serviceRecordCaseId,
            });
            const job = await this.readDispatchJob(tx, input.jobId, true);
            if (!job || job.branch_id !== input.branchId || job.client_id !== context.clientId) return { kind: "not_found" };
            const jobReason = initialFinalizationJobIneligibility(job);
            if (jobReason !== undefined) {
                return { kind: "not_requeueable", reason: jobReason };
            }
            const observed = payloadContext(job.payload);
            if (!observed || observed.branchId !== input.branchId || observed.clientId !== job.client_id) return { kind: "not_found" };
            const verified = await this.verifyInitialFinalizationDispatch(tx, job, observed);
            if (verified.kind !== "allow") return { kind: "not_requeueable", reason: verified.reason };
            const stateUpdated = await tx.$executeRaw(Prisma.sql`
                UPDATE "service_record_revision_document_state"
                SET status = 'pending', step = 'requeued', attempts = attempts + 1,
                    last_error_code = NULL, version = version + 1, updated_at = now()
                WHERE id = ${verified.state.id}::uuid AND generation = ${verified.state.generation}
                  AND version = ${verified.state.version} AND status IN ('capability_unverified', 'pending')
            `);
            if (stateUpdated !== 1) throw new ConflictException("SERVICE_RECORD_WRITE_TARGET_CHANGED");
            const jobs = await tx.$queryRaw<RawJob[]>(Prisma.sql`
                UPDATE "eformsign_document_job"
                SET status = 'queued', progress_step = 'queued', progress_detail = NULL, attempts = 0,
                    next_attempt_at = now(), last_error_code = NULL, completed_at = NULL, heartbeat_at = NULL,
                    lease_token = NULL, updated_at = now()
                WHERE id = ${input.jobId}::uuid AND branch_id = ${input.branchId}::uuid
                  AND status IN ('requires_attention', 'failed')
                  AND COALESCE(progress_step, '') IN ('', 'queued', 'validating', 'preparing')
                RETURNING *
            `);
            const requeued = jobs[0];
            if (jobs.length !== 1 || !requeued) throw new ConflictException("SERVICE_RECORD_WRITE_TARGET_CHANGED");
            return { kind: "requeued", job: this.toDomain(requeued) };
        });
    }

    private async readDispatchJob(
        tx: Prisma.TransactionClient,
        jobId: string,
        forUpdate: boolean,
    ): Promise<DispatchJobSnapshot | null> {
        const rows = await tx.$queryRaw<DispatchJobSnapshot[]>(Prisma.sql`
            SELECT
                "id", "branch_id", "client_id", "document_id", "job_type", "status",
                "lease_token", "progress_step", "payload", "payload_fingerprint", "source", "request_key"
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

        return this.authorizeForDispatchCore(tx, input);
    }

    private async authorizeForDispatchCore(
        tx: Prisma.TransactionClient,
        input: AuthorizeEformsignDocumentJobForDispatchInput,
    ) {
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
        // Only real or possible send evidence blocks authorization. A row that
        // still carries `dispatch_authorized` from an earlier attempt re-claimed
        // under a new lease authorizes again: the lease check above already
        // guarantees a single live owner.
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
            SET progress_step = ${DISPATCH_AUTHORIZED_PROGRESS_STEP}, heartbeat_at = now(), updated_at = now()
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
                SET status = 'processing', attempts = attempts + 1, progress_detail = NULL,
                    started_at = COALESCE(started_at, now()), heartbeat_at = now(),
                    lease_token = gen_random_uuid(), updated_at = now()
                FROM picked WHERE job.id = picked.id
                RETURNING job.*
            `);
            return rows.map((row) => this.toDomain(row));
        });
    }

    async updateProgress(id: string, leaseToken: string, progressStep: string, heartbeatAt = new Date(), progressDetail?: string) {
        // The persisted marker only moves forward: dispatch_authorized ->
        // creating -> sent. A late write (a delayed heartbeat) computed before
        // a later step committed must not regress it, so the ordering is
        // decided here, atomically, against the stored value. The heartbeat
        // and lease predicates are unchanged: the heartbeat still advances
        // when the step is kept.
        const nextStep = Prisma.sql`CASE
                    WHEN progress_step = 'sent' THEN progress_step
                    WHEN progress_step = 'creating' AND ${progressStep}::text <> 'sent' THEN progress_step
                    WHEN progress_step = ${DISPATCH_AUTHORIZED_PROGRESS_STEP}
                        AND ${progressStep}::text NOT IN ('creating', 'sent') THEN progress_step
                    ELSE ${progressStep}::text
                END`;
        // Display progress is independent of the duplicate-send fence and only advances.
        const detailOrder = Prisma.sql`ARRAY['client-started', 'info-inserted', 'creating', 'sent']::text[]`;
        const nextDetail = Prisma.sql`CASE
                    WHEN array_position(${detailOrder}, ${progressDetail ?? null}::text)
                        > COALESCE(array_position(${detailOrder}, progress_detail), 0)
                    THEN ${progressDetail ?? null}::text
                    ELSE progress_detail
                END`;
        // Two statements, because the realtime hint is decided when a statement runs and the
        // step is rendered (the contracts job popover shows it). Statement 1 only matches when
        // the step really moves, so it keeps emitting. Statement 2 is reached when the step is
        // unchanged (or the lease is gone): it moves only heartbeat_at/updated_at, which no screen
        // renders, and runs with hints suppressed. Comparing in SQL against the stored value is
        // race-free; passing the worker's last-known step would not be, since the stored step can
        // be advanced by another path between the worker's read and this write.
        const stepMoved = await this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET progress_step = ${nextStep},
                progress_detail = ${nextDetail}, heartbeat_at = ${heartbeatAt}, updated_at = now()
            WHERE id = ${id}::uuid AND lease_token = ${leaseToken}::uuid
              AND status IN ('processing', 'reconciling')
              AND (progress_step IS DISTINCT FROM (${nextStep})
                   OR progress_detail IS DISTINCT FROM (${nextDetail})) RETURNING *
        `);
        if (stepMoved) return stepMoved;
        return withoutEntityChangeHints(() => this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET heartbeat_at = ${heartbeatAt}, updated_at = now()
            WHERE id = ${id}::uuid AND lease_token = ${leaseToken}::uuid
              AND status IN ('processing', 'reconciling') RETURNING *
        `));
    }

    async scheduleRetry(id: string, leaseToken: string, nextAttemptAt: Date, errorCode: string) {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = 'queued', next_attempt_at = ${nextAttemptAt},
                last_error_code = ${toJobErrorCode(errorCode)}, heartbeat_at = NULL, lease_token = NULL, updated_at = now()
            WHERE id = ${id}::uuid AND lease_token = ${leaseToken}::uuid
              AND status = 'processing' RETURNING *
        `);
    }

    async markReconciling(id: string, leaseToken: string, progressStep = "reconciling") {
        return this.updateOne(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = 'reconciling', progress_step = ${progressStep},
                payload = CASE
                    WHEN contract_generation IS NOT NULL THEN payload
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
                    WHEN contract_generation IS NOT NULL THEN payload
                    WHEN jsonb_typeof(payload) = 'object'
                        AND payload->>'kind' = 'service_record_revision' THEN payload
                    ELSE NULL
                END,
                active_key = NULL, heartbeat_at = NULL, lease_token = NULL,
                last_error_code = NULL, updated_at = now()
            WHERE id = ${id}::uuid AND lease_token = ${leaseToken}::uuid
              AND status IN ('processing', 'reconciling') AND contract_generation IS NULL RETURNING *
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
                    WHEN contract_generation IS NOT NULL THEN payload
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
        const unresolved = Prisma.sql`(progress_step IS DISTINCT FROM ${CANCELLED_PROGRESS_STEP} AND (
            (status = 'failed' AND progress_step IS DISTINCT FROM ${SUPERSEDED_PROGRESS_STEP} AND (completed_at >= now() - interval '7 days'
                OR EXISTS (SELECT 1 FROM eformsign_contract_authority a WHERE a.creation_job_id = eformsign_document_job.id
                    AND a.branch_id = eformsign_document_job.branch_id AND a.client_id = eformsign_document_job.client_id AND a.phase <> 'closed')))
            OR status = 'requires_attention'
        ))`;
        const [rows, unresolvedRows] = await Promise.all([
            this.prisma.$queryRaw<Array<{
                active_count: number;
                attention_count: number;
                failed_count: number;
                unresolved_count: number;
            }>>(Prisma.sql`
                SELECT count(*) FILTER (WHERE status IN ${ACTIVE_STATUSES})::int AS active_count,
                       count(*) FILTER (WHERE status = 'requires_attention')::int AS attention_count,
                       count(*) FILTER (
                           WHERE ${contractJobSql()} AND status = 'failed'
                             AND progress_step IS DISTINCT FROM ${CANCELLED_PROGRESS_STEP}
                             AND completed_at >= now() - interval '7 days'
                       )::int AS failed_count,
                       count(*) FILTER (WHERE ${contractJobSql()} AND ${unresolved})::int AS unresolved_count
                FROM "eformsign_document_job" WHERE branch_id = ${branchId}::uuid
            `),
            this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT id FROM "eformsign_document_job"
                WHERE branch_id = ${branchId}::uuid AND ${contractJobSql()} AND ${unresolved}
                ORDER BY completed_at DESC NULLS LAST, created_at DESC
                LIMIT 50
            `),
        ]);
        return {
            activeCount: Number(rows[0]?.active_count ?? 0),
            requiresAttentionCount: Number(rows[0]?.attention_count ?? 0),
            failedCount: Number(rows[0]?.failed_count ?? 0),
            unresolvedCount: Number(rows[0]?.unresolved_count ?? 0),
            unresolvedJobIds: unresolvedRows.map((row) => row.id),
        };
    }

    async listForBranch(branchId: string, terminalSince: Date, terminalLimit = 50): Promise<EformsignDocumentJobList> {
        const limit = Math.max(1, Math.min(terminalLimit, 50));
        const contract = contractJobSql("j");
        const [active, requiresAttention, recent] = await Promise.all([
            this.prisma.$queryRaw<RawJob[]>(Prisma.sql`
                SELECT j.*, false AS cancellable, c.name AS client_name FROM "eformsign_document_job" j
                LEFT JOIN "client" c ON c.id = j.client_id
                WHERE j.branch_id = ${branchId}::uuid AND j.status IN ${ACTIVE_STATUSES}
                ORDER BY j.created_at ASC
            `),
            // Current unresolved authority holds remain reachable after the failed-history cutoff.
            // Their contact payload still expires after seven days.
            this.prisma.$queryRaw<RawJob[]>(Prisma.sql`
                SELECT j.*, ${cancellableJobSql()} AS cancellable, c.name AS client_name FROM "eformsign_document_job" j
                LEFT JOIN "client" c ON c.id = j.client_id
                WHERE j.branch_id = ${branchId}::uuid
                  AND j.progress_step IS DISTINCT FROM ${CANCELLED_PROGRESS_STEP}
                  AND (
                      j.status = 'requires_attention'
                      OR (j.status = 'failed' AND ${contract} AND j.progress_step IS DISTINCT FROM ${SUPERSEDED_PROGRESS_STEP} AND (j.completed_at >= now() - interval '7 days'
                          OR EXISTS (SELECT 1 FROM eformsign_contract_authority a WHERE a.creation_job_id = j.id AND a.branch_id = j.branch_id
                              AND a.client_id = j.client_id AND a.phase <> 'closed')))
                  )
                ORDER BY j.completed_at DESC NULLS LAST, j.created_at DESC
                LIMIT 50
            `),
            this.prisma.$queryRaw<RawJob[]>(Prisma.sql`
                SELECT j.*, false AS cancellable, c.name AS client_name FROM "eformsign_document_job" j
                LEFT JOIN "client" c ON c.id = j.client_id
                WHERE j.branch_id = ${branchId}::uuid AND j.status IN ${TERMINAL_STATUSES}
                  AND j.progress_step IS DISTINCT FROM ${CANCELLED_PROGRESS_STEP}
                  AND j.completed_at >= ${terminalSince}
                  AND (NOT (j.status = 'failed' AND ${contract}) OR j.progress_step = ${SUPERSEDED_PROGRESS_STEP})
                ORDER BY j.completed_at DESC LIMIT ${limit}
            `),
        ]);
        return { active: active.map(this.toDomain), requiresAttention: requiresAttention.map(this.toDomain), recent: recent.map(this.toDomain) };
    }

    async deleteExpiredTerminal(cutoff: Date) {
        const count = await this.prisma.$executeRaw(Prisma.sql`
            DELETE FROM "eformsign_document_job"
            WHERE status IN ${TERMINAL_STATUSES}
              AND completed_at < ${cutoff}
              AND NOT EXISTS (
                  SELECT 1 FROM "eformsign_contract_authority" AS authority
                  WHERE authority.creation_job_id = "eformsign_document_job".id
              )
              AND NOT (
                  COALESCE(jsonb_typeof(payload) = 'object', false)
                  AND COALESCE(payload->>'kind' = 'service_record_revision', false)
              )
        `);
        return Number(count);
    }

    async claimRecovery(input: ManualRecoveryInput): Promise<ClaimRecoveryResult> {
        if (!UUID_PATTERN.test(input.jobId) || !UUID_PATTERN.test(input.branchId)) return { kind: "not_found" };
        const nowMs = this.assertClaimInput(input);
        const rows = await this.prisma.$queryRaw<RawJob[]>(Prisma.sql`
            WITH claimed AS (
                UPDATE "eformsign_document_job" AS j
                SET progress_step = ${buildManualClaimStep(input.userId, nowMs)}, updated_at = now()
                WHERE j.id = ${input.jobId}::uuid AND j.branch_id = ${input.branchId}::uuid
                  AND j.contract_generation IS NULL AND ${contractJobSql("j")}
                  AND j.status IN ${RECOVERABLE_STATUSES}
                  AND ${manualClaimAvailableSql(input.userId, nowMs)}
                RETURNING j.*
            )
            SELECT claimed.*, c.name AS client_name
            FROM claimed LEFT JOIN "client" c ON c.id = claimed.client_id
        `);
        if (rows[0]) return { kind: "claimed", job: this.toDomain(rows[0]) };
        const miss = await this.explainRecoveryMiss(input);
        // A job that is already resolved is not claimable; the claim never reports it as success.
        return miss.kind === "resolved"
            ? { kind: "invalid_state", status: miss.row.status as EformsignDocumentJobStatus }
            : miss;
    }

    async resolveManually(input: ManualRecoveryInput): Promise<ResolveManuallyResult> {
        if (!UUID_PATTERN.test(input.jobId) || !UUID_PATTERN.test(input.branchId)) return { kind: "not_found" };
        const nowMs = this.assertClaimInput(input);
        const rows = await this.prisma.$queryRaw<RawJob[]>(Prisma.sql`
            WITH resolved AS (
                UPDATE "eformsign_document_job" AS j
                SET status = 'completed', progress_step = ${MANUAL_RESOLVED_PROGRESS_STEP},
                    completed_at = ${input.now}, active_key = NULL, payload = NULL,
                    heartbeat_at = NULL, lease_token = NULL, updated_at = now()
                WHERE j.id = ${input.jobId}::uuid AND j.branch_id = ${input.branchId}::uuid
                  AND j.contract_generation IS NULL AND ${contractJobSql("j")}
                  AND j.status IN ${RECOVERABLE_STATUSES}
                  AND ${manualClaimAvailableSql(input.userId, nowMs)}
                RETURNING j.*
            )
            SELECT resolved.*, c.name AS client_name
            FROM resolved LEFT JOIN "client" c ON c.id = resolved.client_id
        `);
        if (rows[0]) return { kind: "resolved", job: this.toDomain(rows[0]) };
        const miss = await this.explainRecoveryMiss(input);
        return miss.kind === "resolved" ? { kind: "already_resolved", job: this.toDomain(miss.row) } : miss;
    }

    async purgeExpiredAttentionPayloads(now: Date): Promise<number> {
        // The active key stays: a requires_attention job may already have sent the
        // document, so releasing it here could let a duplicate through.
        const count = await this.prisma.$executeRaw(Prisma.sql`
            UPDATE "eformsign_document_job"
            SET payload = NULL, updated_at = now()
            WHERE ${contractJobSql()}
              AND (status = 'requires_attention' OR (status = 'failed' AND contract_generation IS NOT NULL))
              AND payload IS NOT NULL
              AND completed_at < ${new Date(now.getTime() - RECOVERY_RETENTION_MS)}
        `);
        return Number(count);
    }

    async listRecentStaffFailures(since: Date): Promise<EformsignDocumentJobEntity[]> {
        const rows = await this.prisma.$queryRaw<RawJob[]>(Prisma.sql`
            SELECT j.*, ${cancellableJobSql()} AS cancellable, c.name AS client_name FROM "eformsign_document_job" j
            LEFT JOIN "client" c ON c.id = j.client_id
            WHERE ${contractJobSql("j")}
              AND j.status IN ${RECOVERABLE_STATUSES}
              AND j.completed_at >= ${since}
            ORDER BY j.completed_at ASC
        `);
        return rows.map((row) => this.toDomain(row));
    }

    private assertClaimInput(input: ManualRecoveryInput): number {
        if (!MANUAL_CLAIM_USER_PATTERN.test(input.userId)) throw new Error("INVALID_MANUAL_CLAIM_USER");
        return input.now.getTime();
    }

    /** Runs only when the guarded UPDATE touched no row: say which guard stopped it. */
    private async explainRecoveryMiss(input: ManualRecoveryInput): Promise<RecoveryMiss> {
        const rows = await this.prisma.$queryRaw<RawJob[]>(Prisma.sql`
            SELECT j.*, c.name AS client_name FROM "eformsign_document_job" j
            LEFT JOIN "client" c ON c.id = j.client_id
            WHERE j.id = ${input.jobId}::uuid AND j.branch_id = ${input.branchId}::uuid
              AND ${contractJobSql("j")}
            LIMIT 1
        `);
        const row = rows[0];
        if (!row) return { kind: "not_found" };
        if (row.status === "completed" && row.progress_step === MANUAL_RESOLVED_PROGRESS_STEP) {
            return { kind: "resolved", row };
        }
        if (row.status !== "failed" && row.status !== "requires_attention") {
            return { kind: "invalid_state", status: row.status as EformsignDocumentJobStatus };
        }
        const claim = parseManualClaim(row.progress_step);
        // A well-formed live claim by someone else is the only guard left that can have blocked the UPDATE.
        return claim
            ? { kind: "claimed_by_other", expiresAt: new Date(claim.expiresAtMs) }
            : { kind: "invalid_state", status: row.status as EformsignDocumentJobStatus };
    }

    private async terminal(
        id: string,
        leaseToken: string,
        status: "failed" | "requires_attention",
        errorCode: string,
        releaseActiveKey: boolean,
    ) {
        const code = toJobErrorCode(errorCode);
        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<RawJob[]>(Prisma.sql`
                UPDATE "eformsign_document_job" SET status = ${status}, last_error_code = ${code},
                    completed_at = now(),
                    payload = CASE
                        WHEN jsonb_typeof(payload) = 'object'
                            AND payload->>'kind' = 'service_record_revision' THEN payload
                        WHEN ${contractJobSql()} THEN payload
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
                        autoFinalizeLastError: code,
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
                const maxAttempts = await this.getContractAutoFinalizeMaxAttempts(tx, row.branch_id);
                await tx.$executeRaw(Prisma.sql`
                    UPDATE "eformsign_document_job"
                    SET active_key = ${recordedAttempts < maxAttempts ? null : row.active_key}
                    WHERE id = ${id}::uuid
                `);
                if (recordedAttempts < maxAttempts) row.active_key = null;
            }
            return new EformsignDocumentJobEntity({
                ...this.toDomain(row),
                autoFinalizeOutcomeAttempts: recordedAttempts,
            });
        });
    }

    private async getContractAutoFinalizeMaxAttempts(
        tx: Prisma.TransactionClient,
        branchId: string,
    ): Promise<number> {
        const setting = await tx.system_setting.findUnique({
            where: { key: `branch:${branchId}:contract_automation:auto_finalize` },
            select: { value: true },
        });
        if (!setting?.value) return DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.maxAttempts;

        try {
            return normalizeContractAutoFinalizeConfig(JSON.parse(setting.value)).maxAttempts;
        } catch {
            return DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.maxAttempts;
        }
    }

    private async updateOne(query: Prisma.Sql) {
        const rows = await this.prisma.$queryRaw<RawJob[]>(query);
        return rows[0] ? this.toDomain(rows[0]) : null;
    }

    private toDomain = (row: RawJob): EformsignDocumentJobEntity => new EformsignDocumentJobEntity({
        cancellable: row.cancellable === true,
        contractGeneration: row.contract_generation ?? null,
        id: row.id, branchId: row.branch_id, clientId: row.client_id, documentId: row.document_id,
        jobType: row.job_type as EformsignDocumentJobType, source: row.source as EformsignDocumentJobSource,
        status: row.status as EformsignDocumentJobStatus, requestKey: row.request_key, activeKey: row.active_key,
        payload: this.parsePayload(row.payload), payloadFingerprint: row.payload_fingerprint,
        progressStep: row.progress_step, progressDetail: row.progress_detail ?? null, attempts: row.attempts, nextAttemptAt: new Date(row.next_attempt_at),
        heartbeatAt: row.heartbeat_at ? new Date(row.heartbeat_at) : null,
        leaseToken: row.lease_token,
        autoFinalizeOutcomeRecordedAt: row.auto_finalize_outcome_recorded_at
            ? new Date(row.auto_finalize_outcome_recorded_at)
            : null,
        autoFinalizeOutcomeAttempts: null,
        startedAt: row.started_at ? new Date(row.started_at) : null,
        completedAt: row.completed_at ? new Date(row.completed_at) : null, lastErrorCode: row.last_error_code,
        createdByUserId: row.created_by_user_id, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
        clientName: row.client_name ?? null,
    });

    private parsePayload(value: RawJob["payload"]): EformsignDocumentJobPayload | null {
        if (value === null) return null;
        return (typeof value === "string" ? JSON.parse(value) : value) as EformsignDocumentJobPayload;
    }
}
