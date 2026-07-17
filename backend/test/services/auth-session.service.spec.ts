import { JwtService } from "@nestjs/jwt";

import { AuthSessionService } from "application/services/auth-session.service";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("AuthSessionService", () => {
    const user = {
        id: "10000000-0000-4000-8000-000000000001",
        role: "admin",
        approvalStatus: "approved",
        tokenVersion: 3,
    };
    const tx = {
        $queryRaw: jest.fn(),
        auth_session: {
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        auth_refresh_token: {
            create: jest.fn(),
            findUnique: jest.fn(),
            updateMany: jest.fn(),
        },
        branch: { findUnique: jest.fn() },
        user_branch: { findUnique: jest.fn() },
    };
    const prisma = {
        $transaction: jest.fn(),
        auth_session: {
            findUnique: jest.fn(),
            updateMany: jest.fn(),
        },
    };
    const jwt = { signAsync: jest.fn() };
    let service: AuthSessionService;

    beforeEach(() => {
        jest.clearAllMocks();
        prisma.$transaction.mockImplementation(async (callback) => callback(tx));
        jwt.signAsync.mockResolvedValue("signed-access");
        tx.auth_session.create.mockResolvedValue({});
        tx.auth_session.update.mockResolvedValue({});
        tx.auth_session.updateMany.mockResolvedValue({ count: 1 });
        tx.$queryRaw.mockResolvedValue([
            { id: "40000000-0000-4000-8000-000000000001" },
        ]);
        tx.auth_refresh_token.create.mockResolvedValue({});
        tx.auth_refresh_token.updateMany.mockResolvedValue({ count: 1 });
        service = new AuthSessionService(
            prisma as unknown as PrismaService,
            jwt as unknown as JwtService,
        );
    });

    it("stores only a refresh secret hash and signs a 15 minute sid access token", async () => {
        const tokens = await service.issueSession(user, {
            branchId: "20000000-0000-4000-8000-000000000001",
            branchRole: "admin",
        });

        const [tokenId, secret] = tokens.refreshToken.split(".");
        expect(tokenId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(tx.auth_refresh_token.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                id: tokenId,
                secretHash: expect.stringMatching(/^[0-9a-f]{64}$/),
            }),
        });
        const persisted = tx.auth_refresh_token.create.mock.calls[0][0].data;
        expect(persisted.secretHash).not.toContain(secret);
        expect(jwt.signAsync).toHaveBeenCalledWith(
            expect.objectContaining({
                sid: expect.any(String),
                type: "access",
                tokenVersion: 3,
            }),
            { expiresIn: "15m" },
        );
    });

    it("conditionally consumes one refresh token and creates its successor", async () => {
        const now = new Date();
        const secret = "a".repeat(32);
        const rawToken = `30000000-0000-4000-8000-000000000001.${secret}`;
        const hash = (service as unknown as { hashSecret(secret: string): string })
            .hashSecret(secret);
        tx.auth_refresh_token.findUnique.mockResolvedValue({
            id: "30000000-0000-4000-8000-000000000001",
            sessionId: "40000000-0000-4000-8000-000000000001",
            secretHash: hash,
            expiresAt: new Date(now.getTime() + 60_000),
            usedAt: null,
            revokedAt: null,
            session: {
                id: "40000000-0000-4000-8000-000000000001",
                userId: user.id,
                selectedBranchId: null,
                expiresAt: new Date(now.getTime() + 60_000),
                revokedAt: null,
                user,
            },
        });

        const result = await service.rotateRefreshToken(rawToken);

        expect(result.refreshToken).not.toBe(rawToken);
        expect(tx.auth_refresh_token.updateMany).toHaveBeenCalledWith({
            where: {
                id: "30000000-0000-4000-8000-000000000001",
                usedAt: null,
                revokedAt: null,
            },
            data: {
                usedAt: expect.any(Date),
                replacedByTokenId: expect.any(String),
                activeMarker: null,
            },
        });
        expect(tx.auth_refresh_token.create).toHaveBeenCalledTimes(1);
    });

    it("does not revoke the session for a replay inside the concurrency grace", async () => {
        const usedAt = new Date();
        const secret = "b".repeat(32);
        const secretHash = (service as unknown as { hashSecret(secret: string): string })
            .hashSecret(secret);
        tx.auth_refresh_token.findUnique.mockResolvedValue({
            id: "30000000-0000-4000-8000-000000000001",
            sessionId: "40000000-0000-4000-8000-000000000001",
            secretHash,
            expiresAt: new Date(Date.now() + 60_000),
            usedAt,
            revokedAt: null,
            session: {
                id: "40000000-0000-4000-8000-000000000001",
                userId: user.id,
                selectedBranchId: null,
                expiresAt: new Date(Date.now() + 60_000),
                revokedAt: null,
                user,
            },
        });

        await expect(service.rotateRefreshToken(
            `30000000-0000-4000-8000-000000000001.${secret}`,
        )).rejects.toMatchObject({
            response: expect.objectContaining({
                code: "AUTH_REFRESH_REPLAY_CONCURRENT",
            }),
        });
        expect(tx.auth_session.updateMany).not.toHaveBeenCalled();
    });
});
