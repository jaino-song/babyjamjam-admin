import { ConflictException, InternalServerErrorException } from "@nestjs/common";

import { ContractSupersedeService } from "application/services/contract-supersede.service";
import { createEformsignWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";

const BRANCH_ID = "00000000-0000-0000-0000-000000000010";
const principal = createEformsignWorkerPrincipal(BRANCH_ID);

const UNSIGNED = { status_type: "030", step_type: "05", step_name: "고객 서명" };
const SIGNED = { status_type: "003", step_type: "05", step_name: "고객 서명" };

function build(overrides: {
    document?: Record<string, unknown> | null;
    fresh?: { current_status: Record<string, unknown> };
    cancelResult?: unknown;
    terminal?: string[];
} = {}) {
    const repository = {
        findSupersedeCandidate: jest.fn().mockResolvedValue(overrides.document === undefined
                ? {
                    clientId: 7, documentKind: "contract",
                    statusType: "030", stepType: "05", stepName: "고객 서명",
                }
                : overrides.document),
    };
    const credentialBoundary = {
        withCredentials: jest.fn(async (
            _principal: unknown,
            _capability: string,
            operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
        ) => operation({ accessToken: "server-access-token", refreshToken: "server-refresh-token" })),
    };
    const eformsignService = {
        getDocumentById: jest.fn().mockResolvedValue(overrides.fresh ?? { current_status: UNSIGNED }),
        cancelDocuments: jest.fn().mockResolvedValue(overrides.cancelResult ?? {
            result: { success_result: ["old-doc"], fail_result: [] },
        }),
    };
    const documentMirrorService = {
        findTerminalDocumentIds: jest.fn().mockResolvedValue(overrides.terminal ?? []),
        purgeDocuments: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ContractSupersedeService(
        repository as never,
        credentialBoundary as never,
        eformsignService as never,
        documentMirrorService as never,
    );
    return { service, repository, credentialBoundary, eformsignService, documentMirrorService };
}

const params = { branchId: BRANCH_ID, clientId: 7, documentId: "old-doc", principal };

describe("ContractSupersedeService", () => {
    it("cancels and then purges an unsigned contract", async () => {
        const { service, eformsignService, documentMirrorService, credentialBoundary } = build();

        await expect(service.supersede(params)).resolves.toEqual({ documentId: "old-doc", superseded: true });

        expect(credentialBoundary.withCredentials.mock.calls.map((call) => call[1]))
            .toEqual(["document.read", "document.cancel"]);
        expect(eformsignService.cancelDocuments).toHaveBeenCalledWith("server-access-token", ["old-doc"]);
        expect(documentMirrorService.purgeDocuments).toHaveBeenCalledWith(["old-doc"]);
        expect(eformsignService.getDocumentById.mock.invocationCallOrder[0]!)
            .toBeLessThan(eformsignService.cancelDocuments.mock.invocationCallOrder[0]!);
        expect(eformsignService.cancelDocuments.mock.invocationCallOrder[0]!)
            .toBeLessThan(documentMirrorService.purgeDocuments.mock.invocationCallOrder[0]!);
    });

    it("refuses with a conflict, without cancelling, when the fresh vendor status shows it signed", async () => {
        const { service, eformsignService, documentMirrorService } = build({
            fresh: { current_status: SIGNED },
        });

        await expect(service.supersede(params)).rejects.toBeInstanceOf(ConflictException);

        expect(eformsignService.cancelDocuments).not.toHaveBeenCalled();
        expect(documentMirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it.each([
        ["a missing document", null],
        ["another client's document", { clientId: 8, documentKind: "contract", statusType: "030", stepType: "05", stepName: "고객 서명" }],
        ["an unowned legacy document", { clientId: null, documentKind: "contract", statusType: "030", stepType: "05", stepName: "고객 서명" }],
        ["a service-record snapshot", { clientId: 7, documentKind: "service_record_snapshot", statusType: "030", stepType: "05", stepName: "고객 서명" }],
        ["a locally signed document", { clientId: 7, documentKind: "contract", statusType: "003", stepType: "05", stepName: "고객 서명" }],
    ])("refuses %s before any vendor call", async (_label, document) => {
        const { service, eformsignService, credentialBoundary, documentMirrorService } = build({ document });

        await expect(service.supersede(params)).rejects.toBeInstanceOf(ConflictException);

        expect(credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(eformsignService.cancelDocuments).not.toHaveBeenCalled();
        expect(documentMirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("refuses a terminal mirrored document", async () => {
        const { service, eformsignService } = build({ terminal: ["old-doc"] });

        await expect(service.supersede(params)).rejects.toBeInstanceOf(ConflictException);

        expect(eformsignService.cancelDocuments).not.toHaveBeenCalled();
    });

    it("keeps the local copy when the vendor refuses the cancel", async () => {
        const { service, documentMirrorService } = build({
            cancelResult: {
                result: { success_result: [], fail_result: [{ document_id: "old-doc", code: "4000164" }] },
            },
        });

        await expect(service.supersede(params)).rejects.toBeInstanceOf(ConflictException);

        expect(documentMirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("answers 500 and keeps the local copy when the cancel outcome is ambiguous", async () => {
        const { service, eformsignService, documentMirrorService } = build();
        eformsignService.cancelDocuments.mockRejectedValue(new Error("socket hang up"));

        await expect(service.supersede(params)).rejects.toBeInstanceOf(InternalServerErrorException);

        expect(documentMirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("answers 500 when the local purge fails after a confirmed cancel", async () => {
        const { service, documentMirrorService } = build();
        documentMirrorService.purgeDocuments.mockRejectedValue(new Error("db down"));

        await expect(service.supersede(params)).rejects.toBeInstanceOf(InternalServerErrorException);
    });
});
