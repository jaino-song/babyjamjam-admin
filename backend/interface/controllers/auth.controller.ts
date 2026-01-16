import { Controller, Get, Req, Res, UseGuards, Request, Body, Post } from "@nestjs/common";
import { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { AuthService } from "../../application/services/auth.service";
import { JwtGuard } from "../../infrastructure/auth/jwt.guard";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { TokenExchangeDto } from "interface/dto/token-exchange.dto";

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
        const tokens = await this.authService.validateKakaoUser(req.user);
        const code = await this.authService.createAuthCode(tokens);

        const nodeEnv = process.env['NODE_ENV'];
        let frontendURL: string;
        
        if (nodeEnv === "production") {
            frontendURL = process.env['PRODUCTION_FRONTEND_URL'] ?? "http://localhost:3000";
        } else if (nodeEnv === "preview") {
            frontendURL = process.env['PREVIEW_FRONTEND_URL'] ?? "http://localhost:3000";
        } else {
            frontendURL = process.env['DEVELOPMENT_FRONTEND_URL'] ?? "http://localhost:3000";
        }

        console.log(`[Auth] Redirecting to ${frontendURL}/auth/callback (NODE_ENV: ${process.env['NODE_ENV']})`);

        res.redirect(`${frontendURL}/auth/callback?code=${code}`);
    }

    @Get("me")
    @UseGuards(JwtGuard)
    async getCurrentUser(@Request() req: any) {
        if (req.user.userId === 'dev-user') {
            return {
                id: 'dev-user',
                name: '개발자',
                email: 'dev@example.com',
                profile_image: null,
                role: 'owner',
            };
        }

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
    async exchangeToken(@Body() body: TokenExchangeDto) {
        const tokens = await this.authService.exchangeCodeForTokens(body.code);
        return tokens;
    }
}