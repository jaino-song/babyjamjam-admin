import { Controller, Get, Req, Res, UseGuards, Request } from "@nestjs/common";
import { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { AuthService, KakaoData } from "../../application/services/auth.service";
import { UserValidationResult } from "../../application/services/auth.service";
import { JwtGuard } from "../../infrastructure/auth/jwt.guard";
import { PrismaService } from "../../infrastructure/database/prisma.service";

@Controller("auth")
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly prisma: PrismaService,
    ) { }

    @Get("kakao")
    @UseGuards(AuthGuard("kakao"))
    async kakaoLogin() {
        // Redirects user to Kakao login page
    }

    @Get("kakao/callback")
    @UseGuards(AuthGuard("kakao"))
    async kakaoCallback(@Req() req: any, @Res() res: Response) {
        const result: UserValidationResult = await this.authService.validateKakaoUser(req.user);

        // Set HTTP-only cookie
        const isProduction = process.env.NODE_ENV === 'production';
        res.cookie("auth_token", result.token, {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? "none" : "lax",
            path: "/",
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        // Redirect to frontend callback to set cookie on frontend domain
        const frontendUrl = process.env.PRODUCTION_FRONTEND_URL || process.env.DEVELOPMENT_FRONTEND_URL;
        res.redirect(`${frontendUrl}/auth/callback?token=${result.token}&refreshToken=${result.refreshToken}`);
    }

    @Get("me")
    @UseGuards(JwtGuard)
    async getCurrentUser(@Request() req: any) {
        const user = await this.prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                name: true,
                email: true,
                profile_image: true,
                role: true,
            },
        });
        return user;
    }
}