import { Prisma } from "@prisma/client";
import type { ReceiptRecoveryProof } from "domain/constants/receipt-job-recovery";
import { isCancellableUnsignedContract } from "domain/utils/eformsign-customer-signature";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { ClientEntity } from "domain/entities/client.entity";
import {
    EFORMSIGN_COMPLETED_STATUS_CODES,
    EFORMSIGN_IN_PROGRESS_STATUS_CODES,
    TERMINAL_STATUS_CODES,
    isReviewerRejectedStatus,
} from "domain/constants/eformsign-doc-status.constants";
import { normalizeEformsignStatusCode, isProviderReviewWorkflowStep } from "domain/utils/eformsign-status-code";
import {
    FILE_STORAGE_PORT,
    FileStoragePort,
} from "domain/ports/file-storage.port";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import {
    EformsignDocumentMirrorState,
    EformsignStoredDocumentFile,
    EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY,
    IEformsignDocumentMirrorRepository,
} from "domain/repositories/eformsign-document-mirror.repository.interface";
import { IReceiptLinkTokenIssuanceRepository } from "domain/repositories/receipt-link-token.repository.interface";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";
import { selectCurrentContractDocument } from "application/utils/current-contract-document";
import { configuredServiceRecordTemplateIds } from "application/utils/eformsign-document-kind";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import { EformsignDocumentMirrorService } from "./eformsign-document-mirror.service";
import { normalizeBirthdayInput, ReceiptLinkSource, ReceiptLinkTokenService } from "./receipt-link-token.service";
import { SmsTriggerDeliverySkipError, type ReceiptReadiness } from "./sms-trigger-payload-enricher.registry";

export const RECEIPT_PAGE_NUMBER = 7;
export const RECEIPT_IMAGE_WIDTH = 1240;
const DEFAULT_RECEIPT_BASE_URL = "https://m.admin.babyjamjam.com";

export type ReceiptLinkSkipReason =
    | "not_voucher_client"
    | "missing_birthday"
    | "contract_not_signed"
    | "contract_voided"
    | "no_contract_document"
    | "pdf_unavailable"
    | "render_failed"
    | "upload_failed";

export const RECEIPT_LINK_SKIP_MESSAGES: Record<ReceiptLinkSkipReason, string> = {
    not_voucher_client: "바우처 이용 산모가 아닙니다",
    missing_birthday: "산모 생년월일이 등록되지 않았습니다",
    contract_not_signed: "계약서 서명이 완료된 후 발송할 수 있습니다.",
    contract_voided: "파기된 계약서입니다.",
    no_contract_document: "연결된 계약서가 없습니다",
    pdf_unavailable: "계약서 PDF를 아직 불러올 수 없습니다",
    render_failed: "영수증 이미지 생성에 실패했습니다",
    upload_failed: "영수증 이미지 저장에 실패했습니다",
};

/** An approved staged link that can no longer be delivered: expired, revoked, or no longer the client's current contract. */
export function receiptLinkUnusableError(): SmsTriggerDeliverySkipError {
    return new SmsTriggerDeliverySkipError(
        "receipt_link_unusable",
        "승인된 영수증 링크가 만료되었거나 취소되어 재시도하지 않았습니다",
    );
}

export class ReceiptLinkSkipError extends SmsTriggerDeliverySkipError {
    constructor(readonly skipReason: ReceiptLinkSkipReason, recoveryProof?: ReceiptRecoveryProof) {
        super(skipReason, RECEIPT_LINK_SKIP_MESSAGES[skipReason], recoveryProof);
        this.name = "ReceiptLinkSkipError";
    }
}

export class ReceiptLinkIssuanceConflictError extends Error {
    constructor() {
        super("Receipt link issuance is already in progress for this delivery job");
        this.name = "ReceiptLinkIssuanceConflictError";
    }
}

export interface ReceiptLinkPreflight {
    client: { id: number; name: string; phone: string | null; birthday: string };
    doc: { id: number; documentId: string };
    pdf: Buffer;
    generation?: ReceiptDocumentGeneration;
}

