import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Ip, Post, Query, Req, Request, Res, UseGuards } from "@nestjs/common";
import { Response, Request as ExpressRequest } from "express";
import { AuthGuard } from "@nestjs/passport";
import { AuthService, NO_ACCESSIBLE_BRANCH_MESSAGE, type KakaoUserValidationResult } from "../../application/services/auth.service";
import { JwtGuard } from "../../infrastructure/auth/jwt.guard";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { TokenExchangeDto } from "interface/dto/token-exchange.dto";
import { RefreshTokenDto } from "interface/dto/refresh-token.dto";
import { RateLimitGuard } from "../../infrastructure/auth/rate-limit.guard";
import { getAuthTokenMaxAgeMs } from "../../application/services/auth-token-policy";
import {
    RegisterDto,
    LoginDto,
    VerifyEmailDto,
    ForgotPasswordDto,
    ResetPasswordDto,
    ResendVerificationDto,
    LinkPasswordDto,
} from "interface/dto/email-auth.dto";
import { SelectBranchDto, SwitchBranchDto } from "interface/dto/branch-auth.dto";
import { CompleteKakaoOnboardingDto } from "interface/dto/kakao-onboarding.dto";
import { isVisibleStaffBranchSlug } from "domain/constants/branch-routing.constants";
import { getKakaoOAuthConfig } from "infrastructure/auth/kakao-config";

@Controller("auth")
export class AuthController {
    private static readonly PENDING_SIGNUP_TOKEN_HEADER = "x-pending-signup-token";
    private static readonly PENDING_ONBOARDING_TOKEN_HEADER = "x-pending-onboarding-token";
    private static readonly OAUTH_NONCE_COOKIE = "kakao_oauth_nonce";

    constructor(
        private readonly authService: AuthService,
        private readonly prisma: PrismaService,
        private readonly rateLimitGuard: RateLimitGuard,
    ) {}

    @Get("kakao")
    async kakaoLogin(@Query("client") client: string | undefined, @Res() res: Response) {
        // Initiate Kakao OAuth manually so we can both:
        //  - carry the originating client (mobile vs desktop) in the OAuth `state`, so the
        //    callback returns mobile users to m.staff.* instead of the desktop domain, and
        //  - bind the round-trip to THIS browser with a single-use nonce cookie, so a forged
        //    callback from another browser is rejected (login-CSRF protection).
        // Both frontends navigate the browser directly to this backend host to start the flow,
        // so the nonce cookie set here is sent back on the callback (same host).
        const target = client === "mobile" ? "mobile" : "desktop";
        const { signedState, nonce } = await this.authService.createKakaoLoginState(target);
        this.setOAuthNonceCookie(res, nonce);

        res.redirect(this.buildKakaoAuthorizeUrl(signedState));
    }

    @Get("kakao/callback")
    @UseGuards(AuthGuard("kakao"))
    async kakaoCallback(@Req() req: any, @Res() res: Response) {
        // `state` is a signed JWT: { client, nonce } for login, or a userId payload for
        // linking. For login, the matching single-use nonce was stored in an httpOnly cookie
        // at initiation; reading + clearing it here and requiring it to match the signed nonce
        // binds this callback to the browser that started the flow (login-CSRF protection).
        const state = req.query.state as string | undefined;
        const nonce = req.cookies?.[AuthController.OAUTH_NONCE_COOKIE] as string | undefined;
        this.clearOAuthNonceCookie(res);

        // Account-linking flow: state is a signed JWT bound to a userId (JwtGuard-gated).
        const linkingInfo = state ? await this.authService.verifyLinkingState(state) : null;
        if (linkingInfo) {
            console.log(`[Auth] Linking Kakao account to user ${linkingInfo.userId}`);
            return this.completeKakaoLink(linkingInfo.userId, req.user, res, this.resolveFrontendURL("desktop"));
        }

        // Login/registration flow: state is a signed JWT carrying { client, nonce }.
        const loginState = state ? await this.authService.verifyKakaoLoginState(state, nonce) : null;
        if (!loginState) {
            // Login-CSRF guard: state missing/forged/expired, or its nonce does not match the cookie.
            console.warn("[Auth] Rejected Kakao callback: invalid or unbound OAuth state");
            return res.redirect(`${this.resolveFrontendURL("desktop")}/login?error=invalid_oauth_state`);
        }

        const frontendURL = this.resolveFrontendURL(loginState.client);

        // Normal login/registration flow
        let result: KakaoUserValidationResult;
        try {
            result = await this.authService.validateKakaoUser(req.user);
        } catch (error) {
            if (error instanceof ForbiddenException && error.message === NO_ACCESSIBLE_BRANCH_MESSAGE) {
                const query = new URLSearchParams({ error: NO_ACCESSIBLE_BRANCH_MESSAGE });
                return res.redirect(`${frontendURL}/callback?${query.toString()}`);
            }

            throw error;
        }

        const code = ("onboardingRequired" in result && result.onboardingRequired)
            ? result.onboardingKind === "kakao_signup"
                ? await this.authService.createPendingSignupCode(result.pendingSignupData)
                : await this.authService.createPendingAccountOnboardingCode(result.userId)
            : await this.authService.createAuthCode(result as { accessToken: string; refreshToken: string; requiresBranchSelection?: boolean });

        console.log(`[Auth] Redirecting to ${frontendURL}/callback (NODE_ENV: ${process.env['NODE_ENV']})`);

        res.redirect(`${frontendURL}/callback?code=${code}`);
    }

