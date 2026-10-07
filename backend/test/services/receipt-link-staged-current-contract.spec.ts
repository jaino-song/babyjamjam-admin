import { ConfigService } from "@nestjs/config";
import { ClientEntity } from "domain/entities/client.entity";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { FileStoragePort } from "domain/ports/file-storage.port";
import { IClientRepository } from "domain/repositories/client.repository.interface";
import { IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import {
    EformsignDocumentMirrorState,
    EformsignStoredDocumentFile,
    IEformsignDocumentMirrorRepository,
} from "domain/repositories/eformsign-document-mirror.repository.interface";
import {
    IReceiptLinkTokenRepository,
    ReceiptLinkTokenRecord,
} from "domain/repositories/receipt-link-token.repository.interface";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { ReceiptLinkIssueService } from "application/services/receipt-link-issue.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { SmsTriggerPayloadEnricherRegistry } from "application/services/sms-trigger-payload-enricher.registry";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";

const BRANCH = "11111111-1111-1111-1111-111111111111";
const LINK_TOKEN = "efr_stagedlinkA";
const RECEIPT_URL = `https://m.admin.example/receipt/${LINK_TOKEN}`;
const A_STORAGE_PATH = "receipts/contract-A.png";

interface ContractFixture {
    id: number;
    documentId: string;
    createdDate: Date;
    signed: boolean;
}

const CONTRACT_A: ContractFixture = { id: 10, documentId: "doc-A", createdDate: new Date("2026-01-01"), signed: true };
const CONTRACT_B: ContractFixture = { id: 20, documentId: "doc-B", createdDate: new Date("2026-02-01"), signed: true };

function mirrorState(contract: ContractFixture): Partial<EformsignDocumentMirrorState> {
    const status = contract.signed
        ? { status_type: "070", step_type: "06", step_name: "제공기관" }
        : { status_type: "060", step_type: "05", step_name: "이용자" };
    return {
        documentId: contract.documentId,
        syncStatus: "ready",
        detailPayload: { current_status: status } as unknown as EformsignDocumentMirrorState["detailPayload"],
    };
}

/**
 * Real ReceiptLinkIssueService + ReceiptLinkTokenService + ReceiptLinkDeliveryEnricher over fakes.
 * `tokenDocId` is the eformsign_doc.id the already-approved staged link was rendered from.
 */
function build(params: { contracts: ContractFixture[]; tokenDocId: number }) {
    const client = { id: 7, name: "김산모", voucherClient: true, birthday: "940315", eDocId: "doc-A" };
    const clientRepository = {
        findById: jest.fn().mockResolvedValue(client as unknown as ClientEntity),
    } as unknown as IClientRepository;

    const eformsignDocRepository = {
        findContractCandidatesByClientId: jest.fn().mockResolvedValue(
            params.contracts.map((c) => ({
                id: c.id,
                documentId: c.documentId,
                documentKind: "contract",
                serviceRecordCaseId: null,
                templateId: null,
                createdDate: c.createdDate,
                statusType: c.signed ? "070" : "060",
                stepType: c.signed ? "06" : "05",
                stepName: c.signed ? "제공기관" : "이용자",
                permanentPurgeRequestedAt: null,
            })),
        ),
        findById: jest.fn(async (_branchId: string, id: number) => {
            const c = params.contracts.find((x) => x.id === id);
            return c ? { id: c.id, documentId: c.documentId, documentKind: "contract", clientId: 7 } : null;
        }),
    } as unknown as IEformsignDocRepository;

    const mirrorRepository = {
        findFile: jest.fn().mockResolvedValue({ content: Buffer.from("%PDF") } as unknown as EformsignStoredDocumentFile),
        findState: jest.fn(async (documentId: string) => {
            const c = params.contracts.find((x) => x.documentId === documentId);
            return c ? mirrorState(c) : null;
        }),
    } as unknown as IEformsignDocumentMirrorRepository;

    const config = {
        get: jest.fn((key: string, fallback?: unknown) => (key === "RECEIPT_LINK_HASH_SALT" ? "salt" : fallback)),
    } as unknown as ConfigService;

    // The approved link row: its document identity is persisted on the token.
    const tokenRepository = {
        findByLinkTokenHash: jest.fn(
            async (): Promise<ReceiptLinkTokenRecord> => ({
                id: "tok-A",
                eformsignDocId: params.tokenDocId,
                accessTokenHash: null,
                expectedBirthdayHash: "h",
                verifiedAt: null,
                failedAttempts: 0,
                lockedAt: null,
                expiresAt: new Date(Date.now() + 86_400_000),
                active: true,
                storagePath: A_STORAGE_PATH,
                branchName: "branch",
                clientName: "김산모",
            }),
        ),
    } as unknown as IReceiptLinkTokenRepository;
    const tokenService = new ReceiptLinkTokenService(tokenRepository, config);

    const storage = {
        createSignedUrl: jest.fn(async (path: string) => `https://storage.example/signed/${path}`),
    } as unknown as FileStoragePort;

    const issueService = new ReceiptLinkIssueService(
        clientRepository,
        eformsignDocRepository,
        mirrorRepository,
        {} as unknown as EformsignDocumentMirrorService,
        config,
        {} as unknown as PdfPageRasterizerService,
        tokenService,
        storage,
    );
    const enricher = new ReceiptLinkDeliveryEnricher(
        new SmsTriggerPayloadEnricherRegistry(),
        issueService,
        tokenService,
        storage,
    );
    return { enricher, storage };
}

function stagedJob(receiptEformsignDocId?: number): MessageTriggerJobEntity {
    const job = MessageTriggerJobEntity.create({
        branchId: BRANCH,
        ruleId: "system:service_end_notice",
        scheduledFor: new Date(),
        clientId: 7,
        recipientType: MessageTriggerRecipientType.CLIENT,
        recipientPhone: "01012345678",
        templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        dedupeKey: "system:service_end_notice:client:7",
        payload: {
            memberId: "client:7",
            recipientName: "김산모",
            recipientPhone: "01012345678",
            templateVariables: { name: "김산모", receiptUrl: RECEIPT_URL },
        },
    });
    if (receiptEformsignDocId !== undefined) job.payload.receiptEformsignDocId = receiptEformsignDocId;
    return job;
}

describe("staged receipt delivery keeps the artifact tied to the current contract", () => {
    it("refuses an A-token when the current contract is now B (signed), and signs no storage URL for A", async () => {
        const { enricher, storage } = build({ contracts: [CONTRACT_A, CONTRACT_B], tokenDocId: CONTRACT_A.id });

        await expect(enricher.validateStagedSnapshot(stagedJob())).rejects.toMatchObject({
            reason: "receipt_link_unusable",
        });
        expect(storage.createSignedUrl).not.toHaveBeenCalled();
    });

    it("allows an A-token while A is still the current signed contract (control)", async () => {
        const { enricher, storage } = build({ contracts: [CONTRACT_A], tokenDocId: CONTRACT_A.id });

        await expect(enricher.validateStagedSnapshot(stagedJob())).resolves.toBeUndefined();
        expect(storage.createSignedUrl).toHaveBeenCalledWith(A_STORAGE_PATH);
    });

    it("allows a B-token when B is the current signed contract (control)", async () => {
        const { enricher, storage } = build({ contracts: [CONTRACT_A, CONTRACT_B], tokenDocId: CONTRACT_B.id });

        await expect(enricher.validateStagedSnapshot(stagedJob())).resolves.toBeUndefined();
        expect(storage.createSignedUrl).toHaveBeenCalledWith(A_STORAGE_PATH);
    });

    it("keeps a manually pinned document's behaviour: the pin, not the current contract, is checked", async () => {
        // The staff pinned A explicitly; B is the newer current contract. The pin stays deliverable.
        const { enricher, storage } = build({ contracts: [CONTRACT_A, CONTRACT_B], tokenDocId: CONTRACT_A.id });

        await expect(enricher.validateStagedSnapshot(stagedJob(CONTRACT_A.id))).resolves.toBeUndefined();
        expect(storage.createSignedUrl).toHaveBeenCalledWith(A_STORAGE_PATH);
    });
});