export interface ReceiptDocumentGeneration {
    documentId: number;
    sourceUpdatedDate: Date;
    sha256: string;
}

export interface IssueReceiptLinkParams {
    observeRecovery?: boolean;
    onPrepared?: (generation: ReceiptDocumentGeneration) => void;
    branchId: string;
    clientId: number;
    source: ReceiptLinkSource;
    jobId?: string | null;
    createdBy?: string | null;
    /** Existing delivery URL, retained for compatibility with staged payloads. */
    existingUrl?: string;
    /**
     * The exact contract document the caller already resolved (numeric `eformsign_doc.id`), when
     * one is known — e.g. a manual send pins the document the staff selected in the UI. When
     * present, `preflight` renders THIS document instead of re-deriving one from
     * the client's current contract, which can differ from the staff's selection after a contract
     * re-issue. When absent, the auto path judges the client's current contract (the one the
     * client summary shows).
     */
    eformsignDocId?: number;
}

export interface IssuedReceiptLink {
    url: string;
    tokenId: string;
    expiresAt: Date;
}

interface ContractDocumentRef {
    id: number;
    documentId: string;
}

interface PreparedReceiptLink {
    client: ReceiptLinkPreflight["client"];
    doc: ContractDocumentRef;
    png: Buffer;
    storagePath: string;
    contentSha256: string;
    generation?: ReceiptDocumentGeneration;
}

@Injectable()
export class ReceiptLinkIssueService {
    private readonly logger = new Logger(ReceiptLinkIssueService.name);
    private readonly inFlightJobIssuances = new Map<string, Promise<{
        link: IssuedReceiptLink;
        generation?: ReceiptDocumentGeneration;
    }>>();

