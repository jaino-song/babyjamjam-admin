import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { ClientEntity } from "domain/entities/client.entity";
import {
    EFORMSIGN_COMPLETED_STATUS_CODES,
    TERMINAL_STATUS_CODES,
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
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import { EformsignDocumentMirrorService } from "./eformsign-document-mirror.service";
import { normalizeBirthdayInput, ReceiptLinkSource, ReceiptLinkTokenService } from "./receipt-link-token.service";
import { SmsTriggerDeliverySkipError } from "./sms-trigger-payload-enricher.registry";

export const RECEIPT_PAGE_NUMBER = 7;
export const RECEIPT_IMAGE_WIDTH = 1240;
const DEFAULT_RECEIPT_BASE_URL = "https://m.admin.babyjamjam.com";

export type ReceiptLinkSkipReason =
    | "not_voucher_client"
    | "missing_birthday"
    | "contract_not_signed"
    | "no_contract_document"
    | "pdf_unavailable"
    | "render_failed"
    | "upload_failed";

export const RECEIPT_LINK_SKIP_MESSAGES: Record<ReceiptLinkSkipReason, string> = {
    not_voucher_client: "바우처 이용 산모가 아닙니다",
    missing_birthday: "산모 생년월일이 등록되지 않았습니다",
    contract_not_signed: "계약서 서명이 완료된 후 발송할 수 있습니다.",
    no_contract_document: "연결된 계약서가 없습니다",
    pdf_unavailable: "계약서 PDF를 아직 불러올 수 없습니다",
    render_failed: "영수증 이미지 생성에 실패했습니다",
    upload_failed: "영수증 이미지 저장에 실패했습니다",
};

export class ReceiptLinkSkipError extends SmsTriggerDeliverySkipError {
    constructor(readonly skipReason: ReceiptLinkSkipReason) {
        super(skipReason, RECEIPT_LINK_SKIP_MESSAGES[skipReason]);
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
}

export interface IssueReceiptLinkParams {
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
     * `client.eDocId`/newest-contract, which can point elsewhere after a contract re-issue. When
     * absent, the client-derived auto path is unchanged.
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
}

@Injectable()
export class ReceiptLinkIssueService {
    private readonly logger = new Logger(ReceiptLinkIssueService.name);
    private readonly inFlightJobIssuances = new Map<string, Promise<IssuedReceiptLink>>();

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
    async preflight(params: { branchId: string; clientId: number; eformsignDocId?: number }): Promise<ReceiptLinkPreflight> {
        const client = await this.clientRepository.findById(params.branchId, params.clientId);
        if (!client) throw new ReceiptLinkSkipError("no_contract_document");
        if (!client.voucherClient) throw new ReceiptLinkSkipError("not_voucher_client");

        // normalizeBirthdayInput accepts both 6-digit (YYMMDD) and 8-digit (YYYYMMDD) input and
        // returns the canonical 6-digit form — the same normalization issue() relies on, so a
        // birthday that would fail there must be caught here instead, not just an empty one.
        const birthday = normalizeBirthdayInput(client.birthday ?? "");
        if (!birthday) throw new ReceiptLinkSkipError("missing_birthday");

        const doc = params.eformsignDocId !== undefined
            ? await this.findExplicitContractDocument(params.branchId, params.eformsignDocId, client.id)
            : await this.findContractDocument(params.branchId, client);
        if (!doc) throw new ReceiptLinkSkipError("no_contract_document");

        // The receipt link may only be minted once the customer has finished
        // signing: from the provider-review step onward, or any completed
        // status. Fail closed when the mirror cannot prove either.
        await this.assertContractSigned(doc.documentId);

        // Load (and if needed re-sync) the contract PDF. findFile itself fences
        // superseded generations, so a partial/ready mirror whose current-version
        // document file is unreadable still fails closed here. The sync-ready
        // gate is re-run at the delivery boundary (prepare()/assertDocumentSyncReady).
        const pdf = await this.loadContractPdf(params.branchId, doc);
        if (!pdf) throw new ReceiptLinkSkipError("pdf_unavailable");

        // A re-sync may have refreshed the mirror to a terminal status while
        // still returning a readable PDF. Recheck before the preflight can
        // authorize rendering and publication.
        await this.assertContractSigned(doc.documentId);

        return { client: { id: client.id, name: client.name, phone: client.phone, birthday }, doc, pdf };
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
     * minted. True either when the mirrored status is a completed code or
     * when the current workflow step is the provider's review/confirmation
     * step (only current after the client signature). Terminal codes are
     * excluded BEFORE the step check: a rejected/expired document keeps the
     * provider-review step as its last step, so the step alone cannot prove
     * a live signature. Anything earlier (drafting, participant request),
     * any unprovable state, and terminal codes fall closed to
     * `contract_not_signed`.
     */
    private async assertContractSigned(documentId: string): Promise<void> {
        const state = await this.resolveMirrorState(documentId);
        const currentStatus = state?.detailPayload?.current_status ?? null;
        const statusType = normalizeEformsignStatusCode(currentStatus?.status_type);
        if (EFORMSIGN_COMPLETED_STATUS_CODES.has(statusType)) return;
        // Terminal-but-not-completed here means rejected/revoked/deleted/expired.
        if (TERMINAL_STATUS_CODES.has(statusType)) throw new ReceiptLinkSkipError("contract_not_signed");
        const signedOrLater = isProviderReviewWorkflowStep(
            currentStatus ? { stepType: currentStatus.step_type, stepName: currentStatus.step_name } : null,
        );
        if (!signedOrLater) throw new ReceiptLinkSkipError("contract_not_signed");
    }

    /**
     * Recheck the CURRENT mirror generation's contract document file without
     * rendering or issuing a token. Delivery callers use this immediately
     * before an SMS authorization boundary so a sync that superseded the
     * preflight cannot publish its old image: `findFile` answers only when the
     * locally stored file still matches the mirror's live detail version.
     */
    async assertDocumentSyncReady(
        target: string | { branchId: string; clientId: number; eformsignDocId?: number },
    ): Promise<void> {
        try {
            let documentId: string | null = typeof target === "string" ? target : null;
            if (typeof target !== "string") {
                const client = await this.clientRepository.findById(target.branchId, target.clientId);
                const doc = client
                    ? target.eformsignDocId !== undefined
                        ? await this.findExplicitContractDocument(target.branchId, target.eformsignDocId, client.id)
                        : await this.findContractDocument(target.branchId, client)
                    : null;
                documentId = doc?.documentId ?? null;
            }
            if (!documentId) throw new ReceiptLinkSkipError("no_contract_document");
            const file: EformsignStoredDocumentFile | null =
                await this.mirrorRepository.findFile(documentId, "document");
            if (!file) throw new ReceiptLinkSkipError("pdf_unavailable");
            await this.assertContractSigned(documentId);
        } catch (error) {
            if (error instanceof ReceiptLinkSkipError) throw error;
            throw new ReceiptLinkSkipError("pdf_unavailable");
        }
    }

    /** Refresh the contract's stable URL; overlapping retries in this process share preparation. */
    async issue(params: IssueReceiptLinkParams): Promise<IssuedReceiptLink> {
        const jobId = params.jobId;
        if (!jobId) {
            const prepared = await this.prepare(params);
            return this.mint(params, prepared);
        }

        const inFlight = this.inFlightJobIssuances.get(jobId);
        if (inFlight) return inFlight;

        const issuance = this.issueForJob({ ...params, jobId });
        this.inFlightJobIssuances.set(jobId, issuance);
        try {
            return await issuance;
        } finally {
            if (this.inFlightJobIssuances.get(jobId) === issuance) {
                this.inFlightJobIssuances.delete(jobId);
            }
        }
    }

    private async issueForJob(params: IssueReceiptLinkParams & { jobId: string }): Promise<IssuedReceiptLink> {
        // Every dispatch refreshes the same contract token and expiry, including stale retries.
        // No job may replace or revoke a link already delivered by another job.
        return this.mint(params, await this.prepare(params));
    }

    private async prepare(params: IssueReceiptLinkParams): Promise<PreparedReceiptLink> {
        const { client, doc, pdf } = await this.preflight(params);
        await this.assertDocumentSyncReady(doc.documentId);

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

        return { client, doc, png, storagePath, contentSha256 };
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

    private async findContractDocument(branchId: string, client: ClientEntity): Promise<ContractDocumentRef | null> {
        if (client.eDocId) {
            const byEDocId = await this.eformsignDocRepository.findByDocumentId(branchId, client.eDocId);
            if (
                byEDocId
                && byEDocId.id !== undefined
                && byEDocId.documentKind === "contract"
                && byEDocId.clientId === client.id
            ) {
                return { id: byEDocId.id, documentId: byEDocId.documentId };
            }
        }

        const docs = await this.eformsignDocRepository.findByClientId(branchId, client.id);
        const latest = docs
            .filter((doc) => doc.documentKind === "contract" && doc.id !== undefined)
            .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime())[0];
        return latest ? { id: latest.id as number, documentId: latest.documentId } : null;
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
        return { id: doc.id, documentId: doc.documentId };
    }

    private async loadContractPdf(branchId: string, doc: ContractDocumentRef): Promise<Buffer | null> {
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

    private async findStoredPdf(documentId: string): Promise<Buffer | null> {
        const file = await this.mirrorRepository.findFile(documentId, "document");
        return file?.content ? Buffer.from(file.content) : null;
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
