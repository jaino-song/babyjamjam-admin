import { createHash } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { ClientEntity } from "domain/entities/client.entity";
import { FileStorageObjectNotFoundError, FileStoragePort } from "domain/ports/file-storage.port";
import { IClientRepository } from "domain/repositories/client.repository.interface";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import {
    EformsignDocumentMirrorState,
    EformsignStoredDocumentFile,
    IEformsignDocumentMirrorRepository,
} from "domain/repositories/eformsign-document-mirror.repository.interface";
import { IReceiptLinkTokenRepository } from "domain/repositories/receipt-link-token.repository.interface";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { SmsTriggerDeliverySkipError } from "application/services/sms-trigger-payload-enricher.registry";
import {
    ReceiptLinkIssueService,
    ReceiptLinkSkipError,
} from "application/services/receipt-link-issue.service";

const BRANCH = "11111111-1111-1111-1111-111111111111";
const PDF = Buffer.from("%PDF-1.4 fake");
const PNG = Buffer.from("png-bytes");
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");
const ISSUED_TOKEN = { id: "tok-1", linkToken: "efr_abc", expiresAt: new Date("2026-10-03T00:00:00Z") };

interface ClientFixture {
    id: number;
    name: string;
    phone: string | null;
    voucherClient: boolean;
    birthday: string | null;
    eDocId: string | null;
    endDate?: Date;
}

interface DocFixture {
    id: number;
    documentId: string;
    documentKind?: string | null;
    createdDate?: Date;
    clientId?: number | null;
}

interface MakeServiceOverrides {
    client?: ClientFixture | null;
    doc?: DocFixture | null;
    docsByClient?: DocFixture[];
    /** The row `eformsignDocRepository.findById` resolves to — the explicit-selection path. */
    docById?: DocFixture | null;
    file?: { content: Buffer } | null;
    /** eformsign detail payload mirrored locally — defaults to a signed, provider-review-stage document. */
    mirrorState?: Partial<EformsignDocumentMirrorState> | null;
    activeTokenForJob?: { id: string; expiresAt: Date } | null;
    jobLockContended?: boolean;
    storedPath?: boolean;
    storageObject?: Buffer | null;
    baseUrl?: string;
    serviceRecordBaseUrl?: string;
}

/** A provider-review-stage mirrored document: the customer has signed (status 070). */
const SIGNED_MIRROR_STATE: Partial<EformsignDocumentMirrorState> = {
    syncStatus: "ready",
    detailPayload: {
        id: "doc-ext-1",
        document_number: "C-0001",
        template: { id: "t", name: "계약서" },
        document_name: "계약서",
        creator: { recipient_type: "01", id: "c", name: "branch" },
        created_date: 0,
        updated_date: 0,
        current_status: {
            status_type: "070",
            status_doc_type: "",
            status_doc_detail: "",
            step_type: "06",
            step_index: "1",
            step_name: "제공기관 확인",
            step_recipients: [],
            step_group: 1,
        },
    } as EformsignDocumentMirrorState["detailPayload"],
};

