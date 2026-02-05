import { Controller, Get, Req, Res, UseGuards, Request, Body, Post, Ip } from "@nestjs/common";
import { Response, Request as ExpressRequest } from "express";
import { AuthGuard } from "@nestjs/passport";
import { AuthService } from "../../application/services/auth.service";
import { JwtGuard } from "../../infrastructure/auth/jwt.guard";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { TokenExchangeDto } from "interface/dto/token-exchange.dto";
import { RefreshTokenDto } from "interface/dto/refresh-token.dto";
import { RateLimitGuard } from "../../infrastructure/auth/rate-limit.guard";
import {
    RegisterDto,
    LoginDto,
    VerifyEmailDto,
    ForgotPasswordDto,
    ResetPasswordDto,
    ResendVerificationDto,
    LinkPasswordDto,
} from "interface/dto/email-auth.dto";
import { SelectOrganizationDto, SwitchOrganizationDto } from "interface/dto/organization-auth.dto";

@Controller("auth")
export class AuthController {
    private readonly rateLimitGuard: RateLimitGuard;

    constructor(
        private readonly authService: AuthService,
        private readonly prisma: PrismaService,
    ) {
        this.rateLimitGuard = new RateLimitGuard();
    }

    @Get("kakao")
    @UseGuards(AuthGuard("kakao"))
    async kakaoLogin() {
        // Redirects user to Kakao login page
    }

