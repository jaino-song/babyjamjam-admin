import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import type {
    ServiceRecordRevisionDocumentState,
    ServiceRecordRevisionDocumentStatus,
} from "@babyjamjam/shared/types/service-record";
import {
    SERVICE_RECORD_EDIT_REPOSITORY,
    type AdvanceServiceRecordRevisionDocumentStateInput,
    type IServiceRecordEditRepository,
    type ServiceRecordEditJsonValue,
} from "domain/repositories/service-record-edit.repository.interface";
import {
    FILE_STORAGE_PORT,
    type FileStoragePort,
} from "domain/ports/file-storage.port";
import {
    RECEIPT_LINK_TOKEN_REPOSITORY,
    type IReceiptLinkTokenRepository,
    type PromoteReceiptLinkRevisionArtifactInput,
    type ReceiptLinkRevisionArtifactProof,
    type ReceiptLinkRevisionArtifactPromotionResult,
} from "domain/repositories/receipt-link-token.repository.interface";
import {
    ReceiptPdfVerifierService,
    type ReceiptPdfExpectedFields,
    type ReceiptPdfVerificationProof,
    type ReceiptPdfVerificationResult,
    type ReceiptPdfVerificationScope,
} from "infrastructure/pdf/receipt-pdf-verifier.service";

export const RECEIPT_LINK_REVISION_PDF_SOURCE = Symbol("ReceiptLinkRevisionPdfSource");
export const RECEIPT_LINK_REVISION_RASTERIZER = Symbol("ReceiptLinkRevisionRasterizer");
export const RECEIPT_LINK_REVISION_PDF_VERIFIER = Symbol("ReceiptLinkRevisionPdfVerifier");

export const RECEIPT_PAGE_NUMBER = 7;
export const RECEIPT_IMAGE_WIDTH = 1240;

const RECEIPT_REFRESH_OPERATION = "receipt_refresh" as const;
const STEP_NOT_REQUIRED = "not_required";
const STEP_CAPABILITY_UNVERIFIED = "capability_unverified";
const STEP_PROOF_READY = "proof_ready";
const STEP_ARTIFACT_PROMOTED = "artifact_promoted";
const STEP_UNKNOWN = "unknown";
const STEP_FAILED = "failed";

const REASON_INVALID_INPUT = "RECEIPT_REFRESH_INPUT_INVALID";
const REASON_STATE_NOT_FOUND = "RECEIPT_REFRESH_STATE_NOT_FOUND";
const REASON_SCOPE_MISMATCH = "RECEIPT_REFRESH_SCOPE_MISMATCH";
const REASON_GENERATION_MISMATCH = "RECEIPT_REFRESH_GENERATION_MISMATCH";
const REASON_IMMUTABLE_INPUT_INVALID = "RECEIPT_REFRESH_IMMUTABLE_INPUT_INVALID";
const REASON_NO_TOKEN = "RECEIPT_REFRESH_NO_ACTIVE_TOKEN";
const REASON_PDF_SOURCE_UNAVAILABLE = "RECEIPT_REFRESH_PDF_SOURCE_UNAVAILABLE";
const REASON_PDF_UNVERIFIED = "RECEIPT_REFRESH_PDF_UNVERIFIED";
const REASON_RENDER_FAILED = "RECEIPT_REFRESH_RENDER_FAILED";
const REASON_UPLOAD_FAILED = "RECEIPT_REFRESH_UPLOAD_FAILED";
const REASON_STATE_CAS_LOST = "RECEIPT_REFRESH_STATE_CAS_LOST";
const REASON_ARTIFACT_PROMOTION_STALE = "RECEIPT_REFRESH_ARTIFACT_PROMOTION_STALE";

type JsonRecord = Record<string, unknown>;

