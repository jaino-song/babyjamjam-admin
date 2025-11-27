import { Injectable, UnauthorizedException } from "@nestjs/common";
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
    token: string;
    refreshToken: string;
}

@Injectable()
export class AuthService {
    constructor(private prisma: PrismaService, private jwt: JwtService) { }

    async validateKakaoUser(kakaoData: KakaoData): Promise<UserValidationResult> {
        let user = await this.prisma.user.findFirst({
            where: {
                kakaoId: kakaoData.kakaoId
            },
        });

        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    kakaoId: kakaoData.kakaoId,
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

        const signOptions = user.role === "owner"
            ? { expiresIn: "30d" }
            : { expiresIn: "3d" };

        const refreshSignOptions = user.role === "owner"
            ? { expiresIn: "7d" }
            : { expiresIn: "1d" };

        const refreshToken = await this.jwt.signAsync(
            { ...payload, type: 'refresh' },
            refreshSignOptions
        );
        const token = await this.jwt.signAsync(
            { ...payload, type: 'access' },
            signOptions
        );

        return {
            user: user.id,
            token,
            refreshToken,
        };
    }
}