import { EformsignDispatchIntentEntity } from "domain/entities/eformsign-dispatch-intent.entity";
import {
    CancelEformsignDocumentsUsecase,
} from "application/usecases/eformsign-doc/cancel-eformsign-documents.usecase";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";

const makeIntent = (overrides: Partial<ConstructorParameters<typeof EformsignDispatchIntentEntity>[0]> = {}) => {
    const now = new Date("2026-09-18T00:00:00.000Z");
    return new EformsignDispatchIntentEntity({
        id: "intent-1",
        branchId: "branch-1",
        clientId: 7,
        localDocumentId: 11,
        assignmentId: 13,
        providerDocumentId: "doc-1",
        templateId: "template-1",
        action: "cancel",
        generation: "cancel:doc-1:source-1",
        businessKey: "b".repeat(64),
        fingerprint: "f".repeat(64),
        status: "started",
        attemptCount: 1,
        startedAt: now,
        providerAcceptedAt: null,
        uncertainAt: null,
        uncertainReason: null,
        providerReceipt: null,
        reconciledAt: null,
        reconciledOutcome: null,
        reconciledByUserId: null,
        reconciliationReason: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    });
};

const makeTarget = (documentId: string, intent = makeIntent({ id: `intent-${documentId}` })) => ({
    documentId,
    branchId: "branch-1",
    localDocumentId: documentId === "doc-1" ? 11 : 12,
    clientId: 7,
    assignmentId: 13,
    templateId: "template-1",
    providerDocumentId: documentId,
    sourceIntentId: "source-1",
    sourceIntentStatus: "accepted",
    purgeGeneration: new Date("2026-09-18T00:00:00.000Z"),
    cancellationIntent: intent,
});

