import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ServiceRecordGuard } from "infrastructure/auth/service-record.guard";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";

function setup(resolved: unknown) {
    const tokenService = { resolveAccess: jest.fn().mockResolvedValue(resolved) };
    const guard = new ServiceRecordGuard(tokenService as never);
    const request: { headers: { authorization: string }; serviceRecordContext?: unknown } = {
        headers: { authorization: "Bearer test-access" },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    return { guard, request, context };
}

describe("ServiceRecordGuard tenant propagation", () => {
    it("retains the verified token branch for downstream controller queries", async () => {
        const resolved = { tokenId: "token", branchId: "branch-1", scheduleId: 10, employeeId: 7 };
        const { guard, request, context } = setup(resolved);
        await tenantContextStore.run({ origin: "http" }, async () => {
            expect(await guard.canActivate(context)).toBe(true);
            expect(request.serviceRecordContext).toEqual(resolved);
            expect(tenantContextStore.get()).toEqual({ origin: "http", branchId: "branch-1" });
        });
    });

    it("does not install a branch or request context for invalid access", async () => {
        const { guard, request, context } = setup(null);
        await tenantContextStore.run({ origin: "http" }, async () => {
            await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
            expect(request.serviceRecordContext).toBeUndefined();
            expect(tenantContextStore.get()).toEqual({ origin: "http" });
        });
    });
});
