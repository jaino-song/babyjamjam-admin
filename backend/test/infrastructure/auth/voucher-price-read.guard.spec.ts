import { ExecutionContext } from "@nestjs/common";
import { VoucherPriceReadGuard } from "infrastructure/auth/voucher-price-read.guard";

describe("VoucherPriceReadGuard", () => {
    const guard = new VoucherPriceReadGuard();

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
        ["global manager with branch user", { globalRole: "manager", branchRole: "user" }],
        ["missing tenant", undefined],
    ])("denies %s tenant principal", (_label, tenant) => {
        expect(guard.canActivate(contextFor(tenant))).toBe(false);
    });

    it("does not fall back to an owner role on request.user when tenant is missing", () => {
        expect(guard.canActivate(contextFor(undefined, { role: "owner" }))).toBe(false);
    });
});
