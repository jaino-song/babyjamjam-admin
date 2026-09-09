import { createHash } from "node:crypto";

import {
    ReceiptLinkRevisionRefreshService,
    type ReceiptLinkRevisionPdfSource,
    type ReceiptLinkRevisionRasterizer,
    type ReceiptLinkRevisionRefreshSnapshot,
    type ReceiptLinkRevisionRefreshState,
} from "application/services/receipt-link-revision-refresh.service";
import type { FileStoragePort } from "domain/ports/file-storage.port";
import type {
    IReceiptLinkTokenRepository,
    ReceiptLinkRevisionArtifactProof,
    ReceiptLinkRevisionArtifactPromotionResult,
} from "domain/repositories/receipt-link-token.repository.interface";
import type { IServiceRecordEditRepository } from "domain/repositories/service-record-edit.repository.interface";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";
const STATE_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN_A = "55555555-5555-4555-8555-555555555555";
const TOKEN_B = "66666666-6666-4666-8666-666666666666";
const GENERATION = "receipt-generation-1";
const PDF = Buffer.from("%PDF-1.7\nlocal-receipt-fixture\n%%EOF");
const PNG = Buffer.from("png-fixture");

const SNAPSHOT: ReceiptLinkRevisionRefreshSnapshot = {
    expected: {
        serviceStartDate: "2026-08-01",
        serviceEndDate: "2026-08-14",
        receivedDate: "2026-08-02",
        amount: "123000",
    },
    tokens: { eformsignDocId: 42, tokenIds: [TOKEN_A, TOKEN_B] },
    source: {
        documentId: "document-target-1",
        documentVersion: 3,
        templateId: "receipt-template-1",
        templateVersion: "v3",
        mirrorGeneration: "mirror-3",
    },
};

function proof(snapshot: ReceiptLinkRevisionRefreshSnapshot, generation = GENERATION): ReceiptLinkRevisionArtifactProof {
    return {
        officialPdfSha256: createHash("sha256").update(PDF).digest("hex"),
        verifiedAt: "2026-09-08T03:00:00.000Z",
        pageCount: 1,
        scope: {
            branchId: BRANCH,
            clientId: 7,
            revisionId: REVISION_ID,
            documentId: snapshot.source.documentId,
            generation,
            mirrorGeneration: snapshot.source.mirrorGeneration,
            templateId: snapshot.source.templateId,
            templateVersion: snapshot.source.templateVersion,
        },
        expected: { ...snapshot.expected },
    };
}

function verification(snapshot: ReceiptLinkRevisionRefreshSnapshot) {
    const persisted = proof(snapshot);
    return {
        status: "verified" as const,
        officialPdfSha256: persisted.officialPdfSha256,
        verifiedAt: new Date(persisted.verifiedAt),
        pageCount: persisted.pageCount,
        scope: persisted.scope,
        expected: persisted.expected,
    };
}

function state(overrides: Partial<ReceiptLinkRevisionRefreshState> = {}): ReceiptLinkRevisionRefreshState {
    return {
        id: STATE_ID,
        branchId: BRANCH,
        clientId: 7,
        serviceRecordCaseId: CASE_ID,
        revisionId: REVISION_ID,
        operation: "receipt_refresh",
        generation: GENERATION,
        immutableInput: JSON.parse(JSON.stringify(SNAPSHOT)) as Record<string, unknown>,
        inputFingerprint: "a".repeat(64),
        documentVersion: null,
        sourceDocumentId: "document-original-1",
        targetDocumentId: null,
        templateId: SNAPSHOT.source.templateId,
        templateVersion: SNAPSHOT.source.templateVersion,
        workflowScope: null,
        mirrorGeneration: null,
        outputProof: null,
        step: "pending",
        status: "pending",
        attempts: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        version: 0,
        createdAt: "2026-09-08T03:00:00.000Z",
        updatedAt: "2026-09-08T03:00:00.000Z",
        ...overrides,
    };
}

interface Harness {
    service: ReceiptLinkRevisionRefreshService;
    current: ReceiptLinkRevisionRefreshState;
    source: jest.Mocked<ReceiptLinkRevisionPdfSource>;
    verifier: { verify: jest.Mock };
    rasterizer: jest.Mocked<ReceiptLinkRevisionRasterizer>;
    storage: jest.Mocked<FileStoragePort>;
    promotion: jest.Mock<Promise<ReceiptLinkRevisionArtifactPromotionResult>, [unknown]>;
    repository: Partial<Record<keyof IServiceRecordEditRepository, jest.Mock>>;
}

