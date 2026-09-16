import { UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { JwtStrategy } from "./jwt.strategy";

// Every rejection is a registered AUTH_REQUIRED problem (401): the HTTP
// mapper keys on the body code, and the public body must never leak which
// internal check failed (token type, session state, token version, approval).
const expectAuthProblem = async (promise: Promise<unknown>): Promise<void> => {
    const error: unknown = await promise.then(
        () => { throw new Error("expected validate to reject"); },
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
};

describe("JwtStrategy", () => {
    const prisma = { auth_session: { findUnique: jest.fn() } };
    let strategy: JwtStrategy;

    beforeEach(() => {
        jest.clearAllMocks();
        strategy = new JwtStrategy(prisma as unknown as PrismaService);
    });

    it("rejects a payload without tokenVersion", async () => {
        prisma.auth_session.findUnique.mockResolvedValue({
            userId: "user-1",
            selectedBranchId: null,
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            user: { tokenVersion: 0, approvalStatus: "approved", role: "user" },
        });
        await expectAuthProblem(strategy.validate({ sub: "user-1", sid: "session-1", role: "user", type: "access" }));
    });

    it("rejects a payload with a stale tokenVersion", async () => {
        prisma.auth_session.findUnique.mockResolvedValue({
            userId: "user-1",
            selectedBranchId: null,
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            user: { tokenVersion: 2, approvalStatus: "approved", role: "user" },
        });
        await expectAuthProblem(strategy.validate({ sub: "user-1", sid: "session-1", role: "user", type: "access", tokenVersion: 1 }));
    });

    it("rejects a non-access token type before touching the store", async () => {
        await expectAuthProblem(strategy.validate({ sub: "user-1", sid: "session-1", role: "user", type: "refresh" }));
        expect(prisma.auth_session.findUnique).not.toHaveBeenCalled();
    });

    it("rejects an account whose approval is still pending", async () => {
        prisma.auth_session.findUnique.mockResolvedValue({
            userId: "user-1",
            selectedBranchId: null,
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            user: { tokenVersion: 1, approvalStatus: "pending", role: "user" },
        });
        await expectAuthProblem(strategy.validate({ sub: "user-1", sid: "session-1", role: "user", type: "access", tokenVersion: 1 }));
    });

    it("returns the fresh DB role, ignoring a stale role baked into the token", async () => {
        // Token still claims "manager" but the account was demoted to "user" in the DB — authz must
        // reflect the DB, so a PATCH /users demotion takes effect on the next request (H1).
        prisma.auth_session.findUnique.mockResolvedValue({
            userId: "user-1",
            selectedBranchId: "branch-1",
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            user: { tokenVersion: 2, approvalStatus: "approved", role: "user" },
        });
        await expect(strategy.validate({ sub: "user-1", sid: "session-1", role: "manager", type: "access", tokenVersion: 2, branchId: "branch-1" }))
            .resolves.toEqual({ userId: "user-1", sessionId: "session-1", role: "user", branchId: "branch-1", branchRole: undefined });
    });
});
