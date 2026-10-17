import {
    BackfillEformsignDocsError,
    BackfillEformsignDocsUsecase,
    type EformsignDocsBackfillProgress,
    type EformsignDocsBackfillSummary,
    type EformsignDocsBackfillTypeSummary,
} from "application/usecases/eformsign-doc/backfill-eformsign-docs.usecase";
import { MirrorUnassignedEformsignDocUsecase } from "application/usecases/eformsign-doc/mirror-unassigned-eformsign-doc.usecase";
import { EformsignDocStaleUpdateError } from "domain/repositories/eformsign-doc.repository.interface";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";
import { normalizeEformsignDocumentResponse } from "infrastructure/api/eformsign-response.normalizer";

const TEST_PRINCIPAL = { branchId: "__system__:backfill-test", source: "worker" as const };
const createBoundary = () => ({
    withCredentials: jest.fn((
        _principal: unknown,
        _capability: unknown,
        operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
    ) => operation({ accessToken: "shared-access-token", refreshToken: "shared-refresh-token" })),
    withRefreshedCredentials: jest.fn((
        _principal: unknown,
        _capability: unknown,
        _credentials: unknown,
        operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
    ) => operation({ accessToken: "shared-access-token-refreshed", refreshToken: "shared-refresh-token" })),
});

const createRemoteDocument = (
    id: string,
    statusType = "060",
): EformsignApiDocumentResponse => normalizeEformsignDocumentResponse({
    id,
    document_number: `NUMBER-${id}`,
    template: { id: "template-1", name: "계약서" },
    document_name: `문서 ${id}`,
    creator: { recipient_type: "01", id: "creator", name: "생성자" },
    created_date: String(Date.parse("2026-07-01T00:00:00.000Z")),
    updated_date: String(Date.parse("2026-07-02T00:00:00.000Z")),
    current_status: {
        status_type: statusType,
        status_doc_type: "",
        status_doc_detail: "상태",
        step_type: 5,
        step_index: 0,
        step_name: "이용자",
        step_recipients: [],
        step_group: 1,
    },
});

