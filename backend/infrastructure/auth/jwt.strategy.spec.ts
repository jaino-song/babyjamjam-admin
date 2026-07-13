import { UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
    const prisma = { user: { findUnique: jest.fn() } };
    let strategy: JwtStrategy;

    beforeEach(() => {
        jest.clearAllMocks();
        strategy = new JwtStrategy(prisma as unknown as PrismaService);
    });

    it("rejects a payload without tokenVersion", async () => {
        prisma.user.findUnique.mockResolvedValue({ tokenVersion: 0, approvalStatus: "approved", role: "user" });
        await expect(strategy.validate({ sub: "user-1", role: "user", type: "access" })).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects a payload with a stale tokenVersion", async () => {
        prisma.user.findUnique.mockResolvedValue({ tokenVersion: 2, approvalStatus: "approved", role: "user" });
        await expect(strategy.validate({ sub: "user-1", role: "user", type: "access", tokenVersion: 1 })).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("returns the fresh DB role, ignoring a stale role baked into the token", async () => {
        // Token still claims "manager" but the account was demoted to "user" in the DB — authz must
        // reflect the DB, so a PATCH /users demotion takes effect on the next request (H1).
        prisma.user.findUnique.mockResolvedValue({ tokenVersion: 2, approvalStatus: "approved", role: "user" });
        await expect(strategy.validate({ sub: "user-1", role: "manager", type: "access", tokenVersion: 2, branchId: "branch-1" }))
            .resolves.toEqual({ userId: "user-1", role: "user", branchId: "branch-1", branchRole: undefined });
    });
});