function makeHarness(overrides: Partial<ReceiptLinkRevisionRefreshState> = {}): Harness {
    const current = state(overrides);
    const source: jest.Mocked<ReceiptLinkRevisionPdfSource> = {
        download: jest.fn().mockResolvedValue({
            pdf: PDF,
            documentId: SNAPSHOT.source.documentId,
            documentVersion: SNAPSHOT.source.documentVersion,
            templateId: SNAPSHOT.source.templateId,
            templateVersion: SNAPSHOT.source.templateVersion,
            mirrorGeneration: SNAPSHOT.source.mirrorGeneration,
        }),
    };
    const verifier = { verify: jest.fn().mockResolvedValue(verification(SNAPSHOT)) };
    const rasterizer: jest.Mocked<ReceiptLinkRevisionRasterizer> = {
        renderPageToPng: jest.fn().mockResolvedValue(PNG),
    };
    const storage: jest.Mocked<FileStoragePort> = {
        upload: jest.fn().mockResolvedValue("signed-url-ignored"),
        delete: jest.fn().mockResolvedValue(undefined),
        createSignedUrl: jest.fn(),
        ensureBucketExists: jest.fn(),
        download: jest.fn(),
    };
    const promotion = jest.fn<Promise<ReceiptLinkRevisionArtifactPromotionResult>, [unknown]>().mockResolvedValue({
        disposition: "promoted",
        tokenIds: SNAPSHOT.tokens.tokenIds,
        stateVersion: 2,
    });
    const repository: Harness["repository"] = {
        findRevisionDocumentState: jest.fn().mockResolvedValue(current),
        advanceRevisionDocumentState: jest.fn().mockImplementation(async (patch: Record<string, unknown>) => {
            Object.assign(current, {
                status: patch["status"],
                step: patch["step"],
                lastErrorCode: patch["lastErrorCode"] ?? null,
                version: current.version + 1,
                ...(patch["outputProof"] !== undefined ? { outputProof: patch["outputProof"] } : {}),
                ...(patch["targetDocumentId"] !== undefined ? { targetDocumentId: patch["targetDocumentId"] } : {}),
                ...(patch["documentVersion"] !== undefined ? { documentVersion: patch["documentVersion"] } : {}),
                ...(patch["mirrorGeneration"] !== undefined ? { mirrorGeneration: patch["mirrorGeneration"] } : {}),
            });
            return current;
        }),
        retryRevisionDocumentState: jest.fn().mockImplementation(async () => {
            current.status = "pending";
            current.step = "retry_requested";
            current.version += 1;
            current.lastErrorCode = null;
            return current;
        }),
    };
    const tokenRepository = { promoteReceiptRevisionArtifact: promotion } as unknown as IReceiptLinkTokenRepository;
    const service = new ReceiptLinkRevisionRefreshService(
        repository as unknown as Harness["repository"] & IServiceRecordEditRepository,
        source,
        verifier,
        rasterizer,
        storage,
        tokenRepository,
    );
    return { service, current, source, verifier, rasterizer, storage, promotion, repository };
}

const input = {
    branchId: BRANCH,
    clientId: 7,
    serviceRecordCaseId: CASE_ID,
    revisionId: REVISION_ID,
    documentStateId: STATE_ID,
    expectedGeneration: GENERATION,
};