    @Get("me")
    @UseGuards(JwtGuard)
    async getCurrentUser(@Request() req: any) {
        const userPromise = this.prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                birthDate: true,
                profileImage: true,
                role: true,
            },
        });
        const branchPromise = req.user.branchId
            ? this.prisma.branch.findUnique({
                where: { id: req.user.branchId },
                select: { name: true, slug: true },
            })
            : Promise.resolve(null);

        const [user, org] = await Promise.all([userPromise, branchPromise]);
        const branchName = org?.name ?? null;
        const branchSlug = org?.slug ?? null;

        return { ...user, branchName, branchSlug };
    }

    @Post("token")
    async exchangeToken(@Body() body: TokenExchangeDto) {
        const tokens = await this.authService.exchangeCodeForTokens(body.code);
        return tokens;
    }

    @Get("kakao/pending-signup")
    async getPendingKakaoSignup(
        @Headers(AuthController.PENDING_SIGNUP_TOKEN_HEADER) headerToken?: string,
        @Query("token") queryToken?: string,
    ) {
        const token = headerToken ?? queryToken;
        if (!token) {
            throw new BadRequestException("Pending signup token is required");
        }

        return this.authService.getPendingKakaoSignup(token);
    }

    @Post("kakao/complete-signup")
    async completeKakaoOnboarding(
        @Headers(AuthController.PENDING_SIGNUP_TOKEN_HEADER) headerToken: string | undefined,
        @Query("token") queryToken: string | undefined,
        @Body() body: CompleteKakaoOnboardingDto,
    ) {
        const token = headerToken ?? queryToken;
        if (!token) {
            throw new BadRequestException("Pending signup token is required");
        }

        return this.authService.completeKakaoOnboarding(
            token,
            body.phone,
            body.birthDate,
            body.branchId,
            body.role,
        );
    }

    @Get("onboarding/pending")
    async getPendingAccountOnboarding(
        @Headers(AuthController.PENDING_ONBOARDING_TOKEN_HEADER) headerToken?: string,
        @Query("token") queryToken?: string,
    ) {
        const token = headerToken ?? queryToken;
        if (!token) {
            throw new BadRequestException("Pending onboarding token is required");
        }

        return this.authService.getPendingAccountOnboarding(token);
    }

    @Post("onboarding/complete")
    async completeAccountOnboarding(
        @Headers(AuthController.PENDING_ONBOARDING_TOKEN_HEADER) headerToken: string | undefined,
        @Query("token") queryToken: string | undefined,
        @Body() body: CompleteKakaoOnboardingDto,
    ) {
        const token = headerToken ?? queryToken;
        if (!token) {
            throw new BadRequestException("Pending onboarding token is required");
        }

        return this.authService.completeAccountOnboarding(
            token,
            body.phone,
            body.birthDate,
            body.branchId,
            body.role,
        );
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
            body.phone,
            body.birthDate,
            body.branchId,
            body.role,
        );

        // Reset rate limit on successful registration
        if (result.success) {
            this.rateLimitGuard.resetForKey(ip, body.email);
        }

        return result;
    }

    @Get("check-email")
    @UseGuards(RateLimitGuard)
    async checkEmail(@Query("email") email?: string) {
        const normalizedEmail = email?.trim().toLowerCase();

        if (!normalizedEmail) {
            return { exists: false, linkable: false };
        }

        const user = await this.prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true, kakaoId: true, passwordHash: true },
        });

        const linkable = Boolean(user?.kakaoId && !user.passwordHash);
        return {
            exists: Boolean(user),
            linkable,
        };
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

        if ("onboardingRequired" in result && result.onboardingRequired) {
            const pendingAccountOnboardingToken = await this.authService.startPendingAccountOnboarding(result.userId);

            return {
                success: true,
                onboardingRequired: true,
                onboardingRoute: "/onboarding",
                pendingAccountOnboardingToken,
            };
        }

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
        res.redirect(this.buildKakaoAuthorizeUrl(state));
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

    // ==================== Branch Selection Endpoints ====================

    @Get("branches")
    @UseGuards(JwtGuard)
    async getUserBranches(@Request() req: any) {
        const branches = await this.authService.getUserBranches(req.user.userId);
        return { branches };
    }

    @Get("branches/all")
    async getAllActiveBranches() {
        const branches = await this.prisma.branch.findMany({
            where: { isActive: true },
            select: { id: true, name: true, slug: true },
            orderBy: { name: 'asc' },
        });
        return branches
            .filter((branch) => isVisibleStaffBranchSlug(branch.slug))
            .map(({ id, name }) => ({ id, name }));
    }

    @Post("select-branch")
    @UseGuards(JwtGuard)
    async selectBranch(
        @Body() body: SelectBranchDto,
        @Request() req: any,
        @Res({ passthrough: true }) res: Response
    ) {
        const tokens = await this.authService.selectBranch(
            req.user.userId,
            body.branchId
        );

        this.setAuthCookies(res, tokens);

        return { success: true, ...tokens };
    }

    @Post("switch-branch")
    @UseGuards(JwtGuard)
    async switchBranch(
        @Body() body: SwitchBranchDto,
        @Request() req: any,
        @Res({ passthrough: true }) res: Response
    ) {
        const tokens = await this.authService.switchBranch(
            req.user.userId,
            body.currentBranchId,
            body.newBranchId
        );

        this.setAuthCookies(res, tokens);

        return { success: true, ...tokens };
    }

    @Post("logout")
    async logout(@Res({ passthrough: true }) res: Response) {
        // Clear auth cookies
        res.clearCookie('auth_token', { path: '/' });
        res.clearCookie('refresh_token', { path: '/' });
        res.clearCookie('selected_branch_id', { path: '/' });

        return { success: true, message: 'Logged out successfully' };
    }

    // ==================== Private Helper Methods ====================

    private getRoleFromToken(token: string): string | null {
        const [, payload] = token.split(".");
        if (!payload) return null;

        try {
            const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: unknown };
            return typeof decoded.role === "string" ? decoded.role : null;
        } catch {
            return null;
        }
    }

    private resolveFrontendURL(client: "mobile" | "desktop"): string {
        const nodeEnv = process.env['NODE_ENV'];
        const fallback = "http://localhost:3000";

        const desktopURL =
            nodeEnv === "production" ? process.env['PRODUCTION_FRONTEND_URL']
            : nodeEnv === "preview" ? process.env['PREVIEW_FRONTEND_URL']
            : process.env['DEVELOPMENT_FRONTEND_URL'];

        if (client === "desktop") {
            return desktopURL ?? fallback;
        }

        const mobileURL =
            nodeEnv === "production" ? process.env['PRODUCTION_MOBILE_FRONTEND_URL']
            : nodeEnv === "preview" ? process.env['PREVIEW_MOBILE_FRONTEND_URL']
            : process.env['DEVELOPMENT_MOBILE_FRONTEND_URL'];

        // Fall back to the desktop URL until the mobile URL env var is configured, so a
        // missing var degrades gracefully (current behavior) instead of breaking login.
        return mobileURL ?? desktopURL ?? fallback;
    }

    private buildKakaoAuthorizeUrl(state: string): string {
        const kakaoOAuthConfig = getKakaoOAuthConfig();
        const kakaoAuthUrl = new URL("https://kauth.kakao.com/oauth/authorize");
        kakaoAuthUrl.searchParams.set("client_id", kakaoOAuthConfig.clientID);
        kakaoAuthUrl.searchParams.set("redirect_uri", kakaoOAuthConfig.callbackURL);
        kakaoAuthUrl.searchParams.set("response_type", "code");
        kakaoAuthUrl.searchParams.set("state", state);
        return kakaoAuthUrl.toString();
    }

    private setOAuthNonceCookie(res: Response, nonce: string) {
        res.cookie(AuthController.OAUTH_NONCE_COOKIE, nonce, {
            httpOnly: true,
            secure: process.env['NODE_ENV'] === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 10 * 60 * 1000, // 10 minutes; matches the signed-state TTL
        });
    }

    private clearOAuthNonceCookie(res: Response) {
        res.clearCookie(AuthController.OAUTH_NONCE_COOKIE, { path: '/' });
    }

    private setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
        const isProduction = process.env['NODE_ENV'] === 'production';
        const role = this.getRoleFromToken(tokens.accessToken);
        const maxAge = getAuthTokenMaxAgeMs(role);

        res.cookie('auth_token', tokens.accessToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/',
            maxAge,
        });

        res.cookie('refresh_token', tokens.refreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/',
            maxAge,
        });
    }
}
