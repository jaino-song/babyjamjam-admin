import { BadGatewayException, ForbiddenException, HttpException, Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { VoidContractDocumentUsecase } from "application/usecases/eformsign-doc/void-contract-document.usecase";
import { EformsignCredentialBoundary } from "application/services/eformsign-credential-boundary.service";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { EFORMSIGN_DOC_REPOSITORY, type EformsignVoidCandidate } from "domain/repositories/eformsign-doc.repository.interface";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";
import { createHolidayCalendarStub } from "../../utils/holiday-calendar.stub";

describe("VoidContractDocumentUsecase", () => {
    let usecase: VoidContractDocumentUsecase;
    const tenant = { branchId: "branch-1", userId: "actor-1", branchRole: "user" };
    const candidate: EformsignVoidCandidate = {
        documentId: "doc-1", clientId: 1, documentKind: null, serviceRecordCaseId: null,
        statusType: "060", stepType: "05", stepName: "이용자 서명",
        voidedAt: null, permanentPurgeRequestedAt: null,
    };
    const repository = { findVoidCandidate: jest.fn(), markVoided: jest.fn(), findVoidedByNames: jest.fn() };
    const vendor = { cancelDocuments: jest.fn() };
    const boundary = { withCredentials: jest.fn() };
    const snapshot = { bumpVersion: jest.fn() };
    const events = { emit: jest.fn() };
    let warn: jest.SpyInstance;

    beforeEach(async () => {
        jest.resetAllMocks();
        warn = jest.spyOn(Logger, "warn").mockImplementation(() => undefined);
        repository.findVoidCandidate.mockResolvedValue({ ...candidate });
        repository.markVoided.mockResolvedValue(true);
        repository.findVoidedByNames.mockResolvedValue(new Map([[tenant.userId, "담당자"]]));
        vendor.cancelDocuments.mockResolvedValue({ result: { success_result: ["doc-1"] } });
        boundary.withCredentials.mockImplementation(async (_tenant, _operation, callback) => callback({ accessToken: "test-token" }));
        const module = await Test.createTestingModule({ providers: [
            VoidContractDocumentUsecase,
            { provide: EFORMSIGN_DOC_REPOSITORY, useValue: repository },
            { provide: EformsignCredentialBoundary, useValue: boundary },
            { provide: EformsignService, useValue: vendor },
            { provide: EformsignDocumentSnapshotService, useValue: snapshot },
            { provide: EformsignDocsEventBus, useValue: events },
            { provide: HolidayCalendarService, useValue: createHolidayCalendarStub() },
        ] }).compile();
        usecase = module.get(VoidContractDocumentUsecase);
    });
    afterEach(() => warn.mockRestore());

    async function rejects(status: number, code: string, outcome = "NOT_APPLIED") {
        try { await usecase.execute(tenant, "doc-1"); throw new Error("expected rejection"); }
        catch (error) {
            expect(error).toBeInstanceOf(HttpException);
            expect((error as HttpException).getStatus()).toBe(status);
            expect((error as HttpException).getResponse()).toMatchObject({ code, outcome });
        }
        expect(repository.markVoided).not.toHaveBeenCalled();
    }

    it("returns 404 on a scoped miss without calling the vendor", async () => {
        repository.findVoidCandidate.mockResolvedValue(null);
        await rejects(404, "RESOURCE_NOT_FOUND");
        expect(repository.findVoidCandidate).toHaveBeenCalledWith("branch-1", "doc-1");
        expect(vendor.cancelDocuments).not.toHaveBeenCalled();
    });

    it.each<[string, Partial<EformsignVoidCandidate>]>([
        ["already voided", { voidedAt: new Date() }],
        ["purge pending", { permanentPurgeRequestedAt: new Date() }],
        ["snapshot kind", { documentKind: "service_record_snapshot" }],
        ["service record case", { serviceRecordCaseId: "case-1" }],
        ["unowned", { clientId: null }],
        ["deleted 047", { statusType: "047" }],
        ["deleted 049", { statusType: "049" }],
        ["deleted 099", { statusType: "099" }],
        ["revoked 042", { statusType: "042" }],
        ["revoked 090", { statusType: "090" }],
        ["expired", { statusType: "080" }],
        ["rejected shown expired", { statusType: "011" }],
    ])("refuses %s before vendor or write", async (_label, overrides) => {
        repository.findVoidCandidate.mockResolvedValue({ ...candidate, ...overrides });
        await rejects(409, "REQUEST_CONFLICT");
        expect(vendor.cancelDocuments).not.toHaveBeenCalled();
        expect(boundary.withCredentials).not.toHaveBeenCalled();
    });

    it.each([
        ["050", "05", false], ["060", "06", false], ["060", "05", true], ["040", "05", true], ["045", "05", true],
    ])("voids status %s step %s (cancel=%s)", async (statusType, stepType, cancel) => {
        repository.findVoidCandidate.mockResolvedValue({ ...candidate, statusType, stepType });
        const response = await usecase.execute(tenant, "doc-1");
        expect(response.displayStatus).toBe("voided");
        expect(repository.markVoided).toHaveBeenCalledWith("branch-1", "doc-1", expect.any(Date), "actor-1");
        if (cancel) {
            expect(vendor.cancelDocuments).toHaveBeenCalledTimes(1);
            expect(vendor.cancelDocuments).toHaveBeenCalledWith("test-token", ["doc-1"], "계약 파기");
            expect(boundary.withCredentials).toHaveBeenCalledWith(tenant, "document.cancel", expect.any(Function));
            expect(vendor.cancelDocuments.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(repository.markVoided.mock.invocationCallOrder[0] ?? 0);
        } else {
            expect(vendor.cancelDocuments).not.toHaveBeenCalled();
            expect(boundary.withCredentials).not.toHaveBeenCalled();
        }
        expect(snapshot.bumpVersion).toHaveBeenCalledWith("branch-1");
        expect(repository.markVoided.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(snapshot.bumpVersion.mock.invocationCallOrder[0] ?? 0);
        expect(events.emit).toHaveBeenCalledWith({ branchId: "branch-1", documentId: "doc-1", reason: "mirror:changed" });
    });

    it.each([new Error("token failed"), new EformsignApiError("token refused", 401), new BadGatewayException()])(
        "maps pre-call acquisition failure %s to 503, not 409", async (error) => {
            boundary.withCredentials.mockRejectedValue(error);
            await rejects(503, "DEPENDENCY_UNAVAILABLE");
            expect(vendor.cancelDocuments).not.toHaveBeenCalled();
        },
    );
    it("rethrows a pre-call ForbiddenException unchanged", async () => {
        const error = new ForbiddenException();
        boundary.withCredentials.mockRejectedValue(error);
        await expect(usecase.execute(tenant, "doc-1")).rejects.toBe(error);
        expect(repository.markVoided).not.toHaveBeenCalled();
        expect(vendor.cancelDocuments).not.toHaveBeenCalled();
    });
    it("accepts a success id without re-reading", async () => {
        await usecase.execute(tenant, "doc-1");
        expect(repository.findVoidCandidate).toHaveBeenCalledTimes(1);
        expect(repository.markVoided).toHaveBeenCalledTimes(1);
    });
    it.each(["050", "060"])("accepts failed cancel only when scoped re-read is signed (%s)", async (statusType) => {
        vendor.cancelDocuments.mockResolvedValue({ result: { fail_result: [{ document_id: "doc-1" }] } });
        repository.findVoidCandidate.mockResolvedValueOnce(candidate).mockResolvedValueOnce({ ...candidate, statusType, stepType: "06" });
        await usecase.execute(tenant, "doc-1");
        expect(repository.findVoidCandidate).toHaveBeenNthCalledWith(2, "branch-1", "doc-1");
        expect(repository.markVoided).toHaveBeenCalledTimes(1);
    });
    it.each([candidate, null])("refuses failed cancel if re-read is not signed: %s", async (fresh) => {
        vendor.cancelDocuments.mockResolvedValue({ result: { fail_result: [{ document_id: "doc-1" }] } });
        repository.findVoidCandidate.mockResolvedValueOnce(candidate).mockResolvedValueOnce(fresh);
        await rejects(409, "REQUEST_CONFLICT");
        expect(warn).toHaveBeenCalledWith({ documentId: "doc-1" }, VoidContractDocumentUsecase.name);
    });
    it("refuses a missing success id", async () => {
        vendor.cancelDocuments.mockResolvedValue({});
        await rejects(409, "REQUEST_CONFLICT");
    });
    it("keeps an uncertain outcome if the post-cancel local read fails", async () => {
        vendor.cancelDocuments.mockResolvedValue({});
        repository.findVoidCandidate.mockResolvedValueOnce(candidate).mockRejectedValueOnce(new Error());
        await rejects(500, "INTERNAL_ERROR", "UNKNOWN");
        expect(warn).toHaveBeenCalledWith({ documentId: "doc-1" }, VoidContractDocumentUsecase.name);
    });
    it.each([400, 401, 403, 422])("maps attempted vendor refusal %s to 409", async (status) => {
        vendor.cancelDocuments.mockRejectedValue(new EformsignApiError("refused", status));
        await rejects(409, "REQUEST_CONFLICT");
        expect(warn).toHaveBeenCalledWith({ documentId: "doc-1" }, VoidContractDocumentUsecase.name);
    });
    it.each([new Error("network"), new EformsignApiError("absent", 404), new EformsignApiError("timeout", 408), new EformsignApiError("limit", 429), new EformsignApiError("vendor down", 503), new BadGatewayException()])(
        "maps attempted ambiguous error %s to uncertain 500", async (error) => {
            vendor.cancelDocuments.mockRejectedValue(error);
            await rejects(500, "INTERNAL_ERROR", "UNKNOWN");
        },
    );
    it("returns 409 if guarded write loses a race", async () => {
        repository.markVoided.mockResolvedValue(false);
        await expect(usecase.execute(tenant, "doc-1")).rejects.toMatchObject({ status: 409 });
        expect(repository.markVoided).toHaveBeenCalledTimes(1);
        expect(snapshot.bumpVersion).not.toHaveBeenCalled();
        expect(events.emit).not.toHaveBeenCalled();
    });
    it("logs a failed local write after successful cancellation without reporting success", async () => {
        repository.markVoided.mockRejectedValue(new Error());
        await expect(usecase.execute(tenant, "doc-1")).rejects.toMatchObject({ status: 500 });
        expect(vendor.cancelDocuments).toHaveBeenCalledTimes(1);
        expect(repository.markVoided).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith({ documentId: "doc-1" }, VoidContractDocumentUsecase.name);
        expect(snapshot.bumpVersion).not.toHaveBeenCalled();
        expect(events.emit).not.toHaveBeenCalled();
    });
    it.each(["bump", "emit"])("keeps success after %s failure", async (operation) => {
        if (operation === "bump") snapshot.bumpVersion.mockRejectedValue(new Error());
        else events.emit.mockImplementation(() => { throw new Error(); });
        await expect(usecase.execute(tenant, "doc-1")).resolves.toMatchObject({ displayStatus: "voided" });
        expect(snapshot.bumpVersion).toHaveBeenCalled();
        expect(events.emit).toHaveBeenCalled();
        expect(repository.markVoided).toHaveBeenCalledTimes(1);
    });
    it("returns exactly the public shape with ISO time and display name", async () => {
        const response = await usecase.execute(tenant, "doc-1");
        expect(response).toEqual({ documentId: "doc-1", voidedAt: expect.any(String), voidedByName: "담당자", displayStatus: "voided" });
        expect(new Date(response.voidedAt).toISOString()).toBe(response.voidedAt);
        expect(repository.findVoidedByNames).toHaveBeenCalledWith(["actor-1"]);
    });
    it.each([new Map([[tenant.userId, null]]), new Map()])("returns null when actor has no name: %s", async (names) => {
        repository.findVoidedByNames.mockResolvedValue(names);
        await expect(usecase.execute(tenant, "doc-1")).resolves.toMatchObject({ voidedByName: null });
    });
    it("returns null when actor lookup fails", async () => {
        repository.findVoidedByNames.mockRejectedValue(new Error());
        await expect(usecase.execute(tenant, "doc-1")).resolves.toMatchObject({ voidedByName: null });
    });
});