function makeService(overrides: MakeServiceOverrides = {}) {
    const client: ClientFixture | null =
        overrides.client === undefined
            ? { id: 7, name: "김산모", phone: "01012345678", voucherClient: true, birthday: "940315", eDocId: "doc-ext-1" }
            : overrides.client;
    const doc: DocFixture | null =
        overrides.doc === undefined
            ? { id: 42, documentId: "doc-ext-1", documentKind: "contract", createdDate: new Date("2026-01-01"), clientId: 7 }
            : overrides.doc;

    const clientRepository = {
        findById: jest.fn().mockResolvedValue(client ? { endDate: new Date("2026-09-20"), ...client } as unknown as ClientEntity : null),
    } as unknown as IClientRepository;

    const eformsignDocRepository = {
        findById: jest
            .fn()
            .mockResolvedValue((overrides.docById === undefined ? doc : overrides.docById) as unknown as EformsignDocEntity | null),
        findByDocumentId: jest.fn().mockResolvedValue(doc as unknown as EformsignDocEntity | null),
        findByClientId: jest
            .fn()
            .mockResolvedValue((overrides.docsByClient ?? (doc ? [doc] : [])) as unknown as EformsignDocEntity[]),
    } as unknown as IEformsignDocRepository;

    const mirrorRepository = {
        findFile: jest
            .fn()
            .mockResolvedValue(
                (overrides.file === undefined ? { content: PDF } : overrides.file) as unknown as EformsignStoredDocumentFile | null,
            ),
        findState: jest.fn().mockResolvedValue(
            overrides.mirrorState === undefined
                ? { documentId: "doc-ext-1", ...SIGNED_MIRROR_STATE }
                : overrides.mirrorState === null
                    ? null
                    : { documentId: "doc-ext-1", ...SIGNED_MIRROR_STATE, ...overrides.mirrorState },
        ),
    } as unknown as IEformsignDocumentMirrorRepository;

    const documentMirrorService = {
        syncDocument: jest.fn().mockResolvedValue({}),
    } as unknown as EformsignDocumentMirrorService;

    const lockScopedRepository = {
        createReplacingActive: jest.fn(),
        findActiveByJobId: jest.fn().mockResolvedValue(overrides.activeTokenForJob ?? null),
    };
    const receiptLinkTokenRepository = {
        existsByStoragePath: jest.fn().mockResolvedValue(!!overrides.storedPath),
        findActiveByJobId: jest.fn().mockResolvedValue(overrides.activeTokenForJob ?? null),
        ...(overrides.jobLockContended === undefined
            ? {}
            : {
                withJobIssuanceLock: jest.fn(
                    async (_jobId: string, operation: (contended: boolean, repository: unknown) => Promise<unknown>) =>
                        operation(overrides.jobLockContended === true, lockScopedRepository),
                ),
            }),
    } as unknown as IReceiptLinkTokenRepository;

    const config = {
        get: jest.fn((key: string) => {
            if (key === "MOBILE_RECEIPT_BASE_URL") return overrides.baseUrl ?? "https://m.admin.example/";
            if (key === "MOBILE_SERVICE_RECORD_BASE_URL") return overrides.serviceRecordBaseUrl;
            return undefined;
        }),
    } as unknown as ConfigService;

    const rasterizer = {
        renderPageToPng: jest.fn().mockResolvedValue(PNG),
    } as unknown as PdfPageRasterizerService;

    const issuedTokenStoragePaths = new Map<string, string>();
    const tokenService = {
        issue: jest.fn(async (params: { storagePath: string }) => {
            issuedTokenStoragePaths.set(ISSUED_TOKEN.linkToken, params.storagePath);
            return ISSUED_TOKEN;
        }),
    } as unknown as ReceiptLinkTokenService;

    const storagePath = `receipts/${BRANCH}/42/${PNG_SHA}.png`;
    const storageObjects = new Map<string, Buffer>();
    const initialStorageObject = overrides.storageObject === undefined && overrides.storedPath
        ? PNG
        : overrides.storageObject;
    if (initialStorageObject) storageObjects.set(storagePath, initialStorageObject);

    const storage: FileStoragePort = {
        upload: jest.fn(async (file: Buffer, path: string) => {
            storageObjects.set(path, file);
            return path;
        }),
        download: jest.fn(async (path: string) => {
            const file = storageObjects.get(path);
            if (!file) throw new FileStorageObjectNotFoundError(path, "download");
            return file;
        }),
        delete: jest.fn(),
        createSignedUrl: jest.fn(),
        ensureBucketExists: jest.fn(),
    };

    const service = new ReceiptLinkIssueService(
        clientRepository,
        eformsignDocRepository,
        mirrorRepository,
        documentMirrorService,
        config,
        rasterizer,
        tokenService,
        storage,
    );

    return {
        service,
        clientRepository,
        eformsignDocRepository,
        mirrorRepository,
        documentMirrorService,
        receiptLinkTokenRepository,
        lockScopedRepository,
        config,
        rasterizer,
        tokenService,
        issuedTokenStoragePaths,
        storage,
        storageObjects,
    };
}

