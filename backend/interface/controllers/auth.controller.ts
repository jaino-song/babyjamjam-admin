import { Controller, Get, Req, Res, UseGuards, Request, Body, Post } from "@nestjs/common";
import { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { AuthService, UserValidationResult } from "../../application/services/auth.service";
import { LegacyLoginNotAllowedError } from "../../application/errors/legacy-login-not-allowed.error";
import { JwtGuard } from "../../infrastructure/auth/jwt.guard";
import { Public } from "../../infrastructure/auth/public.decorator";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { TokenExchangeDto } from "interface/dto/token-exchange.dto";

@Controller("auth")
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly prisma: PrismaService,
    ) { }

    @Get("kakao")
    @Public()
    @UseGuards(AuthGuard("kakao"))
    async kakaoLogin() {
        // Redirects user to Kakao login page
    }

    @Get("kakao/callback")
    @Public()
    @UseGuards(AuthGuard("kakao"))
    async kakaoCallback(@Req() req: any, @Res() res: Response) {
        const isProduction = process.env['NODE_ENV'] === "production";
        const frontendURL = isProduction
            ? process.env['PRODUCTION_FRONTEND_URL']
            : (process.env['DEVELOPMENT_FRONTEND_URL'] ?? "http://localhost:3000");

        let tokens: UserValidationResult;
        try {
            tokens = await this.authService.validateKakaoUser(req.user);
        } catch (error) {
            if (error instanceof LegacyLoginNotAllowedError) {
                res.redirect(`${frontendURL}/login?error=not_allowed`);
                return;
            }
            throw error;
        }
        const code = await this.authService.createAuthCode(tokens);

        console.log(`[Auth] Redirecting to ${frontendURL}/auth/callback (NODE_ENV: ${process.env['NODE_ENV']})`);

        res.redirect(`${frontendURL}/auth/callback?code=${code}`);
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

    @Post("token")
    @Public()
    async exchangeToken(@Body() body: TokenExchangeDto) {
        const tokens = await this.authService.exchangeCodeForTokens(body.code);
        return tokens;
    }
}
