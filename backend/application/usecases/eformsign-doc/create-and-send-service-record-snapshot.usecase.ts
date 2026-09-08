import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import {
    SERVICE_RECORD_EDIT_REPOSITORY,
    type IServiceRecordEditRepository,
} from "domain/repositories/service-record-edit.repository.interface";
import { encodeEformsignStepRecipientTypes } from "domain/value-objects/eformsign-step-recipient-types";
import {
    isPendingEformsignDocColumnError,
    omitPendingEformsignDocColumns,
} from "infrastructure/database/eformsign-doc-compat";
import { PrismaService } from "infrastructure/database/prisma.service";
import { eformsignExpiryDateFromRemainingDays } from "domain/utils/eformsign-expiry-date";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";
import {
    EformsignCredentialBoundary,
    EformsignProviderPrincipal,
} from "application/services/eformsign-credential-boundary.service";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import type { ServiceRecordRevisionGenerationInput } from "domain/entities/eformsign-document-job.entity";
import {
    buildServiceRecordDocumentFields,
    chunkSessionsByTier,
    type ServiceRecordDayInput,
} from "./service-record-field-mapper";
import {
    SERVICE_RECORD_TEMPLATE_SESSIONS_PER_DOCUMENT,
    SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS,
} from "./service-record-field-ids";

const SNAPSHOT_FALLBACK_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

const CASE_SNAPSHOT_INCLUDE = {
    branch: { select: { name: true } },
    client: { select: { name: true } },
    assignments: {
        select: {
            id: true,
            scheduleId: true,
            employeeId: true,
            employeeNameSnapshot: true,
            startDate: true,
            endDate: true,
        },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
    },
    days: {
        select: {
            scheduleId: true,
            caseSessionIndex: true,
            employeeId: true,
            employeeNameSnapshot: true,
            serviceDate: true,
            answers: true,
            etcService: true,
            notes: true,
            paymentConfirmed: true,
            momApproval: true,
            clientSignature: true,
            locked: true,
        },
        orderBy: [{ caseSessionIndex: "asc" }, { serviceDate: "asc" }],
    },
} satisfies Prisma.service_record_caseInclude;

type ServiceRecordCaseForSnapshot = Prisma.service_record_caseGetPayload<{
    include: typeof CASE_SNAPSHOT_INCLUDE;
}>;

interface PreparedSnapshotChunk {
    assignmentId: string | null;
    scheduleId: number | null;
    employeeName: string;
    chunkIndex: number;
    chunkCount: number;
    firstSessionIndex: number;
    lastSessionIndex: number;
    sourceHash: string;
    compatibleSourceHashes: string[];
    documentName: string;
    days: ServiceRecordDayInput[];
    tier: number;
    templateId: string;
}

interface PersistedSnapshotChunkLayout {
    assignmentId: string | null;
    chunkIndex: number;
    chunkCount: number;
    firstSessionIndex: number;
    lastSessionIndex: number;
    employeeNameSnapshot: string;
}

type RevisionSnapshotChunkRow = Prisma.service_record_snapshot_chunkGetPayload<Prisma.service_record_snapshot_chunkDefaultArgs>;
type RevisionSnapshotStateRow = Pick<
    Prisma.service_record_revision_document_stateGetPayload<Prisma.service_record_revision_document_stateDefaultArgs>,
    "id"
    | "branchId"
    | "clientId"
    | "serviceRecordCaseId"
    | "revisionId"
    | "operation"
    | "generation"
    | "immutableInput"
    | "inputFingerprint"
    | "documentVersion"
    | "status"
    | "step"
    | "version"
>;

interface FrozenRevisionSource {
    record: ServiceRecordCaseForSnapshot;
    payloadFingerprint: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function finiteInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value)
        ? value
        : null;
}

function parseDateOnly(value: unknown): Date | null {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month! - 1
        && date.getUTCDate() === day
        ? date
        : null;
}

const CHUNK_CLAIM_STALE_MS = 10 * 60 * 1000;
const CHUNK_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_DEFINITIVE_CREATE_ATTEMPTS = 5;
const MAX_RECONCILIATION_ATTEMPTS = 12;

/**
 * Finalize a completed 제공기록지 into one or more fully-prefilled eformsign documents and route
 * them to the template's 제공업체 확인 (reviewer) step (BJJ-249). The 제공인력 fills everything in
 * the app — nobody fills anything in eformsign — so the document goes straight to the org's
 * pre-specified reviewer for confirmation.
 *
 * Templates come in fixed session-grid tiers (5/10/15/20 — BJJ-multi-tier): each provider
 * segment is packed into the smallest configured tier that holds it in one document, and
 * segments longer than the max tier are cut at max-tier size with the remainder re-tiered.
 * Each document's fields are prefilled from `service_record` + `service_record_day`
 * by the pure mapper. Persisted with linkToClient:false — the client's eDocId is NEVER touched —
 * and the webhook template_id gate (all EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID* tiers) keeps completion
 * from marking the contract done.
 *
 * Retry-safe: durable `service_record_snapshot_chunk` rows let a re-run skip documents already created.
 */
