import { PrismaService } from "../../infrastructure/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
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
export declare class AuthService {
    private prisma;
    private jwt;
    private authCodes;
    constructor(prisma: PrismaService, jwt: JwtService);
    private cleanupExpiredCodes;
    validateKakaoUser(kakaoData: KakaoData): Promise<UserValidationResult>;
    createAuthCode(tokens: {
        accessToken: string;
        refreshToken: string;
    }): Promise<string>;
    exchangeCodeForTokens(code: string): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
}