describe("BackfillEformsignDocsUsecase", () => {
    const accessToken = "shared-access-token";

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("purges a requested document only after the post-scan verification confirms vendor 404", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockRejectedValue(new EformsignApiError("missing", 404)),
        };
        const mirrorService = {
            // Permanent deletion is normally requested for a 049 trash row, which is
            // intentionally absent from the active-id query.
            findActiveDocumentIds: jest.fn().mockResolvedValue([]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue(["missing-doc"]),
            purgeDocuments: jest.fn().mockResolvedValue(undefined),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(undefined),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(mirrorService.purgeDocuments).toHaveBeenCalledWith(["missing-doc"]);
        expect(mirrorService.markDocumentsDeleted).not.toHaveBeenCalled();
    });

    it("keeps an ordinary vendor-absent document as a recoverable tombstone", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockRejectedValue(new EformsignApiError("missing", 404)),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["missing-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn().mockResolvedValue(undefined),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(undefined),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(mirrorService.markDocumentsDeleted).toHaveBeenCalledWith(["missing-doc"]);
        expect(mirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("tombstones a document when detail returns the vendor deleted-document code", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockRejectedValue(
                new EformsignApiError("deleted", 400, "4000006"),
            ),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["deleted-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn().mockResolvedValue(undefined),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(undefined),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(mirrorService.markDocumentsDeleted).toHaveBeenCalledWith(["deleted-doc"]);
    });

    it("fails closed for an unrelated vendor 400 during absence verification", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockRejectedValue(
                new EformsignApiError("bad request", 400, "4000001"),
            ),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["uncertain-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn(),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toThrow(
            /failed to verify locally active eformsign document uncertain-doc/i,
        );
        expect(mirrorService.markDocumentsDeleted).not.toHaveBeenCalled();
    });

    it("retries a confirmed-present purge by cancelling and purges only after vendor success", async () => {
        const document = createRemoteDocument("pending-doc");
        const retryGeneration = new Date("2026-07-30T01:00:00.000Z");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [document],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockResolvedValue(document),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            syncDocumentWithToken: jest.fn().mockResolvedValue({ status: "synced" }),
            requestPermanentPurge: jest.fn().mockResolvedValue([
                { documentId: "pending-doc", generation: retryGeneration },
            ]),
            purgeDocuments: jest.fn().mockResolvedValue(undefined),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(undefined),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const eformsignService = {
            cancelDocuments: jest.fn().mockResolvedValue({
                result: { success_result: ["pending-doc"] },
            }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue({ id: 1 }) } as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "pending-doc" }) } as never,
            mirrorService as never,
            eformsignService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(client.getDocument).toHaveBeenCalledWith(accessToken, "pending-doc");
        expect(mirrorService.requestPermanentPurge).toHaveBeenCalledWith(["pending-doc"]);
        // The retry cancels rather than deletes: the delete endpoint keeps the vendor's
        // copy, so a sweep must not erase it hours later.
        expect(eformsignService.cancelDocuments).toHaveBeenCalledWith(
            accessToken,
            ["pending-doc"],
        );
        expect(mirrorService.clearPermanentPurgeRequest).not.toHaveBeenCalled();
        expect(mirrorService.purgeDocuments).toHaveBeenCalledWith(["pending-doc"]);
    });

    it("finishes the purge when the vendor refuses to cancel an already-finished document", async () => {
        // 042 = cancelled at the vendor. The mirror still reads 060 here, because a live
        // purge intent fences every writer of statusType — which is the whole reason this
        // branch consults the vendor's status instead.
        const document = createRemoteDocument("pending-doc", "042");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [document],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockResolvedValue(document),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            syncDocumentWithToken: jest.fn().mockResolvedValue({ status: "synced" }),
            requestPermanentPurge: jest.fn().mockResolvedValue([
                { documentId: "pending-doc", generation: new Date("2026-07-30T01:00:00.000Z") },
            ]),
            purgeDocuments: jest.fn().mockResolvedValue(undefined),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn(),
            // Left deliberately wrong: the frozen mirror would say "not terminal", and
            // trusting it is what made this loop run forever.
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const eformsignService = {
            cancelDocuments: jest.fn().mockResolvedValue({
                result: { fail_result: [{ document_id: "pending-doc", code: "4000031" }] },
            }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue({ id: 1 }) } as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "pending-doc" }) } as never,
            mirrorService as never,
            eformsignService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        // eformsign never cancels a finished document, so retrying forever would make every
        // sweep from here on reattempt a call that cannot succeed.
        expect(mirrorService.purgeDocuments).toHaveBeenCalledWith(["pending-doc"]);
        expect(mirrorService.clearPermanentPurgeRequest).not.toHaveBeenCalled();
    });

    it("retains a retried purge intent for an ambiguous vendor cancel outcome", async () => {
        const document = createRemoteDocument("pending-doc");
        const retryGeneration = new Date("2026-07-30T01:00:00.000Z");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [document],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockResolvedValue(document),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            syncDocumentWithToken: jest.fn().mockResolvedValue({ status: "synced" }),
            requestPermanentPurge: jest.fn().mockResolvedValue([
                { documentId: "pending-doc", generation: retryGeneration },
            ]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn(),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const eformsignService = {
            cancelDocuments: jest.fn().mockResolvedValue({
                result: {
                    fail_result: [{ document_id: "pending-doc", code: "4000031" }],
                },
            }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue({ id: 1 }) } as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "pending-doc" }) } as never,
            mirrorService as never,
            eformsignService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(mirrorService.requestPermanentPurge).toHaveBeenCalledWith(["pending-doc"]);
        expect(mirrorService.clearPermanentPurgeRequest).not.toHaveBeenCalled();
        expect(mirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("clears only the retry generation for a definitive vendor cancel rejection", async () => {
        const document = createRemoteDocument("pending-doc");
        const retryGeneration = new Date("2026-07-30T01:00:00.000Z");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [document],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockResolvedValue(document),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            syncDocumentWithToken: jest.fn().mockResolvedValue({ status: "synced" }),
            requestPermanentPurge: jest.fn().mockResolvedValue([
                { documentId: "pending-doc", generation: retryGeneration },
            ]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(["pending-doc"]),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const eformsignService = {
            cancelDocuments: jest.fn().mockResolvedValue({
                result: {
                    fail_result: [{ document_id: "pending-doc", code: "4000164" }],
                },
            }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue({ id: 1 }) } as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "pending-doc" }) } as never,
            mirrorService as never,
            eformsignService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(mirrorService.clearPermanentPurgeRequest).toHaveBeenCalledWith([
            { documentId: "pending-doc", generation: retryGeneration },
        ]);
        expect(mirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("fails closed when an absent local document cannot be verified", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockRejectedValue(new EformsignApiError("unavailable", 503)),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["uncertain-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(undefined),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toThrow(
            /failed to verify locally active eformsign document uncertain-doc/i,
        );
        expect(mirrorService.markDocumentsDeleted).not.toHaveBeenCalled();
        expect(mirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("does not run the absence post-pass after an incomplete vendor scan", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockRejectedValue(new Error("list unavailable")),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn(),
            findPermanentPurgeRequestedDocumentIds: jest.fn(),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toThrow(/failed for types=01/i);
        expect(mirrorService.findActiveDocumentIds).not.toHaveBeenCalled();
        expect(mirrorService.findPermanentPurgeRequestedDocumentIds).not.toHaveBeenCalled();
    });

    it("reuses one token and scans beyond 1000 documents until total_rows", async () => {
        const inProgress = Array.from(
            { length: 1_205 },
            (_, index) => createRemoteDocument(`progress-${index + 1}`),
        );
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn(
                (_token: string, limit: number, skip: number) => Promise.resolve({
                    documents: inProgress.slice(skip, skip + limit),
                    total_rows: inProgress.length,
                }),
            ),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn((document: EformsignApiDocumentResponse) =>
                Promise.resolve({ documentId: document.id })),
        };
        const credentialBoundary = createBoundary();
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            credentialBoundary as never,
            repository as never,
            mirror as never,
        );

        const summary = await usecase.execute({}, TEST_PRINCIPAL);

        expect(credentialBoundary.withCredentials).toHaveBeenCalledTimes(1);
        expect(credentialBoundary.withCredentials).toHaveBeenCalledWith(
            TEST_PRINCIPAL,
            "document.backfill",
            expect.any(Function),
        );
        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(26);
        expect(client.getInProgressDocumentsPage).toHaveBeenLastCalledWith(
            accessToken,
            100,
            1_200,
        );
        expect(client.getCompletedDocumentsPage).toHaveBeenCalledWith(
            accessToken,
            100,
            0,
        );
        expect(client.getRejectedDocumentsPage).toHaveBeenCalledWith(
            accessToken,
            100,
            0,
        );
        expect(summary).toEqual(expect.objectContaining({
            fetched: 1_205,
            created: 1_205,
            updated: 0,
            skipped: 0,
            failed: 0,
            pages: 15,
        }));
        expect(summary.byDocumentType).toEqual(expect.objectContaining({
            "01": expect.objectContaining({
                status: "completed",
                fetched: 1_205,
                pages: 13,
            }),
            "03": expect.objectContaining({ status: "completed", pages: 1 }),
            "04": expect.objectContaining({ status: "completed", pages: 1 }),
        }));
    });

    it("scans rejected documents with type 04", async () => {
        const rejected = createRemoteDocument("rejected-doc", "080");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [rejected],
                total_rows: 1,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: rejected.id }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        const summary = await usecase.execute({}, TEST_PRINCIPAL);

        expect(client.getRejectedDocumentsPage).toHaveBeenCalledWith(
            accessToken,
            100,
            0,
        );
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledWith(
            rejected,
            { allowAssignedUpdate: true },
        );
        expect(summary.byDocumentType["04"]).toEqual(expect.objectContaining({
            status: "completed",
            fetched: 1,
            created: 1,
        }));
    });

    it("continues later document types when an earlier API page fails", async () => {
        const pageError = new Error("remote page failed");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn()
                .mockResolvedValueOnce({
                    documents: [
                        createRemoteDocument("doc-1"),
                        createRemoteDocument("doc-2"),
                    ],
                    total_rows: 3,
                })
                .mockRejectedValueOnce(pageError),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn((document: EformsignApiDocumentResponse) =>
                Promise.resolve({ documentId: document.id })),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        const result = usecase.execute({}, TEST_PRINCIPAL);

        await expect(result).rejects.toMatchObject({
            summary: {
                fetched: 2,
                created: 2,
                updated: 0,
                skipped: 0,
                failed: 0,
                pages: 3,
                byDocumentType: {
                    "01": expect.objectContaining({
                        status: "failed",
                        fetched: 2,
                        error: expect.stringContaining("type=01"),
                    }),
                    "03": expect.objectContaining({ status: "completed" }),
                    "04": expect.objectContaining({ status: "completed" }),
                },
            },
        });
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
        expect(client.getCompletedDocumentsPage).toHaveBeenCalledTimes(2);
        expect(client.getRejectedDocumentsPage).toHaveBeenCalledTimes(2);
    });

    it("syncs full detail and PDFs after a stale projection write, then counts it as skipped", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [
                    createRemoteDocument("terminal-doc", "060"),
                    createRemoteDocument("fresh-doc", "060"),
                ],
                total_rows: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue({
                branchId: "branch-1",
                document: { documentId: "existing" },
            }),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn()
                .mockRejectedValueOnce(new EformsignDocStaleUpdateError("terminal-doc"))
                .mockResolvedValueOnce({ documentId: "fresh-doc" }),
        };
        const documentMirrorService = {
            syncDocumentWithToken: jest.fn().mockResolvedValue({ status: "synced" }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
            documentMirrorService as never,
        );

        const summary = await usecase.execute({}, TEST_PRINCIPAL);

        expect(summary).toEqual(expect.objectContaining({
            fetched: 2,
            created: 0,
            updated: 1,
            skipped: 1,
            failed: 0,
            pages: 3,
        }));
        expect(mirror.mirrorRemoteDocument).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ id: "terminal-doc" }),
            { allowAssignedUpdate: true },
        );
        expect(documentMirrorService.syncDocumentWithToken).toHaveBeenNthCalledWith(
            1,
            accessToken,
            "terminal-doc",
            { expectedUpdatedDate: expect.any(Number) },
        );
    });

    it("finishes the page after a document write failure but refuses to report success", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [
                    createRemoteDocument("failed-doc"),
                    createRemoteDocument("saved-doc"),
                ],
                total_rows: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn()
                .mockRejectedValueOnce(new Error("write failed"))
                .mockResolvedValueOnce({ documentId: "saved-doc" }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        // The second document must still be written — one bad row may not abort the
        // sweep — but a mirror missing a document is not a completed backfill.
        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toMatchObject({
            summary: expect.objectContaining({
                fetched: 2,
                created: 1,
                updated: 0,
                skipped: 0,
                failed: 1,
                byDocumentType: expect.objectContaining({
                    "01": expect.objectContaining({
                        status: "failed",
                        error: expect.stringContaining("could not mirror every document"),
                    }),
                }),
            }),
        });
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
    });

    it("fails closed when a completed document is missing its current-version audit trail", async () => {
        const completedDocument = createRemoteDocument("completed-doc", "doc_complete");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [completedDocument],
                total_rows: 1,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({
                documentId: completedDocument.id,
            }),
        };
        const documentMirrorService = {
            syncDocumentWithToken: jest.fn().mockRejectedValue(
                new Error("missing current-version files: audit_trail"),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null) } as never,
            mirror as never,
            documentMirrorService as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toMatchObject({
            summary: expect.objectContaining({
                fetched: 1,
                created: 0,
                failed: 1,
                byDocumentType: expect.objectContaining({
                    "03": expect.objectContaining({ status: "failed" }),
                }),
            }),
        });
        expect(documentMirrorService.syncDocumentWithToken).toHaveBeenCalledWith(
            accessToken,
            completedDocument.id,
            { expectedUpdatedDate: completedDocument.updated_date },
        );
    });

    it("fails the sweep when the execution lease is lost during the final write", async () => {
        // shouldContinue is polled before every write, so a lease lost during the last
        // one would otherwise be reported as a clean success.
        let writes = 0;
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [
                    createRemoteDocument("first-doc"),
                    createRemoteDocument("last-doc"),
                ],
                total_rows: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn((document: EformsignApiDocumentResponse) => {
                writes += 1;
                return Promise.resolve({ documentId: document.id });
            }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({
            shouldContinue: () => writes < 2,
        }, TEST_PRINCIPAL)).rejects.toThrow(/lost its execution lease/);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
    });

    it("stops when a non-empty page repeats without any new document ids", async () => {
        const repeated = createRemoteDocument("repeated-doc");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [repeated],
                total_rows: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "repeated-doc" }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toBeInstanceOf(BackfillEformsignDocsError);

        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(2);
        expect(client.getCompletedDocumentsPage).toHaveBeenCalledTimes(2);
        expect(client.getRejectedDocumentsPage).toHaveBeenCalledTimes(2);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(1);
    });

    it("fails the document type when total_rows decreases during offset pagination", async () => {
        const firstPage = Array.from(
            { length: 100 },
            (_, index) => createRemoteDocument(`document-${index + 1}`),
        );
        const shiftedSecondPage = Array.from(
            { length: 99 },
            (_, index) => createRemoteDocument(`document-${index + 102}`),
        );
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn()
                .mockResolvedValueOnce({
                    documents: firstPage,
                    total_rows: 200,
                })
                .mockResolvedValueOnce({
                    documents: shiftedSecondPage,
                    total_rows: 199,
                }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(
                (document: EformsignApiDocumentResponse) =>
                    Promise.resolve({ documentId: document.id }),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toMatchObject({
            summary: {
                byDocumentType: {
                    "01": expect.objectContaining({
                        status: "failed",
                        error: expect.stringContaining("total_rows decreased"),
                    }),
                    "03": expect.objectContaining({ status: "completed" }),
                    "04": expect.objectContaining({ status: "completed" }),
                },
            },
        });

        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(2);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(100);
    });

    it("fails closed when the list keeps growing faster than the sweep pages through it", async () => {
        // Every page brings new documents and reports a still-larger total, so the loop
        // has no natural end. This runs as an operator job; it must stop and say why.
        let served = 0;
        const growingPage = () => {
            const documents = Array.from(
                { length: 100 },
                (_, index) => createRemoteDocument(`document-${served + index + 1}`),
            );
            served += 100;
            return { documents, total_rows: served + 101 };
        };
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn(() => Promise.resolve(growingPage())),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(
                (document: EformsignApiDocumentResponse) =>
                    Promise.resolve({ documentId: document.id }),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toMatchObject({
            summary: {
                byDocumentType: {
                    "01": expect.objectContaining({
                        status: "failed",
                        error: expect.stringContaining("page budget"),
                    }),
                },
            },
        });
    });

    it("fails closed when total_rows increases then returns to its initial value with incomplete unique coverage", async () => {
        const firstPage = Array.from(
            { length: 100 },
            (_, index) => createRemoteDocument(`document-${index + 1}`),
        );
        const shiftedSecondPage = Array.from(
            { length: 100 },
            (_, index) => createRemoteDocument(`document-${index + 100}`),
        );
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn()
                .mockResolvedValueOnce({
                    documents: firstPage,
                    total_rows: 200,
                })
                .mockResolvedValueOnce({
                    documents: shiftedSecondPage,
                    total_rows: 201,
                })
                .mockResolvedValueOnce({
                    documents: [],
                    total_rows: 200,
                }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(
                (document: EformsignApiDocumentResponse) =>
                    Promise.resolve({ documentId: document.id }),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toMatchObject({
            summary: {
                fetched: 200,
                created: 199,
                byDocumentType: {
                    "01": expect.objectContaining({
                        status: "failed",
                        error: expect.stringMatching(
                            /coverage incomplete.*uniqueSeen=199.*currentTotal=200.*missing=1.*rerun/i,
                        ),
                    }),
                    "03": expect.objectContaining({ status: "completed" }),
                    "04": expect.objectContaining({ status: "completed" }),
                },
            },
        });

        expect(client.getInProgressDocumentsPage).toHaveBeenNthCalledWith(
            3,
            accessToken,
            100,
            200,
        );
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(199);
    });

    it("fails closed when same-size list churn hides a live document across offsets", async () => {
        const firstPage = Array.from(
            { length: 100 },
            (_, index) => createRemoteDocument(`document-${index + 1}`),
        );
        const churnedSecondPage = [
            ...Array.from(
                { length: 99 },
                (_, index) => createRemoteDocument(`document-${index + 102}`),
            ),
            createRemoteDocument("replacement-document"),
        ];
        const stableFirstPage = Array.from(
            { length: 100 },
            (_, index) => createRemoteDocument(`document-${index + 2}`),
        );
        const stableSecondPage = [
            ...Array.from(
                { length: 99 },
                (_, index) => createRemoteDocument(`document-${index + 102}`),
            ),
            createRemoteDocument("replacement-document"),
        ];
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn()
                .mockResolvedValueOnce({
                    documents: firstPage,
                    total_rows: 200,
                })
                .mockResolvedValueOnce({
                    documents: churnedSecondPage,
                    total_rows: 200,
                })
                .mockResolvedValueOnce({
                    documents: stableFirstPage,
                    total_rows: 200,
                })
                .mockResolvedValueOnce({
                    documents: stableSecondPage,
                    total_rows: 200,
                }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(
                (document: EformsignApiDocumentResponse) =>
                    Promise.resolve({ documentId: document.id }),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toMatchObject({
            summary: {
                byDocumentType: {
                    "01": expect.objectContaining({
                        status: "failed",
                        error: expect.stringMatching(
                            /coverage changed between consecutive scans.*firstCount=200.*verificationCount=200.*missingFromVerification=1.*newInVerification=1.*retry/i,
                        ),
                    }),
                    "03": expect.objectContaining({ status: "completed" }),
                    "04": expect.objectContaining({ status: "completed" }),
                },
            },
        });

        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(4);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(200);
    });

    it("fails fast when total_rows is missing from a list response", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: accessToken,
                    refresh_token: "refresh-token",
                },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn(),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toMatchObject({
            summary: {
                byDocumentType: {
                    "01": expect.objectContaining({ status: "failed" }),
                    "03": expect.objectContaining({ status: "completed" }),
                    "04": expect.objectContaining({ status: "completed" }),
                },
            },
        });

        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(1);
        expect(mirror.mirrorRemoteDocument).not.toHaveBeenCalled();
    });

    it("reissues an access token after 401 and resumes the same page", async () => {
        const refreshedAccessToken = "shared-access-token-refreshed";
        const documents = [
            createRemoteDocument("page-1"),
            createRemoteDocument("page-2"),
        ];
        const getInProgressDocumentsPage = jest.fn(
            (token: string, _limit: number, skip: number) => {
                if (skip === 0) {
                    return Promise.resolve({
                        documents: [documents[0]],
                        total_rows: documents.length,
                    });
                }
                if (token === accessToken) {
                    return Promise.reject(new EformsignApiError("expired", 401));
                }
                return Promise.resolve({
                    documents: [documents[1]],
                    total_rows: documents.length,
                });
            },
        );
        const client = {
            getAccessToken: jest.fn()
                .mockResolvedValueOnce({
                    oauth_token: { access_token: accessToken },
                })
                .mockResolvedValueOnce({
                    oauth_token: { access_token: refreshedAccessToken },
                }),
            getInProgressDocumentsPage,
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn((document: EformsignApiDocumentResponse) =>
                Promise.resolve({ documentId: document.id })),
        };
        const credentialBoundary = createBoundary();
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            credentialBoundary as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).resolves.toMatchObject({
            fetched: 2,
            created: 2,
        });

        expect(getInProgressDocumentsPage.mock.calls).toEqual([
            [accessToken, 100, 0],
            [accessToken, 100, 1],
            [refreshedAccessToken, 100, 1],
            [refreshedAccessToken, 100, 0],
            [refreshedAccessToken, 100, 1],
        ]);
        expect(credentialBoundary.withCredentials).toHaveBeenCalledTimes(1);
        expect(credentialBoundary.withRefreshedCredentials).toHaveBeenCalledTimes(1);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
        expect(client.getCompletedDocumentsPage).toHaveBeenCalledTimes(2);
        expect(client.getRejectedDocumentsPage).toHaveBeenCalledTimes(2);
    });

    it("reissues an access token after 401 during the coverage confirmation pass", async () => {
        const refreshedAccessToken = "shared-access-token-refreshed";
        const documents = [
            createRemoteDocument("confirmation-page-1"),
            createRemoteDocument("confirmation-page-2"),
        ];
        const getInProgressDocumentsPage = jest.fn()
            .mockResolvedValueOnce({
                documents: [documents[0]],
                total_rows: documents.length,
            })
            .mockResolvedValueOnce({
                documents: [documents[1]],
                total_rows: documents.length,
            })
            .mockRejectedValueOnce(new EformsignApiError("expired", 401))
            .mockResolvedValueOnce({
                documents: [documents[0]],
                total_rows: documents.length,
            })
            .mockResolvedValueOnce({
                documents: [documents[1]],
                total_rows: documents.length,
            });
        const client = {
            getAccessToken: jest.fn()
                .mockResolvedValueOnce({
                    oauth_token: { access_token: accessToken },
                })
                .mockResolvedValueOnce({
                    oauth_token: { access_token: refreshedAccessToken },
                }),
            getInProgressDocumentsPage,
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(
                (document: EformsignApiDocumentResponse) =>
                    Promise.resolve({ documentId: document.id }),
            ),
        };
        const credentialBoundary = createBoundary();
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            credentialBoundary as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).resolves.toMatchObject({
            fetched: 2,
            created: 2,
            failed: 0,
        });

        expect(getInProgressDocumentsPage.mock.calls).toEqual([
            [accessToken, 100, 0],
            [accessToken, 100, 1],
            [accessToken, 100, 0],
            [refreshedAccessToken, 100, 0],
            [refreshedAccessToken, 100, 1],
        ]);
        expect(credentialBoundary.withCredentials).toHaveBeenCalledTimes(1);
        expect(credentialBoundary.withRefreshedCredentials).toHaveBeenCalledTimes(1);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
    });

    it("reissues an access token after a per-document detail or PDF sync returns 401", async () => {
        const refreshedAccessToken = "shared-access-token-refreshed";
        const document = createRemoteDocument("detail-auth-retry");
        const client = {
            getAccessToken: jest.fn()
                .mockResolvedValueOnce({
                    oauth_token: { access_token: accessToken },
                })
                .mockResolvedValueOnce({
                    oauth_token: { access_token: refreshedAccessToken },
                }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [document],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({
                documentId: document.id,
            }),
        };
        const documentMirrorService = {
            syncDocumentWithToken: jest.fn()
                .mockRejectedValueOnce(new EformsignApiError("expired", 401))
                .mockResolvedValueOnce({
                    status: "synced",
                    documentId: document.id,
                }),
        };
        const credentialBoundary = createBoundary();
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            credentialBoundary as never,
            repository as never,
            mirror as never,
            documentMirrorService as never,
        );

        await expect(usecase.execute({
            suppressOutboundAutomation: true,
        }, TEST_PRINCIPAL)).resolves.toMatchObject({
            fetched: 1,
            created: 1,
            failed: 0,
        });

        expect(documentMirrorService.syncDocumentWithToken.mock.calls).toEqual([
            [
                accessToken,
                document.id,
                {
                    expectedUpdatedDate: document.updated_date,
                    suppressOutboundAutomation: true,
                },
            ],
            [
                refreshedAccessToken,
                document.id,
                {
                    expectedUpdatedDate: document.updated_date,
                    suppressOutboundAutomation: true,
                },
            ],
        ]);
        expect(credentialBoundary.withCredentials).toHaveBeenCalledTimes(1);
        expect(credentialBoundary.withRefreshedCredentials).toHaveBeenCalledTimes(1);
    });

    it("stops after one token reissue when the retried page is still unauthorized", async () => {
        const client = {
            getAccessToken: jest.fn()
                .mockResolvedValueOnce({
                    oauth_token: { access_token: accessToken },
                })
                .mockResolvedValueOnce({
                    oauth_token: { access_token: "refreshed-access-token" },
                }),
            getInProgressDocumentsPage: jest.fn()
                .mockRejectedValue(new EformsignApiError("unauthorized", 401)),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn(),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(),
        };
        const credentialBoundary = createBoundary();
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            credentialBoundary as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({}, TEST_PRINCIPAL)).rejects.toBeInstanceOf(
            BackfillEformsignDocsError,
        );

        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(2);
        expect(credentialBoundary.withCredentials).toHaveBeenCalledTimes(1);
        expect(credentialBoundary.withRefreshedCredentials).toHaveBeenCalledTimes(1);
        expect(mirror.mirrorRemoteDocument).not.toHaveBeenCalled();
    });

    it("normalizes a remote status code before the backfill mirror persists it", async () => {
        const remote = createRemoteDocument("normalized-doc", " DOC_EXPIRED ");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: accessToken,
                    refresh_token: "refresh-token",
                },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [remote],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
            upsertUnassignedByDocumentId: jest.fn(
                (document) => Promise.resolve(document),
            ),
        };
        const mirror = new MirrorUnassignedEformsignDocUsecase(
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            repository as never,
        );
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror,
        );

        await usecase.execute({}, TEST_PRINCIPAL);

        // The list carries no _expired, but an 080 document is expired by definition, so
        // the row must not be created claiming otherwise — and having derived it, the
        // write is no longer the blind overwrite updateExpired:false guards against.
        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({ statusType: "080", expired: true }),
            {
                allowAssignedUpdate: true,
                updateListDisplayFields: true,
                // The list has no expired_date, so the computed date is only a fallback.
                updateExpiredDate: false,
            },
        );
    });

    it("mirrors a document once when two inboxes both list it", async () => {
        // Type "04" is eformsign's document-management inbox, not a rejected-only one, so
        // it overlaps the other scans. Now that this runs nightly, writing those rows a
        // second time every night would be pure waste.
        const shared = createRemoteDocument("shared-doc");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [shared],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [shared],
                total_rows: 1,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "shared-doc" }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        const summary = await usecase.execute({}, TEST_PRINCIPAL);

        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(1);
        // Both scans still have to page it: each inbox's coverage check compares against
        // its own total_rows, so the duplicate has to count as seen for type 04 as well.
        expect(summary).toEqual(expect.objectContaining({
            fetched: 2,
            created: 1,
            duplicates: 1,
        }));
        expect(summary.byDocumentType["04"]).toEqual(
            expect.objectContaining({ status: "completed", duplicates: 1, created: 0 }),
        );
    });

    it("re-mirrors a document when a later inbox carries newer state", async () => {
        // A document that completes between the in-progress scan and the completed scan
        // shows up twice, the second copy newer. Skipping on identity alone would keep the
        // mirror a night behind on exactly the documents that just changed.
        const earlier = createRemoteDocument("moving-doc");
        const later = {
            ...createRemoteDocument("moving-doc", "050"),
            updated_date: earlier.updated_date + 60_000,
        };
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [earlier],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [later],
                total_rows: 1,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "moving-doc" }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror as never,
        );

        const summary = await usecase.execute({}, TEST_PRINCIPAL);

        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
        expect(mirror.mirrorRemoteDocument).toHaveBeenLastCalledWith(
            expect.objectContaining({ current_status: expect.objectContaining({ status_type: "050" }) }),
            { allowAssignedUpdate: true },
        );
        expect(summary.duplicates).toBe(0);
    });

    it("keeps a stored status detail when the list response carries none", async () => {
        // The list schema has no status_doc_detail, so the mirror falls back to the step
        // name. That derived value may seed a new row but must not replace "만료"/"거부"
        // on an existing one.
        const remote = createRemoteDocument("detail-less-doc");
        delete (remote.current_status as { status_doc_detail?: string }).status_doc_detail;
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [remote],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
            upsertUnassignedByDocumentId: jest.fn(
                (document) => Promise.resolve(document),
            ),
        };
        const mirror = new MirrorUnassignedEformsignDocUsecase(
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            repository as never,
        );
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            createBoundary() as never,
            repository as never,
            mirror,
        );

        await usecase.execute({}, TEST_PRINCIPAL);

        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ updateStatusDetail: false }),
        );
    });
});

