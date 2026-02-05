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
        user_organization: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
        },
        organization: {
            findUnique: jest.fn(),
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
        role: "user",
    };

    const mockOrganization = {
        id: "org-uuid-123",
        name: "Test Organization",
        slug: "test-org",
        isActive: true,
    };

    const mockUserOrganization = {
        id: "user-org-uuid-123",
        userId: mockUser.id,
        organizationId: mockOrganization.id,
        role: "admin",
    };

    const mockOrganization2 = {
        id: "org-uuid-456",
        name: "Second Organization",
        slug: "second-org",
        isActive: true,
    };

    const mockUserOrganization2 = {
        id: "user-org-uuid-456",
        userId: mockUser.id,
        organizationId: mockOrganization2.id,
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
        describe("given user with exactly 1 organization", () => {
            it("should include organizationId in JWT", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_organization.findMany.mockResolvedValue([mockUserOrganization]);
                prismaService.organization.findUnique.mockResolvedValue(mockOrganization);

                // #when
                await service.validateKakaoUser(kakaoData);

                // #then
                expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("organizationId", mockOrganization.id);
            });
        });

        describe("given user with multiple organizations", () => {
            it("should NOT include organizationId in JWT", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_organization.findMany.mockResolvedValue([
                    mockUserOrganization,
                    mockUserOrganization2,
                ]);

                // #when
                const result = await service.validateKakaoUser(kakaoData);

                // #then
                expect(result).toBeDefined();
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).not.toHaveProperty("organizationId");
            });

            it("should set requiresOrgSelection=true in result", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_organization.findMany.mockResolvedValue([
                    mockUserOrganization,
                    mockUserOrganization2,
                ]);

                // #when
                const result = await service.validateKakaoUser(kakaoData);

                // #then
                expect(result).toHaveProperty("requiresOrgSelection", true);
            });
        });

        describe("given user with no organizations", () => {
            it("should NOT include organizationId in JWT", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_organization.findMany.mockResolvedValue([]);

                // #when
                await service.validateKakaoUser(kakaoData);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).not.toHaveProperty("organizationId");
            });
        });
    });

    // ============================================
    // selectOrganization Tests (NEW METHOD)
    // ============================================
    describe("selectOrganization", () => {
        describe("given user belongs to organization", () => {
            it("should issue JWT with selected organizationId", async () => {
                // #given
                const userId = mockUser.id;
                const organizationId = mockOrganization.id;

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_organization.findFirst.mockResolvedValue(mockUserOrganization);

                // #when
                await service.selectOrganization(userId, organizationId);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("organizationId", organizationId);
                expect(accessCall?.[0]).toHaveProperty("orgRole", "admin");
            });
        });

        describe("given user does NOT belong to organization", () => {
            it("should throw ForbiddenException", async () => {
                // #given
                const userId = mockUser.id;
                const invalidOrgId = "org-uuid-999";

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_organization.findFirst.mockResolvedValue(null);

                // #when
                const action = () => service.selectOrganization(userId, invalidOrgId);

                // #then
                await expect(action).rejects.toThrow(ForbiddenException);
                await expect(action).rejects.toThrow("User does not belong to this organization");
            });
        });

        describe("given user does not exist", () => {
            it("should throw UnauthorizedException", async () => {
                // #given
                const invalidUserId = "user-uuid-999";
                const organizationId = mockOrganization.id;

                prismaService.user.findUnique.mockResolvedValue(null);

                // #when
                const action = () => service.selectOrganization(invalidUserId, organizationId);

                // #then
                await expect(action).rejects.toThrow(UnauthorizedException);
                await expect(action).rejects.toThrow("User not found");
            });
        });

        describe("given user has member role", () => {
            it("should include orgRole in JWT", async () => {
                // #given
                const userId = mockUser.id;
                const organizationId = mockOrganization.id;
                const memberUserOrg = { ...mockUserOrganization, role: "member" };

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_organization.findFirst.mockResolvedValue(memberUserOrg);

                // #when
                await service.selectOrganization(userId, organizationId);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("orgRole", "member");
            });
        });
    });

    // ============================================
    // switchOrganization Tests (NEW METHOD)
    // ============================================
    describe("switchOrganization", () => {
        describe("given switching to a new organization user belongs to", () => {
            it("should issue new JWT with new organizationId", async () => {
                // #given
                const userId = mockUser.id;
                const currentOrgId = mockOrganization.id;
                const newOrgId = mockOrganization2.id;

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_organization.findFirst.mockImplementation((opts: any) => {
                    if (opts.where.organizationId === newOrgId) {
                        return Promise.resolve(mockUserOrganization2);
                    }
                    return Promise.resolve(mockUserOrganization);
                });

                // #when
                await service.switchOrganization(userId, currentOrgId, newOrgId);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("organizationId", newOrgId);
            });
        });

        describe("given user does NOT belong to target organization", () => {
            it("should throw ForbiddenException", async () => {
                // #given
                const userId = mockUser.id;
                const currentOrgId = mockOrganization.id;
                const invalidOrgId = "org-uuid-999";

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_organization.findFirst.mockResolvedValue(null);

                // #when
                const action = () => service.switchOrganization(userId, currentOrgId, invalidOrgId);

                // #then
                await expect(action).rejects.toThrow(ForbiddenException);
                await expect(action).rejects.toThrow("User does not belong to target organization");
            });
        });
    });

    // ============================================
    // refreshTokens Tests
    // ============================================
    describe("refreshTokens", () => {
        describe("given refresh token with organizationId", () => {
            it("should preserve organizationId in new tokens", async () => {
                // #given
                const refreshToken = "valid-refresh-token";
                const decodedPayload = {
                    sub: mockUser.id,
                    role: mockUser.role,
                    type: "refresh" as const,
                    organizationId: mockOrganization.id,
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
                expect(accessCall?.[0]).toHaveProperty("organizationId", mockOrganization.id);
                expect(refreshCall?.[0]).toHaveProperty("organizationId", mockOrganization.id);
            });
        });

        describe("given refresh token without organizationId", () => {
            it("should issue tokens without organizationId", async () => {
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
                expect(accessCall?.[0]).not.toHaveProperty("organizationId");
                expect(refreshCall?.[0]).not.toHaveProperty("organizationId");
            });
        });

        describe("given user no longer belongs to organization from refresh token", () => {
            it("should issue tokens without organizationId", async () => {
                // #given
                const refreshToken = "valid-refresh-token";
                const decodedPayload = {
                    sub: mockUser.id,
                    role: mockUser.role,
                    type: "refresh" as const,
                    organizationId: mockOrganization.id,
                };

                jwtService.verifyAsync.mockResolvedValue(decodedPayload);
                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_organization.findFirst.mockResolvedValue(null);

                // #when
                await service.refreshTokens(refreshToken);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                const refreshCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "refresh"
                );
                expect(accessCall?.[0]).not.toHaveProperty("organizationId");
                expect(refreshCall?.[0]).not.toHaveProperty("organizationId");
            });
        });
    });

    // ============================================
    // getUserOrganizations Tests (NEW METHOD)
    // ============================================
    describe("getUserOrganizations", () => {
        describe("given user with organizations", () => {
            it("should return list of organizations with roles", async () => {
                // #given
                const userId = mockUser.id;

                prismaService.user.findUnique.mockResolvedValue({ role: "user" });
                prismaService.user_organization.findMany.mockResolvedValue([
                    { ...mockUserOrganization, organization: mockOrganization },
                    { ...mockUserOrganization2, organization: mockOrganization2 },
                ]);

                // #when
                const result = await service.getUserOrganizations(userId);

                // #then
                expect(result).toHaveLength(2);
                expect(result[0]).toMatchObject({
                    id: mockOrganization.id,
                    name: mockOrganization.name,
                    slug: mockOrganization.slug,
                    role: "admin",
                });
                expect(result[1]).toMatchObject({
                    id: mockOrganization2.id,
                    name: mockOrganization2.name,
                    slug: mockOrganization2.slug,
                    role: "member",
                });
            });
        });

        describe("given user with no organizations", () => {
            it("should return empty array", async () => {
                // #given
                const userId = mockUser.id;

                prismaService.user.findUnique.mockResolvedValue({ role: "user" });
                prismaService.user_organization.findMany.mockResolvedValue([]);

                // #when
                const result = await service.getUserOrganizations(userId);

                // #then
                expect(result).toHaveLength(0);
                expect(result).toEqual([]);
                expect(prismaService.organization.findUnique).not.toHaveBeenCalled();
            });
        });
    });
});