/** Receipt operation facts captured by the server at revision confirmation. */
export interface ReceiptLinkRevisionRefreshSnapshot {
    expected: ReceiptPdfExpectedFields;
    tokens: {
        eformsignDocId: number;
        tokenIds: string[];
    };
    source: {
        documentId: string;
        documentVersion: number | null;
        templateId: string;
        templateVersion: string;
        mirrorGeneration: string;
    };
}

export interface ReceiptLinkRevisionRefreshProcessInput {
    branchId: string;
    clientId: number;
    serviceRecordCaseId: string;
    revisionId: string;
    documentStateId: string;
    expectedGeneration: string;
    retry?: boolean;
}

export interface ReceiptLinkRevisionPdfSource {
    /** Download fresh official bytes for the already pinned revision target. */
    download(input: {
        branchId: string;
        clientId: number;
        serviceRecordCaseId: string;
        revisionId: string;
        documentStateId: string;
        generation: string;
        documentId: string;
        documentVersion: number | null;
        templateId: string;
        templateVersion: string;
        mirrorGeneration: string;
        eformsignDocId: number;
    }): Promise<{
        pdf: Buffer;
        documentId: string;
        documentVersion: number | null;
        templateId: string;
        templateVersion: string;
        mirrorGeneration: string;
    }>;
}

export interface ReceiptLinkRevisionRasterizer {
    renderPageToPng(pdf: Buffer, pageNumber: number, options: { width: number }): Promise<Buffer>;
}

export interface ReceiptLinkRevisionRefreshState extends ServiceRecordRevisionDocumentState {
    outputProof: JsonRecord | null;
}

export type ReceiptLinkRevisionRefreshStateRepository = Pick<
    IServiceRecordEditRepository,
    | "findRevisionDocumentState"
    | "advanceRevisionDocumentState"
    | "retryRevisionDocumentState"
>;

export interface ReceiptLinkRevisionRefreshProcessResult {
    status: ServiceRecordRevisionDocumentStatus;
    state: ReceiptLinkRevisionRefreshState | null;
    reason: string | null;
    promotedTokenIds: string[];
}

interface PreparedArtifact {
    storagePath: string;
    contentSha256: string;
    byteSize: number;
}

interface ParsedOutputProof {
    proof: ReceiptLinkRevisionArtifactProof;
    artifact: PreparedArtifact;
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isUuid(value: unknown): value is string {
    return typeof value === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDateOnly(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year ?? Number.NaN, (month ?? Number.NaN) - 1, day ?? Number.NaN));
    return Number.isFinite(date.getTime())
        && date.getUTCFullYear() === year
        && date.getUTCMonth() === (month ?? Number.NaN) - 1
        && date.getUTCDate() === day;
}

function amountIsValid(value: unknown): value is string | number {
    if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
    if (typeof value !== "string" || value.trim().length === 0) return false;
    const digits = value.replace(/[^0-9]/g, "");
    return digits.length > 0 && Number.isSafeInteger(Number(digits));
}

function nullableVersionIsValid(value: unknown): value is number | null {
    return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function asJsonRecord(value: unknown): JsonRecord | null {
    return isRecord(value) ? value : null;
}

function safeSegment(value: string): string {
    return value !== "." && value !== ".." && /^[A-Za-z0-9._-]+$/.test(value)
        ? value
        : createHash("sha256").update(value).digest("hex");
}

function asJsonValue(value: unknown): ServiceRecordEditJsonValue {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map((entry) => asJsonValue(entry));
    if (isRecord(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, asJsonValue(entry)]));
    }
    throw new Error(REASON_INVALID_INPUT);
}