describe("Backfill collection observation", () => {
    const page = { documents: [], total_rows: 0 };
    function setup(observer = { page: jest.fn().mockResolvedValue(undefined), scan: jest.fn().mockResolvedValue(undefined),
        finish: jest.fn().mockResolvedValue(undefined) }) {
        const client = { getInProgressDocumentsPage: jest.fn().mockResolvedValue(page),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue(page), getRejectedDocumentsPage: jest.fn().mockResolvedValue(page) };
        const boundary = createBoundary();
        const mirror = { mirrorRemoteDocument: jest.fn().mockResolvedValue(undefined) };
        const writer = { begin: jest.fn().mockResolvedValue(observer) };
        const usecase = new BackfillEformsignDocsUsecase(client as never, boundary as never,
            { findByDocumentIdUnscoped: jest.fn() } as never, mirror as never, undefined, undefined, writer as never);
        const receiptContext = { configuredCompanyId: "company-1", trigger: "operator-backfill" as const, lockMode: "valkey" as const };
        return { client, boundary, mirror, writer, observer, usecase, receiptContext };
    }

    it("records six actual empty scans through the explicit optional writer binding", async () => {
        const { usecase, observer, receiptContext } = setup();
        await usecase.execute({ receiptContext }, TEST_PRINCIPAL);
        expect(observer.page).toHaveBeenCalledTimes(6);
        expect(observer.scan).toHaveBeenCalledTimes(6);
        expect(observer.page.mock.calls.map(([value]) => [value.documentType, value.pass, value.startOffset,
            value.returnedCount, value.totalCount, value.terminal])).toEqual([
            ["01", 1, 0, 0, 0, true], ["01", 2, 0, 0, 0, true],
            ["03", 1, 0, 0, 0, true], ["03", 2, 0, 0, 0, true],
            ["04", 1, 0, 0, 0, true], ["04", 2, 0, 0, 0, true],
        ]);
        expect(observer.finish).toHaveBeenCalledWith("succeeded");
    });

    it("begins before credentials and observes the original credential rejection", async () => {
        const { usecase, observer, boundary, writer, receiptContext } = setup();
        const error = new Error("credential failure");
        boundary.withCredentials.mockRejectedValueOnce(error as never);
        await expect(usecase.execute({ receiptContext }, TEST_PRINCIPAL)).rejects.toBe(error);
        expect(writer.begin.mock.invocationCallOrder[0]).toBeLessThan(boundary.withCredentials.mock.invocationCallOrder[0]!);
        expect(observer.finish).toHaveBeenCalledWith("failed");
    });

    it("awaits observation before mirror and stops after lease loss during observation", async () => {
        const { usecase, client, observer, mirror, receiptContext } = setup();
        client.getInProgressDocumentsPage.mockResolvedValue({ documents: [createRemoteDocument("doc-1")], total_rows: 1 } as never);
        let held = true;
        observer.page.mockImplementationOnce(async () => { held = false; });
        await expect(usecase.execute({ receiptContext, shouldContinue: () => held }, TEST_PRINCIPAL)).rejects.toThrow("lease");
        expect(mirror.mirrorRemoteDocument).not.toHaveBeenCalled();
        expect(observer.finish).toHaveBeenCalledWith("interrupted", expect.any(Function));
    });

    it("preserves the rejected fetch as the cause when the lease expires during failure observation", async () => {
        const { usecase, client, observer, mirror, receiptContext } = setup();
        const fetchError = new Error("provider request rejected");
        client.getInProgressDocumentsPage.mockRejectedValueOnce(fetchError);
        let held = true;
        const shouldContinue = jest.fn(() => held);
        observer.page.mockImplementationOnce(async () => { held = false; });
        let rejected: unknown;
        try { await usecase.execute({ receiptContext, shouldContinue }, TEST_PRINCIPAL); }
        catch (error) { rejected = error; }
        expect(rejected).toBeInstanceOf(BackfillEformsignDocsError);
        expect((rejected as BackfillEformsignDocsError).cause).toBe(fetchError);
        expect((rejected as Error).message).toContain("lease");
        expect(shouldContinue.mock.invocationCallOrder.some(order => order > observer.page.mock.invocationCallOrder[0]!)).toBe(true);
        expect(client.getCompletedDocumentsPage).not.toHaveBeenCalled();
        expect(client.getRejectedDocumentsPage).not.toHaveBeenCalled();
        expect(mirror.mirrorRemoteDocument).not.toHaveBeenCalled();
        expect(observer.finish).toHaveBeenCalledWith("interrupted", shouldContinue);
    });

    it("keeps fetch failures unknown and preserves business success when the observer fails", async () => {
        const first = setup();
        first.client.getInProgressDocumentsPage.mockRejectedValueOnce(new Error("private provider text"));
        await expect(first.usecase.execute({ receiptContext: first.receiptContext }, TEST_PRINCIPAL)).rejects.toThrow();
        expect(first.observer.page).toHaveBeenCalledWith(expect.objectContaining({ returnedCount: null, totalCount: null,
            terminal: null, outcome: "failed", failureCode: "fetch-failed" }));
        expect(JSON.stringify(first.observer.page.mock.calls)).not.toContain("private provider text");
        const second = setup();
        second.observer.page.mockRejectedValue(new Error("ledger down"));
        second.observer.finish.mockRejectedValue(new Error("ledger down"));
        await expect(second.usecase.execute({ receiptContext: second.receiptContext }, TEST_PRINCIPAL)).resolves.toMatchObject({ failed: 0 });
    });

    it("observes a fetched page before a mirror failure and preserves the business failure", async () => {
        const { usecase, client, observer, mirror, receiptContext } = setup();
        client.getInProgressDocumentsPage.mockResolvedValue({ documents: [createRemoteDocument("private-doc")], total_rows: 1 } as never);
        mirror.mirrorRemoteDocument.mockRejectedValue(new Error("mirror rejected"));
        await expect(usecase.execute({ receiptContext }, TEST_PRINCIPAL)).rejects.toThrow();
        expect(observer.page.mock.invocationCallOrder[0]).toBeLessThan(mirror.mirrorRemoteDocument.mock.invocationCallOrder[0]!);
        expect(JSON.stringify(observer.page.mock.calls)).not.toContain("private-doc");
        expect(observer.finish).toHaveBeenCalledWith("failed");
    });

    it("records actual offsets in both passes and a failed pass2 page2 without fabricated counts", async () => {
        const { usecase, client, observer, receiptContext } = setup();
        const docs = Array.from({ length: 100 }, (_, index) => createRemoteDocument(`doc-${index}`));
        client.getInProgressDocumentsPage
            .mockResolvedValueOnce({ documents: docs, total_rows: 101 } as never)
            .mockResolvedValueOnce({ documents: [createRemoteDocument("last")], total_rows: 101 } as never)
            .mockResolvedValueOnce({ documents: docs, total_rows: 101 } as never)
            .mockRejectedValueOnce(new Error("down"));
        await expect(usecase.execute({ receiptContext }, TEST_PRINCIPAL)).rejects.toThrow();
        expect(observer.page.mock.calls.slice(0, 4).map(([value]) => [value.pass, value.ordinal, value.startOffset,
            value.returnedCount])).toEqual([[1, 0, 0, 100], [1, 1, 100, 1], [2, 0, 0, 100], [2, 1, 100, null]]);
    });
});