describe("CancelEformsignDocumentsUsecase", () => {
    it("rejects a principal without document.cancel before claiming or calling the provider", async () => {
        const cancellationRepository = {
            begin: jest.fn(),
            completeAccepted: jest.fn(),
            markUncertain: jest.fn(),
            clearAuthoritativeRefusal: jest.fn(),
            reconcile: jest.fn(),
            findByIntentId: jest.fn(),
        };
        const eformsignService = { cancelDocuments: jest.fn() };
        const credentialBoundary = { withCredentials: jest.fn() };
        const usecase = new CancelEformsignDocumentsUsecase(
            cancellationRepository as never,
            eformsignService as never,
            credentialBoundary as never,
            { getDocument: jest.fn() } as never,
        );

        await expect(usecase.execute(
            {
                branchId: "branch-1",
                documentIds: ["doc-1"],
                actorUserId: "operator-1",
            },
            {
                branchId: "branch-1",
                userId: "operator-1",
                branchRole: "manager",
            },
        )).rejects.toThrow("Eformsign provider capability required");
        expect(cancellationRepository.begin).not.toHaveBeenCalled();
        expect(credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(eformsignService.cancelDocuments).not.toHaveBeenCalled();
    });

    it("persists each provider outcome independently and returns sanitized batch results", async () => {
        const targetOne = makeTarget("doc-1");
        const targetTwo = makeTarget("doc-2", makeIntent({
            id: "intent-doc-2",
            providerDocumentId: "doc-2",
            localDocumentId: 12,
        }));
        const cancellationRepository = {
            begin: jest.fn().mockResolvedValue({ targets: [targetOne, targetTwo] }),
            completeAccepted: jest.fn().mockResolvedValue(makeIntent({ status: "accepted" })),
            markUncertain: jest.fn().mockResolvedValue(makeIntent({ status: "uncertain" })),
            clearAuthoritativeRefusal: jest.fn(),
            reconcile: jest.fn(),
            findByIntentId: jest.fn(),
        };
        const eformsignService = {
            cancelDocuments: jest.fn().mockResolvedValue({
                result: {
                    success_result: ["doc-1"],
                    fail_result: [{ document_id: "doc-2", code: "4000031", phone: "01011112222" }],
                },
            }),
        };
        const credentialBoundary = {
            withCredentials: jest.fn(async (_principal, _capability, operation) =>
                operation({ accessToken: "redacted", refreshToken: "redacted" })),
        };
        const usecase = new CancelEformsignDocumentsUsecase(
            cancellationRepository as never,
            eformsignService as never,
            credentialBoundary as never,
            { getDocument: jest.fn() } as never,
        );

        const result = await usecase.execute(
            {
                branchId: "branch-1",
                documentIds: ["doc-1", "doc-2"],
                actorUserId: "operator-1",
            },
            { branchId: "branch-1", userId: "operator-1", branchRole: "admin" },
        );

        expect(eformsignService.cancelDocuments).toHaveBeenCalledWith(
            "redacted",
            ["doc-1", "doc-2"],
            "관리자 삭제",
        );
        expect(cancellationRepository.completeAccepted).toHaveBeenCalledWith(expect.objectContaining({
            target: targetOne,
            providerReceipt: expect.objectContaining({ documentId: "doc-1", decision: "accepted" }),
        }));
        expect(cancellationRepository.markUncertain).toHaveBeenCalledWith(expect.objectContaining({
            target: targetTwo,
            reason: "provider_cancel_uncertain:4000031",
        }));
        expect(result.result.success_result).toEqual(["doc-1"]);
        expect(result.result.fail_result).toEqual([{
            document_id: "doc-2",
            outcome: "uncertain",
            code: "4000031",
        }]);
        expect(JSON.stringify(result)).not.toContain("01011112222");
    });

    it("marks every claimed document uncertain before surfacing a provider timeout", async () => {
        const targetOne = makeTarget("doc-1");
        const targetTwo = makeTarget("doc-2", makeIntent({
            id: "intent-doc-2",
            providerDocumentId: "doc-2",
            localDocumentId: 12,
        }));
        const cancellationRepository = {
            begin: jest.fn().mockResolvedValue({ targets: [targetOne, targetTwo] }),
            completeAccepted: jest.fn(),
            markUncertain: jest.fn().mockResolvedValue(makeIntent({ status: "uncertain" })),
            clearAuthoritativeRefusal: jest.fn(),
            reconcile: jest.fn(),
            findByIntentId: jest.fn(),
        };
        const eformsignService = {
            cancelDocuments: jest.fn().mockRejectedValue(new Error("socket timeout")),
        };
        const credentialBoundary = {
            withCredentials: jest.fn(async (_principal, _capability, operation) =>
                operation({ accessToken: "redacted", refreshToken: "redacted" })),
        };
        const usecase = new CancelEformsignDocumentsUsecase(
            cancellationRepository as never,
            eformsignService as never,
            credentialBoundary as never,
            { getDocument: jest.fn() } as never,
        );

        await expect(usecase.execute(
            {
                branchId: "branch-1",
                documentIds: ["doc-1", "doc-2"],
                actorUserId: "operator-1",
            },
            { branchId: "branch-1", userId: "operator-1", branchRole: "admin" },
        )).rejects.toThrow("socket timeout");
        expect(cancellationRepository.markUncertain).toHaveBeenCalledTimes(2);
        expect(cancellationRepository.completeAccepted).not.toHaveBeenCalled();
    });

    it("does not call the provider for an already terminal cancellation", async () => {
        const terminalTarget = makeTarget("doc-1", makeIntent({
            status: "accepted",
            providerAcceptedAt: new Date(),
        }));
        const cancellationRepository = {
            begin: jest.fn().mockResolvedValue({ targets: [terminalTarget] }),
            completeAccepted: jest.fn(),
            markUncertain: jest.fn(),
            clearAuthoritativeRefusal: jest.fn(),
            reconcile: jest.fn(),
            findByIntentId: jest.fn(),
        };
        const eformsignService = { cancelDocuments: jest.fn() };
        const credentialBoundary = { withCredentials: jest.fn() };
        const usecase = new CancelEformsignDocumentsUsecase(
            cancellationRepository as never,
            eformsignService as never,
            credentialBoundary as never,
            { getDocument: jest.fn() } as never,
        );

        const result = await usecase.execute(
            { branchId: "branch-1", documentIds: ["doc-1"], actorUserId: "operator-1" },
            { branchId: "branch-1", userId: "operator-1", branchRole: "admin" },
        );
        expect(eformsignService.cancelDocuments).not.toHaveBeenCalled();
        expect(result.result.success_result).toEqual(["doc-1"]);
    });

    it("requires provider terminal proof before accepting a delivered reconciliation", async () => {
        const cancellationRepository = {
            begin: jest.fn(),
            completeAccepted: jest.fn(),
            markUncertain: jest.fn(),
            clearAuthoritativeRefusal: jest.fn(),
            findByIntentId: jest.fn().mockResolvedValue(makeIntent({ status: "uncertain" })),
            reconcile: jest.fn().mockResolvedValue({
                intent: makeIntent({
                    status: "reconciled_delivered",
                    reconciledOutcome: "delivered",
                }),
                clearedPurgeFence: false,
            }),
        };
        const eformsignClient = {
            getDocument: jest.fn().mockResolvedValue({
                id: "doc-1",
                current_status: { status_type: "099" },
            }),
        };
        const credentialBoundary = {
            withCredentials: jest.fn(async (_principal, _capability, operation) =>
                operation({ accessToken: "redacted", refreshToken: "redacted" })),
        };
        const usecase = new CancelEformsignDocumentsUsecase(
            cancellationRepository as never,
            {} as never,
            credentialBoundary as never,
            eformsignClient as never,
        );

        await expect(usecase.reconcile(
            {
                branchId: "branch-1",
                intentId: "intent-1",
                actorUserId: "operator-1",
                reason: "operator verified",
                outcome: "delivered",
                providerDocumentId: "doc-1",
            },
            { branchId: "branch-1", userId: "operator-1", branchRole: "admin" },
        )).resolves.toEqual(expect.objectContaining({ clearedPurgeFence: false }));

        expect(eformsignClient.getDocument).toHaveBeenCalledWith("redacted", "doc-1");
        expect(cancellationRepository.reconcile).toHaveBeenCalledWith(expect.objectContaining({
            reason: expect.stringContaining("provider_terminal_verified"),
        }));
    });

    it("accepts delivered reconciliation only when provider absence is authoritative", async () => {
        const cancellationRepository = {
            findByIntentId: jest.fn().mockResolvedValue(makeIntent({ status: "uncertain" })),
            reconcile: jest.fn().mockResolvedValue({
                intent: makeIntent({ status: "reconciled_delivered", reconciledOutcome: "delivered" }),
                clearedPurgeFence: false,
            }),
        };
        const eformsignClient = {
            getDocument: jest.fn().mockRejectedValue(new EformsignApiError("missing", 404)),
        };
        const credentialBoundary = {
            withCredentials: jest.fn(async (_principal, _capability, operation) =>
                operation({ accessToken: "redacted", refreshToken: "redacted" })),
        };
        const usecase = new CancelEformsignDocumentsUsecase(
            cancellationRepository as never,
            {} as never,
            credentialBoundary as never,
            eformsignClient as never,
        );

        await expect(usecase.reconcile(
            {
                branchId: "branch-1",
                intentId: "intent-1",
                actorUserId: "operator-1",
                reason: "provider unavailable",
                outcome: "delivered",
            },
            { branchId: "branch-1", userId: "operator-1", branchRole: "admin" },
        )).resolves.toEqual(expect.objectContaining({ clearedPurgeFence: false }));
        expect(cancellationRepository.reconcile).toHaveBeenCalledWith(expect.objectContaining({
            reason: expect.stringContaining("provider_absence_verified"),
        }));
    });

    it("retains the fence when provider response is ambiguous or from another document", async () => {
        const cancellationRepository = {
            findByIntentId: jest.fn().mockResolvedValue(makeIntent({ status: "uncertain" })),
            reconcile: jest.fn(),
        };
        const ambiguousClient = {
            getDocument: jest.fn().mockRejectedValue(new EformsignApiError("ambiguous", 400, "4000031")),
        };
        const credentialBoundary = {
            withCredentials: jest.fn(async (_principal, _capability, operation) =>
                operation({ accessToken: "redacted", refreshToken: "redacted" })),
        };
        const usecase = new CancelEformsignDocumentsUsecase(
            cancellationRepository as never,
            {} as never,
            credentialBoundary as never,
            ambiguousClient as never,
        );
        const request = {
            branchId: "branch-1",
            intentId: "intent-1",
            actorUserId: "operator-1",
            reason: "manual check",
            outcome: "delivered" as const,
        };
        const principal = { branchId: "branch-1", userId: "operator-1", branchRole: "admin" };

        await expect(usecase.reconcile(request, principal)).rejects.toThrow(/수동 재검증/);
        expect(cancellationRepository.reconcile).not.toHaveBeenCalled();

        cancellationRepository.findByIntentId.mockResolvedValue(makeIntent({
            status: "uncertain",
            providerDocumentId: "doc-1",
        }));
        const mismatchClient = {
            getDocument: jest.fn().mockResolvedValue({
                id: "other-doc",
                current_status: { status_type: "099" },
            }),
        };
        const mismatchUsecase = new CancelEformsignDocumentsUsecase(
            cancellationRepository as never,
            {} as never,
            credentialBoundary as never,
            mismatchClient as never,
        );
        await expect(mismatchUsecase.reconcile(request, principal)).rejects.toThrow(/소유 범위/);
        expect(cancellationRepository.reconcile).not.toHaveBeenCalled();
    });
});