function readSnapshot(value: unknown): ReceiptLinkRevisionRefreshSnapshot | null {
    const root = asJsonRecord(value);
    const expected = root ? asJsonRecord(root["expected"]) : null;
    const tokens = root ? asJsonRecord(root["tokens"]) : null;
    const source = root ? asJsonRecord(root["source"]) : null;
    if (!expected || !tokens || !source
        || !isDateOnly(expected["serviceStartDate"])
        || !isDateOnly(expected["serviceEndDate"])
        || expected["serviceStartDate"] > expected["serviceEndDate"]
        || !isDateOnly(expected["receivedDate"])
        || !amountIsValid(expected["amount"])
        || !isPositiveInteger(tokens["eformsignDocId"])
        || !Array.isArray(tokens["tokenIds"])
        || !tokens["tokenIds"].every(isUuid)
        || new Set(tokens["tokenIds"]).size !== tokens["tokenIds"].length
        || !isNonEmptyString(source["documentId"])
        || !nullableVersionIsValid(source["documentVersion"])
        || !isNonEmptyString(source["templateId"])
        || !isNonEmptyString(source["templateVersion"])
        || !isNonEmptyString(source["mirrorGeneration"])) {
        return null;
    }
    const documentVersion = source["documentVersion"];
    const eformsignDocId = tokens["eformsignDocId"];
    const tokenIds = tokens["tokenIds"];
    const documentId = source["documentId"];
    const templateId = source["templateId"];
    const templateVersion = source["templateVersion"];
    const mirrorGeneration = source["mirrorGeneration"];
    return {
        expected: {
            serviceStartDate: expected["serviceStartDate"],
            serviceEndDate: expected["serviceEndDate"],
            receivedDate: expected["receivedDate"],
            amount: expected["amount"],
        },
        tokens: {
            eformsignDocId: eformsignDocId as number,
            tokenIds: [...tokenIds] as string[],
        },
        source: {
            documentId: documentId as string,
            documentVersion: documentVersion as number | null,
            templateId: templateId as string,
            templateVersion: templateVersion as string,
            mirrorGeneration: mirrorGeneration as string,
        },
    };
}

function stateResult(
    state: ReceiptLinkRevisionRefreshState | null,
    reason: string | null,
    promotedTokenIds: string[] = [],
): ReceiptLinkRevisionRefreshProcessResult {
    return {
        status: state?.status ?? "unknown",
        state,
        reason,
        promotedTokenIds,
    };
}

function proofForTokenRepository(proof: ReceiptPdfVerificationProof, artifact: PreparedArtifact): ReceiptLinkRevisionArtifactProof {
    return {
        officialPdfSha256: proof.officialPdfSha256,
        verifiedAt: proof.verifiedAt.toISOString(),
        pageCount: proof.pageCount,
        scope: { ...proof.scope },
        expected: { ...proof.expected },
        artifact: { ...artifact },
    };
}

function parseOutputProof(value: unknown): ParsedOutputProof | null {
    const root = asJsonRecord(value);
    const artifact = root ? asJsonRecord(root["artifact"]) : null;
    const pageCount = root?.["pageCount"];
    const byteSize = artifact?.["byteSize"];
    if (!root || root["status"] !== "verified"
        || !isNonEmptyString(root["officialPdfSha256"])
        || !/^[0-9a-f]{64}$/i.test(root["officialPdfSha256"])
        || !isNonEmptyString(root["verifiedAt"])
        || !Number.isSafeInteger(pageCount) || (pageCount as number) < 1
        || !isRecord(root["scope"]) || !isRecord(root["expected"])
        || !artifact
        || !isNonEmptyString(artifact["storagePath"])
        || !isNonEmptyString(artifact["contentSha256"])
        || !/^[0-9a-f]{64}$/i.test(artifact["contentSha256"])
        || !Number.isSafeInteger(byteSize) || (byteSize as number) <= 0) {
        return null;
    }
    const officialPdfSha256 = root["officialPdfSha256"] as string;
    const verifiedAt = root["verifiedAt"] as string;
    if (!Number.isFinite(new Date(verifiedAt).getTime())) return null;
    const pageCountValue = pageCount as number;
    const scope = root["scope"] as JsonRecord;
    const expected = root["expected"] as JsonRecord;
    const storagePath = artifact["storagePath"] as string;
    const contentSha256 = artifact["contentSha256"] as string;
    const byteSizeValue = byteSize as number;
    return {
        proof: {
            officialPdfSha256,
            verifiedAt,
            pageCount: pageCountValue,
            scope,
            expected,
            artifact: {
                storagePath,
                contentSha256,
                byteSize: byteSizeValue,
            },
        },
        artifact: {
            storagePath,
            contentSha256,
            byteSize: byteSizeValue,
        },
    };
}

