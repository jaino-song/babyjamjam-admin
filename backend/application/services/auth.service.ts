import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";

export interface KakaoData {
    kakaoId: string;
    email?: string;
    name?: string;
    profileImage?: string;
}

export interface TokenPayload {
    sub: string;
    role: string | null;
    type: 'access' | 'refresh';
}

export interface UserValidationResult {
    user: string;
    accessToken: string;
    refreshToken: string;
}

interface StoredAuthCode {
    tokens: {
        accessToken: string;
        refreshToken: string;
    };
    expiresAt: number;
}

@Injectable()
export class AuthService {
    private authCodes = new Map<string, StoredAuthCode>();

    constructor(private prisma: PrismaService, private jwt: JwtService) { }

    private cleanupExpiredCodes() {
        const now = Date.now();
        for (const [code, stored] of this.authCodes.entries()) {
            if (now > stored.expiresAt) {
                this.authCodes.delete(code);
            }
        }
    }

    async validateKakaoUser(kakaoData: KakaoData): Promise<UserValidationResult> {
        let user = await this.prisma.user.findFirst({
            where: {
                kakao_id: kakaoData.kakaoId
            },
        });

        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    kakao_id: kakaoData.kakaoId,
                    email: kakaoData.email,
                    name: kakaoData.name,
                    profile_image: kakaoData.profileImage,
                    role: "user",
                },
            });
        }

        const payload = {
            sub: user.id,
            role: user.role,
        };

        const privilegedRoles = ["owner", "admin", "manager"];
        const isPrivileged = user.role !== null && privilegedRoles.includes(user.role);

        const signOptions = isPrivileged
            ? { expiresIn: "30d" }
            : { expiresIn: "3d" };

        const refreshSignOptions = isPrivileged
            ? { expiresIn: "7d" }
            : { expiresIn: "1d" };

        const refreshToken = await this.jwt.signAsync(
            { ...payload, type: 'refresh' },
            refreshSignOptions
        );
        const accessToken = await this.jwt.signAsync(
            { ...payload, type: 'access' },
            signOptions
        );

        return {
            user: user.id,
            accessToken,
            refreshToken,
        };
    }

    async createAuthCode(tokens: { accessToken: string; refreshToken: string }): Promise<string> {
        const code = crypto.randomBytes(32).toString("hex");

        this.authCodes.set(code, {
            tokens,
            expiresAt: Date.now() + 30 * 1000,
        });

        this.cleanupExpiredCodes();

        return code;
    }

    async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string }> {
        const stored = this.authCodes.get(code);

        if (!stored) {
            throw new UnauthorizedException("Invalid authorization code");
        }

        if (Date.now() > stored.expiresAt) {
            this.authCodes.delete(code);
            throw new UnauthorizedException("Authorization code expired");
        }

        this.authCodes.delete(code);
        return stored.tokens;
    }

    async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
        try {
            // Verify and decode the refresh token
            const decoded = await this.jwt.verifyAsync<TokenPayload>(refreshToken);

            // Check that this is a refresh token
            if (decoded.type !== 'refresh') {
                throw new UnauthorizedException("Invalid token type");
            }

            // Look up the user
            const user = await this.prisma.user.findUnique({
                where: { id: decoded.sub },
            });

            if (!user) {
                throw new UnauthorizedException("User not found");
            }

            // Generate new tokens with the same logic as validateKakaoUser
            const payload = {
                sub: user.id,
                role: user.role,
            };

            const privilegedRoles = ["owner", "admin", "manager"];
            const isPrivileged = user.role !== null && privilegedRoles.includes(user.role);

            const signOptions = isPrivileged
                ? { expiresIn: "30d" }
                : { expiresIn: "3d" };

            const refreshSignOptions = isPrivileged
                ? { expiresIn: "7d" }
                : { expiresIn: "1d" };

            const newRefreshToken = await this.jwt.signAsync(
                { ...payload, type: 'refresh' },
                refreshSignOptions
            );
            const newAccessToken = await this.jwt.signAsync(
                { ...payload, type: 'access' },
                signOptions
            );

            return {
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
            };
        } catch (error) {
            if (error instanceof UnauthorizedException) {
                throw error;
            }
            throw new UnauthorizedException("Invalid or expired refresh token");
        }
    }
}