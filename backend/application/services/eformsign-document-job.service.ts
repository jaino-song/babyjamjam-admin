import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";

import { ContractDataDto } from "application/dto/contract.dto";
import type { StaffCompletionPrefillAmounts } from "application/services/eformsign.service";
import {
    EformsignDocumentJobPayload,
    EformsignDocumentJobSource,
} from "domain/entities/eformsign-document-job.entity";
import {
    EFORMSIGN_DOCUMENT_JOB_REPOSITORY,
    ClaimRecoveryResult,
    EformsignDocumentJobList,
    EformsignDocumentJobSummary,
    AuthorizeEformsignDocumentJobForDispatchInput,
    IEformsignDocumentJobRepository,
    ManualRecoveryInput,
    ResolveManuallyResult,
} from "domain/repositories/eformsign-document-job.repository.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { assertRequiredPhone, invalidPhoneFieldMessage, InvalidPhoneError } from "application/utils/normalize-phone";
import type { ServiceRecordDispatchAuthorizationResult } from "@babyjamjam/shared/types/service-record";

export interface EnqueueCreateDocumentParams {
    branchId: string;
    clientId: number;
    contractData: ContractDataDto;
    requestKey: string;
    source?: EformsignDocumentJobSource;
    progressId?: string;
    force?: boolean;
    /** The contract this re-issue replaces; the worker cancels it once the new one is sent. */
    supersedeDocumentId?: string;
    createdByUserId?: string | null;
}

export interface EnqueueFinalizeDocumentParams {
    branchId: string;
    documentId: string;
    requestKey: string;
    prefillEndDate?: string;
    prefillAmounts?: StaffCompletionPrefillAmounts;
    progressId?: string;
    source: EformsignDocumentJobSource;
    createdByUserId?: string | null;
}

export interface EnqueueDocumentJobResult {
    job: Awaited<ReturnType<IEformsignDocumentJobRepository["enqueue"]>>["job"];
    existing: boolean;
}

/**
 * Caller-owned transaction boundary used by atomic service-record confirm
 * and finalization. The payload is already server-derived; this method never
 * opens a nested transaction or performs a provider/client lookup.
 */
export interface EnqueueEformsignDocumentJobInTransactionParams {
    branchId: string;
    clientId?: number | null;
    documentId?: string | null;
    jobType: "create_document" | "finalize_document";
    source: EformsignDocumentJobSource;
    requestKey: string;
    activeKey: string;
    payload: EformsignDocumentJobPayload;
    payloadFingerprint: string;
    createdByUserId?: string | null;
}

const MAX_SERVICE_PERIOD_LENGTH = 64;

/**
 * The one rule set for a staff-completion prefill, shared by enqueue and the
 * worker's payload parser so a value accepted at enqueue is never rejected by
 * the worker. `undefined` when absent, `null` when present but malformed.
 */
export function parsePrefillAmounts(raw: unknown): StaffCompletionPrefillAmounts | undefined | null {
    if (raw === undefined) return undefined;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const a = raw as Record<string, unknown>;
    const isAmount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
    if (!isAmount(a["fullPrice"]) || !isAmount(a["grant"]) || !isAmount(a["actualPrice"])) return null;
    const servicePeriod = a["servicePeriod"];
    if (servicePeriod !== undefined) {
        if (
            typeof servicePeriod !== "string"
            || servicePeriod.trim().length === 0
            || servicePeriod.length > MAX_SERVICE_PERIOD_LENGTH
        ) {
            return null;
        }
    }
    return {
        fullPrice: a["fullPrice"],
        grant: a["grant"],
        actualPrice: a["actualPrice"],
        ...(servicePeriod !== undefined ? { servicePeriod: servicePeriod as string } : {}),
    };
}

function assertContractDataPhones(contractData: ContractDataDto): void {
    const fields: Array<[string, unknown, boolean]> = [
        ["customerContact", contractData.customerContact, true],
        ["caretaker1Contact", contractData.caretaker1Contact, true],
        ["issuerPhone", contractData.issuerPhone, false],
    ];

    for (const [field, value, required] of fields) {
        if (!required && (value === undefined || value === null)) continue;
        try {
            assertRequiredPhone(value as string | null | undefined);
        } catch (error) {
            if (error instanceof InvalidPhoneError) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: `/contractData/${field}`,
                    code: "INVALID_VALUE",
                    detail: invalidPhoneFieldMessage(field),
                    location: "body",
                }));
            }
            throw error;
        }
    }
}

/**
 * Application boundary for durable eformsign work.
 *
 * The job table intentionally stores only resume input. Credentials, provider
 * responses, and the request body are never written to logs by this service.
 */
