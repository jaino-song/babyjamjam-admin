import { UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { AuthService } from "../../application/services/auth.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { EmailPort } from "../../domain/ports/email.port";

describe("AuthService - Multi-Tenancy Enhancement", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockPrismaService = () => ({
        user: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
        },
        user_branch: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
        },
        branch: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
        },
    });

    const createMockJwtService = () => ({
        signAsync: jest.fn(),
        verifyAsync: jest.fn(),
    });

    const createMockEmailService = (): EmailPort => ({
        send: jest.fn().mockResolvedValue("mock-message-id"),
        sendVerificationEmail: jest.fn().mockResolvedValue("mock-verification-id"),
        sendPasswordResetEmail: jest.fn().mockResolvedValue("mock-reset-id"),
    });

    const createMockAuthTokenRepository = () => ({
        findByToken: jest.fn(),
        findByUserIdAndType: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteByUserIdAndType: jest.fn(),
        deleteExpiredTokens: jest.fn(),
    });

    const mockUser = {
        id: "user-uuid-123",
        kakaoId: "kakao-12345",
        email: "test@example.com",
        name: "Test User",
        phone: "010-1234-5678",
        birthDate: "1990-01-01",
        profileImage: null,
        role: "user",
    };

    const mockBranch = {
        id: "org-uuid-123",
        name: "Test Branch",
        slug: "test-org",
        isActive: true,
    };

    const mockUserBranch = {
        id: "user-org-uuid-123",
        userId: mockUser.id,
        branchId: mockBranch.id,
        role: "admin",
    };

    const mockBranch2 = {
        id: "org-uuid-456",
        name: "Second Branch",
        slug: "second-org",
        isActive: true,
    };

    const mockUserBranch2 = {
        id: "user-org-uuid-456",
        userId: mockUser.id,
        branchId: mockBranch2.id,
        role: "member",
    };

    let service: AuthService;
    let prismaService: ReturnType<typeof createMockPrismaService>;
    let jwtService: ReturnType<typeof createMockJwtService>;
    let emailService: EmailPort;
    let authTokenRepository: ReturnType<typeof createMockAuthTokenRepository>;

    beforeEach(() => {
        prismaService = createMockPrismaService();
        jwtService = createMockJwtService();
        emailService = createMockEmailService();
        authTokenRepository = createMockAuthTokenRepository();

        // Type assertion to work around constructor typing
        service = new AuthService(
            prismaService as unknown as PrismaService,
            jwtService as unknown as JwtService,
            emailService,
            authTokenRepository as unknown as ReturnType<typeof createMockAuthTokenRepository>
        );

        // Setup default mock returns
        jwtService.signAsync.mockResolvedValue("mock-jwt-token");
        jwtService.verifyAsync.mockResolvedValue({
            sub: mockUser.id,
            role: mockUser.role,
            type: "refresh",
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // validateKakaoUser Tests
    // ============================================
    describe("validateKakaoUser", () => {
        describe("given user with exactly 1 branch", () => {
            it("should include branchId in JWT", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_branch.findMany.mockResolvedValue([mockUserBranch]);
                prismaService.branch.findUnique.mockResolvedValue(mockBranch);

                // #when
                const result = await service.validateKakaoUser(kakaoData);

                // #then
                expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("branchId", mockBranch.id);
            });
        });

        describe("given user with multiple branches", () => {
            it("should NOT include branchId in JWT", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_branch.findMany.mockResolvedValue([
                    mockUserBranch,
                    mockUserBranch2,
                ]);

                // #when
                const result = await service.validateKakaoUser(kakaoData);

                // #then
                expect(result).toBeDefined();
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).not.toHaveProperty("branchId");
            });

            it("should set requiresBranchSelection=true in result", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_branch.findMany.mockResolvedValue([
                    mockUserBranch,
                    mockUserBranch2,
                ]);

                // #when
                const result = await service.validateKakaoUser(kakaoData);

                // #then
                expect(result).toHaveProperty("requiresBranchSelection", true);
            });
        });

        describe("given user with no branches", () => {
            it("should require account completion instead of issuing branch-scoped JWT", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_branch.findMany.mockResolvedValue([]);

                // #when
                const result = await service.validateKakaoUser(kakaoData);

                // #then
                expect(result).toHaveProperty("onboardingRequired", true);
                expect(result).toHaveProperty("onboardingKind", "account_completion");
                expect(jwtService.signAsync).not.toHaveBeenCalled();
            });
        });

        describe("given user only has a hidden Incheon district branch", () => {
            it("should not auto-select the hidden branch", async () => {
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };
                const hiddenIncheonDistrictBranch = {
                    id: "incheon-bupyeong-id",
                    name: "인천 부평구점",
                    slug: "incheon-bupyeong",
                    isActive: true,
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_branch.findMany.mockResolvedValue([
                    {
                        ...mockUserBranch,
                        branchId: hiddenIncheonDistrictBranch.id,
                        branch: hiddenIncheonDistrictBranch,
                    },
                ]);

                const result = await service.validateKakaoUser(kakaoData);

                expect(result).toMatchObject({
                    onboardingRequired: true,
                    onboardingKind: "account_completion",
                    prefill: expect.objectContaining({
                        branchId: undefined,
                    }),
                });
                expect(jwtService.signAsync).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // selectBranch Tests (NEW METHOD)
    // ============================================
    describe("selectBranch", () => {
        describe("given user belongs to branch", () => {
            it("should issue JWT with selected branchId", async () => {
                // #given
                const userId = mockUser.id;
                const branchId = mockBranch.id;

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(mockUserBranch);

                // #when
                await service.selectBranch(userId, branchId);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("branchId", branchId);
                expect(accessCall?.[0]).toHaveProperty("branchRole", "admin");
            });
        });

        describe("given user does NOT belong to branch", () => {
            it("should throw ForbiddenException", async () => {
                // #given
                const userId = mockUser.id;
                const invalidOrgId = "org-uuid-999";

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(null);

                // #when
                const action = () => service.selectBranch(userId, invalidOrgId);

                // #then
                await expect(action).rejects.toThrow(ForbiddenException);
                await expect(action).rejects.toThrow("User does not belong to this branch");
            });
        });

        describe("given user belongs to a hidden Incheon district branch", () => {
            it("should throw ForbiddenException", async () => {
                const hiddenIncheonDistrictBranch = {
                    id: "incheon-bupyeong-id",
                    name: "인천 부평구점",
                    slug: "incheon-bupyeong",
                    isActive: true,
                };
                const hiddenMembership = {
                    ...mockUserBranch,
                    branchId: hiddenIncheonDistrictBranch.id,
                    branch: hiddenIncheonDistrictBranch,
                };

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(hiddenMembership);

                const action = () => service.selectBranch(mockUser.id, hiddenIncheonDistrictBranch.id);

                await expect(action).rejects.toThrow(ForbiddenException);
                await expect(action).rejects.toThrow("User does not belong to this branch");
            });
        });

        describe("given user does not exist", () => {
            it("should throw UnauthorizedException", async () => {
                // #given
                const invalidUserId = "user-uuid-999";
                const branchId = mockBranch.id;

                prismaService.user.findUnique.mockResolvedValue(null);

                // #when
                const action = () => service.selectBranch(invalidUserId, branchId);

                // #then
                await expect(action).rejects.toThrow(UnauthorizedException);
                await expect(action).rejects.toThrow("User not found");
            });
        });

        describe("given user has member role", () => {
            it("should include branchRole in JWT", async () => {
                // #given
                const userId = mockUser.id;
                const branchId = mockBranch.id;
                const memberUserOrg = { ...mockUserBranch, role: "member" };

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(memberUserOrg);

                // #when
                await service.selectBranch(userId, branchId);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("branchRole", "member");
            });
        });

        it.each([
            { role: "owner", expectedExpiresIn: "30d" },
            { role: "admin", expectedExpiresIn: "7d" },
            { role: "manager", expectedExpiresIn: "7d" },
            { role: "user", expectedExpiresIn: "3d" },
        ])("should issue $expectedExpiresIn tokens for $role role", async ({ role, expectedExpiresIn }) => {
            // #given
            const userId = mockUser.id;
            const branchId = mockBranch.id;
            const user = { ...mockUser, role };

            prismaService.user.findUnique.mockResolvedValue(user);
            if (role === "owner") {
                prismaService.branch.findUnique.mockResolvedValue(mockBranch);
            } else {
                prismaService.user_branch.findFirst.mockResolvedValue(mockUserBranch);
            }

            // #when
            await service.selectBranch(userId, branchId);

            // #then
            const accessCall = jwtService.signAsync.mock.calls.find(
                (call: any[]) => call[0]?.type === "access"
            );
            const refreshCall = jwtService.signAsync.mock.calls.find(
                (call: any[]) => call[0]?.type === "refresh"
            );
            expect(accessCall?.[1]).toEqual({ expiresIn: expectedExpiresIn });
            expect(refreshCall?.[1]).toEqual({ expiresIn: expectedExpiresIn });
        });
    });

    // ============================================
    // switchBranch Tests (NEW METHOD)
    // ============================================
    describe("switchBranch", () => {
        describe("given switching to a new branch user belongs to", () => {
            it("should issue new JWT with new branchId", async () => {
                // #given
                const userId = mockUser.id;
                const currentOrgId = mockBranch.id;
                const newOrgId = mockBranch2.id;

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockImplementation((opts: any) => {
                    if (opts.where.branchId === newOrgId) {
                        return Promise.resolve(mockUserBranch2);
                    }
                    return Promise.resolve(mockUserBranch);
                });

                // #when
                await service.switchBranch(userId, currentOrgId, newOrgId);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("branchId", newOrgId);
            });
        });

        describe("given user does NOT belong to target branch", () => {
            it("should throw ForbiddenException", async () => {
                // #given
                const userId = mockUser.id;
                const currentOrgId = mockBranch.id;
                const invalidOrgId = "org-uuid-999";

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(null);

                // #when
                const action = () => service.switchBranch(userId, currentOrgId, invalidOrgId);

                // #then
                await expect(action).rejects.toThrow(ForbiddenException);
                await expect(action).rejects.toThrow("User does not belong to target branch");
            });
        });
    });

    // ============================================
    // registerWithEmail Tests
    // ============================================
    describe("registerWithEmail", () => {
        it("should preserve the submitted branch role on membership creation", async () => {
            prismaService.branch.findUnique.mockResolvedValue(mockBranch);
            prismaService.user.findUnique
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ name: "Manager User" });
            prismaService.user.create.mockResolvedValue({
                ...mockUser,
                id: "new-user-uuid-123",
                role: "manager",
                emailVerified: false,
            });
            prismaService.user_branch.create.mockResolvedValue(undefined);
            authTokenRepository.deleteByUserIdAndType.mockResolvedValue(undefined);
            authTokenRepository.create.mockResolvedValue(undefined);

            await service.registerWithEmail(
                "manager@example.com",
                "Password1!",
                "Manager User",
                "010-1234-5678",
                "1990-01-01",
                mockBranch.id,
                "manager",
            );

            expect(prismaService.user_branch.create).toHaveBeenCalledWith({
                data: {
                    userId: "new-user-uuid-123",
                    branchId: mockBranch.id,
                    role: "manager",
                },
            });
        });
    });

    // ============================================
    // refreshTokens Tests
    // ============================================
    describe("refreshTokens", () => {
        describe("given refresh token with branchId", () => {
            it("should preserve branchId in new tokens", async () => {
                // #given
                const refreshToken = "valid-refresh-token";
                const decodedPayload = {
                    sub: mockUser.id,
                    role: mockUser.role,
                    type: "refresh" as const,
                    branchId: mockBranch.id,
                };

                jwtService.verifyAsync.mockResolvedValue(decodedPayload);
                prismaService.user.findUnique.mockResolvedValue(mockUser);

                // #when
                await service.refreshTokens(refreshToken);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                const refreshCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "refresh"
                );
                expect(accessCall?.[0]).toHaveProperty("branchId", mockBranch.id);
                expect(refreshCall?.[0]).toHaveProperty("branchId", mockBranch.id);
            });
        });

        describe("given refresh token without branchId", () => {
            it("should issue tokens without branchId", async () => {
                // #given
                const refreshToken = "valid-refresh-token";
                const decodedPayload = {
                    sub: mockUser.id,
                    role: mockUser.role,
                    type: "refresh" as const,
                };

                jwtService.verifyAsync.mockResolvedValue(decodedPayload);
                prismaService.user.findUnique.mockResolvedValue(mockUser);

                // #when
                await service.refreshTokens(refreshToken);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                const refreshCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "refresh"
                );
                expect(accessCall?.[0]).not.toHaveProperty("branchId");
                expect(refreshCall?.[0]).not.toHaveProperty("branchId");
            });
        });

        describe("given user no longer belongs to branch from refresh token", () => {
            it("should issue tokens without branchId", async () => {
                // #given
                const refreshToken = "valid-refresh-token";
                const decodedPayload = {
                    sub: mockUser.id,
                    role: mockUser.role,
                    type: "refresh" as const,
                    branchId: mockBranch.id,
                };

                jwtService.verifyAsync.mockResolvedValue(decodedPayload);
                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(null);

                // #when
                await service.refreshTokens(refreshToken);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                const refreshCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "refresh"
                );
                expect(accessCall?.[0]).not.toHaveProperty("branchId");
                expect(refreshCall?.[0]).not.toHaveProperty("branchId");
            });
        });
    });

    // ============================================
    // getUserBranches Tests (NEW METHOD)
    // ============================================
    describe("getUserBranches", () => {
        describe("given user with branches", () => {
            it("should return list of branches with roles", async () => {
                // #given
                const userId = mockUser.id;

                prismaService.user.findUnique.mockResolvedValue({ role: "user" });
                prismaService.user_branch.findMany.mockResolvedValue([
                    { ...mockUserBranch, branch: mockBranch },
                    { ...mockUserBranch2, branch: mockBranch2 },
                ]);

                // #when
                const result = await service.getUserBranches(userId);

                // #then
                expect(result).toHaveLength(2);
                expect(result[0]).toMatchObject({
                    id: mockBranch.id,
                    name: mockBranch.name,
                    slug: mockBranch.slug,
                    role: "admin",
                });
                expect(result[1]).toMatchObject({
                    id: mockBranch2.id,
                    name: mockBranch2.name,
                    slug: mockBranch2.slug,
                    role: "member",
                });
            });

            it("should hide Incheon district branches from regular user branch list", async () => {
                const userId = mockUser.id;
                const hiddenIncheonDistrictBranch = {
                    id: "incheon-bupyeong-id",
                    name: "인천 부평구점",
                    slug: "incheon-bupyeong",
                    isActive: true,
                };
                const canonicalIncheonBranch = {
                    id: "incheon-id",
                    name: "인천지점",
                    slug: "incheon",
                    isActive: true,
                };

                prismaService.user.findUnique.mockResolvedValue({ role: "user" });
                prismaService.user_branch.findMany.mockResolvedValue([
                    { ...mockUserBranch, branch: hiddenIncheonDistrictBranch },
                    { ...mockUserBranch2, branch: canonicalIncheonBranch },
                ]);

                const result = await service.getUserBranches(userId);

                expect(result).toEqual([
                    {
                        id: canonicalIncheonBranch.id,
                        name: canonicalIncheonBranch.name,
                        slug: canonicalIncheonBranch.slug,
                        role: "member",
                    },
                ]);
            });
        });

        describe("given owner user", () => {
            it("should hide Incheon district branches from owner branch list", async () => {
                const userId = mockUser.id;
                const hiddenIncheonDistrictBranch = {
                    id: "incheon-yeonsu-id",
                    name: "인천 연수구점",
                    slug: "incheon-yeonsu",
                    isActive: true,
                };
                const canonicalIncheonBranch = {
                    id: "incheon-id",
                    name: "인천지점",
                    slug: "incheon",
                    isActive: true,
                };

                prismaService.user.findUnique.mockResolvedValue({ role: "owner" });
                prismaService.branch.findMany.mockResolvedValue([
                    hiddenIncheonDistrictBranch,
                    canonicalIncheonBranch,
                    mockBranch,
                ]);

                const result = await service.getUserBranches(userId);

                expect(result).toEqual([
                    {
                        id: canonicalIncheonBranch.id,
                        name: canonicalIncheonBranch.name,
                        slug: canonicalIncheonBranch.slug,
                        role: "owner",
                    },
                    {
                        id: mockBranch.id,
                        name: mockBranch.name,
                        slug: mockBranch.slug,
                        role: "owner",
                    },
                ]);
            });
        });

        describe("given user with no branches", () => {
            it("should return empty array", async () => {
                // #given
                const userId = mockUser.id;

                prismaService.user.findUnique.mockResolvedValue({ role: "user" });
                prismaService.user_branch.findMany.mockResolvedValue([]);

                // #when
                const result = await service.getUserBranches(userId);

                // #then
                expect(result).toHaveLength(0);
                expect(result).toEqual([]);
                expect(prismaService.branch.findUnique).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // Email Failure Resilience Tests
    // ============================================
    describe("requestPasswordReset", () => {
        it("should return success even when password reset email delivery fails", async () => {
            // #given
            prismaService.user.findUnique.mockResolvedValue({
                ...mockUser,
                emailVerified: true,
            });
            authTokenRepository.deleteByUserIdAndType.mockResolvedValue(undefined);
            authTokenRepository.create.mockResolvedValue(undefined);
            (emailService.sendPasswordResetEmail as jest.Mock).mockRejectedValue(
                new Error("resend unavailable"),
            );

            // #when
            const result = await service.requestPasswordReset(mockUser.email);

            // #then
            expect(result).toEqual({
                success: true,
                message: "비밀번호 재설정 이메일이 발송되었습니다.",
            });
            expect(authTokenRepository.deleteByUserIdAndType).toHaveBeenCalledWith(
                mockUser.id,
                "password_reset",
            );
            expect(authTokenRepository.create).toHaveBeenCalledTimes(1);
            expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
        });
    });

    describe("resendVerificationEmail", () => {
        it("should return success even when verification email delivery fails", async () => {
            // #given
            prismaService.user.findUnique
                .mockResolvedValueOnce({
                    ...mockUser,
                    emailVerified: false,
                })
                .mockResolvedValueOnce({
                    name: mockUser.name,
                });
            authTokenRepository.deleteByUserIdAndType.mockResolvedValue(undefined);
            authTokenRepository.create.mockResolvedValue(undefined);
            (emailService.sendVerificationEmail as jest.Mock).mockRejectedValue(
                new Error("resend unavailable"),
            );

            // #when
            const result = await service.resendVerificationEmail(mockUser.email);

            // #then
            expect(result).toEqual({
                success: true,
                message: "인증 이메일이 발송되었습니다.",
            });
            expect(authTokenRepository.deleteByUserIdAndType).toHaveBeenCalledWith(
                mockUser.id,
                "email_verification",
            );
            expect(authTokenRepository.create).toHaveBeenCalledTimes(1);
            expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
        });
    });
});