/**
 * Characterization of the inactive collection path (BJJ-453 1B). In production no
 * EformsignBackupCollectionWriter is registered, so the usecase runs without an
 * observer. The invariant under test is that business outcomes there equal the
 * pre-collection behaviour exactly. Every expected value below was produced by
 * running the identical scenario against the base commit (origin/dev e6780416a),
 * never by recording what the current code returns.
 */
describe("Inactive collection path (no writer) keeps base behaviour", () => {
    // `receiptContext` is accepted by the current option type only; the cast keeps the
    // same scenario source runnable against the base commit.
    const RECEIPT_CONTEXT = {
        configuredCompanyId: "company-1",
        trigger: "operator-backfill",
        lockMode: "valkey",
    };
    // Expected traces: recorded by running these scenarios on the base commit
    // (origin/dev e6780416a). Summary rows read fetched/created/updated/skipped/duplicates/failed/pages.
    const LAST_LEASE_POLL = 16;
    const LAST_LEASE_POLL_ABSENT = 14;
    const EXPECT_NORMAL = [
        "outcome: resolved total 3/3/0/0/0/0/3 | 01 completed 2/2/0/0/0/0/1 | 03 completed 1/1/0/0/0/0/1 | 04 completed 0/0/0/0/0/0/1",
        "progress: started: total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 01@2/2: total 2/2/0/0/0/0/1 | 01 pending 2/2/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 03@1/1: total 3/3/0/0/0/0/2 | 01 completed 2/2/0/0/0/0/1 | 03 pending 1/1/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 04@0/0: total 3/3/0/0/0/0/3 | 01 completed 2/2/0/0/0/0/1 | 03 completed 1/1/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/1",
        "progress: completed: total 3/3/0/0/0/0/3 | 01 completed 2/2/0/0/0/0/1 | 03 completed 1/1/0/0/0/0/1 | 04 completed 0/0/0/0/0/0/1",
        "pages: 01@0,01@0,03@0,03@0,04@0,04@0",
        "mirrored: a-0,a-1,c-0",
        "lease polls: 16",
        "mirror service: none",
        "token refreshes: 0",
    ];
    const EXPECT_NORMAL_NO_LEASE = [
        "outcome: resolved total 3/3/0/0/0/0/3 | 01 completed 2/2/0/0/0/0/1 | 03 completed 1/1/0/0/0/0/1 | 04 completed 0/0/0/0/0/0/1",
        "progress: started: total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 01@2/2: total 2/2/0/0/0/0/1 | 01 pending 2/2/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 03@1/1: total 3/3/0/0/0/0/2 | 01 completed 2/2/0/0/0/0/1 | 03 pending 1/1/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 04@0/0: total 3/3/0/0/0/0/3 | 01 completed 2/2/0/0/0/0/1 | 03 completed 1/1/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/1",
        "progress: completed: total 3/3/0/0/0/0/3 | 01 completed 2/2/0/0/0/0/1 | 03 completed 1/1/0/0/0/0/1 | 04 completed 0/0/0/0/0/0/1",
        "pages: 01@0,01@0,03@0,03@0,04@0,04@0",
        "mirrored: a-0,a-1,c-0",
        "lease polls: 0",
        "mirror service: none",
        "token refreshes: 0",
    ];
    const EXPECT_LEASE_LOST_AT_LAST_CHECK = [
        "outcome: rejected EformsignBackfillLeaseLostError(\"Eformsign document backfill lost its execution lease\" summary={total 3/3/0/0/0/0/3 | 01 completed 2/2/0/0/0/0/1 | 03 completed 1/1/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/1})",
        "progress: started: total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 01@2/2: total 2/2/0/0/0/0/1 | 01 pending 2/2/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 03@1/1: total 3/3/0/0/0/0/2 | 01 completed 2/2/0/0/0/0/1 | 03 pending 1/1/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/0",
        "progress: failed: total 3/3/0/0/0/0/3 | 01 completed 2/2/0/0/0/0/1 | 03 completed 1/1/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/1",
        "pages: 01@0,01@0,03@0,03@0,04@0,04@0",
        "mirrored: a-0,a-1,c-0",
        "lease polls: 16",
        "mirror service: none",
        "token refreshes: 0",
    ];
    const EXPECT_FETCH_FAILURE_LEASE_LOST = [
        "outcome: rejected EformsignBackfillLeaseLostError(\"Eformsign document backfill lost its execution lease\" summary={total 0/0/0/0/0/0/0 | 01 failed 0/0/0/0/0/0/0 error=\"Failed to fetch eformsign document page type=01 skip=0\" | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0})",
        "progress: started: total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: failed: total 0/0/0/0/0/0/0 | 01 failed 0/0/0/0/0/0/0 error=\"Failed to fetch eformsign document page type=01 skip=0\" | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "pages: 01@0",
        "mirrored: ",
        "lease polls: 3",
        "mirror service: none",
        "token refreshes: 0",
    ];
    const EXPECT_VERIFY_FETCH_FAILURE_LEASE_LOST = [
        "outcome: rejected EformsignBackfillLeaseLostError(\"Eformsign document backfill lost its execution lease\" summary={total 1/1/0/0/0/0/1 | 01 failed 1/1/0/0/0/0/1 error=\"Failed to verify eformsign document coverage type=01 skip=0\" | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0})",
        "progress: started: total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 01@1/1: total 1/1/0/0/0/0/1 | 01 pending 1/1/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: failed: total 1/1/0/0/0/0/1 | 01 failed 1/1/0/0/0/0/1 error=\"Failed to verify eformsign document coverage type=01 skip=0\" | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "pages: 01@0,01@0",
        "mirrored: a-0",
        "lease polls: 5",
        "mirror service: none",
        "token refreshes: 0",
    ];
    const EXPECT_FETCH_FAILURE_LEASE_HELD = [
        "outcome: rejected BackfillEformsignDocsError(\"Eformsign document backfill failed for types=01\" cause=[BackfillEformsignDocsError(\"Failed to fetch eformsign document page type=01 skip=0\" cause=Error(\"provider request rejected\") summary={total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0})] summary={total 0/0/0/0/0/0/2 | 01 failed 0/0/0/0/0/0/0 error=\"Failed to fetch eformsign document page type=01 skip=0\" | 03 completed 0/0/0/0/0/0/1 | 04 completed 0/0/0/0/0/0/1})",
        "progress: started: total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 03@0/0: total 0/0/0/0/0/0/1 | 01 failed 0/0/0/0/0/0/0 error=\"Failed to fetch eformsign document page type=01 skip=0\" | 03 pending 0/0/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 04@0/0: total 0/0/0/0/0/0/2 | 01 failed 0/0/0/0/0/0/0 error=\"Failed to fetch eformsign document page type=01 skip=0\" | 03 completed 0/0/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/1",
        "progress: failed: total 0/0/0/0/0/0/2 | 01 failed 0/0/0/0/0/0/0 error=\"Failed to fetch eformsign document page type=01 skip=0\" | 03 completed 0/0/0/0/0/0/1 | 04 completed 0/0/0/0/0/0/1",
        "pages: 01@0,03@0,03@0,04@0,04@0",
        "mirrored: ",
        "lease polls: 10",
        "mirror service: none",
        "token refreshes: 0",
    ];
    const EXPECT_LEASE_LOST_BETWEEN_PAGES = [
        "outcome: rejected EformsignBackfillLeaseLostError(\"Eformsign document backfill lost its execution lease\" summary={total 100/100/0/0/0/0/1 | 01 pending 100/100/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0})",
        "progress: started: total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 01@100/101: total 100/100/0/0/0/0/1 | 01 pending 100/100/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: failed: total 100/100/0/0/0/0/1 | 01 pending 100/100/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "pages: 01@0",
        "mirrored: 100 documents",
        "lease polls: 103",
        "mirror service: none",
        "token refreshes: 0",
    ];
    const EXPECT_LEASE_LOST_DURING_PAGE_FETCH = [
        "outcome: rejected EformsignBackfillLeaseLostError(\"Eformsign document backfill lost its execution lease\" summary={total 101/100/0/0/0/0/2 | 01 pending 101/100/0/0/0/0/2 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0})",
        "progress: started: total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 01@100/101: total 100/100/0/0/0/0/1 | 01 pending 100/100/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: failed: total 101/100/0/0/0/0/2 | 01 pending 101/100/0/0/0/0/2 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "pages: 01@0,01@100",
        "mirrored: 100 documents",
        "lease polls: 104",
        "mirror service: none",
        "token refreshes: 0",
    ];
    const EXPECT_ABSENT_NORMAL = [
        "outcome: resolved total 0/0/0/0/0/0/3 | 01 completed 0/0/0/0/0/0/1 | 03 completed 0/0/0/0/0/0/1 | 04 completed 0/0/0/0/0/0/1",
        "progress: started: total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 01@0/0: total 0/0/0/0/0/0/1 | 01 pending 0/0/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 03@0/0: total 0/0/0/0/0/0/2 | 01 completed 0/0/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 04@0/0: total 0/0/0/0/0/0/3 | 01 completed 0/0/0/0/0/0/1 | 03 completed 0/0/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/1",
        "progress: completed: total 0/0/0/0/0/0/3 | 01 completed 0/0/0/0/0/0/1 | 03 completed 0/0/0/0/0/0/1 | 04 completed 0/0/0/0/0/0/1",
        "pages: 01@0,01@0,03@0,03@0,04@0,04@0",
        "mirrored: ",
        "lease polls: 14",
        "mirror service: {\"findActiveDocumentIds\":[[]],\"findPermanentPurgeRequestedDocumentIds\":[[]],\"markDocumentsDeleted\":[[[\"gone-doc\"]]],\"purgeDocuments\":[]}",
        "token refreshes: 0",
    ];
    const EXPECT_ABSENT_LEASE_LOST = [
        "outcome: rejected EformsignBackfillLeaseLostError(\"Eformsign document backfill lost its execution lease\" summary={total 0/0/0/0/0/0/3 | 01 completed 0/0/0/0/0/0/1 | 03 completed 0/0/0/0/0/0/1 | 04 completed 0/0/0/0/0/0/1})",
        "progress: started: total 0/0/0/0/0/0/0 | 01 pending 0/0/0/0/0/0/0 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 01@0/0: total 0/0/0/0/0/0/1 | 01 pending 0/0/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/0 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 03@0/0: total 0/0/0/0/0/0/2 | 01 completed 0/0/0/0/0/0/1 | 03 pending 0/0/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/0",
        "progress: page 04@0/0: total 0/0/0/0/0/0/3 | 01 completed 0/0/0/0/0/0/1 | 03 completed 0/0/0/0/0/0/1 | 04 pending 0/0/0/0/0/0/1",
        "progress: failed: total 0/0/0/0/0/0/3 | 01 completed 0/0/0/0/0/0/1 | 03 completed 0/0/0/0/0/0/1 | 04 completed 0/0/0/0/0/0/1",
        "pages: 01@0,01@0,03@0,03@0,04@0,04@0",
        "mirrored: ",
        "lease polls: 14",
        "mirror service: {\"findActiveDocumentIds\":[[]],\"findPermanentPurgeRequestedDocumentIds\":[[]],\"markDocumentsDeleted\":[],\"purgeDocuments\":[]}",
        "token refreshes: 0",
    ];

    const variants = ["plain", "receipt"] as const;
    type Variant = typeof variants[number];
    type Page = { documents: EformsignApiDocumentResponse[]; total_rows: number };
    type Handler = (call: number, skip: number, h: Harness) => Promise<Page>;

    interface Harness {
        usecase: BackfillEformsignDocsUsecase;
        polls: number;
        held: boolean;
        pageCalls: string[];
        mirrored: string[];
        mirrorService: Record<string, jest.Mock> | undefined;
        boundary: ReturnType<typeof createBoundary>;
    }

    const emptyPage = (): Promise<Page> => Promise.resolve({ documents: [], total_rows: 0 });
    const docs = (prefix: string, count: number) =>
        Array.from({ length: count }, (_, index) => createRemoteDocument(`${prefix}-${index}`));

    function makeHarness(
        handlers: Partial<Record<"01" | "03" | "04", Handler>> = {},
        onMirror?: (id: string, h: Harness) => void,
        absentLocalDocument = false,
    ): Harness {
        const calls: Record<string, number> = { "01": 0, "03": 0, "04": 0 };
        const holder = {} as Harness;
        const page = (type: "01" | "03" | "04") => jest.fn((_token: string, _limit: number, skip: number) => {
            holder.pageCalls.push(`${type}@${skip}`);
            const call = calls[type]!;
            calls[type] = call + 1;
            return (handlers[type] ?? emptyPage)(call, skip, holder);
        });
        const client = {
            getInProgressDocumentsPage: page("01"),
            getCompletedDocumentsPage: page("03"),
            getRejectedDocumentsPage: page("04"),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn((document: EformsignApiDocumentResponse) => {
                holder.mirrored.push(document.id);
                onMirror?.(document.id, holder);
                return Promise.resolve({ documentId: document.id });
            }),
        };
        // Only the absence post-pass scenario wires the optional mirror service; every
        // other scenario leaves it out so that post-pass is skipped, as in production specs.
        const mirrorService = absentLocalDocument ? {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["gone-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
            markDocumentsDeleted: jest.fn().mockResolvedValue(undefined),
            purgeDocuments: jest.fn(),
        } : undefined;
        Object.assign(client, absentLocalDocument
            ? { getDocument: jest.fn().mockRejectedValue(new EformsignApiError("missing", 404)) } : {});
        const boundary = createBoundary();
        // Six constructor parameters: exactly what base accepts, no collection writer.
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            boundary as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null) } as never,
            mirror as never,
            mirrorService as never,
            undefined,
        );
        Object.assign(holder, {
            usecase, polls: 0, held: true, pageCalls: [], mirrored: [], mirrorService, boundary,
        });
        return holder;
    }

    /** One line per summary: counts are fetched/created/updated/skipped/duplicates/failed/pages. */
    const flat = (summary: EformsignDocsBackfillSummary): string => {
        const row = (x: EformsignDocsBackfillSummary | EformsignDocsBackfillTypeSummary) =>
            [x.fetched, x.created, x.updated, x.skipped, x.duplicates, x.failed, x.pages].join("/");
        return [`total ${row(summary)}`, ...(["01", "03", "04"] as const).map(type => {
            const entry = summary.byDocumentType[type];
            return `${type} ${entry.status} ${row(entry)}${entry.error ? ` error=${JSON.stringify(entry.error)}` : ""}`;
        })].join(" | ");
    };

    const describeError = (error: unknown): string => {
        if (Array.isArray(error)) return `[${error.map(describeError).join(", ")}]`;
        if (!(error instanceof Error)) return `non-error ${String(error)}`;
        const backfill = error as Partial<BackfillEformsignDocsError>;
        const cause = (error as { cause?: unknown }).cause;
        return `${error.constructor.name}(${JSON.stringify(error.message)}`
            + `${cause !== undefined ? ` cause=${describeError(cause)}` : ""}`
            + `${backfill.summary ? ` summary={${flat(backfill.summary)}}` : ""})`;
    };

    /** The whole observable run, one line per concern, so expectations stay readable. */
    async function run(
        h: Harness,
        variant: Variant,
        lease?: (poll: number, h: Harness) => boolean,
    ): Promise<string[]> {
        const progress: string[] = [];
        const options = {
            ...(variant === "receipt" ? { receiptContext: RECEIPT_CONTEXT } : {}),
            ...(lease ? { shouldContinue: () => { h.polls += 1; return lease(h.polls, h); } } : {}),
            onProgress: (p: EformsignDocsBackfillProgress) => progress.push(
                `${p.phase}${p.documentType ? ` ${p.documentType}@${p.skip}/${p.totalCount}` : ""}: ${flat(p.summary)}`),
        };
        let outcome: string;
        try {
            outcome = `resolved ${flat(await h.usecase.execute(options as never, TEST_PRINCIPAL))}`;
        } catch (error) {
            outcome = `rejected ${describeError(error)}`;
        }
        return [
            `outcome: ${outcome}`,
            ...progress.map(line => `progress: ${line}`),
            `pages: ${h.pageCalls.join(",")}`,
            `mirrored: ${h.mirrored.length > 6 ? `${h.mirrored.length} documents` : h.mirrored.join(",")}`,
            `lease polls: ${h.polls}`,
            `mirror service: ${h.mirrorService
                ? JSON.stringify(Object.fromEntries(Object.entries(h.mirrorService).map(([name, fn]) => [name, fn.mock.calls])))
                : "none"}`,
            `token refreshes: ${h.boundary.withRefreshedCredentials.mock.calls.length}`,
        ];
    }

    /** Each scenario is run with and without receiptContext; both must equal the base trace. */
    async function bothVariants(
        build: () => Harness,
        lease: ((poll: number, h: Harness) => boolean) | undefined,
        expected: string[],
    ) {
        for (const variant of variants) {
            expect(await run(build(), variant, lease)).toEqual(expected);
        }
    }

    const NORMAL_HANDLERS = {
        "01": () => Promise.resolve({ documents: docs("a", 2), total_rows: 2 }),
        "03": () => Promise.resolve({ documents: docs("c", 1), total_rows: 1 }),
    };
    const buildNormal = () => makeHarness(NORMAL_HANDLERS);

    it("a: completes normally with the base summary, progress phases and mirror calls", async () => {
        await bothVariants(buildNormal, () => true, EXPECT_NORMAL);
    });

    it("a: completes normally when no shouldContinue is supplied", async () => {
        await bothVariants(buildNormal, undefined, EXPECT_NORMAL_NO_LEASE);
    });

    it("b: succeeds when the lease flips only after base's last lease check", async () => {
        await bothVariants(buildNormal, poll => poll <= LAST_LEASE_POLL, EXPECT_NORMAL);
    });

    it("b: fails with the base lease error when the lease is lost at the last lease check", async () => {
        await bothVariants(buildNormal, poll => poll < LAST_LEASE_POLL, EXPECT_LEASE_LOST_AT_LAST_CHECK);
    });

    const buildAbsent = () => makeHarness({}, undefined, true);

    it("a: the absence post-pass completes normally and tombstones the vendor-absent document", async () => {
        await bothVariants(buildAbsent, () => true, EXPECT_ABSENT_NORMAL);
    });

    it("b: the absence post-pass runs unchanged and succeeds when the lease flips after its last check", async () => {
        await bothVariants(buildAbsent, poll => poll <= LAST_LEASE_POLL_ABSENT, EXPECT_ABSENT_NORMAL);
    });

    it("b: the absence post-pass fails with the base lease error when the lease is lost at its last check", async () => {
        await bothVariants(buildAbsent, poll => poll < LAST_LEASE_POLL_ABSENT, EXPECT_ABSENT_LEASE_LOST);
    });

    it("c: a provider fetch failure while the lease is lost surfaces as the base lease error without the fetch cause", async () => {
        await bothVariants(
            () => makeHarness({
                "01": (_call, _skip, h) => { h.held = false; return Promise.reject(new Error("provider request rejected")); },
            }),
            (_poll, h) => h.held,
            EXPECT_FETCH_FAILURE_LEASE_LOST,
        );
    });

    it("c: a pass-2 verification fetch failure while the lease is lost surfaces as the base lease error", async () => {
        await bothVariants(
            () => makeHarness({
                "01": (call, _skip, h) => {
                    if (call === 0) return Promise.resolve({ documents: docs("a", 1), total_rows: 1 });
                    h.held = false;
                    return Promise.reject(new Error("verification request rejected"));
                },
            }),
            (_poll, h) => h.held,
            EXPECT_VERIFY_FETCH_FAILURE_LEASE_LOST,
        );
    });

    it("c: a provider fetch failure with the lease held keeps the base error chain and continues later types", async () => {
        await bothVariants(
            () => makeHarness({ "01": () => Promise.reject(new Error("provider request rejected")) }),
            () => true,
            EXPECT_FETCH_FAILURE_LEASE_HELD,
        );
    });

    it("d: stops before fetching the next page when the lease is lost after a full page was mirrored", async () => {
        await bothVariants(
            () => makeHarness(
                { "01": (_call, skip) => Promise.resolve({ documents: docs(`p${skip}`, skip === 0 ? 100 : 1), total_rows: 101 }) },
                (_id, h) => { if (h.mirrored.length === 100) h.held = false; },
            ),
            (_poll, h) => h.held,
            EXPECT_LEASE_LOST_BETWEEN_PAGES,
        );
    });

    it("d: stops before the first write when the lease is lost while the next page is fetched", async () => {
        await bothVariants(
            () => makeHarness({
                "01": (_call, skip, h) => {
                    if (skip > 0) h.held = false;
                    return Promise.resolve({ documents: docs(`p${skip}`, skip === 0 ? 100 : 1), total_rows: 101 });
                },
            }),
            (_poll, h) => h.held,
            EXPECT_LEASE_LOST_DURING_PAGE_FETCH,
        );
    });
});