@Injectable()
export class ReceiptLinkRevisionRefreshService {
    constructor(
        @Inject(SERVICE_RECORD_EDIT_REPOSITORY)
        private readonly stateRepository: ReceiptLinkRevisionRefreshStateRepository,
        @Inject(RECEIPT_LINK_REVISION_PDF_SOURCE)
        private readonly pdfSource: ReceiptLinkRevisionPdfSource,
        @Inject(RECEIPT_LINK_REVISION_PDF_VERIFIER)
        private readonly verifier: Pick<ReceiptPdfVerifierService, "verify">,
        @Inject(RECEIPT_LINK_REVISION_RASTERIZER)
        private readonly rasterizer: ReceiptLinkRevisionRasterizer,
        @Inject(FILE_STORAGE_PORT)
        private readonly storage: FileStoragePort,
        @Inject(RECEIPT_LINK_TOKEN_REPOSITORY)
        private readonly tokenRepository: IReceiptLinkTokenRepository,
    ) {}

    async processOperation(input: ReceiptLinkRevisionRefreshProcessInput): Promise<ReceiptLinkRevisionRefreshProcessResult> {
        if (!isUuid(input.branchId)
            || !isPositiveInteger(input.clientId)
            || !isUuid(input.serviceRecordCaseId)
            || !isUuid(input.revisionId)
            || !isUuid(input.documentStateId)
            || !isNonEmptyString(input.expectedGeneration)) {
            return stateResult(null, REASON_INVALID_INPUT);
        }

        let state: ReceiptLinkRevisionRefreshState | null;
        try {
            state = await this.stateRepository.findRevisionDocumentState(
                input.branchId,
                input.clientId,
                input.revisionId,
                input.documentStateId,
            ) as ReceiptLinkRevisionRefreshState | null;
        } catch {
            return stateResult(null, REASON_STATE_NOT_FOUND);
        }
        if (!state) return stateResult(null, REASON_STATE_NOT_FOUND);
        if (state.branchId !== input.branchId
            || state.clientId !== input.clientId
            || state.serviceRecordCaseId !== input.serviceRecordCaseId
            || state.revisionId !== input.revisionId) {
            return stateResult(state, REASON_SCOPE_MISMATCH);
        }
        if (state.generation !== input.expectedGeneration) return stateResult(state, REASON_GENERATION_MISMATCH);
        if (state.operation !== RECEIPT_REFRESH_OPERATION) return stateResult(state, REASON_SCOPE_MISMATCH);

        if (state.status === "completed" || state.status === "not_required") return stateResult(state, null);
        if (["failed", "unknown", "manual_review", "capability_unverified"].includes(state.status) && !input.retry) {
            return stateResult(state, state.lastErrorCode);
        }
        if (input.retry && ["failed", "unknown", "manual_review", "capability_unverified"].includes(state.status)) {
            try {
                const retried = await this.stateRepository.retryRevisionDocumentState({
                    branchId: input.branchId,
                    clientId: input.clientId,
                    revisionId: input.revisionId,
                    stateId: state.id,
                    expectedGeneration: input.expectedGeneration,
                });
                if (!retried) return stateResult(null, REASON_STATE_CAS_LOST);
                state = retried as ReceiptLinkRevisionRefreshState;
            } catch {
                return stateResult(state, REASON_STATE_CAS_LOST);
            }
        }

        const snapshot = readSnapshot(state.immutableInput);
        if (!snapshot) return this.advanceFailure(state, STEP_CAPABILITY_UNVERIFIED, "capability_unverified", REASON_IMMUTABLE_INPUT_INVALID);
        if (snapshot.tokens.tokenIds.length === 0) {
            return this.advance(state, STEP_NOT_REQUIRED, "not_required", null);
        }
        if (!snapshot.tokens.tokenIds.every(isUuid)) {
            return this.advanceFailure(state, STEP_CAPABILITY_UNVERIFIED, "capability_unverified", REASON_IMMUTABLE_INPUT_INVALID);
        }

        const existingProof = parseOutputProof(state.outputProof);
        let artifact: PreparedArtifact;
        let proof: ReceiptLinkRevisionArtifactProof;
        let candidateStoragePath: string | null = null;
        if (existingProof) {
            artifact = existingProof.artifact;
            proof = existingProof.proof;
            if (!this.proofMatchesSnapshot(proof, snapshot, state)) {
                return this.advanceFailure(state, STEP_CAPABILITY_UNVERIFIED, "capability_unverified", REASON_IMMUTABLE_INPUT_INVALID);
            }
        } else {
            const fresh = await this.downloadFreshPdf(input, snapshot);
            if (!fresh) return this.advanceFailure(state, STEP_CAPABILITY_UNVERIFIED, "capability_unverified", REASON_PDF_SOURCE_UNAVAILABLE);
            const verification = await this.verifyFreshPdf(fresh.pdf, snapshot, input, fresh);
            if (verification.status !== "verified") {
                return this.advanceFailure(state, STEP_CAPABILITY_UNVERIFIED, "capability_unverified", `${REASON_PDF_UNVERIFIED}:${verification.reason}`);
            }
            const rendered = await this.render(fresh.pdf);
            if (!rendered) return this.advanceFailure(state, STEP_FAILED, "failed", REASON_RENDER_FAILED);
            artifact = {
                storagePath: `receipts/${safeSegment(input.branchId)}/${safeSegment(snapshot.source.documentId)}/${verification.officialPdfSha256}-${safeSegment(input.expectedGeneration)}-${randomUUID()}.png`,
                contentSha256: createHash("sha256").update(rendered).digest("hex"),
                byteSize: rendered.length,
            };
            try {
                await this.storage.upload(rendered, artifact.storagePath, "image/png");
            } catch {
                return this.advanceFailure(state, STEP_FAILED, "failed", REASON_UPLOAD_FAILED);
            }
            candidateStoragePath = artifact.storagePath;
            proof = proofForTokenRepository(verification, artifact);
            const advanced = await this.advanceWithProof(state, snapshot, proof);
            if (!advanced) {
                await this.safeDeleteCandidate(candidateStoragePath);
                return stateResult(null, REASON_STATE_CAS_LOST);
            }
            state = advanced;
        }

        const promotion = await this.promote(state, snapshot, proof, artifact, input);
        if (promotion.disposition === "promoted") {
            return stateResult({
                ...state,
                status: "completed",
                step: STEP_ARTIFACT_PROMOTED,
                version: promotion.stateVersion,
                outputProof: proof as unknown as JsonRecord,
            }, null, promotion.tokenIds);
        }
        if (promotion.disposition === "not_required") {
            return this.advance(state, STEP_NOT_REQUIRED, "not_required", null);
        }
        if (promotion.disposition === "not_found") {
            await this.safeDeleteCandidate(candidateStoragePath);
            return this.advanceFailure(state, STEP_UNKNOWN, "unknown", REASON_NO_TOKEN);
        }
        await this.safeDeleteCandidate(candidateStoragePath);
        return this.advanceFailure(state, STEP_UNKNOWN, "unknown", REASON_ARTIFACT_PROMOTION_STALE);
    }