@Injectable()
export class CreateAndSendServiceRecordSnapshotUsecase {
    private readonly logger = new Logger(CreateAndSendServiceRecordSnapshotUsecase.name);

    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
        private readonly prisma: PrismaService,
        private readonly credentialBoundary: EformsignCredentialBoundary,
        private readonly configService: ConfigService,
        @Inject(SERVICE_RECORD_EDIT_REPOSITORY)
        private readonly editRepository?: IServiceRecordEditRepository,
    ) {}

    /**
     * Reads the configured 제공기록지 template tiers from env (BJJ-multi-tier). Only tiers whose
     * env var is actually set are usable — an environment with just the base 5회 id configured
     * behaves exactly as before (every chunk is 5 sessions). Throws the same message as before
     * when even the base tier is missing, preserving the existing "not configured" contract.
     */
    private getConfiguredTiers(): Array<{ tier: number; templateId: string }> {
        const tiers = SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS
            .map(({ tier, envKey }) => ({ tier, templateId: this.configService.get<string>(envKey)?.trim() ?? "" }))
            .filter((entry) => entry.templateId !== "");
        const hasBase = tiers.some((entry) => entry.tier === SERVICE_RECORD_TEMPLATE_SESSIONS_PER_DOCUMENT);
        if (!hasBase) {
            throw new BadRequestException("EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID is not configured.");
        }
        return tiers;
    }

    /**
     * Client-owned finalization path. Chunk rows are durable claims, so multiple app instances
     * cannot create the same remote document concurrently. Ambiguous remote calls are reconciled
     * by deterministic title and are never blindly retried.
     */
    async executeCase(
        branchid: string,
        serviceRecordCaseId: string,
        principal: EformsignProviderPrincipal,
    ): Promise<{ documentIds: string[]; documentId: string; chunkCount: number }> {
        const tiers = this.getConfiguredTiers();
        const tierNumbers = tiers.map((t) => t.tier);
        const templateIdByTier = new Map(tiers.map((t) => [t.tier, t.templateId]));

        const record = await this.prisma.service_record_case.findUnique({
            where: { id: serviceRecordCaseId },
            include: CASE_SNAPSHOT_INCLUDE,
        });
        if (!record || record.branchId !== branchid) {
            throw new NotFoundException("Service record not found");
        }
        // Revised records are frozen into a durable, capability-gated
        // generation job by the finalization service. This legacy usecase
        // reads mutable live rows and owns provider credentials, so it must
        // never become an alternate revised-document path while Phase0 is
        // still unverified.
        if (record.currentRevisionId != null) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" });
        }
        this.assertReadyForSnapshot(record);

        const persistedChunkLayout = await this.prisma.service_record_snapshot_chunk.findMany({
            where: {
                serviceRecordCaseId: record.id,
                snapshotVersion: record.formVersion,
            },
            select: {
                assignmentId: true,
                chunkIndex: true,
                chunkCount: true,
                firstSessionIndex: true,
                lastSessionIndex: true,
                employeeNameSnapshot: true,
            },
            orderBy: { chunkIndex: "asc" },
        });
        const chunks = this.buildCaseChunks(
            record,
            tierNumbers,
            templateIdByTier,
            persistedChunkLayout,
        );
        const chunkRows = await this.prepareChunkRows(record, chunks);
        const existingDocs = await this.prisma.eformsign_doc.findMany({
            where: {
                serviceRecordCaseId: record.id,
                snapshotVersion: record.formVersion,
                documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
            },
            // Keep this projection pinned to fields consumed below so future schema columns
            // cannot break snapshot creation during an application-before-database deploy window.
            select: {
                documentId: true,
                snapshotChunkIndex: true,
            },
            orderBy: { snapshotChunkIndex: "asc" },
        });
        const existingByChunk = new Map(
            existingDocs.map((document) => [document.snapshotChunkIndex, document]),
        );

        const documentIdsByChunk = new Map<number, string>();
        for (const chunk of chunks) {
            const existingDoc = existingByChunk.get(chunk.chunkIndex);
            const row = chunkRows.find((candidate) => candidate.chunkIndex === chunk.chunkIndex);
            if (!row) throw new Error(`Snapshot chunk ${chunk.chunkIndex} was not prepared`);

            if (existingDoc) {
                await this.markChunkCreated(row.id, existingDoc.documentId);
                documentIdsByChunk.set(chunk.chunkIndex, existingDoc.documentId);
            }
        }

        const missingChunks = chunks.filter((chunk) => !existingByChunk.has(chunk.chunkIndex));
        if (missingChunks.length > 0) {
            // The reviewer recipient must mirror each used template's pre-specified
            // 제공업체 확인 step exactly. Both reviewer lookup and document creation
            // happen inside the credential custody callback so no token escapes.
            const createdDocumentIds = await this.credentialBoundary.withCredentials(
                principal,
                "contract.dispatch",
                async ({ accessToken }) => {
                    const reviewerByTemplateId = new Map<
                        string,
                        NonNullable<Awaited<ReturnType<IEformsignClientRepository["getTemplateReviewer"]>>>
                    >();
                    const neededTemplateIds = new Set(missingChunks.map((chunk) => chunk.templateId));
                    for (const templateId of neededTemplateIds) {
                        const reviewer = await this.eformsignClient.getTemplateReviewer(accessToken, templateId);
                        if (!reviewer) {
                            throw new BadRequestException("제공기록지 템플릿에 검토자(제공업체 확인) 지정이 없습니다.");
                        }
                        reviewerByTemplateId.set(templateId, reviewer);
                    }

                    const ids: string[] = [];
                    for (const chunk of missingChunks) {
                        const row = chunkRows.find((candidate) => candidate.chunkIndex === chunk.chunkIndex);
                        if (!row) throw new Error(`Snapshot chunk ${chunk.chunkIndex} was not prepared`);
                        const reviewer = reviewerByTemplateId.get(chunk.templateId);
                        if (!reviewer) {
                            throw new Error("Eformsign reviewer was not initialized");
                        }
                        ids.push(await this.processChunk({
                            record,
                            chunk,
                            chunkId: row.id,
                            chunkStatus: row.status,
                            chunkAttempts: row.attempts,
                            chunkClaimedAt: row.claimedAt,
                            chunkCreateAttemptedAt: row.createAttemptedAt,
                            templateId: chunk.templateId,
                            accessToken,
                            reviewer,
                        }));
                    }
                    return ids;
                },
            );
            missingChunks.forEach((chunk, index) => {
                const documentId = createdDocumentIds[index];
                if (documentId) documentIdsByChunk.set(chunk.chunkIndex, documentId);
            });
        }

        const documentIds = chunks
            .map((chunk) => documentIdsByChunk.get(chunk.chunkIndex))
            .filter((documentId): documentId is string => Boolean(documentId));

        return {
            documentIds,
            documentId: documentIds[0] ?? "",
            chunkCount: chunks.length,
        };
    }

    /**
     * Render a durable revision generation from its frozen payload. This path intentionally does
     * not call `service_record_case.findUnique`: a retry must render the exact bytes captured by
     * the confirm transaction even when the live case/day rows have changed meanwhile.
     */
    async executeRevision(
        input: ServiceRecordRevisionGenerationInput,
        principal: EformsignProviderPrincipal,
    ): Promise<{ documentIds: string[]; documentVersion: number; chunkCount: number }> {
        this.assertRevisionGenerationInput(input, principal);
        const revisionId = input.revisionId!;
        const revisionNumber = input.revisionNumber!;
        const state = await this.prisma.service_record_revision_document_state.findUnique({
            where: { id: input.documentStateId },
            select: {
                id: true,
                branchId: true,
                clientId: true,
                serviceRecordCaseId: true,
                revisionId: true,
                operation: true,
                generation: true,
                immutableInput: true,
                inputFingerprint: true,
                documentVersion: true,
                status: true,
                step: true,
                version: true,
            },
        });
        if (!state) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_STATE_UNAVAILABLE" });
        }
        this.assertRevisionState(input, state);

        // The core confirm boundary allocates and persists the case-local
        // snapshot version before dispatch. The renderer consumes that frozen
        // value verbatim; it never recomputes or allocates a replacement.
        const documentVersion = this.resolveRevisionDocumentVersion(input);
        const frozen = this.buildFrozenRevisionSource(input);
        const tiers = this.getConfiguredTiers();
        const tierNumbers = tiers.map((entry) => entry.tier);
        const templateIdByTier = new Map(tiers.map((entry) => [entry.tier, entry.templateId]));
        const existingRows = await this.prisma.service_record_snapshot_chunk.findMany({
            where: {
                branchId: input.branchId,
                serviceRecordCaseId: input.serviceRecordCaseId,
                revisionId,
                snapshotVersion: documentVersion,
            },
            orderBy: { chunkIndex: "asc" },
        });
        const persistedLayout = existingRows.length > 0
            ? existingRows.map((row) => ({
                assignmentId: row.assignmentId ?? null,
                chunkIndex: row.chunkIndex,
                chunkCount: row.chunkCount,
                firstSessionIndex: row.firstSessionIndex,
                lastSessionIndex: row.lastSessionIndex,
                employeeNameSnapshot: row.employeeNameSnapshot,
            }))
            : [];
        const chunks = this.buildRevisionChunks(
            frozen.record,
            tierNumbers,
            templateIdByTier,
            persistedLayout,
            input,
            documentVersion,
        );
        const chunkRows = await this.prepareRevisionChunkRows(input, documentVersion, chunks, existingRows);
        const existingDocs = await this.prisma.eformsign_doc.findMany({
            where: {
                branchId: input.branchId,
                clientId: input.clientId,
                serviceRecordCaseId: input.serviceRecordCaseId,
                revisionId,
                snapshotVersion: documentVersion,
                documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
            },
            select: { documentId: true, snapshotChunkIndex: true },
            orderBy: { snapshotChunkIndex: "asc" },
        });
        const existingByChunk = new Map(
            existingDocs
                .filter((document) => document.snapshotChunkIndex !== null)
                .map((document) => [document.snapshotChunkIndex!, document]),
        );
        const documentIdsByChunk = new Map<number, string>();
        const missingChunks: PreparedSnapshotChunk[] = [];
        for (const chunk of chunks) {
            const row = chunkRows.find((candidate) => candidate.chunkIndex === chunk.chunkIndex);
            if (!row) throw new Error(`Revision snapshot chunk ${chunk.chunkIndex} was not prepared`);
            const persistedDocumentId = row.status === "CREATED" ? row.eformsignDocumentId : null;
            const existingDocument = existingByChunk.get(chunk.chunkIndex);
            if (persistedDocumentId && existingDocument?.documentId === persistedDocumentId) {
                documentIdsByChunk.set(chunk.chunkIndex, persistedDocumentId);
                continue;
            }
            if (persistedDocumentId && existingDocument && existingDocument.documentId !== persistedDocumentId) {
                throw new ConflictException({ code: "SERVICE_RECORD_REVISION_CHUNK_SCOPE_CHANGED" });
            }
            if (existingDocument) {
                await this.markRevisionChunkCreated(input, documentVersion, row.id, existingDocument.documentId);
                documentIdsByChunk.set(chunk.chunkIndex, existingDocument.documentId);
                continue;
            }
            if (row.status === "CREATED") {
                // A CREATED row without a durable remote id is an unknown outcome. Querying the
                // provider is the only safe recovery; do not blindly create a replacement.
                missingChunks.push(chunk);
                continue;
            }
            missingChunks.push(chunk);
        }

        if (missingChunks.length > 0) {
            const createdDocumentIds = await this.credentialBoundary.withCredentials(
                principal,
                "contract.dispatch",
                async ({ accessToken }) => {
                    const reviewerByTemplateId = new Map<
                        string,
                        NonNullable<Awaited<ReturnType<IEformsignClientRepository["getTemplateReviewer"]>>>
                    >();
                    const neededTemplateIds = new Set(missingChunks.map((chunk) => chunk.templateId));
                    for (const templateId of neededTemplateIds) {
                        const reviewer = await this.eformsignClient.getTemplateReviewer(accessToken, templateId);
                        if (!reviewer) {
                            throw new BadRequestException("제공기록지 템플릿에 검토자(제공업체 확인) 지정이 없습니다.");
                        }
                        reviewerByTemplateId.set(templateId, reviewer);
                    }

                    const ids: string[] = [];
                    for (const chunk of missingChunks) {
                        const row = chunkRows.find((candidate) => candidate.chunkIndex === chunk.chunkIndex);
                        if (!row) throw new Error(`Revision snapshot chunk ${chunk.chunkIndex} was not prepared`);
                        const reviewer = reviewerByTemplateId.get(chunk.templateId);
                        if (!reviewer) throw new Error("Eformsign reviewer was not initialized");
                        ids.push(await this.processChunk({
                            record: frozen.record,
                            chunk,
                            chunkId: row.id,
                            // A CREATED row without its durable remote id is
                            // an ambiguous provider outcome. Force the
                            // reconciliation branch before allowing any new
                            // mutation; a second create would duplicate the
                            // document if the first response was lost.
                            chunkStatus: row.status === "CREATED" && !row.eformsignDocumentId
                                ? "RECONCILING"
                                : row.status,
                            chunkAttempts: row.attempts,
                            chunkClaimedAt: row.claimedAt,
                            chunkCreateAttemptedAt: row.createAttemptedAt,
                            templateId: chunk.templateId,
                            accessToken,
                            reviewer,
                            snapshotVersion: documentVersion,
                            revisionId,
                            revisionNumber,
                            generation: input.generation,
                            idempotencyKey: `service-record-revision:${input.generation}:v${documentVersion}:c${chunk.chunkIndex}`,
                        }));
                    }
                    return ids;
                },
            );
            missingChunks.forEach((chunk, index) => {
                const documentId = createdDocumentIds[index];
                if (documentId) documentIdsByChunk.set(chunk.chunkIndex, documentId);
            });
        }

        const documentIds = chunks
            .map((chunk) => documentIdsByChunk.get(chunk.chunkIndex))
            .filter((documentId): documentId is string => Boolean(documentId));
        if (documentIds.length !== chunks.length) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_CHUNKS_INCOMPLETE" });
        }
        if (!this.editRepository?.promoteServiceRecordRevisionSnapshot) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_POINTER_PROMOTION_UNAVAILABLE" });
        }
        const promoted = await this.editRepository.promoteServiceRecordRevisionSnapshot({
            branchId: input.branchId,
            clientId: input.clientId,
            serviceRecordCaseId: input.serviceRecordCaseId,
            revisionId,
            revisionNumber,
            documentStateId: input.documentStateId,
            generation: input.generation,
            documentVersion,
            chunkCount: chunks.length,
            documentIds,
        });
        if (promoted !== true) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_POINTER_PROMOTION_STALE" });
        }
        return { documentIds, documentVersion, chunkCount: chunks.length };
    }

    private assertRevisionGenerationInput(
        input: ServiceRecordRevisionGenerationInput,
        principal: EformsignProviderPrincipal,
    ): void {
        if (!principal.branchId || principal.branchId !== input.branchId) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_SCOPE_CHANGED" });
        }
        const revisionNumber = input.revisionNumber;
        if (!nonEmptyString(input.branchId)
            || !Number.isInteger(input.clientId)
            || !nonEmptyString(input.serviceRecordCaseId)
            || !nonEmptyString(input.revisionId)
            || !Number.isInteger(revisionNumber)
            || revisionNumber === null
            || revisionNumber < 1
            || !nonEmptyString(input.documentStateId)
            || !nonEmptyString(input.snapshotReference)
            || !nonEmptyString(input.generation)
            || !["REVISION_SNAPSHOT", "INITIAL_FINALIZATION"].includes(input.generationKind)
            || input.completeness !== "complete"
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_INVALID" });
        }
        if (input.documentSyncStatus === "capability_unverified") {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" });
        }
        if (input.documentSyncStatus === "not_required" || input.documentSyncStatus === "waiting_for_completion") {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_NOT_READY" });
        }
        if (!/^[0-9a-f]{64}$/i.test(input.payloadFingerprint)
            || sha256CanonicalJson(input.immutablePayload) !== input.payloadFingerprint
            || input.businessFingerprint !== input.payloadFingerprint
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_FINGERPRINT_MISMATCH" });
        }
        const plannedSessionCount = input.plannedSessionCount;
        if (plannedSessionCount === null || !Number.isInteger(plannedSessionCount) || plannedSessionCount < 1) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_INVALID" });
        }
        if (input.plannedSessionDates.length !== plannedSessionCount
            || input.plannedSessionDates.some((entry, index) => (
                entry.sessionIndex !== index + 1
                || parseDateOnly(entry.serviceDate) === null
            ))) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_INVALID" });
        }
        if (!Number.isInteger(input.documentVersion) || input.documentVersion < 1) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_DOCUMENT_VERSION_INVALID" });
        }
    }

    private assertRevisionState(
        input: ServiceRecordRevisionGenerationInput,
        state: RevisionSnapshotStateRow,
    ): void {
        if (state.status === "capability_unverified" || state.step === "capability_unverified") {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" });
        }
        if ([
            "not_required",
            "waiting_for_completion",
            "waiting_for_signature",
            "failed",
            "manual_review",
            "unknown",
        ].includes(state.status)) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_NOT_READY" });
        }
        const sameScope = state.branchId === input.branchId
            && state.clientId === input.clientId
            && state.serviceRecordCaseId === input.serviceRecordCaseId
            && state.revisionId === input.revisionId
            && state.operation === "record_snapshot";
        if (!sameScope || state.generation !== input.generation) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_SCOPE_CHANGED" });
        }
        if (state.inputFingerprint !== input.payloadFingerprint
            || (state.immutableInput !== null
                && sha256CanonicalJson(state.immutableInput) !== input.payloadFingerprint)
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_FINGERPRINT_MISMATCH" });
        }
        if (state.documentVersion !== input.documentVersion) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_DOCUMENT_VERSION_SCOPE_CHANGED" });
        }
    }

    private resolveRevisionDocumentVersion(input: ServiceRecordRevisionGenerationInput): number {
        if (!Number.isInteger(input.documentVersion) || input.documentVersion < 1) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_DOCUMENT_VERSION_INVALID" });
        }
        return input.documentVersion;
    }

    private buildFrozenRevisionSource(input: ServiceRecordRevisionGenerationInput): FrozenRevisionSource {
        const payload = input.immutablePayload;
        if (payload["completeness"] !== undefined && payload["completeness"] !== "complete") {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_INCOMPLETE" });
        }
        const payloadCaseId = nonEmptyString(payload["caseId"] ?? payload["serviceRecordCaseId"]);
        const payloadBranchId = nonEmptyString(payload["branchId"]);
        const payloadClientId = finiteInteger(payload["clientId"]);
        const payloadRevisionId = nonEmptyString(payload["revisionId"]);
        const payloadRevisionNumber = finiteInteger(payload["revisionNumber"]);
        const payloadGeneration = nonEmptyString(payload["generation"]);
        if ((payloadCaseId && payloadCaseId !== input.serviceRecordCaseId)
            || (payloadBranchId && payloadBranchId !== input.branchId)
            || (payloadClientId !== null && payloadClientId !== input.clientId)
            || (payloadRevisionId && payloadRevisionId !== input.revisionId)
            || (payloadRevisionNumber !== null && payloadRevisionNumber !== input.revisionNumber)
            || (payloadGeneration && payloadGeneration !== input.generation)
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_SCOPE_CHANGED" });
        }
        if (!payloadCaseId || payloadClientId === null) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_INVALID" });
        }

        const headerPayload = isRecord(payload["header"]) ? payload["header"] : null;
        const header = {
            momName: nonEmptyString(headerPayload?.["momName"]),
            momBirth: nonEmptyString(headerPayload?.["momBirth"]),
            babyName: nonEmptyString(headerPayload?.["babyName"]),
            babyBirth: nonEmptyString(headerPayload?.["babyBirth"]),
            deliveryType: nonEmptyString(headerPayload?.["deliveryType"]),
            babyWeight: nonEmptyString(headerPayload?.["babyWeight"]),
        };
        if (Object.values(header).some((value) => value === null)) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_HEADER_INCOMPLETE" });
        }

        // The provider identity must be frozen alongside the rendered fields.
        // Do not derive it from the live branch relation (or from a loose
        // nested hint) because a branch rename/reassignment after confirm
        // must not change a retry's document bytes.
        const providerName = nonEmptyString(payload["providerName"])
            ?? nonEmptyString(payload["branchName"]);
        if (!providerName) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_IMMUTABLE_PROVIDER_MISSING" });
        }
        const clientPayload = isRecord(payload["client"]) ? payload["client"] : null;
        const clientName = nonEmptyString(clientPayload?.["name"])
            ?? nonEmptyString(payload["clientName"])
            ?? header.momName;
        if (!clientName) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_CLIENT_MISSING" });
        }

        const plannedSessionCount = input.plannedSessionCount;
        const requiredSessionCount = finiteInteger(payload["requiredSessionCount"])
            ?? plannedSessionCount;
        if (plannedSessionCount === null
            || requiredSessionCount !== plannedSessionCount
            || requiredSessionCount < 1
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_GENERATION_INVALID" });
        }
        const sessionsPayload = Array.isArray(payload["sessions"]) ? payload["sessions"] : null;
        const plannedPayload = Array.isArray(payload["plannedSessions"]) ? payload["plannedSessions"] : null;
        if (!sessionsPayload || sessionsPayload.length !== requiredSessionCount
            || (plannedPayload && plannedPayload.length !== requiredSessionCount)
        ) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_INCOMPLETE" });
        }
        const plannedByIndex = new Map<number, Record<string, unknown>>();
        if (plannedPayload) {
            for (const item of plannedPayload) {
                if (!isRecord(item)) throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_INVALID" });
                const index = finiteInteger(item["sessionIndex"]);
                if (index === null || plannedByIndex.has(index)) {
                    throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_INVALID" });
                }
                plannedByIndex.set(index, item);
            }
        }
        const assignmentPayload = Array.isArray(payload["assignments"]) ? payload["assignments"] : [];
        const assignmentsById = new Map<string, {
            id: string;
            scheduleId: number | null;
            employeeId: number | null;
            employeeNameSnapshot: string;
            startDate: Date;
            endDate: Date;
        }>();
        for (const item of assignmentPayload) {
            if (!isRecord(item)) throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_INVALID" });
            const id = nonEmptyString(item["assignmentId"] ?? item["id"]);
            const name = nonEmptyString(item["employeeNameSnapshot"] ?? item["employeeName"]);
            const startDate = parseDateOnly(item["startDate"]);
            const endDate = parseDateOnly(item["endDate"]);
            if (!id || !name || !startDate || !endDate || endDate < startDate) {
                throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_ASSIGNMENT_INVALID" });
            }
            assignmentsById.set(id, {
                id,
                scheduleId: finiteInteger(item["scheduleId"]),
                employeeId: finiteInteger(item["employeeId"]),
                employeeNameSnapshot: name,
                startDate,
                endDate,
            });
        }

        const days: Array<ServiceRecordDayInput & {
            caseSessionIndex: number;
            scheduleId: number | null;
            employeeId: number | null;
            employeeNameSnapshot: string;
            assignmentId: string | null;
        }> = [];
        for (let offset = 0; offset < sessionsPayload.length; offset++) {
            const item = sessionsPayload[offset];
            if (!isRecord(item)) throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_INVALID" });
            const sessionIndex = finiteInteger(item["sessionIndex"]);
            const serviceDate = parseDateOnly(item["serviceDate"]);
            const planned = plannedByIndex.get(offset + 1);
            const plannedIndex = planned ? finiteInteger(planned["sessionIndex"]) : offset + 1;
            const plannedDate = planned ? parseDateOnly(planned["serviceDate"]) : null;
            if (sessionIndex !== offset + 1
                || plannedIndex !== offset + 1
                || !serviceDate
                || (planned && (!plannedDate || plannedDate.getTime() !== serviceDate.getTime()))
                || input.plannedSessionDates[offset]?.sessionIndex !== sessionIndex
                || parseDateOnly(input.plannedSessionDates[offset]?.serviceDate)?.getTime() !== serviceDate.getTime()
            ) {
                throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_DATES_CHANGED" });
            }
            const assignmentId = nonEmptyString(item["assignmentId"] ?? planned?.["assignmentId"]);
            const assignment = assignmentId ? assignmentsById.get(assignmentId) : undefined;
            const employeeName = nonEmptyString(item["employeeNameSnapshot"] ?? item["employeeName"])
                ?? assignment?.employeeNameSnapshot;
            if (!employeeName) {
                throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_EMPLOYEE_MISSING" });
            }
            const answers = item["answers"] === undefined
                ? {}
                : (isRecord(item["answers"]) ? item["answers"] : null);
            if (answers === null) {
                throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_INVALID" });
            }
            const nullableText = (value: unknown): string | null => value === null || value === undefined
                ? null
                : typeof value === "string" ? value : null;
            const paymentConfirmed = item["paymentConfirmed"];
            const momApproval = nullableText(item["momApproval"]);
            const clientSignature = nullableText(item["clientSignature"]);
            const clientSignedAt = nonEmptyString(item["clientSignedAt"]);
            const submittedAt = nonEmptyString(item["submittedAt"]);
            const locked = item["locked"];
            const scheduleId = finiteInteger(item["scheduleId"]) ?? assignment?.scheduleId ?? null;
            const employeeId = finiteInteger(item["employeeId"]) ?? assignment?.employeeId ?? null;
            if (typeof paymentConfirmed !== "boolean"
                || locked !== true
                || momApproval !== "approved"
                || !clientSignature
                || !clientSignedAt
                || !submittedAt
                || scheduleId === null
                || scheduleId < 1
                || employeeId === null
                || employeeId < 1
            ) {
                throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_INCOMPLETE" });
            }
            days.push({
                sessionIndex,
                caseSessionIndex: sessionIndex,
                serviceDate,
                answers,
                etcService: nullableText(item["etcService"]),
                notes: nullableText(item["notes"]),
                paymentConfirmed,
                momApproval,
                clientSignature,
                scheduleId,
                employeeId,
                employeeNameSnapshot: employeeName,
                assignmentId: assignmentId ?? null,
            });
        }
        if (plannedPayload && plannedByIndex.size !== requiredSessionCount) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_INVALID" });
        }

        const assignmentList = [...assignmentsById.values()];
        const startDate = parseDateOnly(payload["startDate"]) ?? days[0]!.serviceDate;
        const endDate = parseDateOnly(payload["endDate"]) ?? days.at(-1)!.serviceDate;
        if (endDate < startDate) throw new ConflictException({ code: "SERVICE_RECORD_REVISION_PAYLOAD_DATES_CHANGED" });
        const record = {
            id: input.serviceRecordCaseId,
            branchId: input.branchId,
            clientId: input.clientId,
            formVersion: input.formVersion,
            requiredSessionCount,
            startDate,
            endDate,
            momName: header.momName,
            momBirth: header.momBirth,
            babyName: header.babyName,
            babyBirth: header.babyBirth,
            deliveryType: header.deliveryType,
            babyWeight: header.babyWeight,
            branch: { name: providerName },
            client: { name: clientName },
            assignments: assignmentList,
            days,
        } as unknown as ServiceRecordCaseForSnapshot;
        return { record, payloadFingerprint: input.payloadFingerprint };
    }

    private buildRevisionChunks(
        record: ServiceRecordCaseForSnapshot,
        tiers: number[],
        templateIdByTier: Map<number, string>,
        persistedLayout: PersistedSnapshotChunkLayout[],
        input: ServiceRecordRevisionGenerationInput,
        documentVersion: number,
    ): PreparedSnapshotChunk[] {
        const chunks = this.buildCaseChunks(record, tiers, templateIdByTier, persistedLayout);
        return chunks.map((chunk) => ({
            ...chunk,
            sourceHash: input.payloadFingerprint,
            compatibleSourceHashes: [],
            documentName: this.revisionDocumentName(
                record.client?.name || record.momName?.trim() || "삭제된 고객",
                record.id,
                input.revisionNumber!,
                documentVersion,
                chunk.chunkIndex,
                chunk.chunkCount,
            ),
        }));
    }

    private revisionDocumentName(
        clientName: string,
        caseId: string,
        revisionNumber: number,
        documentVersion: number,
        chunkIndex: number,
        chunkCount: number,
    ): string {
        return `서비스 제공기록지 - ${clientName} (${chunkIndex}/${chunkCount}) [SR-${caseId.slice(0, 8)}-r${revisionNumber}-v${documentVersion}]`;
    }

    private async prepareRevisionChunkRows(
        input: ServiceRecordRevisionGenerationInput,
        documentVersion: number,
        chunks: PreparedSnapshotChunk[],
        existingRows: RevisionSnapshotChunkRow[],
    ): Promise<RevisionSnapshotChunkRow[]> {
        const byIndex = new Map<number, RevisionSnapshotChunkRow>();
        for (const row of existingRows) {
            if (byIndex.has(row.chunkIndex)
                || row.revisionId !== input.revisionId
                || row.snapshotVersion !== documentVersion
            ) {
                throw new ConflictException({ code: "SERVICE_RECORD_REVISION_CHUNK_SCOPE_CHANGED" });
            }
            byIndex.set(row.chunkIndex, row);
        }
        if (existingRows.length > 0 && existingRows.some((row) => row.chunkCount !== chunks.length)) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_CHUNK_LAYOUT_CHANGED" });
        }
        return this.prisma.$transaction(async (tx) => {
            for (const chunk of chunks) {
                const existing = byIndex.get(chunk.chunkIndex);
                const data = {
                    branchId: input.branchId,
                    serviceRecordCaseId: input.serviceRecordCaseId,
                    revisionId: input.revisionId,
                    snapshotVersion: documentVersion,
                    assignmentId: chunk.assignmentId,
                    chunkCount: chunk.chunkCount,
                    firstSessionIndex: chunk.firstSessionIndex,
                    lastSessionIndex: chunk.lastSessionIndex,
                    employeeNameSnapshot: chunk.employeeName,
                    sourceHash: chunk.sourceHash,
                };
                if (!existing) {
                    const created = await tx.service_record_snapshot_chunk.create({ data: {
                        ...data,
                        chunkIndex: chunk.chunkIndex,
                    } });
                    byIndex.set(chunk.chunkIndex, created);
                    continue;
                }
                if (existing.sourceHash !== chunk.sourceHash) {
                    throw new ConflictException({ code: "SERVICE_RECORD_REVISION_SOURCE_CHANGED" });
                }
                if (existing.chunkIndex !== chunk.chunkIndex
                    || existing.firstSessionIndex !== chunk.firstSessionIndex
                    || existing.lastSessionIndex !== chunk.lastSessionIndex
                    || existing.employeeNameSnapshot !== chunk.employeeName
                ) {
                    throw new ConflictException({ code: "SERVICE_RECORD_REVISION_CHUNK_LAYOUT_CHANGED" });
                }
                if (existing.status !== "CREATED") {
                    await tx.service_record_snapshot_chunk.update({
                        where: { id: existing.id },
                        data,
                    });
                }
            }
            return tx.service_record_snapshot_chunk.findMany({
                where: {
                    branchId: input.branchId,
                    serviceRecordCaseId: input.serviceRecordCaseId,
                    revisionId: input.revisionId,
                    snapshotVersion: documentVersion,
                },
                orderBy: { chunkIndex: "asc" },
            });
        });
    }

    private async markRevisionChunkCreated(
        input: ServiceRecordRevisionGenerationInput,
        documentVersion: number,
        chunkId: string,
        documentId: string,
    ): Promise<void> {
        const updated = await this.prisma.service_record_snapshot_chunk.updateMany({
            where: {
                id: chunkId,
                branchId: input.branchId,
                serviceRecordCaseId: input.serviceRecordCaseId,
                revisionId: input.revisionId,
                snapshotVersion: documentVersion,
                OR: [
                    { status: { not: "CREATED" } },
                    { status: "CREATED", eformsignDocumentId: null },
                ],
            },
            data: {
                status: "CREATED",
                eformsignDocumentId: documentId,
                nextAttemptAt: null,
                lastError: null,
            },
        });
        if (updated.count !== 1) {
            throw new ConflictException({ code: "SERVICE_RECORD_REVISION_CHUNK_SCOPE_CHANGED" });
        }
    }

    private assertReadyForSnapshot(record: ServiceRecordCaseForSnapshot): void {
        const required = record.requiredSessionCount ?? 0;
        const completeHeader = [
            record.momName,
            record.momBirth,
            record.babyName,
            record.babyBirth,
            record.deliveryType,
            record.babyWeight,
        ].every((value) => Boolean(value?.trim()));
        const indicesAreContinuous = record.days.every(
            (day, index) => day.caseSessionIndex === index + 1,
        );
        const sessionsComplete = required > 0
            && record.days.length === required
            && indicesAreContinuous
            && record.days.every((day) => day.locked && day.momApproval === "approved");

        if (!completeHeader || !sessionsComplete) {
            throw new ConflictException({ code: "SERVICE_RECORD_INCOMPLETE" });
        }
    }

    private buildCaseChunks(
        record: ServiceRecordCaseForSnapshot,
        tiers: number[],
        templateIdByTier: Map<number, string>,
        persistedLayout: PersistedSnapshotChunkLayout[] = [],
    ): PreparedSnapshotChunk[] {
        if (persistedLayout.length > 0) {
            return this.buildCaseChunksFromPersistedLayout(
                record,
                tiers,
                templateIdByTier,
                persistedLayout,
            );
        }

        const assignmentsBySchedule = new Map(
            record.assignments
                .filter((assignment) => assignment.scheduleId !== null)
                .map((assignment) => [assignment.scheduleId!, assignment]),
        );
        const groups: Array<{
            key: string;
            assignmentId: string | null;
            scheduleId: number | null;
            employeeName: string;
            days: ServiceRecordDayInput[];
        }> = [];

        for (const day of record.days) {
            const assignment = day.scheduleId
                ? assignmentsBySchedule.get(day.scheduleId) ?? null
                : this.findAssignmentForDay(record, day.employeeId, day.serviceDate);
            const employeeName = day.employeeNameSnapshot
                ?? assignment?.employeeNameSnapshot
                ?? "미확인 제공인력";
            const groupKey = assignment?.id
                ?? `employee:${day.employeeId ?? "unknown"}:${employeeName}`;
            let group = groups.at(-1);
            if (!group || group.key !== groupKey) {
                group = {
                    key: groupKey,
                    assignmentId: assignment?.id ?? null,
                    scheduleId: day.scheduleId ?? assignment?.scheduleId ?? null,
                    employeeName,
                    days: [],
                };
                groups.push(group);
            }
            group.days.push({
                sessionIndex: day.caseSessionIndex!,
                serviceDate: day.serviceDate,
                answers: (day.answers ?? {}) as Record<string, unknown>,
                etcService: day.etcService,
                notes: day.notes,
                paymentConfirmed: day.paymentConfirmed,
                momApproval: day.momApproval,
                clientSignature: day.clientSignature,
            });
        }

        const rawChunks = groups.flatMap((group) => (
            chunkSessionsByTier(group.days, tiers).map(({ days, tier }) => ({ ...group, days, tier }))
        ));
        const chunkCount = rawChunks.length;
        return rawChunks.map((chunk, index) => {
            const chunkIndex = index + 1;
            const firstSessionIndex = chunk.days[0]!.sessionIndex;
            const lastSessionIndex = chunk.days.at(-1)!.sessionIndex;
            const documentName = this.caseDocumentName(
                record.client?.name || record.momName?.trim() || "삭제된 고객",
                record.id,
                record.formVersion,
                chunkIndex,
                chunkCount,
            );
            const { sourceHash, compatibleSourceHashes } = this.buildSourceHashes(
                record,
                chunk.employeeName,
                chunk.days,
            );
            const templateId = templateIdByTier.get(chunk.tier);
            if (!templateId) throw new Error(`No 제공기록지 template configured for tier ${chunk.tier}`);
            return {
                assignmentId: chunk.assignmentId,
                scheduleId: chunk.scheduleId,
                employeeName: chunk.employeeName,
                chunkIndex,
                chunkCount,
                firstSessionIndex,
                lastSessionIndex,
                sourceHash,
                compatibleSourceHashes,
                documentName,
                days: chunk.days,
                tier: chunk.tier,
                templateId,
            };
        });
    }

    /**
     * Once durable chunk rows exist, their session boundaries are the layout of record for this
     * snapshot version. Rebuild the payload inside those boundaries instead of re-tiering with the
     * current environment, otherwise a newly enabled larger tier could reuse chunkIndex 1 for a
     * different session range and make an existing document hide sessions from the retry.
     */
    private buildCaseChunksFromPersistedLayout(
        record: ServiceRecordCaseForSnapshot,
        tiers: number[],
        templateIdByTier: Map<number, string>,
        persistedLayout: PersistedSnapshotChunkLayout[],
    ): PreparedSnapshotChunk[] {
        const layouts = [...persistedLayout].sort((a, b) => a.chunkIndex - b.chunkIndex);
        const assignmentsById = new Map(record.assignments.map((assignment) => [assignment.id, assignment]));
        const sortedTiers = [...tiers].sort((a, b) => a - b);
        let expectedFirstSessionIndex = 1;

        const chunks = layouts.map((layout, index) => {
            const expectedChunkIndex = index + 1;
            const layoutIsValid = (
                layout.chunkIndex === expectedChunkIndex
                && layout.chunkCount === layouts.length
                && layout.firstSessionIndex === expectedFirstSessionIndex
                && layout.lastSessionIndex >= layout.firstSessionIndex
                && layout.lastSessionIndex <= record.days.length
            );
            if (!layoutIsValid) {
                throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_LAYOUT_INVALID" });
            }

            const sourceDays = record.days.filter((day) => (
                day.caseSessionIndex! >= layout.firstSessionIndex
                && day.caseSessionIndex! <= layout.lastSessionIndex
            ));
            const expectedDayCount = layout.lastSessionIndex - layout.firstSessionIndex + 1;
            if (sourceDays.length !== expectedDayCount) {
                throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_LAYOUT_INVALID" });
            }

            const tier = sortedTiers.find((candidate) => candidate >= sourceDays.length);
            const templateId = tier === undefined ? undefined : templateIdByTier.get(tier);
            if (tier === undefined || !templateId) {
                throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_TEMPLATE_TIER_UNAVAILABLE" });
            }

            const days = sourceDays.map((day) => ({
                sessionIndex: day.caseSessionIndex!,
                serviceDate: day.serviceDate,
                answers: (day.answers ?? {}) as Record<string, unknown>,
                etcService: day.etcService,
                notes: day.notes,
                paymentConfirmed: day.paymentConfirmed,
                momApproval: day.momApproval,
                clientSignature: day.clientSignature,
            }));
            const assignment = layout.assignmentId
                ? assignmentsById.get(layout.assignmentId) ?? null
                : null;
            const employeeName = layout.employeeNameSnapshot;
            const chunkCount = layouts.length;
            const documentName = this.caseDocumentName(
                record.client?.name || record.momName?.trim() || "삭제된 고객",
                record.id,
                record.formVersion,
                layout.chunkIndex,
                chunkCount,
            );
            const { sourceHash, compatibleSourceHashes } = this.buildSourceHashes(
                record,
                employeeName,
                days,
            );

            expectedFirstSessionIndex = layout.lastSessionIndex + 1;
            return {
                assignmentId: layout.assignmentId,
                scheduleId: sourceDays[0]?.scheduleId ?? assignment?.scheduleId ?? null,
                employeeName,
                chunkIndex: layout.chunkIndex,
                chunkCount,
                firstSessionIndex: layout.firstSessionIndex,
                lastSessionIndex: layout.lastSessionIndex,
                sourceHash,
                compatibleSourceHashes,
                documentName,
                days,
                tier,
                templateId,
            };
        });

        if (expectedFirstSessionIndex !== record.days.length + 1) {
            throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_LAYOUT_INVALID" });
        }
        return chunks;
    }

    private findAssignmentForDay(
        record: ServiceRecordCaseForSnapshot,
        employeeId: number | null,
        serviceDate: Date,
    ) {
        return record.assignments.find((assignment) => (
            (employeeId === null || assignment.employeeId === employeeId)
            && assignment.startDate <= serviceDate
            && assignment.endDate >= serviceDate
        )) ?? null;
    }

    private async prepareChunkRows(
        record: ServiceRecordCaseForSnapshot,
        chunks: PreparedSnapshotChunk[],
    ) {
        return this.prisma.$transaction(async (tx) => {
            const existingRows = await tx.service_record_snapshot_chunk.findMany({
                where: {
                    serviceRecordCaseId: record.id,
                    snapshotVersion: record.formVersion,
                },
            });
            const existingByIndex = new Map(existingRows.map((row) => [row.chunkIndex, row]));
            await tx.service_record_snapshot_chunk.deleteMany({
                where: {
                    serviceRecordCaseId: record.id,
                    snapshotVersion: record.formVersion,
                    chunkIndex: { notIn: chunks.map((chunk) => chunk.chunkIndex) },
                    status: { not: "CREATED" },
                },
            });

            for (const chunk of chunks) {
                const existing = existingByIndex.get(chunk.chunkIndex);
                const data = {
                    branchId: record.branchId,
                    assignmentId: chunk.assignmentId,
                    chunkCount: chunk.chunkCount,
                    firstSessionIndex: chunk.firstSessionIndex,
                    lastSessionIndex: chunk.lastSessionIndex,
                    employeeNameSnapshot: chunk.employeeName,
                    sourceHash: chunk.sourceHash,
                };
                if (!existing) {
                    await tx.service_record_snapshot_chunk.create({
                        data: {
                            ...data,
                            serviceRecordCaseId: record.id,
                            snapshotVersion: record.formVersion,
                            chunkIndex: chunk.chunkIndex,
                        },
                    });
                    continue;
                }
                if (
                    existing.status === "CREATED"
                    && existing.sourceHash !== chunk.sourceHash
                    && !chunk.compatibleSourceHashes.includes(existing.sourceHash)
                    && !existing.sourceHash.startsWith("legacy:")
                ) {
                    throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_SOURCE_CHANGED" });
                }
                if (existing.status !== "CREATED") {
                    await tx.service_record_snapshot_chunk.update({
                        where: { id: existing.id },
                        data,
                    });
                }
            }

            return tx.service_record_snapshot_chunk.findMany({
                where: {
                    serviceRecordCaseId: record.id,
                    snapshotVersion: record.formVersion,
                },
                orderBy: { chunkIndex: "asc" },
            });
        });
    }

    private revisionChunkWhere(params: {
        chunkId: string;
        revisionId?: string;
        snapshotVersion?: number;
    }): Prisma.service_record_snapshot_chunkWhereUniqueInput {
        if (!params.revisionId) return { id: params.chunkId };
        return {
            id: params.chunkId,
            revisionId: params.revisionId,
            snapshotVersion: params.snapshotVersion,
        };
    }

    private revisionChunkFilter(params: {
        chunkId: string;
        revisionId?: string;
        snapshotVersion?: number;
    }): Prisma.service_record_snapshot_chunkWhereInput {
        return params.revisionId
            ? {
                id: params.chunkId,
                revisionId: params.revisionId,
                snapshotVersion: params.snapshotVersion,
            }
            : { id: params.chunkId };
    }

    private async processChunk(params: {
        record: ServiceRecordCaseForSnapshot;
        chunk: PreparedSnapshotChunk;
        chunkId: string;
        chunkStatus: string;
        chunkAttempts: number;
        chunkClaimedAt: Date | null;
        chunkCreateAttemptedAt: Date | null;
        templateId: string;
        accessToken: string;
        reviewer: NonNullable<Awaited<ReturnType<IEformsignClientRepository["getTemplateReviewer"]>>>;
        snapshotVersion?: number;
        revisionId?: string;
        revisionNumber?: number;
        generation?: string;
        idempotencyKey?: string;
    }): Promise<string> {
        let status = params.chunkStatus;
        if (
            status === "CLAIMED"
            && params.chunkCreateAttemptedAt === null
            && params.chunkClaimedAt
            && params.chunkClaimedAt.getTime() <= Date.now() - CHUNK_CLAIM_STALE_MS
        ) {
            await this.prisma.service_record_snapshot_chunk.update({
                where: this.revisionChunkWhere(params),
                data: { status: "FAILED", nextAttemptAt: new Date(), lastError: "Stale pre-create claim recovered" },
            });
            status = "FAILED";
        }

        if (
            status === "CREATE_REQUESTED"
            || status === "RECONCILING"
            || (status === "CLAIMED" && params.chunkCreateAttemptedAt !== null)
        ) {
            return this.reconcileChunk(params);
        }
        if (status === "MANUAL_REVIEW") {
            throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_MANUAL_REVIEW" });
        }

        const now = new Date();
        const claim = await this.prisma.service_record_snapshot_chunk.updateMany({
            where: {
                ...this.revisionChunkFilter(params),
                status: { in: ["PENDING", "FAILED"] },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            data: {
                status: "CLAIMED",
                claimedAt: now,
                createAttemptedAt: null,
                nextAttemptAt: null,
                attempts: { increment: 1 },
                lastError: null,
            },
        });
        if (claim.count !== 1) {
            throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_CHUNK_BUSY" });
        }

        await this.prisma.service_record_snapshot_chunk.update({
            where: this.revisionChunkWhere(params),
            data: { status: "CREATE_REQUESTED", createAttemptedAt: new Date() },
        });

        try {
            const prefillFields = buildServiceRecordDocumentFields({
                header: params.record,
                providerName: params.record.branch.name,
                employeeName: params.chunk.employeeName,
                days: params.chunk.days,
                slotCount: params.chunk.tier,
            });
            const result = await this.eformsignClient.createDocument(params.accessToken, {
                templateId: params.templateId,
                ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
                documentName: params.chunk.documentName,
                prefillFields,
                reviewer: params.reviewer,
            });
            await this.persistRemoteDocument({
                ...params,
                documentId: result.documentId,
                remoteDocument: null,
            });
            return result.documentId;
        } catch (error) {
            const message = this.errorMessage(error);
            const definitiveClientError = /Failed to create document: 4\d\d\b/.test(message);
            const attempts = params.chunkAttempts + 1;
            const statusAfterFailure = definitiveClientError
                ? (attempts >= MAX_DEFINITIVE_CREATE_ATTEMPTS ? "MANUAL_REVIEW" : "FAILED")
                : "RECONCILING";
            await this.prisma.service_record_snapshot_chunk.update({
                where: this.revisionChunkWhere(params),
                data: {
                    status: statusAfterFailure,
                    nextAttemptAt: statusAfterFailure === "MANUAL_REVIEW"
                        ? null
                        : new Date(Date.now() + CHUNK_RETRY_DELAY_MS),
                    lastError: message.slice(0, 2000),
                },
            });
            if (!definitiveClientError) {
                captureServiceRecordError(error, {
                    operation: "snapshot-create",
                    handled: true,
                    caseId: params.record.id,
                    scheduleId: params.chunk.scheduleId ?? undefined,
                    retryCount: attempts,
                });
            }
            throw error;
        }
    }

    private async reconcileChunk(params: {
        record: ServiceRecordCaseForSnapshot;
        chunk: PreparedSnapshotChunk;
        chunkId: string;
        chunkAttempts: number;
        chunkStatus?: string;
        chunkClaimedAt?: Date | null;
        chunkCreateAttemptedAt?: Date | null;
        templateId: string;
        accessToken: string;
        reviewer: NonNullable<Awaited<ReturnType<IEformsignClientRepository["getTemplateReviewer"]>>>;
        snapshotVersion?: number;
        revisionId?: string;
        revisionNumber?: number;
        generation?: string;
        idempotencyKey?: string;
    }): Promise<string> {
        const documents = this.eformsignClient.findDocumentsByTitle
            ? await this.eformsignClient.findDocumentsByTitle(params.accessToken, params.chunk.documentName)
            : (await this.eformsignClient.getAllDocuments(params.accessToken))
                .filter((document) => document.document_name === params.chunk.documentName);
        if (documents.length > 1) {
            await this.prisma.service_record_snapshot_chunk.update({
                where: this.revisionChunkWhere(params),
                data: {
                    status: "MANUAL_REVIEW",
                    nextAttemptAt: null,
                    lastError: `Multiple remote documents match ${params.chunk.documentName}`,
                },
            });
            throw new ConflictException({ code: "SERVICE_RECORD_SNAPSHOT_DUPLICATE_REMOTE" });
        }
        const document = documents[0];
        if (document) {
            await this.persistRemoteDocument({
                ...params,
                documentId: document.id,
                remoteDocument: document,
            });
            return document.id;
        }

        const attempts = params.chunkAttempts + 1;
        const manualReview = attempts >= MAX_RECONCILIATION_ATTEMPTS;
        await this.prisma.service_record_snapshot_chunk.update({
            where: this.revisionChunkWhere(params),
            data: {
                status: manualReview ? "MANUAL_REVIEW" : "RECONCILING",
                attempts: { increment: 1 },
                nextAttemptAt: manualReview ? null : new Date(Date.now() + CHUNK_RETRY_DELAY_MS),
                lastError: `Remote document not visible for reconciliation: ${params.chunk.documentName}`,
            },
        });
        throw new ConflictException({
            code: manualReview
                ? "SERVICE_RECORD_SNAPSHOT_MANUAL_REVIEW"
                : "SERVICE_RECORD_SNAPSHOT_RECONCILIATION_PENDING",
        });
    }

    private async persistRemoteDocument(params: {
        record: ServiceRecordCaseForSnapshot;
        chunk: PreparedSnapshotChunk;
        chunkId: string;
        templateId: string;
        reviewer: NonNullable<Awaited<ReturnType<IEformsignClientRepository["getTemplateReviewer"]>>>;
        documentId: string;
        remoteDocument: Awaited<ReturnType<IEformsignClientRepository["getDocument"]>> | null;
        snapshotVersion?: number;
        revisionId?: string;
        revisionNumber?: number;
        generation?: string;
        idempotencyKey?: string;
    }): Promise<void> {
        const snapshotVersion = params.snapshotVersion ?? params.record.formVersion;
        const now = new Date();
        const remoteStatus = params.remoteDocument?.current_status;
        const recipient = remoteStatus?.step_recipients?.[0];
        const templateName = params.remoteDocument?.template.name?.trim() || null;
        const customerName = params.record.momName?.trim()
            || params.record.client?.name.trim()
            || "삭제된 고객";
        const creatorName = params.remoteDocument?.creator.name?.trim() || null;
        const lastEditorName = params.remoteDocument?.last_editor?.name?.trim() || null;
        const stepRecipientTypes = encodeEformsignStepRecipientTypes(
            remoteStatus?.step_recipients?.map((item) => item.recipient_type),
        );
        const createdDate = params.remoteDocument?.created_date
            ? new Date(params.remoteDocument.created_date)
            : now;
        const updatedDate = params.remoteDocument?.updated_date
            ? new Date(params.remoteDocument.updated_date)
            : now;
        // expired_date is days remaining, not an epoch — reading it as one stored a 1970
        // date for every document eformsign said had a few days left. Its own fallback
        // stays 14 days: that is this path's guess for "the vendor did not say", and the
        // shared helper's 30 is a different guess for a different caller.
        const expiredDate = remoteStatus?.expired_date === undefined
            ? new Date(Date.now() + SNAPSHOT_FALLBACK_EXPIRY_MS)
            : eformsignExpiryDateFromRemainingDays(remoteStatus.expired_date, Date.now());
        const marker = params.revisionId
            ? `제공기록지 C${params.record.id.slice(0, 8)} R${params.revisionNumber ?? "?"} V${snapshotVersion} ${params.chunk.chunkIndex}/${params.chunk.chunkCount}`
            : `제공기록지 C${params.record.id.slice(0, 8)} V${params.record.formVersion} ${params.chunk.chunkIndex}/${params.chunk.chunkCount}`;
        const create = {
            documentId: params.documentId,
            documentName: params.chunk.documentName,
            templateName,
            customerName,
            creatorName,
            lastEditorName,
            stepRecipientTypes,
            createdDate,
            updatedDate,
            statusType: normalizeEformsignStatusCode(remoteStatus?.status_type ?? "070"),
            statusDetail: remoteStatus?.status_doc_detail ?? "검토 요청",
            stepType: remoteStatus?.step_type ?? "06",
            stepIndex: remoteStatus?.step_index ?? "2",
            stepName: marker,
            stepRecipientType: recipient?.recipient_type ?? "reviewer",
            stepRecipientName: recipient?.name ?? params.reviewer.name,
            stepRecipientSms: params.reviewer.phoneNumber ?? "-",
            expiredDate,
            expired: remoteStatus?._expired ?? false,
            clientId: params.record.clientId,
            branchId: params.record.branchId,
            documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
            employeeScheduleId: params.chunk.scheduleId,
            templateId: params.templateId,
            serviceRecordCaseId: params.record.id,
            snapshotVersion,
            snapshotChunkIndex: params.chunk.chunkIndex,
            ...(params.revisionId ? {
                revisionId: params.revisionId,
            } : {}),
        };
        const update = {
            documentName: params.chunk.documentName,
            ...(templateName ? { templateName } : {}),
            ...(customerName ? { customerName } : {}),
            ...(creatorName ? { creatorName } : {}),
            ...(lastEditorName ? { lastEditorName } : {}),
            ...(stepRecipientTypes ? { stepRecipientTypes } : {}),
            ...(remoteStatus ? {
                updatedDate,
                statusType: normalizeEformsignStatusCode(remoteStatus.status_type),
                // Only detail responses carry this. Omit rather than pass undefined so
                // the intent is the code's, not Prisma's coincidental skip semantics.
                ...(remoteStatus.status_doc_detail === undefined
                    ? {}
                    : { statusDetail: remoteStatus.status_doc_detail }),
                stepType: remoteStatus.step_type,
                stepIndex: remoteStatus.step_index,
                stepName: marker,
                stepRecipientType: recipient?.recipient_type ?? "reviewer",
                stepRecipientName: recipient?.name ?? params.reviewer.name,
                stepRecipientSms: params.reviewer.phoneNumber ?? "-",
                expiredDate,
                expired: remoteStatus._expired ?? false,
            } : {}),
            clientId: params.record.clientId,
            branchId: params.record.branchId,
            documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
            employeeScheduleId: params.chunk.scheduleId,
            templateId: params.templateId,
            serviceRecordCaseId: params.record.id,
            snapshotVersion,
            snapshotChunkIndex: params.chunk.chunkIndex,
            ...(params.revisionId ? {
                revisionId: params.revisionId,
            } : {}),
        };
        const persistInTransaction = async (
            upsertCreate: typeof create,
            upsertUpdate: typeof update,
        ): Promise<void> => {
            await this.prisma.$transaction(async (tx) => {
                await tx.eformsign_doc.upsert({
                    where: { documentId: params.documentId },
                    create: upsertCreate,
                    update: upsertUpdate,
                    select: { id: true },
                });
                await tx.service_record_snapshot_chunk.update({
                    where: this.revisionChunkWhere(params),
                    data: {
                        status: "CREATED",
                        eformsignDocumentId: params.documentId,
                        nextAttemptAt: null,
                        lastError: null,
                    },
                });
            });
        };

        try {
            await persistInTransaction(create, update);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }
            // PostgreSQL aborts a transaction after a statement error. Retry the complete
            // atomic write in a fresh transaction instead of reusing the failed tx client.
            await persistInTransaction(
                omitPendingEformsignDocColumns(create, error),
                omitPendingEformsignDocColumns(update, error),
            );
        }
        this.logger.log(
            `Service record snapshot chunk created: case=${params.record.id}, chunk=${params.chunk.chunkIndex}/${params.chunk.chunkCount}, document=${params.documentId}`,
        );
    }

    private async markChunkCreated(chunkId: string, documentId: string): Promise<void> {
        await this.prisma.service_record_snapshot_chunk.updateMany({
            where: { id: chunkId, status: { not: "CREATED" } },
            data: {
                status: "CREATED",
                eformsignDocumentId: documentId,
                nextAttemptAt: null,
                lastError: null,
            },
        });
    }

    private caseDocumentName(
        clientName: string,
        caseId: string,
        version: number,
        chunkIndex: number,
        chunkCount: number,
    ): string {
        return `서비스 제공기록지 - ${clientName} (${chunkIndex}/${chunkCount}) [SR-${caseId.slice(0, 8)}-v${version}]`;
    }

    private stableStringify(value: unknown): string {
        if (Array.isArray(value)) {
            return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
        }
        if (value instanceof Date) {
            return JSON.stringify(value.toISOString());
        }
        if (value && typeof value === "object") {
            const entries = Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right));
            return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`).join(",")}}`;
        }
        return JSON.stringify(value) ?? "null";
    }

    private buildSourceHashes(
        record: ServiceRecordCaseForSnapshot,
        employeeName: string,
        days: ServiceRecordDayInput[],
    ): { sourceHash: string; compatibleSourceHashes: string[] } {
        const commonHeader = {
            momName: record.momName,
            momBirth: record.momBirth,
            babyName: record.babyName,
            babyBirth: record.babyBirth,
            deliveryType: record.deliveryType,
            babyWeight: record.babyWeight,
        };
        const hash = (header: Record<string, unknown>) => createHash("sha256")
            .update(this.stableStringify({
                formVersion: record.formVersion,
                header,
                employeeName,
                days,
            }))
            .digest("hex");

        return {
            sourceHash: hash({ providerName: record.branch.name, ...commonHeader }),
            // providerName entered the immutable source hash after snapshots were
            // already in production. Keep accepting that immediately previous
            // representation for CREATED rows so retries adopt the existing
            // document instead of failing or creating a duplicate.
            compatibleSourceHashes: [hash(commonHeader)],
        };
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