describe("ReceiptLinkRevisionRefreshService", () => {
    it("proves fresh official bytes before swapping every frozen token artifact and completing the state", async () => {
        const harness = makeHarness();

        const result = await harness.service.processOperation(input);

        expect(result).toMatchObject({ status: "completed", promotedTokenIds: SNAPSHOT.tokens.tokenIds });
        expect(harness.source.download).toHaveBeenCalledWith(expect.objectContaining({
            documentId: SNAPSHOT.source.documentId,
            generation: GENERATION,
            eformsignDocId: SNAPSHOT.tokens.eformsignDocId,
        }));
        expect(harness.rasterizer.renderPageToPng).toHaveBeenCalledWith(PDF, 7, { width: 1240 });
        expect(harness.storage.upload).toHaveBeenCalledWith(expect.any(Buffer), expect.stringContaining(GENERATION), "image/png");
        expect(harness.repository.advanceRevisionDocumentState).toHaveBeenCalledWith(expect.objectContaining({
            status: "processing",
            step: "proof_ready",
            outputProof: expect.objectContaining({
                officialPdfSha256: createHash("sha256").update(PDF).digest("hex"),
                artifact: expect.objectContaining({ contentSha256: createHash("sha256").update(PNG).digest("hex") }),
            }),
        }));
        expect(harness.promotion).toHaveBeenCalledWith(expect.objectContaining({
            tokenIds: SNAPSHOT.tokens.tokenIds,
            targetDocumentId: SNAPSHOT.source.documentId,
            expectedStateVersion: 1,
            proof: expect.objectContaining({ officialPdfSha256: createHash("sha256").update(PDF).digest("hex") }),
        }));
        expect(harness.storage.delete).not.toHaveBeenCalled();
    });

    it("leaves the existing image and token untouched when semantic PDF proof is unavailable", async () => {
        const harness = makeHarness();
        harness.verifier.verify.mockResolvedValue({ status: "capability_unverified", reason: "mismatched_field" });

        const result = await harness.service.processOperation(input);

        expect(result).toMatchObject({ status: "capability_unverified" });
        expect(result.reason).toBe("RECEIPT_REFRESH_PDF_UNVERIFIED:mismatched_field");
        expect(harness.rasterizer.renderPageToPng).not.toHaveBeenCalled();
        expect(harness.storage.upload).not.toHaveBeenCalled();
        expect(harness.promotion).not.toHaveBeenCalled();
    });

    it("fails closed on the exact server-owned immutable envelope without downloading a PDF", async () => {
        const harness = makeHarness({ immutableInput: { expected: SNAPSHOT.expected, source: SNAPSHOT.source } });

        const result = await harness.service.processOperation(input);

        expect(result).toMatchObject({ status: "capability_unverified", reason: "RECEIPT_REFRESH_IMMUTABLE_INPUT_INVALID" });
        expect(harness.source.download).not.toHaveBeenCalled();
        expect(harness.storage.upload).not.toHaveBeenCalled();
    });

    it("does not issue or refresh a token when the server froze an empty token list", async () => {
        const harness = makeHarness({
            immutableInput: {
                ...SNAPSHOT,
                tokens: { ...SNAPSHOT.tokens, tokenIds: [] },
            },
        });

        const result = await harness.service.processOperation(input);

        expect(result).toMatchObject({ status: "not_required", reason: null });
        expect(harness.source.download).not.toHaveBeenCalled();
        expect(harness.storage.upload).not.toHaveBeenCalled();
        expect(harness.promotion).not.toHaveBeenCalled();
    });

    it("deletes only a newly uploaded candidate when the proof/state promotion CAS is stale", async () => {
        const harness = makeHarness();
        harness.promotion.mockResolvedValue({ disposition: "stale", tokenIds: [], stateVersion: 1 });

        const result = await harness.service.processOperation(input);

        expect(result).toMatchObject({ status: "unknown", reason: "RECEIPT_REFRESH_ARTIFACT_PROMOTION_STALE" });
        expect(harness.storage.upload).toHaveBeenCalledTimes(1);
        const candidatePath = harness.storage.upload.mock.calls[0]?.[1];
        expect(candidatePath).toEqual(expect.stringContaining("receipts/"));
        expect(harness.storage.delete).toHaveBeenCalledWith(candidatePath);
        expect(harness.promotion).toHaveBeenCalledTimes(1);
    });

    it("keeps a persisted proof artifact when a retry loses promotion CAS", async () => {
        const artifact = {
            storagePath: "receipts/branch/document/proof-retry.png",
            contentSha256: createHash("sha256").update(PNG).digest("hex"),
            byteSize: PNG.length,
        };
        const persistedProof = { status: "verified" as const, ...proof(SNAPSHOT), artifact };
        const harness = makeHarness({ status: "processing", step: "proof_ready", version: 1, outputProof: persistedProof });
        harness.promotion.mockResolvedValue({ disposition: "stale", tokenIds: [], stateVersion: 1 });

        const result = await harness.service.processOperation(input);

        expect(result).toMatchObject({ status: "unknown", reason: "RECEIPT_REFRESH_ARTIFACT_PROMOTION_STALE" });
        expect(harness.storage.delete).not.toHaveBeenCalled();
        expect(harness.storage.upload).not.toHaveBeenCalled();
    });

    it("reuses a persisted proof artifact on retry without downloading or rasterizing again", async () => {
        const artifact = {
            storagePath: "receipts/branch/document/proof-retry.png",
            contentSha256: createHash("sha256").update(PNG).digest("hex"),
            byteSize: PNG.length,
        };
        const persistedProof = { status: "verified" as const, ...proof(SNAPSHOT), artifact };
        const harness = makeHarness({ status: "processing", step: "proof_ready", version: 1, outputProof: persistedProof });

        const result = await harness.service.processOperation(input);

        expect(result.status).toBe("completed");
        expect(harness.source.download).not.toHaveBeenCalled();
        expect(harness.rasterizer.renderPageToPng).not.toHaveBeenCalled();
        expect(harness.storage.upload).not.toHaveBeenCalled();
        expect(harness.storage.delete).not.toHaveBeenCalled();
        expect(harness.promotion).toHaveBeenCalledWith(expect.objectContaining({
            storagePath: artifact.storagePath,
            expectedStateVersion: 1,
        }));
    });

    it("requires retry for an unverified generation and preserves the retry CAS identity", async () => {
        const harness = makeHarness({ status: "capability_unverified", lastErrorCode: "old-error" });
        harness.verifier.verify.mockResolvedValue(verification(SNAPSHOT));

        const withoutRetry = await harness.service.processOperation(input);
        expect(withoutRetry.reason).toBe("old-error");
        expect(harness.source.download).not.toHaveBeenCalled();

        const withRetry = await harness.service.processOperation({ ...input, retry: true });
        expect(withRetry.status).toBe("completed");
        expect(harness.repository.retryRevisionDocumentState).toHaveBeenCalledWith(expect.objectContaining({
            stateId: STATE_ID,
            expectedGeneration: GENERATION,
        }));
    });

    it("rejects a state scope mismatch before invoking any external or storage seam", async () => {
        const harness = makeHarness({ clientId: 8 });

        const result = await harness.service.processOperation(input);

        expect(result).toMatchObject({ status: "pending", reason: "RECEIPT_REFRESH_SCOPE_MISMATCH" });
        expect(harness.source.download).not.toHaveBeenCalled();
        expect(harness.promotion).not.toHaveBeenCalled();
    });
});