    private async downloadFreshPdf(
        input: ReceiptLinkRevisionRefreshProcessInput,
        snapshot: ReceiptLinkRevisionRefreshSnapshot,
    ): Promise<Awaited<ReturnType<ReceiptLinkRevisionPdfSource["download"]>> | null> {
        try {
            const targetDocumentId = snapshot.source.documentId;
            const fresh = await this.pdfSource.download({
                branchId: input.branchId,
                clientId: input.clientId,
                serviceRecordCaseId: input.serviceRecordCaseId,
                revisionId: input.revisionId,
                documentStateId: input.documentStateId,
                generation: input.expectedGeneration,
                documentId: targetDocumentId,
                documentVersion: snapshot.source.documentVersion,
                templateId: snapshot.source.templateId,
                templateVersion: snapshot.source.templateVersion,
                mirrorGeneration: snapshot.source.mirrorGeneration,
                eformsignDocId: snapshot.tokens.eformsignDocId,
            });
            if (!Buffer.isBuffer(fresh.pdf)
                || fresh.documentId !== targetDocumentId
                || fresh.documentVersion !== snapshot.source.documentVersion
                || fresh.templateId !== snapshot.source.templateId
                || fresh.templateVersion !== snapshot.source.templateVersion
                || fresh.mirrorGeneration !== snapshot.source.mirrorGeneration) {
                return null;
            }
            return fresh;
        } catch {
            return null;
        }
    }

