import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe, UnauthorizedException } from "@nestjs/common";
import request from "supertest";
import { AuthController } from "interface/controllers/auth.controller";
import { AuthService } from "application/services/auth.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { AuthGuard } from "@nestjs/passport";

describe("AuthController (Integration)", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    let app: INestApplication;
    let authService: jest.Mocked<AuthService>;
    let prismaService: jest.Mocked<PrismaService>;

    const mockUser = {
        id: "user-uuid-123",
        name: "Test User",
        email: "test@example.com",
        profileImage: "https://example.com/profile.jpg",
        role: "user",
    };

    const mockTokens = {
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
    };

    const mockKakaoUser = {
        kakaoId: "12345678",
        email: "kakao@example.com",
        name: "Kakao User",
        profileImage: "https://kakao.com/profile.jpg",
    };

    // Mock guard that injects user into request
    const mockJwtGuard = {
        canActivate: jest.fn((context) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: mockUser.id, role: mockUser.role };
            return true;
        }),
    };

    // Mock kakao guard that injects kakao user into request
    const mockKakaoGuard = {
        canActivate: jest.fn((context) => {
            const req = context.switchToHttp().getRequest();
            req.user = mockKakaoUser;
            return true;
        }),
    };

    beforeEach(async () => {
        const mockAuthService = {
            validateKakaoUser: jest.fn(),
            createAuthCode: jest.fn(),
            exchangeCodeForTokens: jest.fn(),
        };

        const mockPrismaService = {
            user: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                create: jest.fn(),
            },
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [
                {
                    provide: AuthService,
                    useValue: mockAuthService,
                },
                {
                    provide: PrismaService,
                    useValue: mockPrismaService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockJwtGuard)
            .overrideGuard(AuthGuard("kakao"))
            .useValue(mockKakaoGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        authService = moduleFixture.get(AuthService);
        prismaService = moduleFixture.get(PrismaService);
    });

    afterEach(async () => {
        await app.close();
    });

    // ============================================
    // GET /auth/kakao - Kakao Login Redirect
    // ============================================
    describe("GET /auth/kakao", () => {
        describe("given kakao guard passes", () => {
            it("should return 200 (guard handles redirect in real scenario)", async () => {
                // Note: In real scenario, AuthGuard("kakao") redirects to Kakao.
                // With mocked guard, we just verify the endpoint is accessible.
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao");

                // The mocked guard returns true, so endpoint returns 200
                expect(response.status).toBe(200);
            });
        });
    });

    // ============================================
    // GET /auth/kakao/callback - Kakao OAuth Callback
    // ============================================
    describe("GET /auth/kakao/callback", () => {
        describe("given valid kakao user from guard", () => {
            it("should validate user and redirect with auth code", async () => {
                // Arrange
                const authCode = "generated-auth-code-123";
                const validationResult = {
                    user: mockUser.id,
                    ...mockTokens,
                };
                authService.validateKakaoUser.mockResolvedValue(validationResult);
                authService.createAuthCode.mockResolvedValue(authCode);

                // Set environment for test
                process.env['NODE_ENV'] = "development";
                process.env['DEVELOPMENT_FRONTEND_URL'] = "http://localhost:3000";

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback");

                // Assert
                expect(response.status).toBe(302); // Redirect
                expect(response.headers['location']).toContain(`/callback?code=${authCode}`);
                expect(authService.validateKakaoUser).toHaveBeenCalledWith(mockKakaoUser);
                // Note: createAuthCode receives the full UserValidationResult object
                expect(authService.createAuthCode).toHaveBeenCalledWith(validationResult);
            });
        });

        describe("given production environment", () => {
            it("should redirect to production frontend URL", async () => {
                // Arrange
                const authCode = "prod-auth-code";
                authService.validateKakaoUser.mockResolvedValue({
                    user: mockUser.id,
                    ...mockTokens,
                });
                authService.createAuthCode.mockResolvedValue(authCode);

                process.env['NODE_ENV'] = "production";
                process.env['PRODUCTION_FRONTEND_URL'] = "https://app.example.com";

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback");

                // Assert
                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe(`https://app.example.com/callback?code=${authCode}`);
            });
        });

        describe("given authService throws error", () => {
            it("should propagate the error", async () => {
                // Arrange
                authService.validateKakaoUser.mockRejectedValue(
                    new UnauthorizedException("Kakao validation failed")
                );

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback");

                // Assert
                expect(response.status).toBe(401);
            });
        });
    });

    // ============================================
    // GET /auth/me - Get Current User
    // ============================================
    describe("GET /auth/me", () => {
        describe("given authenticated user exists", () => {
            it("should return current user info", async () => {
                // Arrange
                (prismaService.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/me");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual(mockUser);
                expect(prismaService.user.findUnique).toHaveBeenCalledWith({
                    where: { id: mockUser.id },
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        profileImage: true,
                        role: true,
                    },
                });
            });
        });

        describe("given user not found in database", () => {
            it("should return null", async () => {
                // Arrange
                (prismaService.user.findUnique as jest.Mock).mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/me");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual({});
            });
        });

        describe("given different user roles", () => {
            it.each([
                { role: "user", name: "Regular User" },
                { role: "admin", name: "Admin User" },
                { role: "owner", name: "Owner User" },
            ])("should return user with role $role", async ({ role, name }) => {
                // Arrange
                const userWithRole = { ...mockUser, role, name };
                (prismaService.user.findUnique as jest.Mock).mockResolvedValue(userWithRole);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/me");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body.role).toBe(role);
                expect(response.body.name).toBe(name);
            });
        });
    });

    // ============================================
    // POST /auth/token - Token Exchange
    // ============================================
    describe("POST /auth/token", () => {
        describe("given valid authorization code", () => {
            it("should exchange code for tokens", async () => {
                // Arrange
                const validCode = "valid-auth-code-123";
                authService.exchangeCodeForTokens.mockResolvedValue(mockTokens);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code: validCode });

                // Assert
                expect(response.status).toBe(201);
                expect(response.body).toEqual(mockTokens);
                expect(authService.exchangeCodeForTokens).toHaveBeenCalledWith(validCode);
            });
        });

        describe("given invalid authorization code", () => {
            it("should return 401 for non-existent code", async () => {
                // Arrange
                authService.exchangeCodeForTokens.mockRejectedValue(
                    new UnauthorizedException("Invalid authorization code")
                );

                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code: "invalid-code" });

                // Assert
                expect(response.status).toBe(401);
            });

            it("should return 401 for expired code", async () => {
                // Arrange
                authService.exchangeCodeForTokens.mockRejectedValue(
                    new UnauthorizedException("Authorization code expired")
                );

                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code: "expired-code" });

                // Assert
                expect(response.status).toBe(401);
            });
        });

        describe("given missing code in request body", () => {
            it("should return 400 for missing code", async () => {
                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({});

                // Assert
                expect(response.status).toBe(400);
            });

            it("should return 400 for empty code", async () => {
                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code: "" });

                // Assert
                expect(response.status).toBe(400);
            });
        });

        describe("given different code formats", () => {
            it.each([
                "short",
                "a".repeat(64),
                "code-with-dashes-123",
                "code_with_underscores_456",
            ])("should accept code format: %s", async (code) => {
                // Arrange
                authService.exchangeCodeForTokens.mockResolvedValue(mockTokens);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code });

                // Assert
                expect(response.status).toBe(201);
                expect(authService.exchangeCodeForTokens).toHaveBeenCalledWith(code);
            });
        });
    });
});