    constructor(
        @Inject(CLIENT_REPOSITORY) private readonly clientRepository: IClientRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY) private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY)
        private readonly mirrorRepository: IEformsignDocumentMirrorRepository,
        private readonly documentMirrorService: EformsignDocumentMirrorService,
        private readonly configService: ConfigService,
        private readonly rasterizer: PdfPageRasterizerService,
        private readonly tokenService: ReceiptLinkTokenService,
        @Inject(FILE_STORAGE_PORT) private readonly storage: FileStoragePort,
    ) {}

    /** Steps 1-4 of the pipeline: voucher, birthday, contract document, mirrored PDF. No rendering. */
    async preflight(params: { branchId: string; clientId: number; eformsignDocId?: number; observeRecovery?: boolean }): Promise<ReceiptLinkPreflight> {
        const client = await this.clientRepository.findById(params.branchId, params.clientId);
        if (!client) throw new ReceiptLinkSkipError("no_contract_document");
        if (!client.voucherClient) throw new ReceiptLinkSkipError("not_voucher_client");

        // 8자리(YYYYMMDD)는 전체를 보존하고, 기존 6자리(YYMMDD)는 세기를 추론하지 않는다.
        // issue()와 같은 정규화로 사용할 수 없는 생년월일은 발급 전에 건너뛴다.
        const birthday = normalizeBirthdayInput(client.birthday ?? "");
        const automatic = params.observeRecovery === true && params.eformsignDocId === undefined;
        let doc: ContractDocumentRef | null;
        if (automatic) {
            if (client.id !== params.clientId || client.branchId !== params.branchId) {
                throw new ReceiptLinkSkipError("no_contract_document");
            }
            const facts = await this.readBoundContract(client.id, params.branchId);
            if (facts.kind === "invalid") throw new ReceiptLinkSkipError(facts.skipReason);

            const signed = facts.kind === "bound" && hasReceiptSignature(facts.state);
            const unsigned = facts.kind === "bound" && provesUnsignedContract(facts);
            if (facts.kind === "bound" && !signed && !unsigned) throw new ReceiptLinkSkipError("contract_not_signed");

            if (!birthday) {
                const proof = facts.kind === "absent" || hasKnownLiveStatuses(facts)
                    ? { reason: "missing_birthday" as const, documentId: facts.kind === "absent" ? null : facts.doc.id }
                    : undefined;
                throw new ReceiptLinkSkipError("missing_birthday", proof);
            }
            if (facts.kind === "absent") {
                throw new ReceiptLinkSkipError("no_contract_document", { reason: "missing_current_contract", documentId: null });
            }
            if (!signed) {
                throw new ReceiptLinkSkipError("contract_not_signed", { reason: "live_unsigned_contract", documentId: facts.doc.id });
            }
            doc = { id: facts.doc.id, documentId: facts.doc.documentId };
        } else {
            if (!birthday) throw new ReceiptLinkSkipError("missing_birthday");
            doc = params.eformsignDocId !== undefined
                ? await this.findExplicitContractDocument(params.branchId, params.eformsignDocId, client.id)
                : await this.findContractDocument(client);
            if (!doc) throw new ReceiptLinkSkipError("no_contract_document");
            await this.assertContractSigned(doc.documentId);
        }

        const file = await this.loadContractPdf(params.branchId, doc);
        if (!file?.content) {
            throw new ReceiptLinkSkipError("pdf_unavailable", automatic
                ? await this.observePendingPdf(client.id, params.branchId, doc).catch(() => undefined) : undefined);
        }

        // Refresh can change the signature, binding or current contract even
        // when a readable file is returned.
        if (automatic) {
            await this.assertBoundContractSigned(client.id, params.branchId, doc);
        } else {
            await this.assertContractSigned(doc.documentId);
        }

        return { client: { id: client.id, name: client.name, phone: client.phone, birthday }, doc,
            pdf: Buffer.from(file.content),
            ...(automatic && file.sourceUpdatedDate ? {
                generation: { documentId: doc.id, sourceUpdatedDate: file.sourceUpdatedDate, sha256: file.sha256 },
            } : {}),
        };
    }

    /** Fail closed: a mirror state the caller cannot read must never pass the signing gate. */
    private async resolveMirrorState(documentId: string): Promise<EformsignDocumentMirrorState | null> {
        const findState = this.mirrorRepository.findState;
        if (typeof findState !== "function") return null;
        try {
            return await findState.call(this.mirrorRepository, documentId);
        } catch {
            return null;
        }
    }

    /**
     * The customer must have finished signing before a receipt link may be
     * minted. A completed status or the provider's current review step proves
     * the signature. Rejection code 071 retains the customer's signature.
     */
    private async assertContractSigned(documentId: string): Promise<void> {
        if (!hasReceiptSignature(await this.resolveMirrorState(documentId))) throw new ReceiptLinkSkipError("contract_not_signed");
    }

    private async assertBoundContractSigned(clientId: number, branchId: string, expected: ContractDocumentRef) {
        const facts = await this.readBoundContract(clientId, branchId);
        if (facts.kind === "invalid") throw new ReceiptLinkSkipError(facts.skipReason);
        if (facts.kind !== "bound" || !sameContract(facts.doc, expected) || !hasReceiptSignature(facts.state)) {
            throw new ReceiptLinkSkipError("contract_not_signed");
        }
    }

    private async readBoundContract(clientId: number, branchId: string, transaction?: Prisma.TransactionClient) {
        const rows = transaction ? await transaction.eformsign_doc.findMany({
            where: { clientId, serviceRecordCaseId: null, OR: [{ documentKind: "contract" }, { documentKind: null }] },
            orderBy: [{ createdDate: "desc" }, { id: "desc" }],
            select: { id: true, documentId: true, branchId: true, clientId: true, documentKind: true, serviceRecordCaseId: true,
                templateId: true, statusType: true, expired: true, voidedAt: true, permanentPurgeRequestedAt: true,
                createdDate: true },
        }) : await this.eformsignDocRepository.findContractCandidatesByClientId(clientId);
        const doc = selectCurrentContractDocument(rows, configuredServiceRecordTemplateIds(this.configService));
        if (!doc) return { kind: "absent" as const };
        if (!Number.isSafeInteger(doc.id) || doc.id <= 0 || !doc.documentId || doc.clientId !== clientId
            || !matchesReceiptBranch(doc.branchId, branchId)) return invalidContract();
        if (doc.voidedAt) return invalidContract("contract_voided");
        if (doc.permanentPurgeRequestedAt) return invalidContract("no_contract_document");
        if (doc.expired !== false) return invalidContract();

        const state = transaction
            ? await this.mirrorRepository.findState(doc.documentId)
            : await this.resolveMirrorState(doc.documentId);
        if (!state || state.documentId !== doc.documentId || !matchesReceiptBranch(state.branchId, branchId)) return invalidContract();
        if (state.permanentPurgeRequestedAt) return invalidContract("no_contract_document");
        return { kind: "bound" as const, doc, state };
    }

    private async observePendingPdf(clientId: number, branchId: string, expected: ContractDocumentRef): Promise<ReceiptRecoveryProof | undefined> {
        const facts = await this.readBoundContract(clientId, branchId);
        if (facts.kind !== "bound" || !sameContract(facts.doc, expected) || !hasKnownLiveStatuses(facts)
            || !hasReceiptSignature(facts.state) || !isSyncingGeneration(facts.state)) return;
        if (await this.mirrorRepository.findFile(facts.doc.documentId, "document")) return;
        // A successful local read of the absence must still describe the same signed generation.
        const current = await this.readBoundContract(clientId, branchId);
        if (current.kind !== "bound" || !sameContract(current.doc, facts.doc) || !hasKnownLiveStatuses(current)
            || !hasReceiptSignature(current.state) || !isSyncingGeneration(current.state)
            || current.state.detailSourceUpdatedDate!.getTime() !== facts.state.detailSourceUpdatedDate!.getTime()
            || current.state.detailSyncedAt!.getTime() !== facts.state.detailSyncedAt!.getTime()) return;
        return { reason: "current_contract_pdf_pending", documentId: facts.doc.id };
    }

    /** Read only committed local evidence. The caller holds the branch and client locks. */
    async checkRecovery(branchId: string, clientId: number, documentId: number | null,
        transaction: Prisma.TransactionClient, prepared?: ReceiptDocumentGeneration | "legacy"): Promise<ReceiptReadiness> {
        const client = await transaction.client.findFirst({ where: { id: clientId, branchId, deletedAt: null },
            select: { voucherClient: true, birthday: true } });
        if (!client?.voucherClient) return { kind: "terminal" };
        // Include non-candidates as their next committed version could become current.
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM eformsign_doc WHERE client_id = ${clientId} ORDER BY id FOR UPDATE`);
        try {
            const facts = await this.readBoundContract(clientId, branchId, transaction);
            if (facts.kind === "invalid") return { kind: "terminal" };
            if (facts.kind === "absent") return { kind: documentId === null && !prepared ? "waiting" : "terminal" };
            const generation = prepared === "legacy" ? undefined : prepared;
            if ((documentId !== null && facts.doc.id !== documentId) || (generation && facts.doc.id !== generation.documentId)) return { kind: "terminal" };
            const signed = hasReceiptSignature(facts.state);
            if (!signed && !provesUnsignedContract(facts)) return { kind: "terminal" };
            if (!signed || !normalizeBirthdayInput(client.birthday ?? "")) return { kind: prepared ? "terminal" : "waiting" };
            const file = await this.mirrorRepository.findFile(facts.doc.documentId, "document");
            if (!file?.content) return { kind: !prepared && isSyncingGeneration(facts.state) ? "waiting" : "terminal" };
            if (generation && (file.sourceUpdatedDate?.getTime() !== generation.sourceUpdatedDate.getTime()
                || file.sha256 !== generation.sha256)) return { kind: "terminal" };
            return { kind: "ready", documentId: facts.doc.id };
        } catch (error) {
            if (!prepared) throw error;
            return { kind: "terminal" };
        }
    }

    /**
     * Recheck the CURRENT mirror generation's contract document file without
     * rendering or issuing a token. Delivery callers use this immediately
     * before an SMS authorization boundary so a sync that superseded the
     * preflight cannot publish its old image: `findFile` answers only when the
     * locally stored file still matches the mirror's live detail version.
     */
    async assertDocumentSyncReady(
        target:
            | string
            | {
                  branchId: string;
                  clientId: number;
                  eformsignDocId?: number;
                  /**
                   * AUTO delivery only (no pinned `eformsignDocId`): the document (eformsign_doc.id)
                   * the already-approved artifact was rendered from. It must still be the client's
                   * current contract — a fact verified about the current contract must never
                   * authorize an artifact of an older one. Ignored for a pinned document.
                   */
                  expectedEformsignDocId?: number;
                  automatic?: boolean;
              },
        recoveryTarget?: { branchId: string; clientId: number; document: ContractDocumentRef },
    ): Promise<void> {
        try {
            let documentId: string | null = typeof target === "string" ? target : null;
            if (typeof target === "string") {
                const local = await this.eformsignDocRepository.findByDocumentIdUnscoped(target);
                if (local?.document.isVoided) throw new ReceiptLinkSkipError("contract_voided");
            }
            if (typeof target !== "string") {
                const client = await this.clientRepository.findById(target.branchId, target.clientId);
                let doc: ContractDocumentRef | null;
                if (target.automatic && target.eformsignDocId === undefined) {
                    if (!client?.voucherClient || client.id !== target.clientId || client.branchId !== target.branchId) {
                        throw new ReceiptLinkSkipError("no_contract_document");
                    }
                    const facts = await this.readBoundContract(client.id, target.branchId);
                    if (facts.kind === "invalid") throw new ReceiptLinkSkipError(facts.skipReason);
                    doc = facts.kind === "bound" ? facts.doc : null;
                } else {
                    doc = client
                        ? target.eformsignDocId !== undefined
                            ? await this.findExplicitContractDocument(target.branchId, target.eformsignDocId, client.id)
                            : await this.findContractDocument(client)
                        : null;
                }
                if (
                    doc
                    && target.eformsignDocId === undefined
                    && target.expectedEformsignDocId !== undefined
                    && doc.id !== target.expectedEformsignDocId
                ) {
                    throw receiptLinkUnusableError();
                }
                documentId = doc?.documentId ?? null;
            }
            if (!documentId) throw new ReceiptLinkSkipError("no_contract_document");
            const file: EformsignStoredDocumentFile | null =
                await this.mirrorRepository.findFile(documentId, "document");
            if (!file?.content) throw new ReceiptLinkSkipError("pdf_unavailable", recoveryTarget
                ? await this.observePendingPdf(recoveryTarget.clientId, recoveryTarget.branchId, recoveryTarget.document).catch(() => undefined)
                : undefined);
            if (typeof target !== "string" && target.automatic && target.eformsignDocId === undefined) {
                const expectedId = target.expectedEformsignDocId;
                if (expectedId === undefined) throw receiptLinkUnusableError();
                await this.assertBoundContractSigned(target.clientId, target.branchId, { id: expectedId, documentId });
            } else {
                await this.assertContractSigned(documentId);
            }
        } catch (error) {
            // SmsTriggerDeliverySkipError covers ReceiptLinkSkipError and the staged-link
            // refusal (receipt_link_unusable); both are definite answers, not an unreadable PDF.
            if (error instanceof SmsTriggerDeliverySkipError) throw error;
            throw new ReceiptLinkSkipError("pdf_unavailable");
        }
    }

    /** Refresh the contract's stable URL; overlapping retries in this process share preparation. */
    async issue(params: IssueReceiptLinkParams): Promise<IssuedReceiptLink> {
        const jobId = params.jobId;
        if (!jobId) {
            const prepared = await this.prepare(params);
            const link = await this.mint(params, prepared);
            if (prepared.generation) params.onPrepared?.(prepared.generation);
            return link;
        }

        let issuance = this.inFlightJobIssuances.get(jobId);
        if (!issuance) {
            issuance = this.issueForJob(params);
            this.inFlightJobIssuances.set(jobId, issuance);
        }
        try {
            const { link, generation } = await issuance;
            if (generation) params.onPrepared?.(generation);
            return link;
        } finally {
            if (this.inFlightJobIssuances.get(jobId) === issuance) {
                this.inFlightJobIssuances.delete(jobId);
            }
        }
    }

    private async issueForJob(params: IssueReceiptLinkParams) {
        // Every dispatch refreshes the same contract token and expiry, including stale retries.
        // No job may replace or revoke a link already delivered by another job.
        const prepared = await this.prepare(params);
        return { link: await this.mint(params, prepared), generation: prepared.generation };
    }

    private async prepare(params: IssueReceiptLinkParams): Promise<PreparedReceiptLink> {
        const { client, doc, pdf, generation } = await this.preflight(params);
        if (params.observeRecovery && params.eformsignDocId === undefined) {
            await this.assertDocumentSyncReady({
                branchId: params.branchId, clientId: params.clientId, expectedEformsignDocId: doc.id, automatic: true,
            }, { branchId: params.branchId, clientId: params.clientId, document: doc });
        } else {
            await this.assertDocumentSyncReady(doc.documentId);
        }
        let png: Buffer;
        try {
            png = await this.rasterizer.renderPageToPng(pdf, RECEIPT_PAGE_NUMBER, { width: RECEIPT_IMAGE_WIDTH });
        } catch (error) {
            this.logger.error(`[ReceiptLink] render failed for document ${doc.documentId}: ${describe(error)}`);
            throw new ReceiptLinkSkipError("render_failed");
        }

        const contentSha256 = createHash("sha256").update(png).digest("hex");
        // Each issuance owns its immutable image. Cleanup may already have captured
        // the former path; never reuse that object for a newly published stable URL.
        const storagePath = `receipts/${params.branchId}/${doc.id}/${contentSha256}-${randomUUID()}.png`;
        try {
            await this.storage.upload(png, storagePath, "image/png");
        } catch (error) {
            this.logger.error(`[ReceiptLink] upload failed for ${storagePath}: ${describe(error)}`);
            throw new ReceiptLinkSkipError("upload_failed");
        }

        return { client, doc, png, storagePath, contentSha256, generation };
    }

    private async mint(
        params: IssueReceiptLinkParams,
        prepared: PreparedReceiptLink,
        issuanceRepository?: IReceiptLinkTokenIssuanceRepository,
    ): Promise<IssuedReceiptLink> {
        const { client, doc, png, storagePath, contentSha256 } = prepared;
        const issueParams = {
            branchId: params.branchId,
            clientId: client.id,
            eformsignDocId: doc.id,
            jobId: params.jobId ?? null,
            birthday: client.birthday,
            storagePath,
            contentSha256,
            byteSize: png.length,
            source: params.source,
            createdBy: params.createdBy ?? null,
        };
        const token = issuanceRepository
            ? await this.tokenService.issue(issueParams, issuanceRepository)
            : await this.tokenService.issue(issueParams);

        return { url: this.buildReceiptUrl(token.linkToken), tokenId: token.id, expiresAt: token.expiresAt };
    }

    buildReceiptUrl(linkToken: string): string {
        const base =
            this.configService.get<string>("MOBILE_RECEIPT_BASE_URL")
            || this.configService.get<string>("MOBILE_SERVICE_RECORD_BASE_URL")
            || DEFAULT_RECEIPT_BASE_URL;
        return `${base.replace(/\/+$/, "")}/receipt/${linkToken}`;
    }

    /**
     * The AUTO path's contract: the client's CURRENT contract by the exact rule the client
     * summary uses (`selectCurrentContractDocument`) over the exact same row set
     * (`findContractCandidatesByClientId`). `client.eDocId` is deliberately not consulted: it can
     * lag behind a re-issued contract, and a receipt must never be minted from an older signed
     * contract while the screen shows the newer one still waiting for a signature. A
     * purge-requested current contract fails closed (`null` -> no_contract_document).
     */
    private async findContractDocument(client: ClientEntity): Promise<ContractDocumentRef | null> {
        const rows = await this.eformsignDocRepository.findContractCandidatesByClientId(client.id);
        const current = selectCurrentContractDocument(
            rows,
            configuredServiceRecordTemplateIds(this.configService),
        );
        if (current?.voidedAt != null) throw new ReceiptLinkSkipError("contract_voided");
        if (!current || current.permanentPurgeRequestedAt != null) return null;
        return { id: current.id, documentId: current.documentId };
    }

    /**
     * The explicit-selection counterpart to `findContractDocument`: resolves exactly the
     * document the caller named (by numeric id), requiring it to actually be a contract
     * belonging to this client. Never falls back to client.eDocId or the newest contract — an
     * explicit selection that doesn't check out is `no_contract_document`, not a silent
     * substitution.
     */
    private async findExplicitContractDocument(
        branchId: string,
        eformsignDocId: number,
        clientId: number,
    ): Promise<ContractDocumentRef | null> {
        const doc = await this.eformsignDocRepository.findById(branchId, eformsignDocId);
        if (!doc || doc.id === undefined || doc.documentKind !== "contract" || doc.clientId !== clientId) {
            return null;
        }
        if (doc.isVoided) throw new ReceiptLinkSkipError("contract_voided");
        return { id: doc.id, documentId: doc.documentId };
    }

    private async loadContractPdf(branchId: string, doc: ContractDocumentRef): Promise<EformsignStoredDocumentFile | null> {
        const stored = await this.findStoredPdf(doc.documentId);
        if (stored) return stored;

        try {
            await this.documentMirrorService.syncDocument(
                doc.documentId,
                { branchId, source: "worker" },
                {
                    skipBranchOwnedProjection: true,
                    skipClientReconciliation: true,
                    skipHealthySameVersionFileRepair: true,
                    suppressOutboundAutomation: true,
                },
            );
        } catch (error) {
            this.logger.warn(
                `[ReceiptLink] mirror re-sync failed for ${doc.documentId}: ${sanitizeEformsignErrorMessage(error)}`,
            );
            return null;
        }
        return this.findStoredPdf(doc.documentId);
    }

    private async findStoredPdf(documentId: string): Promise<EformsignStoredDocumentFile | null> {
        return this.mirrorRepository.findFile(documentId, "document");
    }
}

function hasReceiptSignature(state: EformsignDocumentMirrorState | null): boolean {
    const current = state?.detailPayload?.current_status;
    const statusType = normalizeEformsignStatusCode(current?.status_type);
    // 071 explicitly retains the customer's signature after reviewer rejection.
    if (EFORMSIGN_COMPLETED_STATUS_CODES.has(statusType) || isReviewerRejectedStatus(statusType)) return true;
    if (TERMINAL_STATUS_CODES.has(statusType)) return false;
    return isProviderReviewWorkflowStep(current ? { stepType: current.step_type, stepName: current.step_name } : null);
}

function invalidContract(skipReason: ReceiptLinkSkipReason = "contract_not_signed") {
    return { kind: "invalid" as const, skipReason };
}

function matchesReceiptBranch(branch: string | null, expected: string): boolean {
    return branch === null || branch === expected;
}

function sameContract(actual: ContractDocumentRef, expected: ContractDocumentRef): boolean {
    return actual.id === expected.id && actual.documentId === expected.documentId;
}

function hasKnownLiveStatuses(facts: { doc: { statusType: string }; state: EformsignDocumentMirrorState }): boolean {
    const known = (status: string) => EFORMSIGN_COMPLETED_STATUS_CODES.has(status) || EFORMSIGN_IN_PROGRESS_STATUS_CODES.has(status);
    return known(normalizeEformsignStatusCode(facts.doc.statusType))
        && known(normalizeEformsignStatusCode(facts.state.detailPayload?.current_status?.status_type));
}

function provesUnsignedContract(facts: { doc: { statusType: string }; state: EformsignDocumentMirrorState }): boolean {
    const status = facts.state.detailPayload?.current_status;
    return hasKnownLiveStatuses(facts) && isCancellableUnsignedContract({
        statusType: normalizeEformsignStatusCode(status?.status_type),
        stepType: status?.step_type ?? null,
        stepName: status?.step_name ?? null,
    });
}

function isSyncingGeneration(state: EformsignDocumentMirrorState): boolean {
    return state.syncStatus === "syncing" && state.syncError === null && state.permanentPurgeRequestedAt === null
        && state.detailSourceUpdatedDate !== null && state.detailSyncedAt !== null;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
