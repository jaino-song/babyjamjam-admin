import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { LegacyLoginNotAllowedError } from "application/errors/legacy-login-not-allowed.error";
import { AuthService } from "application/services/auth.service";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("AuthService.validateKakaoUser", () => {
    const kakaoId = "12345678";
    const prisma = {
        user: {
            findFirst: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            upsert: jest.fn(),
        },
    };
    const jwt = { signAsync: jest.fn() };
    let service: AuthService;

    beforeEach(async () => {
        jest.resetAllMocks();
        const module = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: PrismaService, useValue: prisma },
                { provide: JwtService, useValue: jwt },
            ],
        }).compile();
        service = module.get(AuthService);
    });

    const expectReadOnlyLookup = () => {
        expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
        expect(prisma.user.findFirst).toHaveBeenCalledWith({
            where: { kakao_id: kakaoId },
        });
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.user.upsert).not.toHaveBeenCalled();
    };

    it("rejects an unknown Kakao account without creating a user or signing tokens", async () => {
        prisma.user.findFirst.mockResolvedValue(null);

        const p = service.validateKakaoUser({ kakaoId });

        await expect(p).rejects.toBeInstanceOf(LegacyLoginNotAllowedError);
        expect(jwt.signAsync).not.toHaveBeenCalled();
        expectReadOnlyLookup();
    });

    it.each(["user", null])("rejects an existing account with role %s without signing tokens", async (role) => {
        prisma.user.findFirst.mockResolvedValue({ id: "existing-user-id", role });

        const p = service.validateKakaoUser({ kakaoId });

        await expect(p).rejects.toBeInstanceOf(LegacyLoginNotAllowedError);
        expect(jwt.signAsync).not.toHaveBeenCalled();
        expectReadOnlyLookup();
    });

    it.each(["owner", "admin", "manager"])("signs refresh then access tokens for an existing %s account", async (role) => {
        const userId = "existing-user-id";
        const refreshToken = "mock-refresh-token";
        const accessToken = "mock-access-token";
        prisma.user.findFirst.mockResolvedValue({ id: userId, role });
        jwt.signAsync.mockResolvedValueOnce(refreshToken).mockResolvedValueOnce(accessToken);

        const result = await service.validateKakaoUser({ kakaoId });

        expect(jwt.signAsync).toHaveBeenCalledTimes(2);
        expect(jwt.signAsync).toHaveBeenNthCalledWith(
            1,
            { sub: userId, role, type: "refresh" },
            expect.any(Object),
        );
        expect(jwt.signAsync).toHaveBeenNthCalledWith(
            2,
            { sub: userId, role, type: "access" },
            expect.any(Object),
        );
        expect(result).toEqual({ user: userId, accessToken, refreshToken });
        expectReadOnlyLookup();
    });
});