describe("ReceiptLinkIssueService", () => {
    it("renders page 7, uploads under an issuance-specific path, issues a token and builds the url", async () => {
        const { service, rasterizer, storage, tokenService, clientRepository } = makeService();
        const result = await service.issue({ branchId: BRANCH, clientId: 7, source: "auto_trigger", jobId: "job-1" });

        expect(clientRepository.findById).toHaveBeenCalledWith(BRANCH, 7);
        // Literal 7 and literal { width: 1240 } on purpose: asserting against the
        // RECEIPT_PAGE_NUMBER/RECEIPT_IMAGE_WIDTH constants the implementation itself imports
        // would make this a tautology — a mutated constant would move both sides together.
        expect(rasterizer.renderPageToPng).toHaveBeenCalledWith(PDF, 7, { width: 1240 });
        expect(storage.upload).toHaveBeenCalledWith(PNG, expect.stringMatching(new RegExp(`^receipts/${BRANCH}/42/${PNG_SHA}-[a-f0-9-]+\\.png$`)), "image/png");
        expect(tokenService.issue).toHaveBeenCalledWith(
            expect.objectContaining({
                branchId: BRANCH,
                clientId: 7,
                eformsignDocId: 42,
                jobId: "job-1",
                birthday: "940315",
                storagePath: (storage.upload as jest.Mock).mock.calls[0]?.[1],
                contentSha256: PNG_SHA,
                byteSize: PNG.length,
                source: "auto_trigger",
            }),
        );
        expect(result).toEqual({ url: "https://m.admin.example/receipt/efr_abc", tokenId: "tok-1", expiresAt: new Date("2026-10-03T00:00:00Z") });
    });

    it.each([
        ["not_voucher_client", { client: { id: 7, name: "김산모", phone: null, voucherClient: false, birthday: "940315", eDocId: null } }],
        ["missing_birthday", { client: { id: 7, name: "김산모", phone: null, voucherClient: true, birthday: null, eDocId: null } }],
        // 4 digits: normalizeBirthdayInput only accepts 6 (YYMMDD) or 8 (YYYYMMDD) digit input.
        ["missing_birthday", { client: { id: 7, name: "김산모", phone: null, voucherClient: true, birthday: "9403", eDocId: null } }],
        ["no_contract_document", { doc: null }],
        ["no_contract_document", { client: null }],
        // eDocId points at a real document, but it's the wrong kind (a service-record snapshot,
        // not a contract) and the findByClientId fallback finds nothing either.
        [
            "no_contract_document",
            {
                doc: { id: 42, documentId: "doc-ext-1", documentKind: "service_record_snapshot", clientId: 7 },
                docsByClient: [],
            },
        ],
        // eDocId points at a real contract, but it belongs to a different client (a stale/foreign
        // pointer), and the fallback finds nothing either.
        [
            "no_contract_document",
            {
                doc: { id: 42, documentId: "doc-ext-1", documentKind: "contract", clientId: 999 },
                docsByClient: [],
            },
        ],
    ] as const)("skips with %s", async (reason, overrides) => {
        const { service, rasterizer } = makeService(overrides as MakeServiceOverrides);
        await expect(service.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).rejects.toMatchObject({ skipReason: reason });
        expect(rasterizer.renderPageToPng).not.toHaveBeenCalled();
    });

    it("re-syncs the mirror once when the pdf is missing, then skips with pdf_unavailable if still missing", async () => {
        const { service, mirrorRepository, documentMirrorService } = makeService({ file: null });
        await expect(service.preflight({ branchId: BRANCH, clientId: 7 })).rejects.toMatchObject({ skipReason: "pdf_unavailable" });
        expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
            "doc-ext-1",
            { branchId: BRANCH, source: "worker" },
            expect.objectContaining({ suppressOutboundAutomation: true }),
        );
        expect(mirrorRepository.findFile).toHaveBeenCalledTimes(2);
    });

    it("skips with contract_not_signed while the document is still awaiting the customer signature", async () => {
        const { service, tokenService } = makeService({
            mirrorState: {
                detailPayload: {
                    ...SIGNED_MIRROR_STATE.detailPayload,
                    current_status: {
                        ...SIGNED_MIRROR_STATE.detailPayload!.current_status,
                        status_type: "060",
                        step_type: "05",
                        step_name: "이용자 서명",
                    },
                } as EformsignDocumentMirrorState["detailPayload"],
            },
        });

        await expect(service.preflight({ branchId: BRANCH, clientId: 7 }))
            .rejects.toMatchObject({ skipReason: "contract_not_signed", message: "계약서 서명이 완료된 후 발송할 수 있습니다." });
        expect(tokenService.issue).not.toHaveBeenCalled();
    });

    it("skips with contract_not_signed when the mirror cannot prove a signature at all", async () => {
        const { service } = makeService({ mirrorState: null });
        await expect(service.preflight({ branchId: BRANCH, clientId: 7 }))
            .rejects.toMatchObject({ skipReason: "contract_not_signed" });
    });

    it("allows sending at the provider review stage (status 070) with a partial mirror, once the current-version document file exists", async () => {
        const { service, tokenService } = makeService({ mirrorState: { syncStatus: "partial" } });

        const preflight = await service.preflight({ branchId: BRANCH, clientId: 7 });

        expect(preflight.pdf.equals(PDF)).toBe(true);
        expect(tokenService.issue).not.toHaveBeenCalled();
    });

    const terminalWithProviderReviewStepCases = [
        ["071", "검토 반려"],
        ["080", "만료"],
    ] as const;
    it.each(terminalWithProviderReviewStepCases)(
        "skips with contract_not_signed for terminal status %s even though the last step is still the provider review step",
        async (statusType, stepName) => {
            const { service, tokenService } = makeService({
                mirrorState: {
                    detailPayload: {
                        ...SIGNED_MIRROR_STATE.detailPayload,
                        current_status: {
                            ...SIGNED_MIRROR_STATE.detailPayload!.current_status,
                            status_type: statusType,
                            step_type: "06",
                            step_name: stepName,
                        },
                    } as EformsignDocumentMirrorState["detailPayload"],
                },
            });

            await expect(service.preflight({ branchId: BRANCH, clientId: 7 }))
                .rejects.toMatchObject({ skipReason: "contract_not_signed" });
            expect(tokenService.issue).not.toHaveBeenCalled();
        },
    );

    it("allows sending once the document completed (status 072)", async () => {
        const { service } = makeService({
            mirrorState: {
                detailPayload: {
                    ...SIGNED_MIRROR_STATE.detailPayload,
                    current_status: {
                        ...SIGNED_MIRROR_STATE.detailPayload!.current_status,
                        status_type: "072",
                        step_type: "06",
                        step_name: "제공기관 확인",
                    },
                } as EformsignDocumentMirrorState["detailPayload"],
            },
        });

        await expect(service.preflight({ branchId: BRANCH, clientId: 7 })).resolves.toBeDefined();
    });

    it("allows sending once the document completed (status 003)", async () => {
        const { service } = makeService({
            mirrorState: {
                detailPayload: {
                    ...SIGNED_MIRROR_STATE.detailPayload,
                    current_status: {
                        ...SIGNED_MIRROR_STATE.detailPayload!.current_status,
                        status_type: "003",
                        step_type: "07",
                        step_name: "완료",
                    },
                } as EformsignDocumentMirrorState["detailPayload"],
            },
        });

        await expect(service.preflight({ branchId: BRANCH, clientId: 7 })).resolves.toBeDefined();
    });

    it("uses the pdf that the re-sync brought in", async () => {
        const { service, mirrorRepository } = makeService({ file: null });
        (mirrorRepository.findFile as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ content: PDF });
        const preflight = await service.preflight({ branchId: BRANCH, clientId: 7 });
        expect(preflight.pdf.equals(PDF)).toBe(true);
    });

    it("skips with pdf_unavailable when the mirror re-sync itself throws", async () => {
        const { service, documentMirrorService } = makeService({ file: null });
        (documentMirrorService.syncDocument as jest.Mock).mockRejectedValue(
            new Error("vendor 500: Bearer abcd1234efgh5678"),
        );
        await expect(service.preflight({ branchId: BRANCH, clientId: 7 })).rejects.toMatchObject({ skipReason: "pdf_unavailable" });
    });

    it("picks the latest contract document by createdDate when falling back to findByClientId", async () => {
        const client: ClientFixture = { id: 7, name: "김산모", phone: "01012345678", voucherClient: true, birthday: "940315", eDocId: null };
        const docs: DocFixture[] = [
            { id: 10, documentId: "old", documentKind: "contract", createdDate: new Date("2025-01-01"), clientId: 7 },
            { id: 20, documentId: "new", documentKind: "contract", createdDate: new Date("2026-06-01"), clientId: 7 },
            { id: 30, documentId: "snap", documentKind: "service_record_snapshot", createdDate: new Date("2026-08-01"), clientId: 7 },
        ];
        const { service } = makeService({ client, doc: null, docsByClient: docs });

        const preflight = await service.preflight({ branchId: BRANCH, clientId: 7 });

        expect(preflight.doc).toEqual({ id: 20, documentId: "new" });
    });

    // F1: manual re-send must render whichever document the staff explicitly selected, not
    // whatever client.eDocId/newest-contract would auto-derive (a contract re-issue can leave
    // those pointing at a different document than the one shown in the admin UI).
    it("uses the explicitly selected document over the client-derived one when eformsignDocId is given", async () => {
        const client: ClientFixture = { id: 7, name: "김산모", phone: "01012345678", voucherClient: true, birthday: "940315", eDocId: "doc-newer" };
        const newerDoc: DocFixture = { id: 99, documentId: "doc-newer", documentKind: "contract", createdDate: new Date("2026-01-01"), clientId: 7 };
        const olderDoc: DocFixture = { id: 42, documentId: "doc-older", documentKind: "contract", createdDate: new Date("2025-01-01"), clientId: 7 };
        const { service, eformsignDocRepository } = makeService({ client, doc: newerDoc, docById: olderDoc });

        const preflight = await service.preflight({ branchId: BRANCH, clientId: 7, eformsignDocId: 42 });

        expect(eformsignDocRepository.findById).toHaveBeenCalledWith(BRANCH, 42);
        expect(preflight.doc).toEqual({ id: 42, documentId: "doc-older" });
        // The client-derived (eDocId) path must never be consulted once an explicit id wins.
        expect(eformsignDocRepository.findByDocumentId).not.toHaveBeenCalled();
    });

    it("rejects an explicit eformsignDocId belonging to another client with no_contract_document", async () => {
        const { service } = makeService({
            docById: { id: 42, documentId: "doc-x", documentKind: "contract", clientId: 999 },
        });
        await expect(service.preflight({ branchId: BRANCH, clientId: 7, eformsignDocId: 42 }))
            .rejects.toMatchObject({ skipReason: "no_contract_document" });
    });

    it("rejects an explicit eformsignDocId that is not a contract with no_contract_document", async () => {
        const { service } = makeService({
            docById: { id: 42, documentId: "doc-x", documentKind: "service_record_snapshot", clientId: 7 },
        });
        await expect(service.preflight({ branchId: BRANCH, clientId: 7, eformsignDocId: 42 }))
            .rejects.toMatchObject({ skipReason: "no_contract_document" });
    });

    it("falls back to client-derived selection when eformsignDocId is absent (auto path unchanged)", async () => {
        const { service, eformsignDocRepository } = makeService();
        const preflight = await service.preflight({ branchId: BRANCH, clientId: 7 });
        expect(eformsignDocRepository.findById).not.toHaveBeenCalled();
        expect(preflight.doc).toEqual({ id: 42, documentId: "doc-ext-1" });
    });

    it("maps renderer and storage failures to skip reasons", async () => {
        const { service: renderFail, rasterizer } = makeService();
        (rasterizer.renderPageToPng as jest.Mock).mockRejectedValue(new Error("boom"));
        await expect(renderFail.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).rejects.toMatchObject({ skipReason: "render_failed" });

        const { service: uploadFail, storage } = makeService();
        (storage.upload as jest.Mock).mockRejectedValue(new Error("network"));
        await expect(uploadFail.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).rejects.toMatchObject({ skipReason: "upload_failed" });
    });

    it("uploads a separate object even when the same content is already stored", async () => {
        const { service, storage, storageObjects, issuedTokenStoragePaths } = makeService({ storedPath: true });
        const result = await service.issue({ branchId: BRANCH, clientId: 7, source: "manual" });
        const oldPath = `receipts/${BRANCH}/42/${PNG_SHA}.png`;
        const newPath = issuedTokenStoragePaths.get(ISSUED_TOKEN.linkToken)!;
        expect(newPath).not.toBe(oldPath);
        expect(storageObjects.get(oldPath)).toEqual(PNG);
        expect(storageObjects.get(newPath)).toEqual(PNG);
        expect(result.url).toBe("https://m.admin.example/receipt/efr_abc");
        expect(storage.upload).toHaveBeenCalledTimes(1);
    });

    it("does not publish a link after an upload collision", async () => {
        const { service, storage, tokenService } = makeService();
        (storage.upload as jest.Mock).mockRejectedValue(new Error("The resource already exists"));
        await expect(service.issue({ branchId: BRANCH, clientId: 7, source: "manual" })).rejects.toMatchObject({ skipReason: "upload_failed" });
        expect(tokenService.issue).not.toHaveBeenCalled();
    });

    it("re-uploads when an expired row references a storage object already deleted", async () => {
        const { service, storage, storageObjects, issuedTokenStoragePaths } = makeService({
            storedPath: true,
            storageObject: null,
        });

        const result = await service.issue({ branchId: BRANCH, clientId: 7, source: "manual" });

        const linkToken = result.url.slice(result.url.lastIndexOf("/") + 1);
        const issuedStoragePath = issuedTokenStoragePaths.get(linkToken);
        if (!issuedStoragePath) throw new Error("issued receipt URL did not resolve to a storage path");
        expect(result.url).toBe("https://m.admin.example/receipt/efr_abc");
        expect(storage.upload).toHaveBeenCalledWith(PNG, issuedStoragePath, "image/png");
        expect(storageObjects.get(issuedStoragePath)).toEqual(PNG);
    });

    it("falls back to MOBILE_SERVICE_RECORD_BASE_URL when MOBILE_RECEIPT_BASE_URL is unset", () => {
        const { service } = makeService({ baseUrl: "", serviceRecordBaseUrl: "https://legacy.example/" });
        expect(service.buildReceiptUrl("efr_t")).toBe("https://legacy.example/receipt/efr_t");
    });

    it("falls back to the production host when neither base url is configured", () => {
        const { service } = makeService({ baseUrl: "" });
        expect(service.buildReceiptUrl("efr_t")).toBe("https://m.admin.babyjamjam.com/receipt/efr_t");
    });

    it("is a ReceiptLinkSkipError with a Korean message", () => {
        const error = new ReceiptLinkSkipError("missing_birthday");
        expect(error.message).toBe("산모 생년월일이 등록되지 않았습니다");
        expect(error.reason).toBe("missing_birthday");
        expect(error).toBeInstanceOf(SmsTriggerDeliverySkipError);
    });

    it("refreshes the contract token expiry even when a staged job already carries a URL", async () => {
        const { service, tokenService } = makeService();
        await service.issue({ branchId: BRANCH, clientId: 7, source: "auto_trigger", jobId: "job-1", existingUrl: "https://m.admin.example/receipt/efr_existing" });
        expect(tokenService.issue).toHaveBeenCalledWith(expect.objectContaining({
            eformsignDocId: 42,
            birthday: "940315",
        }));
    });

    it("mints a new token when an active token exists for the job but no existingUrl is supplied", async () => {
        const { service, rasterizer, storage, tokenService } = makeService({
            activeTokenForJob: { id: "existing-tok", expiresAt: new Date("2026-10-01T00:00:00Z") },
        });

        const result = await service.issue({ branchId: BRANCH, clientId: 7, source: "auto_trigger", jobId: "job-1" });

        expect(rasterizer.renderPageToPng).toHaveBeenCalled();
        expect(storage.upload).toHaveBeenCalled();
        expect(tokenService.issue).toHaveBeenCalled();
        expect(result).toEqual({ url: "https://m.admin.example/receipt/efr_abc", tokenId: "tok-1", expiresAt: new Date("2026-10-03T00:00:00Z") });
    });

    it("mints anew when the active token for the job is already expired, even with existingUrl supplied", async () => {
        const { service, rasterizer, storage, tokenService } = makeService({
            activeTokenForJob: { id: "stale-tok", expiresAt: new Date("2020-01-01T00:00:00Z") },
        });

        const result = await service.issue({
            branchId: BRANCH,
            clientId: 7,
            source: "auto_trigger",
            jobId: "job-1",
            existingUrl: "https://m.admin.example/receipt/efr_stale",
        });

        expect(rasterizer.renderPageToPng).toHaveBeenCalled();
        expect(storage.upload).toHaveBeenCalled();
        expect(tokenService.issue).toHaveBeenCalled();
        expect(result).toEqual({ url: "https://m.admin.example/receipt/efr_abc", tokenId: "tok-1", expiresAt: new Date("2026-10-03T00:00:00Z") });
    });

    it("shares one issued url between overlapping attempts for the same job", async () => {
        let releaseIssue: (() => void) | undefined;
        const issueStarted = new Promise<void>((resolve) => {
            releaseIssue = resolve;
        });
        let finishIssue: (() => void) | undefined;
        const issueCanFinish = new Promise<void>((resolve) => {
            finishIssue = resolve;
        });
        const { service, tokenService } = makeService();
        (tokenService.issue as jest.Mock).mockImplementation(async () => {
            releaseIssue?.();
            await issueCanFinish;
            return ISSUED_TOKEN;
        });
        const params = { branchId: BRANCH, clientId: 7, source: "auto_trigger" as const, jobId: "job-race" };

        const first = service.issue(params);
        await issueStarted;
        const second = service.issue(params);
        finishIssue?.();

        await expect(Promise.all([first, second])).resolves.toEqual([
            { url: "https://m.admin.example/receipt/efr_abc", tokenId: "tok-1", expiresAt: new Date("2026-10-03T00:00:00Z") },
            { url: "https://m.admin.example/receipt/efr_abc", tokenId: "tok-1", expiresAt: new Date("2026-10-03T00:00:00Z") },
        ]);
        expect(tokenService.issue).toHaveBeenCalledTimes(1);
    });

    it("mints after waiting when the competing issuer rolls back without replacing the active token", async () => {
        const { service, tokenService } = makeService({
            activeTokenForJob: { id: "active-before-lock", expiresAt: new Date("2026-10-01T00:00:00Z") },
            jobLockContended: true,
        });

        await expect(service.issue({
            branchId: BRANCH,
            clientId: 7,
            source: "auto_trigger",
            jobId: "job-race",
        })).resolves.toEqual({
            url: "https://m.admin.example/receipt/efr_abc",
            tokenId: "tok-1",
            expiresAt: new Date("2026-10-03T00:00:00Z"),
        });

        expect(tokenService.issue).toHaveBeenCalledTimes(1);
    });

    it("refreshes the same contract for independent dispatch jobs", async () => {
        const { service, tokenService } = makeService();
        const first = await service.issue({ branchId: BRANCH, clientId: 7, source: "manual", jobId: "job-1" });
        const second = await service.issue({ branchId: BRANCH, clientId: 7, source: "manual", jobId: "job-2" });
        expect(second.url).toBe(first.url);
        expect(tokenService.issue).toHaveBeenCalledTimes(2);
    });

    describe("assertDocumentSyncReady", () => {
        it("passes when the mirror holds the current-version document file (even at a partial sync status)", async () => {
            const { service, mirrorRepository } = makeService({ mirrorState: { syncStatus: "partial" } });
            (mirrorRepository.findFile as jest.Mock).mockResolvedValue({ content: PDF });
            await expect(service.assertDocumentSyncReady("doc-ext-1")).resolves.toBeUndefined();
        });

        it("fails with pdf_unavailable when no current-version document file exists", async () => {
            const { service, mirrorRepository } = makeService({ mirrorState: { syncStatus: "partial" } });
            (mirrorRepository.findFile as jest.Mock).mockResolvedValue(null);
            await expect(service.assertDocumentSyncReady("doc-ext-1"))
                .rejects.toMatchObject({ skipReason: "pdf_unavailable" });
        });

        it("does not depend on the mirror's syncStatus flag alone", async () => {
            // A "ready" row whose document file is gone must still fail closed.
            const { service, mirrorRepository } = makeService({ mirrorState: { syncStatus: "ready" } });
            (mirrorRepository.findFile as jest.Mock).mockResolvedValue(null);
            await expect(service.assertDocumentSyncReady("doc-ext-1"))
                .rejects.toMatchObject({ skipReason: "pdf_unavailable" });
        });

        it("resolves no contract document when the branch/client targets resolve to nothing", async () => {
            const { service } = makeService({ client: null });
            await expect(service.assertDocumentSyncReady({ branchId: BRANCH, clientId: 7 }))
                .rejects.toMatchObject({ skipReason: "no_contract_document" });
        });
    });
});

describe("receipt image cleanup overlap", () => {
    it.each(["before", "after"])("keeps the new image when a stale cleanup deletion finishes %s token publication", async (order) => {
        const { service, storageObjects, tokenService, issuedTokenStoragePaths } = makeService();
        const params = { branchId: BRANCH, clientId: 7, source: "manual" as const };
        const first = await service.issue(params);
        const collectedPath = issuedTokenStoragePaths.get(ISSUED_TOKEN.linkToken)!;
        const originalIssue = tokenService.issue.bind(tokenService);
        if (order === "before") {
            (tokenService.issue as jest.Mock).mockImplementationOnce(async (issueParams) => {
                storageObjects.delete(collectedPath);
                return originalIssue(issueParams);
            });
        }
        const second = await service.issue(params);
        if (order === "after") storageObjects.delete(collectedPath);
        const currentPath = issuedTokenStoragePaths.get(ISSUED_TOKEN.linkToken)!;
        expect(currentPath).not.toBe(collectedPath);
        expect(storageObjects.has(collectedPath)).toBe(false);
        expect(storageObjects.get(currentPath)).toEqual(PNG);
        expect(second.url).toBe(first.url);
    });
});