@Injectable()
export class EformsignDocumentJobService {
    constructor(
        @Inject(EFORMSIGN_DOCUMENT_JOB_REPOSITORY)
        private readonly repository: IEformsignDocumentJobRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async enqueueCreateDocument(
        params: EnqueueCreateDocumentParams,
    ): Promise<EnqueueDocumentJobResult> {
        const client = await this.clientRepository.findById(params.branchId, params.clientId);
        if (!client) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        // Validate the durable payload before inserting a resumable job. The
        // controller DTO normally performs this check, but this service is
        // also called by internal retry/repair paths and must not persist an
        // identity value that cannot be canonicalized.
        assertContractDataPhones(params.contractData);
        const payload: EformsignDocumentJobPayload = {
            clientId: params.clientId,
            contractData: params.contractData,
            ...(params.progressId ? { progressId: params.progressId } : {}),
            ...(params.force === true ? { force: true } : {}),
            ...(params.supersedeDocumentId ? { supersedeDocumentId: params.supersedeDocumentId } : {}),
        };

        return this.repository.enqueue({
            branchId: params.branchId,
            clientId: params.clientId,
            jobType: "create_document",
            source: params.source ?? "staff",
            requestKey: params.requestKey,
            activeKey: `create:${params.branchId}:${params.clientId}`,
            payload,
            payloadFingerprint: sha256CanonicalJson(payload),
            createdByUserId: params.createdByUserId,
        });
    }

    async enqueueFinalizeDocument(
        params: EnqueueFinalizeDocumentParams,
    ): Promise<EnqueueDocumentJobResult> {
        const document = await this.eformsignDocRepository.findByDocumentId(
            params.branchId,
            params.documentId,
        );
        if (!document) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        // A voided (파기) contract is never finalized. A job queued before the void is stopped by
        // FinalizeDocumentHeadlessUsecase.assertOwnedTarget when it runs.
        if (document.isVoided) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        if (params.prefillAmounts !== undefined && parsePrefillAmounts(params.prefillAmounts) === null) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/prefillAmounts",
                code: "INVALID_VALUE",
                detail: "금액은 0 이상의 정수여야 하고, 이용기간은 비어 있지 않은 64자 이하 문자열이어야 해요",
                location: "body",
            }));
        }
        const payload: EformsignDocumentJobPayload = {
            documentId: params.documentId,
            ...(params.prefillEndDate ? { prefillEndDate: params.prefillEndDate } : {}),
            ...(params.prefillAmounts ? { prefillAmounts: params.prefillAmounts } : {}),
            ...(params.progressId ? { progressId: params.progressId } : {}),
        };

        return this.repository.enqueue({
            branchId: params.branchId,
            clientId: document.clientId ?? null,
            documentId: params.documentId,
            jobType: "finalize_document",
            source: params.source,
            requestKey: params.requestKey,
            activeKey: `finalize:${params.documentId}`,
            payload,
            payloadFingerprint: sha256CanonicalJson(payload),
            createdByUserId: params.createdByUserId,
        });
    }

    /**
     * Enqueue a provider intent without escaping the caller's transaction.
     * Authorization and ownership are deliberately the caller's
     * responsibility; no root repository or external API is reached here.
     */
    async enqueueInTransaction(
        tx: Prisma.TransactionClient,
        params: EnqueueEformsignDocumentJobInTransactionParams,
    ): Promise<EnqueueDocumentJobResult> {
        return this.repository.enqueueInTransaction(tx, {
            branchId: params.branchId,
            clientId: params.clientId,
            documentId: params.documentId,
            jobType: params.jobType,
            source: params.source,
            requestKey: params.requestKey,
            activeKey: params.activeKey,
            payload: params.payload,
            payloadFingerprint: params.payloadFingerprint,
            createdByUserId: params.createdByUserId,
        });
    }

    /**
     * Resolve a stable request key without opening a nested transaction. The
     * caller uses this only to replay an immutable generation payload; no
     * mutable case/client data is read by this seam.
     */
    async findByRequestKeyInTransaction(
        tx: Prisma.TransactionClient,
        requestKey: string,
    ) {
        return this.repository.findByRequestKeyInTransaction(tx, requestKey);
    }

    /**
     * Authorize the irreversible provider boundary inside the transaction
     * owned by the caller. The repository locks and rereads the job, verifies
     * the lease/context, and commits the durable `creating` marker before a
     * worker is allowed to invoke a provider.
     */
    async authorizeForDispatchInTransaction(
        tx: Prisma.TransactionClient,
        input: AuthorizeEformsignDocumentJobForDispatchInput,
    ): Promise<ServiceRecordDispatchAuthorizationResult> {
        return this.repository.authorizeForDispatchInTransaction(tx, input);
    }

    async getSummary(branchId: string): Promise<EformsignDocumentJobSummary> {
        return this.repository.getSummary(branchId);
    }

    async listForBranch(
        branchId: string,
        terminalSince = new Date(0),
        terminalLimit?: number,
    ): Promise<EformsignDocumentJobList> {
        return this.repository.listForBranch(branchId, terminalSince, terminalLimit);
    }

    /** Take the manual-recovery claim on a failed/requires_attention staff contract job. */
    async claimRecovery(input: ManualRecoveryInput): Promise<ClaimRecoveryResult> {
        return this.repository.claimRecovery(input);
    }

    /** Record that staff finished a stuck staff contract job by hand. */
    async resolveManually(input: ManualRecoveryInput): Promise<ResolveManuallyResult> {
        return this.repository.resolveManually(input);
    }

    /** Drop the retained payload of contract jobs that stayed in requires_attention for 7 days. */
    async purgeExpiredAttentionPayloads(now: Date): Promise<number> {
        return this.repository.purgeExpiredAttentionPayloads(now);
    }

    async listRecentStaffFailures(since: Date) {
        return this.repository.listRecentStaffFailures(since);
    }
}

export function sha256CanonicalJson(value: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(canonicalize(value)))
        .digest("hex");
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, canonicalize(nested)]),
        );
    }
    return value;
}