    @Get("kakao/callback")
    @UseGuards(AuthGuard("kakao"))
    async kakaoCallback(@Req() req: any, @Res() res: Response) {
        const nodeEnv = process.env['NODE_ENV'];
        let frontendURL: string;

        if (nodeEnv === "production") {
            frontendURL = process.env['PRODUCTION_FRONTEND_URL'] ?? "http://localhost:3000";
        } else if (nodeEnv === "preview") {
            frontendURL = process.env['PREVIEW_FRONTEND_URL'] ?? "http://localhost:3000";
        } else {
            frontendURL = process.env['DEVELOPMENT_FRONTEND_URL'] ?? "http://localhost:3000";
        }

        // Check if this is an account linking request (state contains linking JWT)
        const state = req.query.state as string | undefined;
        if (state) {
            const linkingInfo = await this.authService.verifyLinkingState(state);
            if (linkingInfo) {
                // This is an account linking request
                console.log(`[Auth] Linking Kakao account to user ${linkingInfo.userId}`);
                return this.completeKakaoLink(linkingInfo.userId, req.user, res, frontendURL);
            }
        }

        // Normal login/registration flow
        const tokens = await this.authService.validateKakaoUser(req.user);
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
                profileImage: true,
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

    @Post("refresh-token")
    async refreshToken(@Body() body: RefreshTokenDto) {
        const tokens = await this.authService.refreshTokens(body.refreshToken);
        return tokens;
    }

    // ==================== Email Authentication Endpoints ====================

    @Post("register")
    @UseGuards(RateLimitGuard)
    async register(@Body() body: RegisterDto, @Ip() ip: string) {
        const result = await this.authService.registerWithEmail(
            body.email,
            body.password,
            body.name,
        );

        // Reset rate limit on successful registration
        if (result.success) {
            this.rateLimitGuard.resetForKey(ip, body.email);
        }

        return result;
    }

    @Post("login")
    @UseGuards(RateLimitGuard)
    async login(@Body() body: LoginDto, @Ip() ip: string, @Req() req: ExpressRequest) {
        const result = await this.authService.validateEmailPassword(
            body.email,
            body.password,
        );

        if (!result) {
            // Don't reset rate limit on failed login
            return {
                success: false,
                message: '이메일 또는 비밀번호가 올바르지 않습니다.',
            };
        }

        // Reset rate limit on successful login
        this.rateLimitGuard.resetForKey(ip, body.email);

        return {
            success: true,
            ...result,
        };
    }

    @Post("verify-email")
    async verifyEmail(@Body() body: VerifyEmailDto) {
        return this.authService.verifyEmail(body.token);
    }

    @Post("forgot-password")
    @UseGuards(RateLimitGuard)
    async forgotPassword(@Body() body: ForgotPasswordDto) {
        return this.authService.requestPasswordReset(body.email);
    }

    @Post("reset-password")
    async resetPassword(@Body() body: ResetPasswordDto) {
        return this.authService.resetPassword(body.token, body.newPassword);
    }

    @Post("resend-verification")
    @UseGuards(RateLimitGuard)
    async resendVerification(@Body() body: ResendVerificationDto) {
        return this.authService.resendVerificationEmail(body.email);
    }

    @Post("link-password")
    @UseGuards(JwtGuard)
    async linkPassword(@Body() body: LinkPasswordDto, @Request() req: any) {
        return this.authService.linkPasswordToOAuthAccount(req.user.userId, body.password);
    }

    /**
     * Initiate Kakao account linking for logged-in email users
     * Redirects to Kakao OAuth with a signed state containing user ID
     */
    @Get("kakao/link")
    @UseGuards(JwtGuard)
    async initiateKakaoLink(@Request() req: any, @Res() res: Response) {
        const state = await this.authService.createLinkingState(req.user.userId);

        const kakaoAuthUrl = new URL("https://kauth.kakao.com/oauth/authorize");
        kakaoAuthUrl.searchParams.set("client_id", process.env['KAKAO_CLIENT_ID'] || "");
        kakaoAuthUrl.searchParams.set("redirect_uri", process.env['KAKAO_CALLBACK_URL'] || "");
        kakaoAuthUrl.searchParams.set("response_type", "code");
        kakaoAuthUrl.searchParams.set("state", state);

        res.redirect(kakaoAuthUrl.toString());
    }

    /**
     * Complete Kakao account linking after OAuth callback
     * Called internally from kakaoCallback when linking state is detected
     */
    private async completeKakaoLink(
        userId: string,
        kakaoData: any,
        res: Response,
        frontendURL: string,
    ) {
        try {
            await this.authService.linkKakaoToAccount(userId, kakaoData);

            // Redirect to frontend with success
            res.redirect(`${frontendURL}/dashboard/settings?kakao_linked=true`);
        } catch (error: any) {
            // Redirect to frontend with error
            const errorMessage = encodeURIComponent(error.message || '카카오 연결에 실패했습니다.');
            res.redirect(`${frontendURL}/dashboard/settings?kakao_link_error=${errorMessage}`);
        }
    }

    // ==================== Organization Selection Endpoints ====================

    @Get("organizations")
    @UseGuards(JwtGuard)
    async getUserOrganizations(@Request() req: any) {
        const organizations = await this.authService.getUserOrganizations(req.user.userId);
        return { organizations };
    }

    @Post("select-organization")
    @UseGuards(JwtGuard)
    async selectOrganization(
        @Body() body: SelectOrganizationDto,
        @Request() req: any,
        @Res({ passthrough: true }) res: Response
    ) {
        const tokens = await this.authService.selectOrganization(
            req.user.userId,
            body.organizationId
        );

        this.setAuthCookies(res, tokens);

        return { success: true, ...tokens };
    }

    @Post("switch-organization")
    @UseGuards(JwtGuard)
    async switchOrganization(
        @Body() body: SwitchOrganizationDto,
        @Request() req: any,
        @Res({ passthrough: true }) res: Response
    ) {
        const tokens = await this.authService.switchOrganization(
            req.user.userId,
            body.currentOrganizationId,
            body.newOrganizationId
        );

        this.setAuthCookies(res, tokens);

        return { success: true, ...tokens };
    }

    @Post("logout")
    async logout(@Res({ passthrough: true }) res: Response) {
        // Clear auth cookies
        res.clearCookie('auth_token', { path: '/' });
        res.clearCookie('refresh_token', { path: '/' });
        res.clearCookie('selected_organization_id', { path: '/' });

        return { success: true, message: 'Logged out successfully' };
    }

    // ==================== Private Helper Methods ====================

    private setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
        const isProduction = process.env['NODE_ENV'] === 'production';

        res.cookie('auth_token', tokens.accessToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        res.cookie('refresh_token', tokens.refreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
    }
}