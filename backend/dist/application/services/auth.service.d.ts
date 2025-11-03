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
}
export interface UserValidationResult {
    user: string;
    token: string;
    refreshToken: string;
}
export declare class AuthService {
    private prisma;
    private jwt;
    constructor(prisma: PrismaService, jwt: JwtService);
    validateKakaoUser(kakaoData: KakaoData): Promise<UserValidationResult>;
}
