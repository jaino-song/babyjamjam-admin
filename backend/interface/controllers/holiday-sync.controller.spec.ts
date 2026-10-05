import { ForbiddenException, HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { HolidaySyncController } from "./holiday-sync.controller";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";

function makeController(branchId = BRANCH_ID) {
    const service = {
        syncManually: jest.fn().mockResolvedValue([
            { year: 2026, status: "updated", added: 1, removed: 0 },
            { year: 2027, status: "failed", added: 0, removed: 0, error: "not_published" },
        ]),
    };
    const tenantContext = { branchId };
    const controller = new HolidaySyncController(service as never, tenantContext as never);
    return { controller, service };
}

describe("HolidaySyncController", () => {
    it("is POST branches/:branchId/holidays/sync answering 200 (not 201)", () => {
        const handler = HolidaySyncController.prototype.sync;
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("branches/:branchId/holidays/sync");
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);
    });

    it("guards the write route in order: JwtGuard, TenantGuard, BranchManagerGuard (per method)", () => {
        expect(Reflect.getMetadata("__guards__", HolidaySyncController.prototype.sync)).toEqual([
            JwtGuard,
            TenantGuard,
            BranchManagerGuard,
        ]);
        expect(Reflect.getMetadata("__guards__", HolidaySyncController)).toBeUndefined();
    });

    it("returns the per-year results, including failed years", async () => {
        const { controller, service } = makeController();
        await expect(controller.sync(BRANCH_ID)).resolves.toEqual({
            results: [
                { year: 2026, status: "updated", added: 1, removed: 0 },
                { year: 2027, status: "failed", added: 0, removed: 0, error: "not_published" },
            ],
        });
        expect(service.syncManually).toHaveBeenCalledTimes(1);
    });

    it("rejects a path branch that differs from the tenant branch with ACCESS_DENIED and does not sync", async () => {
        const { controller, service } = makeController();
        const error = await controller.sync("22222222-2222-4222-8222-222222222222").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toMatchObject({ code: "ACCESS_DENIED" });
        expect(service.syncManually).not.toHaveBeenCalled();
    });
});
