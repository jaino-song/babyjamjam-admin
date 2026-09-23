import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "crypto";
import { AuthService } from "application/services/auth.service";
import { AuthSessionService } from "application/services/auth-session.service";
import { AuthTokenEntity } from "domain/entities/auth-token.entity";
import { EmailPort } from "domain/ports/email.port";
import { IAuthTokenRepository } from "domain/repositories/auth-token.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";

describe("AuthService approval and token hardening", () => {
    const prisma = {
        user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        user_branch: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
        branch: { findUnique: jest.fn() },
        auth_token: { create: jest.fn(), deleteMany: jest.fn() },
        auth_email_outbox: { create: jest.fn() },
        auth_session: { updateMany: jest.fn() },
        auth_flow_state: { findUnique: jest.fn(), updateMany: jest.fn() },
        $transaction: jest.fn(),
    };
    const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
    const sessions = {
        issueSession: jest.fn(),
        rotateRefreshToken: jest.fn(),
    };
    const email: EmailPort = {
        send: jest.fn(), sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn(),
    };
    const tokens: jest.Mocked<IAuthTokenRepository> = {
        findByToken: jest.fn(), findByUserIdAndType: jest.fn(), create: jest.fn(), update: jest.fn(),
        consumeWithinTx: jest.fn(),
        delete: jest.fn(), deleteByUserIdAndType: jest.fn(), deleteExpiredTokens: jest.fn(),
    };
    let service: AuthService;

    beforeEach(() => {
        jest.clearAllMocks();
        jwt.signAsync.mockResolvedValue("signed");
        sessions.issueSession.mockImplementation(async (user, branch) => ({
            accessToken: await jwt.signAsync({
                sub: user.id,
                role: user.role,
                tokenVersion: user.tokenVersion,
                ...branch,
                type: "access",
            }, {}),
            refreshToken: "opaque-refresh",
        }));
        prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
        service = new AuthService(
            prisma as unknown as PrismaService,
            jwt as unknown as JwtService,
            email,
            tokens,
            sessions as unknown as AuthSessionService,
        );
    });

    it("registers an unassigned pending employee without trusting client branch or role", async () => {
        jest.spyOn(service, "hashPassword").mockResolvedValue("hash");
        jest.spyOn(service, "sendVerificationEmail").mockResolvedValue();
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.create.mockResolvedValue({ id: "user-1", email: "new@example.com" });

        await service.registerWithEmail("new@example.com", "Password1!", "New", "010", "1990-01-01");

        expect(prisma.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            role: null, approvalStatus: "pending", requestedRole: "user",
        }) });
        expect(prisma.branch.findUnique).not.toHaveBeenCalled();
        expect(prisma.user_branch.create).not.toHaveBeenCalled();
    });

    it("rejects a pending user before issuing login tokens", async () => {
        jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({
            id: "user-1", email: "p@example.com", passwordHash: "hash", emailVerified: true,
            role: null, approvalStatus: "pending", tokenVersion: 0,
        });

        const rejection = service.validateEmailPassword("p@example.com", "Password1!");
        await expect(rejection).rejects.toBeInstanceOf(ForbiddenException);
        await expect(rejection).rejects.toMatchObject({
            status: 403,
            response: expect.objectContaining({
                code: "PENDING_APPROVAL",
                params: {},
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });
        expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it("returns the registered ACCOUNT_REJECTED problem body for rejected accounts", async () => {
        jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({
            id: "user-1", email: "r@example.com", passwordHash: "hash", emailVerified: true,
            role: null, approvalStatus: "rejected", tokenVersion: 0,
        });

        const rejection = service.validateEmailPassword("r@example.com", "Password1!");
        await expect(rejection).rejects.toMatchObject({
            status: 403,
            response: expect.objectContaining({
                code: "ACCOUNT_REJECTED",
                params: {},
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });
        expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it("returns the registered NO_ACCESSIBLE_BRANCH problem body when no selectable branch exists", async () => {
        jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({
            id: "user-1", email: "b@example.com", name: "B", profileImage: null, phone: "010",
            birthDate: "1990-01-01", passwordHash: "hash", emailVerified: true, role: "user",
            approvalStatus: "approved", tokenVersion: 4,
        });
        prisma.user_branch.findMany.mockResolvedValue([]);

        const rejection = service.validateEmailPassword("b@example.com", "Password1!");
        await expect(rejection).rejects.toMatchObject({
            status: 403,
            response: expect.objectContaining({
                code: "NO_ACCESSIBLE_BRANCH",
                params: {},
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });
        expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it("issues approved-user tokens containing tokenVersion", async () => {
        jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({
            id: "user-1", email: "a@example.com", name: "A", profileImage: null, phone: "010",
            birthDate: "1990-01-01", passwordHash: "hash", emailVerified: true, role: "user",
            approvalStatus: "approved", tokenVersion: 4,
        });
        prisma.user_branch.findMany.mockResolvedValue([{ branchId: "branch-1", role: "user" }]);

        await service.validateEmailPassword("a@example.com", "Password1!");

        expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ tokenVersion: 4, type: "access" }), expect.any(Object));
    });

    it("runs the login membership lookup under an audited system-scope store", async () => {
        jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({
            id: "user-1", email: "a@example.com", name: "A", profileImage: null, phone: "010",
            birthDate: "1990-01-01", passwordHash: "hash", emailVerified: true, role: "user",
            approvalStatus: "approved", tokenVersion: 4,
        });
        let observedStore: ReturnType<typeof tenantContextStore.get>;
        prisma.user_branch.findMany.mockImplementation(async () => {
            observedStore = tenantContextStore.get();
            return [{ branchId: "branch-1", role: "user" }];
        });

        await service.validateEmailPassword("a@example.com", "Password1!");

        expect(observedStore).toMatchObject({ origin: "system", systemScope: true });
    });

    it("rejects incomplete approved accounts instead of starting self-service onboarding", async () => {
        jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({
            id: "user-1", email: "a@example.com", name: "A", profileImage: null, phone: null,
            birthDate: "1990-01-01", passwordHash: "hash", emailVerified: true, role: "user",
            approvalStatus: "approved", tokenVersion: 4,
        });
        prisma.user_branch.findMany.mockResolvedValue([{ branchId: "branch-1", role: "user" }]);

        const rejection = service.validateEmailPassword("a@example.com", "Password1!");
        await expect(rejection).rejects.toMatchObject({
            status: 403,
            response: expect.objectContaining({
                code: "ACCOUNT_PROFILE_INCOMPLETE",
                params: {},
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });
        expect(sessions.issueSession).not.toHaveBeenCalled();
    });

    it("generalizes auth-flow code rejections to AUTH_REQUIRED problem bodies", async () => {
        prisma.auth_flow_state.findUnique.mockResolvedValue(null);

        const rejection = service.exchangeCodeForTokens("missing-code");
        await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(rejection).rejects.toMatchObject({
            status: 401,
            response: expect.objectContaining({
                code: "AUTH_REQUIRED",
                params: {},
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });
    });

    it("generalizes the authorization-session guard to an AUTH_REQUIRED problem body", async () => {
        prisma.auth_flow_state.findUnique.mockResolvedValue({
            id: "state-1", kind: "auth_code", sessionId: null, consumedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
        });
        prisma.auth_flow_state.updateMany.mockResolvedValue({ count: 1 });

        await expect(service.exchangeCodeForTokens("stateless-code")).rejects.toMatchObject({
            status: 401,
            response: expect.objectContaining({
                code: "AUTH_REQUIRED",
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });
    });

    it("returns registered reset-token problem bodies for invalid, expired, and used links", async () => {
        tokens.findByToken.mockResolvedValue(null);
        await expect(service.resetPassword("raw-token", "Password1!")).rejects.toMatchObject({
            status: 400,
            response: expect.objectContaining({
                code: "AUTH_RESET_TOKEN_INVALID",
                params: {},
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });

        const expired = AuthTokenEntity.reconstitute("token-2", "user-1", "hash", "password_reset", new Date(Date.now() - 60_000), new Date(), null);
        tokens.findByToken.mockResolvedValue(expired);
        await expect(service.resetPassword("raw-token", "Password1!")).rejects.toMatchObject({
            status: 400,
            response: expect.objectContaining({ code: "AUTH_RESET_TOKEN_EXPIRED" }),
        });

        const used = AuthTokenEntity.reconstitute("token-3", "user-1", "hash", "password_reset", new Date(Date.now() + 60_000), new Date(), new Date());
        tokens.findByToken.mockResolvedValue(used);
        await expect(service.resetPassword("raw-token", "Password1!")).rejects.toMatchObject({
            status: 400,
            response: expect.objectContaining({ code: "AUTH_RESET_TOKEN_USED" }),
        });
    });

    it("maps the kakao onboarding phone conflict to a /phone validation body", async () => {
        prisma.auth_flow_state.findUnique.mockResolvedValue({
            id: "state-1", kind: "pending_kakao_signup", kakaoId: "kakao-1", consumedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
        });
        prisma.auth_flow_state.updateMany.mockResolvedValue({ count: 1 });
        prisma.user.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: "phone-owner" });

        await expect(
            service.completeKakaoOnboarding("onboarding-token", "01012345678", "1990-01-01", "user"),
        ).rejects.toMatchObject({
            status: 400,
            response: expect.objectContaining({
                code: "VALIDATION_FAILED",
                errors: [expect.objectContaining({ pointer: "/phone", code: "INVALID_VALUE" })],
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            }),
        });
    });

    it("rejects refresh for pending or stale-version users", async () => {
        sessions.rotateRefreshToken.mockRejectedValueOnce(new ForbiddenException());
        await expect(service.refreshTokens("refresh")).rejects.toBeInstanceOf(ForbiddenException);

        sessions.rotateRefreshToken.mockRejectedValueOnce(new UnauthorizedException());
        await expect(service.refreshTokens("refresh")).rejects.toBeInstanceOf(UnauthorizedException);
        expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it("increments tokenVersion when resetting a password", async () => {
        const token = AuthTokenEntity.reconstitute("token-1", "user-1", "hash", "password_reset", new Date(Date.now() + 60_000), new Date(), null);
        tokens.findByToken.mockResolvedValue(token);
        tokens.consumeWithinTx.mockResolvedValue(true);
        jest.spyOn(service, "hashPassword").mockResolvedValue("new-hash");
        prisma.user.findUnique.mockResolvedValue({ id: "user-1", kakaoId: null });

        await service.resetPassword("raw-token", "Password1!");

        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: expect.objectContaining({ tokenVersion: { increment: 1 } }) });
        expect(tokens.consumeWithinTx).toHaveBeenCalledWith(
            prisma,
            createHash("sha256").update("raw-token").digest("hex"),
            "password_reset",
        );
    });

    it("allows a reset token once and rejects the second atomic consume", async () => {
        const token = AuthTokenEntity.reconstitute("token-1", "user-1", "hash", "password_reset", new Date(Date.now() + 60_000), new Date(), null);
        tokens.findByToken.mockResolvedValue(token);
        tokens.consumeWithinTx.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        jest.spyOn(service, "hashPassword").mockResolvedValue("new-hash");
        prisma.user.findUnique.mockResolvedValue({ id: "user-1", kakaoId: null });

        await expect(service.resetPassword("raw-token", "Password1!")).resolves.toMatchObject({ success: true });

        await expect(service.resetPassword("raw-token", "Password1!")).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.user.update).toHaveBeenCalledTimes(1);
        expect(tokens.consumeWithinTx).toHaveBeenCalledTimes(2);
    });

    it("does not mutate a Kakao-only account during unauthenticated registration", async () => {
        prisma.user.findUnique.mockResolvedValue({ id: "user-1", kakaoId: "kakao", passwordHash: null, emailVerified: true });

        await service.registerWithEmail("existing@example.com", "Password1!", "Attacker", "010", "1990-01-01");

        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(tokens.create).not.toHaveBeenCalled();
    });
});
