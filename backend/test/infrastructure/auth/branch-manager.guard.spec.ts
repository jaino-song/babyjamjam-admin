import { ExecutionContext } from "@nestjs/common";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";

describe("BranchManagerGuard", () => {
    const guard = new BranchManagerGuard();

    const contextFor = (
        tenant?: Record<string, unknown>,
        user?: Record<string, unknown>,
    ): ExecutionContext => ({
        switchToHttp: () => ({ getRequest: () => ({ tenant, user }) }),
    } as unknown as ExecutionContext);

    it.each([
        ["owner", { globalRole: "owner", branchRole: "owner" }],
        ["branch admin", { globalRole: "user", branchRole: "admin" }],
        ["branch manager", { globalRole: "user", branchRole: "manager" }],
    ])("allows %s tenant principal", (_label, tenant) => {
        expect(guard.canActivate(contextFor(tenant))).toBe(true);
    });

    it.each([
        ["branch user", { globalRole: "user", branchRole: "user" }],
        ["global admin with branch user", { globalRole: "admin", branchRole: "user" }],
        ["missing tenant", undefined],
    ])("denies %s tenant principal", (_label, tenant) => {
        expect(guard.canActivate(contextFor(tenant, { role: "owner" }))).toBe(false);
    });
});
