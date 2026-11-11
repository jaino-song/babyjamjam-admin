import { BadRequestException } from "@nestjs/common";
import { assertEmptyManualRecoveryBody, parseManualRecoveryEpochBody } from "interface/dto/eformsign-document-job-manual-recovery.dto";

describe("manual recovery request boundary", () => {
    it.each([undefined, {}])("accepts an empty open body %j", body => expect(() => assertEmptyManualRecoveryBody(body)).not.toThrow());
    it.each([null, [], { documentId: "caller-id" }, { userId: "caller" }, { branchId: "caller" }, { token: "private" }])("rejects open body %j", body => {
        expect(() => assertEmptyManualRecoveryBody(body)).toThrow(BadRequestException);
    });
    it.each(["1", "42", "9223372036854775807"])("accepts canonical epoch %s without Number conversion", claimEpoch => {
        expect(parseManualRecoveryEpochBody({ claimEpoch })).toBe(BigInt(claimEpoch));
    });
    it.each(["0", "042", "-1", "1.5", 42, "9223372036854775808", "42\n", "42 ", " 42", "", null])("rejects epoch %j", claimEpoch => {
        expect(() => parseManualRecoveryEpochBody({ claimEpoch })).toThrow(BadRequestException);
    });
    it.each([{ claimEpoch: "42", documentId: "caller-id" }, { claimEpoch: "42", status: "verified" }, { claimEpoch: "42", userId: "caller" }, {}])("rejects extra or missing verify fields %j", body => {
        expect(() => parseManualRecoveryEpochBody(body)).toThrow(BadRequestException);
    });
});

import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { PATH_METADATA, GUARDS_METADATA } from "@nestjs/common/constants";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";
import { runtimeFixture, J, principal, U, I } from "../utils/eformsign-contract-recovery.fixture";
function controllerFixture() {
    const f = runtimeFixture(); f.manual();
    const controller = Object.assign(Object.create(EformsignDocController.prototype), { manualRecovery: f.service }) as EformsignDocController;
    const response: any = { status: jest.fn(), json: jest.fn() }; response.status.mockReturnValue(response); response.json.mockReturnValue(response);
    return { ...f, controller, response };
}
describe("connected manual recovery controller", () => {
    it("registers both exact routes under the existing JWT/Tenant guards", () => {
        expect(Reflect.getMetadata(PATH_METADATA, EformsignDocController.prototype.openManualDocumentJobRecovery)).toBe("jobs/:jobId/recovery/open");
        expect(Reflect.getMetadata(PATH_METADATA, EformsignDocController.prototype.verifyManualDocumentJobRecovery)).toBe("jobs/:jobId/recovery/verify");
        expect(Reflect.getMetadata(GUARDS_METADATA, EformsignDocController).map((guard: any) => guard.name)).toEqual(["JwtGuard", "TenantGuard"]);
    });
    it("returns the exact editable union from the real service, without an envelope or credentials", async () => {
        const f = controllerFixture(); await f.controller.openManualDocumentJobRecovery(principal, { user: { userId: U } }, J, undefined, f.response);
        expect(f.response.status).toHaveBeenCalledWith(200); const body = f.response.json.mock.calls[0][0];
        expect(Object.keys(body).sort()).toEqual(["claimEpoch", "claimExpiresAt", "document", "jobId", "kind"]);
        expect(Object.keys(body.document).sort()).toEqual(["companyId", "documentId", "templateId"]);
        expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|payload|generation|leaseToken/);
    });
    it("rejects extra open/verify body fields before any transaction or provider call", async () => {
        const f = controllerFixture();
        await expect(f.controller.openManualDocumentJobRecovery(principal, {}, J, { documentId: "caller" }, f.response)).rejects.toBeInstanceOf(BadRequestException);
        await expect(f.controller.verifyManualDocumentJobRecovery(principal, {}, J, { claimEpoch: "42", status: "verified" }, f.response)).rejects.toBeInstanceOf(BadRequestException);
        expect(f.prisma.$transaction).not.toHaveBeenCalled(); expect(f.provider.getDocument).not.toHaveBeenCalled();
    });
    it("retains capability and authenticated actor checks", async () => {
        const f = controllerFixture();
        await expect(f.controller.openManualDocumentJobRecovery({ ...principal, branchRole: "user" }, {}, J, {}, f.response)).rejects.toBeInstanceOf(ForbiddenException);
        await expect(f.controller.openManualDocumentJobRecovery({ ...principal, userId: undefined }, {}, J, {}, f.response)).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(f.controller.openManualDocumentJobRecovery(principal, { user: { userId: I } }, J, {}, f.response)).rejects.toBeInstanceOf(ForbiddenException);
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });
    it("projects only the safe unsupported error", async () => {
        const f = controllerFixture(); f.state.jobs[0].contractGeneration = null;
        await f.controller.openManualDocumentJobRecovery(principal, {}, J, {}, f.response);
        expect(f.response.status).toHaveBeenCalledWith(409); expect(f.response.json).toHaveBeenCalledWith({ code: "RECOVERY_UNSUPPORTED", reason: "legacy_unbound" });
    });
    it("unknown provider failures become generic503 without leaking the private message", async () => {
        const f = controllerFixture(); f.provider.getDocument.mockRejectedValue(new Error("PRIVATE_ACCESS PRIVATE_PAYLOAD"));
        await f.controller.openManualDocumentJobRecovery(principal, {}, J, {}, f.response);
        expect(f.response.status).toHaveBeenCalledWith(503); expect(f.response.json).toHaveBeenCalledWith({ code: "RECOVERY_UNAVAILABLE" });
    });
});
