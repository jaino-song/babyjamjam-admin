import { EformsignDocumentJobReconciliationService } from "application/services/eformsign-document-job-reconciliation.service";
import { createEformsignWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";
import { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
import * as sentryReporting from "infrastructure/observability/service-record-sentry";

const mockSentryCapture = jest.fn((error: unknown) => {
    void error;
    return "event-id";
});
jest.mock("@sentry/nestjs", () => ({
    withScope: (callback: (scope: Record<string, jest.Mock>) => unknown) => callback({
        setLevel: jest.fn(), setTag: jest.fn(), setContext: jest.fn(), setFingerprint: jest.fn(),
    }),
    captureException: (error: unknown) => mockSentryCapture(error),
}));

const TEST_PRINCIPAL = createEformsignWorkerPrincipal("00000000-0000-0000-0000-000000000010");

function createCredentialBoundary() {
    return {
        withCredentials: jest.fn(async (
            _principal: unknown,
            _capability: unknown,
            operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
        ) => operation({ accessToken: "token", refreshToken: "refresh-token" })),
    };
}

function job(overrides: Partial<EformsignDocumentJobEntity> = {}): EformsignDocumentJobEntity {
    return new EformsignDocumentJobEntity({
        id: "00000000-0000-0000-0000-000000000001",
        branchId: "00000000-0000-0000-0000-000000000010",
        clientId: 7,
        documentId: null,
        jobType: "create_document",
        source: "staff",
        status: "reconciling",
        requestKey: "request-1",
        activeKey: "create:branch:7",
        payload: { clientId: 7, contractData: { customerName: "고객" } },
        payloadFingerprint: "a".repeat(64),
        progressDetail: null, progressStep: "creating",
        attempts: 1,
        nextAttemptAt: new Date(),
        heartbeatAt: new Date(),
        leaseToken: "00000000-0000-0000-0000-000000000099",
        autoFinalizeOutcomeRecordedAt: null,
        autoFinalizeOutcomeAttempts: null,
        startedAt: new Date("2026-08-13T00:00:00Z"),
        completedAt: null,
        lastErrorCode: null,
        createdByUserId: null,
        createdAt: new Date("2026-08-13T00:00:00Z"),
        updatedAt: new Date(),
        ...overrides,
    });
}

describe("EformsignDocumentJobReconciliationService", () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([
        ["provider-read", "PROVIDER_STATE_UNAVAILABLE"],
        ["provider-detail-read", "PROVIDER_DOCUMENT_NOT_FOUND"],
        ["adoption", "ADOPTION_FAILED"],
        ["completion-mirror", "COMPLETION_MIRROR_FAILED"],
    ])("captures the %s cause and keeps its attention transition", async (step, reason) => {
        mockSentryCapture.mockClear();
        const error = new Error("provider failure with private payload");
        const capture = jest.spyOn(sentryReporting, "captureBackendError");
        const transitioned = job({ status: "requires_attention", lastErrorCode: reason });
        const repository = {
            markCompleted: jest.fn(),
            markRequiresAttention: jest.fn().mockResolvedValue(transitioned),
        };
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            createCredentialBoundary() as never,
            { execute: step === "provider-read"
                ? jest.fn().mockRejectedValue(error)
                : jest.fn().mockResolvedValue([{
                    id: "doc-1", created_date: Date.now(),
                    document_name: step === "provider-detail-read" ? "unmatched" : "고객 계약서",
                }]),
            } as never,
            { execute: step === "provider-detail-read"
                ? jest.fn().mockRejectedValue(error)
                : jest.fn().mockResolvedValue({ current_status: { status_type: "003" } }),
            } as never,
            { execute: step === "adoption"
                ? jest.fn().mockRejectedValue(error)
                : jest.fn().mockResolvedValue(undefined),
            } as never,
            { syncDocument: jest.fn().mockRejectedValue(error) } as never,
        );
        const input = step === "completion-mirror"
            ? job({ jobType: "finalize_document", documentId: "doc-1" }) : job();
        await expect(service.reconcile(input, TEST_PRINCIPAL)).resolves.toMatchObject({
            status: "requires_attention", reason, transitioned,
        });
        expect(capture).toHaveBeenCalledWith(error, { handled: true, operation: `document-job-${step}` });
        expect(mockSentryCapture).toHaveBeenCalledTimes(1);
        expect(mockSentryCapture.mock.calls[0]?.[0]).toMatchObject({
            message: "Backend failure",
            stack: expect.stringContaining(error.stack?.split("\n")[1] ?? "missing source stack"),
        });
        expect(repository.markCompleted).not.toHaveBeenCalled();
    });

    it("still marks provider-state attention when Sentry throws", async () => {
        const error = new Error("provider unavailable");
        const capture = jest.spyOn(sentryReporting, "captureBackendError").mockImplementation(() => {
            throw new Error("Sentry unavailable");
        });
        const repository = { markRequiresAttention: jest.fn().mockResolvedValue(null) };
        const service = new EformsignDocumentJobReconciliationService(
            repository as never, createCredentialBoundary() as never,
            { execute: jest.fn().mockRejectedValue(error) } as never,
            { execute: jest.fn() } as never, { execute: jest.fn() } as never,
        );
        await expect(service.reconcile(job(), TEST_PRINCIPAL)).resolves.toMatchObject({
            status: "requires_attention", reason: "PROVIDER_STATE_UNAVAILABLE",
        });
        expect(capture).toHaveBeenCalledWith(error, { handled: true, operation: "document-job-provider-read" });
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(job().id, job().leaseToken, "PROVIDER_STATE_UNAVAILABLE");
    });

    it("adopts the unique provider creation and completes the job", async () => {
        const repository = {
            markCompleted: jest.fn().mockResolvedValue(null),
            markRequiresAttention: jest.fn(),
        };
        const adoption = { execute: jest.fn().mockResolvedValue(undefined) };
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            createCredentialBoundary() as never,
            {
                execute: jest.fn().mockResolvedValue([{
                    id: "doc-1",
                    created_date: Date.now(),
                    document_name: "고객 계약서",
                }]),
            } as never,
            { execute: jest.fn() } as never,
            adoption as never,
        );

        await expect(service.reconcile(job(), TEST_PRINCIPAL)).resolves.toEqual({
            status: "completed",
            documentId: "doc-1",
            completionRecorded: false,
        });
        expect(adoption.execute).toHaveBeenCalledWith(
            "00000000-0000-0000-0000-000000000010",
            { documentId: "doc-1", clientId: 7 },
            TEST_PRINCIPAL,
        );
        expect(repository.markCompleted).toHaveBeenCalledWith(
            job().id,
            job().leaseToken,
            "doc-1",
        );
    });

    it("reports the completion as recorded when the job lease was still held", async () => {
        const repository = {
            markCompleted: jest.fn().mockResolvedValue(job({ status: "completed" })),
            markRequiresAttention: jest.fn(),
        };
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            createCredentialBoundary() as never,
            {
                execute: jest.fn().mockResolvedValue([{
                    id: "doc-1",
                    created_date: Date.now(),
                    document_name: "고객 계약서",
                }]),
            } as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn().mockResolvedValue(undefined) } as never,
        );

        await expect(service.reconcile(job(), TEST_PRINCIPAL)).resolves.toEqual({
            status: "completed",
            documentId: "doc-1",
            completionRecorded: true,
        });
    });

    it("requires attention when provider creation state is ambiguous", async () => {
        const repository = {
            markCompleted: jest.fn(),
            markRequiresAttention: jest.fn().mockResolvedValue(null),
        };
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            createCredentialBoundary() as never,
            {
                execute: jest.fn().mockResolvedValue([
                    { id: "doc-1", created_date: Date.now(), document_name: "고객 계약서" },
                    { id: "doc-2", created_date: Date.now(), document_name: "고객 계약서" },
                ]),
            } as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
        );

        await expect(service.reconcile(job(), TEST_PRINCIPAL)).resolves.toEqual({
            status: "requires_attention",
            reason: "AMBIGUOUS_PROVIDER_STATE",
            recordedAttempts: null,
            transitioned: null,
        });
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            job().id,
            job().leaseToken,
            "AMBIGUOUS_PROVIDER_STATE",
        );
    });

    it("requires attention when provider creation lookup fails", async () => {
        const repository = {
            markCompleted: jest.fn(),
            markRequiresAttention: jest.fn().mockResolvedValue(null),
        };
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            createCredentialBoundary() as never,
            { execute: jest.fn().mockRejectedValue(new Error("provider unavailable")) } as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
        );

        await expect(service.reconcile(job(), TEST_PRINCIPAL)).resolves.toEqual({
            status: "requires_attention",
            reason: "PROVIDER_STATE_UNAVAILABLE",
            recordedAttempts: null,
            transitioned: null,
        });
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            job().id,
            job().leaseToken,
            "PROVIDER_STATE_UNAVAILABLE",
        );
    });

    it("completes finalization only after a completed provider status and mirror sync", async () => {
        const repository = {
            markCompleted: jest.fn().mockResolvedValue(null),
            markRequiresAttention: jest.fn(),
        };
        const mirror = { syncDocument: jest.fn().mockResolvedValue({ status: "synced" }) };
        const finalizationJob = job({
            jobType: "finalize_document",
            documentId: "doc-finalize",
            payload: { documentId: "doc-finalize" },
        });
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            createCredentialBoundary() as never,
            { execute: jest.fn() } as never,
            {
                execute: jest.fn().mockResolvedValue({ current_status: { status_type: "003" } }),
            } as never,
            { execute: jest.fn() } as never,
            mirror as never,
        );

        await expect(service.reconcile(finalizationJob, TEST_PRINCIPAL)).resolves.toEqual({
            status: "completed",
            documentId: "doc-finalize",
        });
        expect(mirror.syncDocument).toHaveBeenCalledWith(
            "doc-finalize",
            TEST_PRINCIPAL,
            expect.objectContaining({ strictCompletionReconciliation: true }),
        );
        expect(repository.markCompleted).toHaveBeenCalledWith(
            finalizationJob.id,
            finalizationJob.leaseToken,
            "doc-finalize",
        );
    });
    // 계약-04: 071 (reviewer rejection) left the terminal set, so a finalization job that finds it is
    // "provider state unfinished" (070/072 may still follow), not a terminal failure; 080 stays terminal.
    it.each([
        ["071", "PROVIDER_STATE_UNFINISHED"],
        ["070", "PROVIDER_STATE_UNFINISHED"],
        ["080", "PROVIDER_TERMINAL_FAILURE"],
        ["061", "PROVIDER_TERMINAL_FAILURE"],
    ])("requires attention for a finalization job whose provider status is %s (%s)", async (statusType, reason) => {
        const repository = {
            markCompleted: jest.fn(),
            markRequiresAttention: jest.fn().mockResolvedValue(null),
        };
        const finalizationJob = job({
            jobType: "finalize_document",
            documentId: "doc-finalize",
            payload: { documentId: "doc-finalize" },
        });
        const service = new EformsignDocumentJobReconciliationService(
            repository as never,
            createCredentialBoundary() as never,
            { execute: jest.fn() } as never,
            {
                execute: jest.fn().mockResolvedValue({ current_status: { status_type: statusType } }),
            } as never,
            { execute: jest.fn() } as never,
        );

        await expect(service.reconcile(finalizationJob, TEST_PRINCIPAL)).resolves.toEqual(
            expect.objectContaining({ status: "requires_attention", reason }),
        );
        expect(repository.markCompleted).not.toHaveBeenCalled();
    });

    describe("transitioned", () => {
        function ambiguousService(markRequiresAttention: jest.Mock) {
            return new EformsignDocumentJobReconciliationService(
                { markCompleted: jest.fn(), markRequiresAttention } as never,
                createCredentialBoundary() as never,
                {
                    execute: jest.fn().mockResolvedValue([
                        { id: "doc-1", created_date: Date.now(), document_name: "고객 계약서" },
                        { id: "doc-2", created_date: Date.now(), document_name: "고객 계약서" },
                    ]),
                } as never,
                { execute: jest.fn() } as never,
                { execute: jest.fn() } as never,
            );
        }

        it("carries the entity markRequiresAttention returned", async () => {
            const moved = job({ status: "requires_attention" });
            const service = ambiguousService(jest.fn().mockResolvedValue(moved));

            const result = await service.reconcile(job(), TEST_PRINCIPAL);

            expect(result.status).toBe("requires_attention");
            expect(result.transitioned).toBe(moved);
        });

        it("is null when the lease was lost and nothing transitioned", async () => {
            const service = ambiguousService(jest.fn().mockResolvedValue(null));

            const result = await service.reconcile(job(), TEST_PRINCIPAL);

            expect(result.status).toBe("requires_attention");
            expect(result.transitioned).toBeNull();
        });

        it("stays undefined for the MISSING_JOB_LEASE early return", async () => {
            const markRequiresAttention = jest.fn();
            const service = ambiguousService(markRequiresAttention);

            const result = await service.reconcile(job({ leaseToken: null }), TEST_PRINCIPAL);

            expect(result).toEqual({ status: "requires_attention", reason: "MISSING_JOB_LEASE" });
            expect(result.transitioned).toBeUndefined();
            expect(markRequiresAttention).not.toHaveBeenCalled();
        });
    });
});
