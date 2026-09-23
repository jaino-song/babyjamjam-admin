import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ServiceRecordGuard } from "infrastructure/auth/service-record.guard";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";

function setup(resolved: unknown, header?: string) {
    const tokenService = { resolveAccess: jest.fn().mockResolvedValue(resolved) };
    const guard = new ServiceRecordGuard(tokenService as never);
    const request: { headers: { authorization?: string }; serviceRecordContext?: unknown } = {
        headers: header === undefined ? {} : { authorization: header },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    return { guard, request, context };
}

// Every rejection is a registered AUTH_REQUIRED problem (401): the HTTP
// mapper keys on the body code, and the public body must not reveal which
// auth step failed (missing header, bad format, expired/unknown token).
async function expectAuthProblem(promise: Promise<unknown>): Promise<void> {
    const error: unknown = await promise.then(
        () => { throw new Error("expected the guard to reject"); },
        (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: "AUTH_REQUIRED",
        outcome: "NOT_APPLIED",
        recovery: { action: "NONE", retry: { mode: "NEVER" } },
    });
    expect((error as UnauthorizedException).getResponse()).not.toHaveProperty("errors");
}

describe("ServiceRecordGuard tenant propagation", () => {
    it("retains the verified token branch for downstream controller queries", async () => {
        const resolved = { tokenId: "token", branchId: "branch-1", scheduleId: 10, employeeId: 7 };
        const { guard, request, context } = setup(resolved, "Bearer test-access");
        await tenantContextStore.run({ origin: "http" }, async () => {
            expect(await guard.canActivate(context)).toBe(true);
            expect(request.serviceRecordContext).toEqual(resolved);
            expect(tenantContextStore.get()).toEqual({ origin: "http", branchId: "branch-1" });
        });
    });

    it("rejects a missing or malformed header with an AUTH_REQUIRED problem", async () => {
        const missing = setup(null);
        const malformed = setup(null, "Token abc");
        await expectAuthProblem(missing.guard.canActivate(missing.context));
        await expectAuthProblem(malformed.guard.canActivate(malformed.context));
    });

    it("does not install a branch or request context for invalid access", async () => {
        const { guard, request, context } = setup(null, "Bearer test-access");
        await tenantContextStore.run({ origin: "http" }, async () => {
            await expectAuthProblem(guard.canActivate(context));
            expect(request.serviceRecordContext).toBeUndefined();
            expect(tenantContextStore.get()).toEqual({ origin: "http" });
        });
    });
});
