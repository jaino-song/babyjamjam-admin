import { ExecutionContext } from "@nestjs/common";
import { OwnerOnlyGuard } from "infrastructure/auth/owner-only.guard";

describe("OwnerOnlyGuard", () => {
    let guard: OwnerOnlyGuard;

    const createExecutionContext = (user?: { role?: string }): ExecutionContext =>
        ({
            switchToHttp: () => ({
                getRequest: () => ({ user }),
            }),
        }) as ExecutionContext;

    beforeEach(() => {
        guard = new OwnerOnlyGuard();
    });

    it("should allow access when the caller role is owner", () => {
        const context = createExecutionContext({ role: "owner" });

        expect(guard.canActivate(context)).toBe(true);
    });

    it("should deny access when the caller role is admin", () => {
        const context = createExecutionContext({ role: "admin" });

        expect(guard.canActivate(context)).toBe(false);
    });

    it("should deny access when the caller role is manager", () => {
        const context = createExecutionContext({ role: "manager" });

        expect(guard.canActivate(context)).toBe(false);
    });

    it("should deny access when there is no authenticated user", () => {
        const context = createExecutionContext(undefined);

        expect(guard.canActivate(context)).toBe(false);
    });
});