    private async verifyFreshPdf(
        pdf: Buffer,
        snapshot: ReceiptLinkRevisionRefreshSnapshot,
        input: ReceiptLinkRevisionRefreshProcessInput,
        fresh: Awaited<ReturnType<ReceiptLinkRevisionPdfSource["download"]>>,
    ): Promise<ReceiptPdfVerificationResult> {
        const scope: ReceiptPdfVerificationScope = {
            branchId: input.branchId,
            clientId: input.clientId,
            revisionId: input.revisionId,
            documentId: fresh.documentId,
            generation: input.expectedGeneration,
            mirrorGeneration: fresh.mirrorGeneration,
            templateId: fresh.templateId,
            templateVersion: fresh.templateVersion,
        };
        try {
            return await this.verifier.verify({ pdf, expected: snapshot.expected, scope });
        } catch {
            return { status: "capability_unverified", reason: "extraction_unavailable" };
        }
    }

    private async render(pdf: Buffer): Promise<Buffer | null> {
        try {
            const result = await this.rasterizer.renderPageToPng(pdf, RECEIPT_PAGE_NUMBER, { width: RECEIPT_IMAGE_WIDTH });
            return Buffer.isBuffer(result) && result.length > 0 ? result : null;
        } catch {
            return null;
        }
    }

    private proofMatchesSnapshot(
        proof: ReceiptLinkRevisionArtifactProof,
        snapshot: ReceiptLinkRevisionRefreshSnapshot,
        state: ReceiptLinkRevisionRefreshState,
    ): boolean {
        const scope = proof.scope;
        const expected = proof.expected;
        return scope["branchId"] === state.branchId
            && scope["clientId"] === state.clientId
            && scope["revisionId"] === state.revisionId
            && scope["documentId"] === snapshot.source.documentId
            && scope["generation"] === state.generation
            && scope["mirrorGeneration"] === snapshot.source.mirrorGeneration
            && scope["templateId"] === snapshot.source.templateId
            && scope["templateVersion"] === snapshot.source.templateVersion
            && expected["serviceStartDate"] === snapshot.expected.serviceStartDate
            && expected["serviceEndDate"] === snapshot.expected.serviceEndDate
            && expected["receivedDate"] === snapshot.expected.receivedDate
            && String(expected["amount"]) === String(snapshot.expected.amount);
    }

    private async advanceWithProof(
        state: ReceiptLinkRevisionRefreshState,
        snapshot: ReceiptLinkRevisionRefreshSnapshot,
        proof: ReceiptLinkRevisionArtifactProof,
    ): Promise<ReceiptLinkRevisionRefreshState | null> {
        const patch: AdvanceServiceRecordRevisionDocumentStateInput = {
            branchId: state.branchId,
            clientId: state.clientId,
            stateId: state.id,
            expectedGeneration: state.generation,
            expectedVersion: state.version,
            expectedDocumentVersion: state.documentVersion,
            expectedTargetDocumentId: state.targetDocumentId,
            expectedMirrorGeneration: state.mirrorGeneration,
            step: STEP_PROOF_READY,
            status: "processing",
            outputProof: asJsonValue(proof),
            documentVersion: snapshot.source.documentVersion,
            targetDocumentId: snapshot.source.documentId,
            mirrorGeneration: snapshot.source.mirrorGeneration,
        };
        try {
            const next = await this.stateRepository.advanceRevisionDocumentState(patch);
            return next as ReceiptLinkRevisionRefreshState | null;
        } catch {
            return null;
        }
    }

    private async promote(
        state: ReceiptLinkRevisionRefreshState,
        snapshot: ReceiptLinkRevisionRefreshSnapshot,
        proof: ReceiptLinkRevisionArtifactProof,
        artifact: PreparedArtifact,
        input: ReceiptLinkRevisionRefreshProcessInput,
    ): Promise<ReceiptLinkRevisionArtifactPromotionResult> {
        const promote = this.tokenRepository.promoteReceiptRevisionArtifact;
        if (typeof promote !== "function") {
            return { disposition: "stale", tokenIds: [], stateVersion: null };
        }
        const promotionInput: PromoteReceiptLinkRevisionArtifactInput = {
            branchId: input.branchId,
            clientId: input.clientId,
            serviceRecordCaseId: input.serviceRecordCaseId,
            revisionId: input.revisionId,
            documentStateId: state.id,
            expectedGeneration: input.expectedGeneration,
            expectedStateVersion: state.version,
            targetDocumentId: snapshot.source.documentId,
            documentVersion: snapshot.source.documentVersion,
            templateId: snapshot.source.templateId,
            templateVersion: snapshot.source.templateVersion,
            mirrorGeneration: snapshot.source.mirrorGeneration,
            eformsignDocId: snapshot.tokens.eformsignDocId,
            tokenIds: snapshot.tokens.tokenIds,
            storagePath: artifact.storagePath,
            contentSha256: artifact.contentSha256,
            byteSize: artifact.byteSize,
            proof,
        };
        try {
            return await promote.call(this.tokenRepository, promotionInput);
        } catch {
            return { disposition: "stale", tokenIds: [], stateVersion: null };
        }
    }

    private async advanceFailure(
        state: ReceiptLinkRevisionRefreshState,
        step: string,
        status: ServiceRecordRevisionDocumentStatus,
        reason: string,
    ): Promise<ReceiptLinkRevisionRefreshProcessResult> {
        return this.advance(state, step, status, reason);
    }

    private async advance(
        state: ReceiptLinkRevisionRefreshState,
        step: string,
        status: ServiceRecordRevisionDocumentStatus,
        reason: string | null,
    ): Promise<ReceiptLinkRevisionRefreshProcessResult> {
        const patch: AdvanceServiceRecordRevisionDocumentStateInput = {
            branchId: state.branchId,
            clientId: state.clientId,
            stateId: state.id,
            expectedGeneration: state.generation,
            expectedVersion: state.version,
            step,
            status,
            lastErrorCode: reason,
        };
        try {
            const next = await this.stateRepository.advanceRevisionDocumentState(patch);
            if (!next) return stateResult(null, REASON_STATE_CAS_LOST);
            return stateResult(next as ReceiptLinkRevisionRefreshState, reason);
        } catch {
            return stateResult(null, REASON_STATE_CAS_LOST);
        }
    }

    private async safeDelete(storagePath: string): Promise<void> {
        try {
            await this.storage.delete(storagePath);
        } catch {
            // The durable state/token pointer remains unchanged; cleanup can
            // reconcile an orphaned candidate without exposing it publicly.
        }
    }

    private async safeDeleteCandidate(storagePath: string | null): Promise<void> {
        if (storagePath) await this.safeDelete(storagePath);
    }
}
