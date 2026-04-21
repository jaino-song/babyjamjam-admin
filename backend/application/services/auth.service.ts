import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";
import * as bcrypt from "bcrypt";
import { EMAIL_PORT, EmailPort } from "../../domain/ports/email.port";
import { AUTH_TOKEN_REPOSITORY, IAuthTokenRepository } from "../../domain/repositories/auth-token.repository.interface";
import { AuthTokenEntity } from "../../domain/entities/auth-token.entity";
import { getAuthTokenExpiresIn } from "./auth-token-policy";

export interface KakaoData {
    kakaoId: string;
    email?: string;
    name?: string;
    profileImage?: string;
}

export interface TokenPayload {
    sub: string;
    role: string | null;
    branchId?: string;
    branchRole?: string;
    organizationId?: string;
    orgRole?: string;
    type: 'access' | 'refresh';
}

export interface UserValidationResult {
    user: string;
    accessToken: string;
    refreshToken: string;
    requiresBranchSelection?: boolean;
}

export interface PendingKakaoSignupProfile {
    email?: string;
    name?: string;
    profileImage?: string;
}

export interface PendingAccountOnboardingProfile extends PendingKakaoSignupProfile {
    phone?: string;
    birthDate?: string;
    branchId?: string;
    role?: string;
}

export interface PendingKakaoSignupValidationResult {
    onboardingRequired: true;
    onboardingKind: "kakao_signup";
    pendingSignupData: KakaoData;
}

export interface PendingAccountOnboardingValidationResult {
    onboardingRequired: true;
    onboardingKind: "account_completion";
    userId: string;
    prefill: PendingAccountOnboardingProfile;
}

export type KakaoUserValidationResult =
    | UserValidationResult
    | PendingKakaoSignupValidationResult
    | PendingAccountOnboardingValidationResult;

export type EmailUserValidationResult =
    | UserValidationResult
    | PendingAccountOnboardingValidationResult;

export interface PendingKakaoSignupExchangeResult {
    onboardingRequired: true;
    onboardingRoute: "/kakao/onboarding";
    pendingSignupToken: string;
    prefill: PendingKakaoSignupProfile;
}

export interface PendingAccountOnboardingExchangeResult {
    onboardingRequired: true;
    onboardingRoute: "/onboarding";
    pendingAccountOnboardingToken: string;
}

export type TokenExchangeResult = {
    accessToken: string;
    refreshToken: string;
    requiresBranchSelection?: boolean;
} | PendingKakaoSignupExchangeResult | PendingAccountOnboardingExchangeResult;

export interface PasswordValidationResult {
    valid: boolean;
    errors: string[];
}

export interface RegistrationResult {
    success: boolean;
    message: string;
    userId?: string;
    code?: string;
}

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private readonly BCRYPT_SALT_ROUNDS = 12;
    private readonly FRONTEND_URL: string;

    constructor(
        private prisma: PrismaService,
        private jwt: JwtService,
        @Inject(EMAIL_PORT) private emailService: EmailPort,
        @Inject(AUTH_TOKEN_REPOSITORY) private authTokenRepository: IAuthTokenRepository,
    ) {
        const nodeEnv = process.env['NODE_ENV'];
        if (nodeEnv === "production") {
            this.FRONTEND_URL = process.env['PRODUCTION_FRONTEND_URL'] ?? "http://localhost:3000";
        } else if (nodeEnv === "preview") {
            this.FRONTEND_URL = process.env['PREVIEW_FRONTEND_URL'] ?? "http://localhost:3000";
        } else {
            this.FRONTEND_URL = process.env['DEVELOPMENT_FRONTEND_URL'] ?? "http://localhost:3000";
        }
    }

    private async issueBranchTokens(
        user: { id: string; role: string | null },
        branchId: string,
        branchRole: string
    ): Promise<{ accessToken: string; refreshToken: string }> {
        const payload = {
            sub: user.id,
            role: user.role,
            branchId,
            branchRole,
        };

        const tokenExpiresIn = getAuthTokenExpiresIn(user.role);
        const signOptions = { expiresIn: tokenExpiresIn };
        const refreshSignOptions = { expiresIn: tokenExpiresIn };

        const accessToken = await this.jwt.signAsync(
            { ...payload, type: 'access' },
            signOptions
        );
        const refreshToken = await this.jwt.signAsync(
            { ...payload, type: 'refresh' },
            refreshSignOptions
        );

        return { accessToken, refreshToken };
    }

    private getPendingAccountOnboardingProfile(
        user: {
            id: string;
            email: string | null;
            name: string | null;
            profileImage: string | null;
            phone: string | null;
            birthDate: string | null;
            role: string | null;
        },
        userOrgs: Array<{ branchId: string; role: string | null }>,
    ): PendingAccountOnboardingProfile | null {
        const [firstOrg] = userOrgs;

        const needsPhone = !user.phone;
        const needsBirthDate = !user.birthDate;
        const needsRole = !user.role;
        const needsBranch = userOrgs.length === 0;
        const needsBranchRole = userOrgs.length === 1 && !firstOrg?.role;

        if (!needsPhone && !needsBirthDate && !needsRole && !needsBranch && !needsBranchRole) {
            return null;
        }

        return {
            email: user.email ?? undefined,
            name: user.name ?? undefined,
            profileImage: user.profileImage ?? undefined,
            phone: user.phone ?? undefined,
            birthDate: user.birthDate ?? undefined,
            branchId: userOrgs.length === 1 ? firstOrg?.branchId : undefined,
            role: firstOrg?.role ?? user.role ?? undefined,
        };
    }

    private async createLoginResultForUser(user: {
        id: string;
        email: string | null;
        name: string | null;
        profileImage: string | null;
        phone: string | null;
        birthDate: string | null;
        role: string | null;
    }): Promise<UserValidationResult | PendingAccountOnboardingValidationResult> {
        const userOrgs = await this.prisma.user_branch.findMany({
            where: { userId: user.id },
            select: {
                branchId: true,
                role: true,
            },
        });

        const pendingAccountOnboardingProfile = user.role === "owner"
            ? null
            : this.getPendingAccountOnboardingProfile(user, userOrgs);

        if (pendingAccountOnboardingProfile) {
            return {
                onboardingRequired: true,
                onboardingKind: "account_completion",
                userId: user.id,
                prefill: pendingAccountOnboardingProfile,
            };
        }

        if (user.role === 'owner') {
            const payload = {
                sub: user.id,
                role: user.role,
            };

            const tokenExpiresIn = getAuthTokenExpiresIn(user.role);
            const signOptions = { expiresIn: tokenExpiresIn };
            const refreshSignOptions = { expiresIn: tokenExpiresIn };

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
                requiresBranchSelection: true,
            };
        }

        let branchId: string | undefined;
        let branchRole: string | undefined;
        let requiresBranchSelection = false;

        const [firstOrg] = userOrgs;

        if (userOrgs.length === 1 && firstOrg) {
            branchId = firstOrg.branchId;
            branchRole = firstOrg.role ?? undefined;
        } else if (userOrgs.length > 1) {
            requiresBranchSelection = true;
        } else if (userOrgs.length === 0) {
            requiresBranchSelection = true;
        }

        const payload = {
            sub: user.id,
            role: user.role,
            ...(branchId && { branchId, branchRole }),
        };

        const tokenExpiresIn = getAuthTokenExpiresIn(user.role);
        const signOptions = { expiresIn: tokenExpiresIn };
        const refreshSignOptions = { expiresIn: tokenExpiresIn };

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
            requiresBranchSelection: requiresBranchSelection || undefined,
        };
    }

    async validateKakaoUser(kakaoData: KakaoData): Promise<KakaoUserValidationResult> {
        // First, try to find user by kakaoId
        let user = await this.prisma.user.findFirst({
            where: {
                kakaoId: kakaoData.kakaoId
            },
        });

        if (!user) {
            // If not found by kakaoId, check if a user exists with the same email
            // This enables account linking: email-registered users can login with Kakao
            if (kakaoData.email) {
                const existingUserByEmail = await this.prisma.user.findUnique({
                    where: { email: kakaoData.email.toLowerCase() },
                });

                if (existingUserByEmail) {
                    // Link Kakao account to existing email-based account
                    this.logger.log(`Linking Kakao account to existing email user: ${existingUserByEmail.id}`);
                    user = await this.prisma.user.update({
                        where: { id: existingUserByEmail.id },
                        data: {
                            kakaoId: kakaoData.kakaoId,
                            authProvider: existingUserByEmail.passwordHash ? 'both' : 'kakao',
                            // Update profile info from Kakao if not already set
                            name: existingUserByEmail.name || kakaoData.name,
                            profileImage: existingUserByEmail.profileImage || kakaoData.profileImage,
                        },
                    });
                }
            }

            // If still no user found, start a pending Kakao onboarding flow instead.
            if (!user) {
                return {
                    onboardingRequired: true,
                    onboardingKind: "kakao_signup",
                    pendingSignupData: {
                        kakaoId: kakaoData.kakaoId,
                        email: kakaoData.email?.toLowerCase(),
                        name: kakaoData.name,
                        profileImage: kakaoData.profileImage,
                    },
                };
            }
        }

        return this.createLoginResultForUser(user);
    }

    async selectBranch(userid: string, branchid: string): Promise<{ accessToken: string; refreshToken: string }> {
        const user = await this.prisma.user.findUnique({ where: { id: userid } });
        if (!user) {
            throw new UnauthorizedException("User not found");
        }

        // Owners can access any branch
        if (user.role === 'owner') {
            const org = await this.prisma.branch.findUnique({
                where: { id: branchid },
                select: { id: true },
            });
            if (!org) {
                throw new ForbiddenException("Branch not found");
            }
            return this.issueBranchTokens(user, branchid, 'owner');
        }

        // Regular users must be linked to the branch
        const userOrg = await this.prisma.user_branch.findFirst({
            where: { userId: userid, branchId: branchid }
        });
        if (!userOrg) {
            throw new ForbiddenException("User does not belong to this branch");
        }

        return this.issueBranchTokens(user, branchid, userOrg.role ?? 'member');
    }

    async switchBranch(
        userid: string,
        _currentbranchid: string,
        newbranchid: string
    ): Promise<{ accessToken: string; refreshToken: string }> {
        const user = await this.prisma.user.findUnique({ where: { id: userid } });
        if (!user) {
            throw new UnauthorizedException("User not found");
        }

        // Owners can switch to any branch
        if (user.role === 'owner') {
            const org = await this.prisma.branch.findUnique({
                where: { id: newbranchid },
                select: { id: true },
            });
            if (!org) {
                throw new ForbiddenException("Branch not found");
            }
            return this.issueBranchTokens(user, newbranchid, 'owner');
        }

        // Regular users must be linked to the branch
        const userOrg = await this.prisma.user_branch.findFirst({
            where: { userId: userid, branchId: newbranchid }
        });
        if (!userOrg) {
            throw new ForbiddenException("User does not belong to target branch");
        }

        return this.issueBranchTokens(user, newbranchid, userOrg.role ?? 'member');
    }

    async getUserBranches(userid: string): Promise<Array<{ id: string; name: string; slug: string; role: string }>> {
        // Check if user is owner - owners have access to ALL branches
        const user = await this.prisma.user.findUnique({
            where: { id: userid },
            select: { role: true }
        });

        this.logger.log(`[getUserBranches] User ${userid} has role: ${user?.role}`);

        if (user?.role === 'owner') {
            // Owner gets access to all branches
            const allOrgs = await this.prisma.branch.findMany({
                where: { isActive: true },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                },
                orderBy: { name: 'asc' }
            });

            this.logger.log(`[getUserBranches] Owner access - found ${allOrgs.length} active branches`);

            return allOrgs.map(org => ({
                id: org.id,
                name: org.name,
                slug: org.slug,
                role: 'owner',
            }));
        }

        // Regular users: only get branches they're linked to
        const userOrgs = await this.prisma.user_branch.findMany({
            where: { userId: userid },
            include: { branch: true }
        });

        if (userOrgs.length === 0) {
            return [];
        }

        return userOrgs.map(userOrg => ({
            id: userOrg.branch.id,
            name: userOrg.branch.name,
            slug: userOrg.branch.slug,
            role: userOrg.role ?? 'member',
        }));
    }

    private async pruneAuthFlowStates(): Promise<void> {
        try {
            await this.prisma.auth_flow_state.deleteMany({
                where: {
                    OR: [
                        { expiresAt: { lt: new Date() } },
                        {
                            consumedAt: { not: null },
                            createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                        },
                    ],
                },
            });
        } catch (error) {
            this.logger.warn(`Failed to prune auth flow states: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async createAuthFlowState(params: {
        kind: string;
        token: string;
        expiresAt: Date;
        userId?: string;
        accessToken?: string;
        refreshToken?: string;
        requiresBranchSelection?: boolean;
        kakaoData?: KakaoData;
    }): Promise<void> {
        await this.prisma.auth_flow_state.create({
            data: {
                kind: params.kind,
                tokenHash: this.hashToken(params.token),
                userId: params.userId,
                accessToken: params.accessToken,
                refreshToken: params.refreshToken,
                requiresBranchSelection: params.requiresBranchSelection ?? false,
                kakaoId: params.kakaoData?.kakaoId,
                email: params.kakaoData?.email,
                name: params.kakaoData?.name,
                profileImage: params.kakaoData?.profileImage,
                expiresAt: params.expiresAt,
            },
        });
    }

    private async getAuthFlowStateOrThrow(token: string, allowedKinds: string[]) {
        const state = await this.prisma.auth_flow_state.findUnique({
            where: { tokenHash: this.hashToken(token) },
        });

        if (!state || !allowedKinds.includes(state.kind)) {
            throw new UnauthorizedException("Invalid authorization code");
        }

        if (state.consumedAt) {
            throw new UnauthorizedException("Authorization code already used");
        }

        if (state.expiresAt.getTime() < Date.now()) {
            throw new UnauthorizedException("Authorization code expired");
        }

        return state;
    }

    private async consumeAuthFlowStateOrThrow(token: string, allowedKinds: string[]) {
        const hashedToken = this.hashToken(token);

        return this.prisma.$transaction(async (tx) => {
            const state = await tx.auth_flow_state.findUnique({
                where: { tokenHash: hashedToken },
            });

            if (!state || !allowedKinds.includes(state.kind)) {
                throw new UnauthorizedException("Invalid authorization code");
            }

            if (state.consumedAt) {
                throw new UnauthorizedException("Authorization code already used");
            }

            if (state.expiresAt.getTime() < Date.now()) {
                throw new UnauthorizedException("Authorization code expired");
            }

            const consumeResult = await tx.auth_flow_state.updateMany({
                where: {
                    id: state.id,
                    consumedAt: null,
                },
                data: {
                    consumedAt: new Date(),
                },
            });

            if (consumeResult.count !== 1) {
                throw new UnauthorizedException("Authorization code already used");
            }

            return state;
        });
    }

    private async createPendingKakaoSignupState(kakaoData: KakaoData): Promise<string> {
        const pendingSignupToken = this.generateToken();

        await this.createAuthFlowState({
            kind: "pending_kakao_signup",
            token: pendingSignupToken,
            kakaoData,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });

        return pendingSignupToken;
    }

    private async createPendingAccountOnboardingState(userId: string): Promise<string> {
        const pendingOnboardingToken = this.generateToken();

        await this.createAuthFlowState({
            kind: "pending_account_onboarding",
            token: pendingOnboardingToken,
            userId,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });

        return pendingOnboardingToken;
    }

    private async getPendingKakaoSignupOrThrow(token: string) {
        return this.getAuthFlowStateOrThrow(token, ["pending_kakao_signup"]);
    }

    private async getPendingAccountOnboardingOrThrow(token: string) {
        return this.getAuthFlowStateOrThrow(token, ["pending_account_onboarding"]);
    }

    async createAuthCode(tokens: { accessToken: string; refreshToken: string; requiresBranchSelection?: boolean }): Promise<string> {
        await this.pruneAuthFlowStates();

        const code = this.generateToken();
        await this.createAuthFlowState({
            kind: "auth_code",
            token: code,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            requiresBranchSelection: tokens.requiresBranchSelection,
            expiresAt: new Date(Date.now() + 30 * 1000),
        });

        return code;
    }

    async createPendingSignupCode(kakaoData: KakaoData): Promise<string> {
        await this.pruneAuthFlowStates();

        const code = this.generateToken();
        await this.createAuthFlowState({
            kind: "pending_kakao_signup_exchange",
            token: code,
            kakaoData,
            expiresAt: new Date(Date.now() + 30 * 1000),
        });

        return code;
    }

    async createPendingAccountOnboardingCode(userId: string): Promise<string> {
        await this.pruneAuthFlowStates();

        const code = this.generateToken();
        await this.createAuthFlowState({
            kind: "pending_account_onboarding_exchange",
            token: code,
            userId,
            expiresAt: new Date(Date.now() + 30 * 1000),
        });

        return code;
    }

    async startPendingAccountOnboarding(userId: string): Promise<string> {
        await this.pruneAuthFlowStates();
        return this.createPendingAccountOnboardingState(userId);
    }

    async exchangeCodeForTokens(code: string): Promise<TokenExchangeResult> {
        const stored = await this.consumeAuthFlowStateOrThrow(code, [
            "auth_code",
            "pending_kakao_signup_exchange",
            "pending_account_onboarding_exchange",
        ]);

        if (stored.kind === "auth_code") {
            if (!stored.accessToken || !stored.refreshToken) {
                throw new UnauthorizedException("Authorization code payload is invalid");
            }

            return {
                accessToken: stored.accessToken,
                refreshToken: stored.refreshToken,
                requiresBranchSelection: stored.requiresBranchSelection || undefined,
            };
        }

        if (stored.kind === "pending_account_onboarding_exchange") {
            if (!stored.userId) {
                throw new UnauthorizedException("Pending account onboarding payload is invalid");
            }

            const pendingAccountOnboardingToken = await this.createPendingAccountOnboardingState(stored.userId);

            return {
                onboardingRequired: true,
                onboardingRoute: "/onboarding",
                pendingAccountOnboardingToken,
            };
        }

        if (!stored.kakaoId) {
            throw new UnauthorizedException("Pending Kakao signup payload is invalid");
        }

        const pendingSignupData: KakaoData = {
            kakaoId: stored.kakaoId,
            email: stored.email ?? undefined,
            name: stored.name ?? undefined,
            profileImage: stored.profileImage ?? undefined,
        };
        const pendingSignupToken = await this.createPendingKakaoSignupState(pendingSignupData);

        return {
            onboardingRequired: true,
            onboardingRoute: "/kakao/onboarding",
            pendingSignupToken,
            prefill: {
                email: stored.email ?? undefined,
                name: stored.name ?? undefined,
                profileImage: stored.profileImage ?? undefined,
            },
        };
    }

    async getPendingKakaoSignup(token: string): Promise<PendingKakaoSignupProfile> {
        const stored = await this.getPendingKakaoSignupOrThrow(token);

        return {
            email: stored.email ?? undefined,
            name: stored.name ?? undefined,
            profileImage: stored.profileImage ?? undefined,
        };
    }

    async getPendingAccountOnboarding(token: string): Promise<PendingAccountOnboardingProfile> {
        const stored = await this.getPendingAccountOnboardingOrThrow(token);

        if (!stored.userId) {
            throw new UnauthorizedException("Pending account onboarding payload is invalid");
        }

        const user = await this.prisma.user.findUnique({
            where: { id: stored.userId },
            select: {
                id: true,
                email: true,
                name: true,
                profileImage: true,
                phone: true,
                birthDate: true,
                role: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException("Pending account onboarding user not found");
        }

        const userOrgs = await this.prisma.user_branch.findMany({
            where: { userId: user.id },
            select: {
                branchId: true,
                role: true,
            },
        });

        return this.getPendingAccountOnboardingProfile(user, userOrgs) ?? {
            email: user.email ?? undefined,
            name: user.name ?? undefined,
            profileImage: user.profileImage ?? undefined,
            phone: user.phone ?? undefined,
            birthDate: user.birthDate ?? undefined,
            branchId: userOrgs.length === 1 ? userOrgs[0]?.branchId : undefined,
            role: userOrgs.length === 1 ? userOrgs[0]?.role ?? user.role ?? undefined : user.role ?? undefined,
        };
    }

    async completeKakaoOnboarding(
        token: string,
        phone: string,
        birthDate: string,
        branchId: string,
        role: string,
    ): Promise<UserValidationResult> {
        const hashedToken = this.hashToken(token);

        const onboardingResult = await this.prisma.$transaction(async (tx) => {
            const stored = await tx.auth_flow_state.findUnique({
                where: { tokenHash: hashedToken },
            });

            if (!stored || stored.kind !== 'pending_kakao_signup') {
                throw new UnauthorizedException('Pending Kakao signup not found');
            }

            if (stored.consumedAt) {
                throw new UnauthorizedException('Pending Kakao signup already used');
            }

            if (stored.expiresAt.getTime() < Date.now()) {
                throw new UnauthorizedException('Pending Kakao signup expired');
            }

            if (!stored.kakaoId) {
                throw new UnauthorizedException('Pending Kakao signup payload is invalid');
            }

            const consumeResult = await tx.auth_flow_state.updateMany({
                where: {
                    id: stored.id,
                    consumedAt: null,
                },
                data: {
                    consumedAt: new Date(),
                },
            });

            if (consumeResult.count !== 1) {
                throw new UnauthorizedException('Pending Kakao signup already used');
            }

            const branch = await tx.branch.findUnique({
                where: { id: branchId },
                select: { id: true },
            });
            if (!branch) {
                throw new BadRequestException('유효하지 않은 지점입니다.');
            }

            const pendingSignupData: KakaoData = {
                kakaoId: stored.kakaoId,
                email: stored.email ?? undefined,
                name: stored.name ?? undefined,
                profileImage: stored.profileImage ?? undefined,
            };

            let existingUser = await tx.user.findFirst({
                where: { kakaoId: pendingSignupData.kakaoId },
            });

            const phoneOwner = await tx.user.findFirst({
                where: { phone },
            });
            if (phoneOwner && phoneOwner.id !== existingUser?.id) {
                throw new BadRequestException('이미 존재하는 사용자 입니다.');
            }

            if (!existingUser) {
                existingUser = await tx.user.create({
                    data: {
                        kakaoId: pendingSignupData.kakaoId,
                        email: pendingSignupData.email?.toLowerCase(),
                        name: pendingSignupData.name,
                        profileImage: pendingSignupData.profileImage,
                        phone,
                        birthDate,
                        role,
                        authProvider: 'kakao',
                    },
                });
            } else {
                existingUser = await tx.user.update({
                    where: { id: existingUser.id },
                    data: {
                        email: existingUser.email ?? pendingSignupData.email?.toLowerCase(),
                        name: existingUser.name ?? pendingSignupData.name,
                        profileImage: existingUser.profileImage ?? pendingSignupData.profileImage,
                        phone,
                        birthDate,
                        role,
                        authProvider: existingUser.passwordHash ? 'both' : 'kakao',
                    },
                });
            }

            const membership = await tx.user_branch.findFirst({
                where: {
                    userId: existingUser.id,
                    branchId,
                },
            });

            if (!membership) {
                await tx.user_branch.create({
                    data: {
                        userId: existingUser.id,
                        branchId,
                        role,
                    },
                });
            }

            return {
                kakaoData: {
                    kakaoId: pendingSignupData.kakaoId,
                    email: existingUser.email ?? pendingSignupData.email,
                    name: existingUser.name ?? pendingSignupData.name,
                    profileImage: existingUser.profileImage ?? pendingSignupData.profileImage,
                },
            };
        });

        const loginResult = await this.validateKakaoUser(onboardingResult.kakaoData);

        if ('onboardingRequired' in loginResult && loginResult.onboardingRequired) {
            throw new UnauthorizedException('Kakao onboarding completion failed');
        }

        return loginResult as UserValidationResult;
    }

    async completeAccountOnboarding(
        token: string,
        phone: string,
        birthDate: string,
        branchId: string,
        role: string,
    ): Promise<UserValidationResult> {
        const hashedToken = this.hashToken(token);

        const userId = await this.prisma.$transaction(async (tx) => {
            const stored = await tx.auth_flow_state.findUnique({
                where: { tokenHash: hashedToken },
            });

            if (!stored || stored.kind !== "pending_account_onboarding" || !stored.userId) {
                throw new UnauthorizedException("Pending account onboarding not found");
            }

            if (stored.consumedAt) {
                throw new UnauthorizedException("Pending account onboarding already used");
            }

            if (stored.expiresAt.getTime() < Date.now()) {
                throw new UnauthorizedException("Pending account onboarding expired");
            }

            const consumeResult = await tx.auth_flow_state.updateMany({
                where: {
                    id: stored.id,
                    consumedAt: null,
                },
                data: {
                    consumedAt: new Date(),
                },
            });

            if (consumeResult.count !== 1) {
                throw new UnauthorizedException("Pending account onboarding already used");
            }

            const user = await tx.user.findUnique({
                where: { id: stored.userId },
                select: {
                    id: true,
                    passwordHash: true,
                },
            });

            if (!user) {
                throw new UnauthorizedException("Pending account onboarding user not found");
            }

            const branch = await tx.branch.findUnique({
                where: { id: branchId },
                select: { id: true },
            });
            if (!branch) {
                throw new BadRequestException("유효하지 않은 지점입니다.");
            }

            const phoneOwner = await tx.user.findFirst({
                where: { phone },
                select: { id: true },
            });
            if (phoneOwner && phoneOwner.id !== user.id) {
                throw new BadRequestException("이미 존재하는 사용자 입니다.");
            }

            await tx.user.update({
                where: { id: user.id },
                data: {
                    phone,
                    birthDate,
                    role,
                },
            });

            const membership = await tx.user_branch.findFirst({
                where: {
                    userId: user.id,
                    branchId,
                },
                select: {
                    id: true,
                    role: true,
                },
            });

            if (!membership) {
                await tx.user_branch.create({
                    data: {
                        userId: user.id,
                        branchId,
                        role,
                    },
                });
            } else if (membership.role !== role) {
                await tx.user_branch.update({
                    where: { id: membership.id },
                    data: { role },
                });
            }

            return user.id;
        });

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                profileImage: true,
                phone: true,
                birthDate: true,
                role: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException("User not found after completing onboarding");
        }

        const loginResult = await this.createLoginResultForUser(user);

        if ("onboardingRequired" in loginResult && loginResult.onboardingRequired) {
            throw new UnauthorizedException("Account onboarding completion failed");
        }

        return loginResult as UserValidationResult;
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
            const payload: Omit<TokenPayload, "type"> = {
                sub: user.id,
                role: user.role,
            };

            const decodedBranchId = decoded.branchId ?? decoded.organizationId;

            if (decodedBranchId) {
                const stillMember = await this.prisma.user_branch.findFirst({
                    where: { userId: decoded.sub, branchId: decodedBranchId }
                });
                if (stillMember !== null) {
                    payload.branchId = decodedBranchId;
                    if (stillMember) {
                        payload.branchRole = stillMember.role ?? undefined;
                    }
                }
            }

            const tokenExpiresIn = getAuthTokenExpiresIn(user.role);
            const signOptions = { expiresIn: tokenExpiresIn };
            const refreshSignOptions = { expiresIn: tokenExpiresIn };

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

    // ==================== Email Authentication Methods ====================

    /**
     * Validate password strength
     * Requirements: min 8 chars, uppercase, lowercase, number, special char
     */
    validatePasswordStrength(password: string): PasswordValidationResult {
        const errors: string[] = [];

        if (password.length < 8) {
            errors.push('비밀번호는 최소 8자 이상이어야 합니다.');
        }
        if (!/[A-Z]/.test(password)) {
            errors.push('비밀번호에 대문자가 포함되어야 합니다.');
        }
        if (!/[a-z]/.test(password)) {
            errors.push('비밀번호에 소문자가 포함되어야 합니다.');
        }
        if (!/[0-9]/.test(password)) {
            errors.push('비밀번호에 숫자가 포함되어야 합니다.');
        }
        if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            errors.push('비밀번호에 특수문자가 포함되어야 합니다.');
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    /**
     * Hash a password with bcrypt
     */
    async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, this.BCRYPT_SALT_ROUNDS);
    }

    /**
     * Verify a password against a hash
     */
    async verifyPassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }

    /**
     * Generate a secure random token
     */
    private generateToken(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Hash a token for storage (using SHA-256)
     */
    private hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    /**
     * Register a new user with email/password
     * Always returns success to prevent email enumeration
     */
    async registerWithEmail(
        email: string,
        password: string,
        name: string,
        phone: string,
        birthDate: string,
        branchId: string,
        role: string,
    ): Promise<RegistrationResult> {
        // Validate password strength
        const passwordValidation = this.validatePasswordStrength(password);
        if (!passwordValidation.valid) {
            throw new BadRequestException({
                message: '비밀번호가 보안 요구사항을 충족하지 않습니다.',
                errors: passwordValidation.errors,
            });
        }

        // Check if email already exists
        const existingUser = await this.prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });

        if (existingUser) {
            // Check if user has Kakao account only (no password) - link the accounts
            if (existingUser.kakaoId && !existingUser.passwordHash) {
                this.logger.log(`Linking email/password to existing Kakao account: ${email}`);

                const passwordHash = await this.hashPassword(password);
                await this.prisma.user.update({
                    where: { id: existingUser.id },
                    data: {
                        passwordHash: passwordHash,
                        authProvider: 'both',
                        name: existingUser.name || name || null,
                        phone: phone,
                        birthDate: birthDate,
                        emailVerified: false,
                    },
                });

                // Send verification email
                await this.sendVerificationEmail(existingUser.id, email);

                return {
                    success: true,
                    message: '인증 이메일이 발송되었습니다. 이메일을 확인해주세요.',
                    code: 'ACCOUNTS_LINKED',
                    userId: existingUser.id,
                };
            }

            // User already has email account (with or without Kakao)
            // Don't reveal that the email exists - return generic success
            // But still send an email to notify the user
            this.logger.log(`Registration attempt for existing email: ${email}`);
            return {
                success: true,
                message: '인증 이메일이 발송되었습니다. 이메일을 확인해주세요.',
            };
        }

        const org = await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { id: true },
        });
        if (!org) {
            throw new BadRequestException('유효하지 않은 지점입니다.');
        }

        const passwordHash = await this.hashPassword(password);

        const user = await this.prisma.user.create({
            data: {
                email: email.toLowerCase(),
                name: name || null,
                phone: phone,
                birthDate: birthDate,
                passwordHash: passwordHash,
                role: role,
                authProvider: 'email',
                emailVerified: false,
            },
        });

        await this.prisma.user_branch.create({
            data: {
                userId: user.id,
                branchId: branchId,
                role,
            },
        });

        await this.sendVerificationEmail(user.id, user.email!);

        return {
            success: true,
            message: '인증 이메일이 발송되었습니다. 이메일을 확인해주세요.',
            userId: user.id,
        };
    }

    /**
     * Send a verification email to the user
     */
    async sendVerificationEmail(userId: string, email: string): Promise<void> {
        // Delete any existing verification tokens for this user
        await this.authTokenRepository.deleteByUserIdAndType(userId, 'email_verification');

        // Generate token
        const rawToken = this.generateToken();
        const hashedToken = this.hashToken(rawToken);

        // Create token entity
        const tokenEntity = AuthTokenEntity.createEmailVerificationToken(userId, hashedToken);
        await this.authTokenRepository.create(tokenEntity);

        // Build verification URL
        const verificationUrl = `${this.FRONTEND_URL}/verify-email?token=${rawToken}`;

        // Get user name
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
        });

        // Send email
        await this.emailService.sendVerificationEmail(email, user?.name || null, verificationUrl);
        this.logger.log(`Verification email sent to ${email}`);
    }

    /**
     * Verify email with token
     */
    async verifyEmail(token: string): Promise<RegistrationResult> {
        const hashedToken = this.hashToken(token);
        const tokenEntity = await this.authTokenRepository.findByToken(hashedToken);

        if (!tokenEntity) {
            throw new BadRequestException('유효하지 않은 인증 토큰입니다.');
        }

        if (tokenEntity.type !== 'email_verification') {
            throw new BadRequestException('유효하지 않은 인증 토큰입니다.');
        }

        if (!tokenEntity.isValid()) {
            throw new BadRequestException(
                tokenEntity.isExpired()
                    ? '인증 토큰이 만료되었습니다. 새 인증 이메일을 요청해주세요.'
                    : '이미 사용된 인증 토큰입니다.'
            );
        }

        // Mark token as used
        tokenEntity.markAsUsed();
        await this.authTokenRepository.update(tokenEntity);

        // Update user's emailVerified status
        await this.prisma.user.update({
            where: { id: tokenEntity.userId },
            data: {
                emailVerified: true,
                emailVerifiedAt: new Date(),
            },
        });

        this.logger.log(`Email verified for user ${tokenEntity.userId}`);

        return {
            success: true,
            message: '이메일 인증이 완료되었습니다. 이제 로그인할 수 있습니다.',
        };
    }

    /**
     * Validate email and password for login
     * Returns null if validation fails (for security reasons, don't reveal why)
     */
    async validateEmailPassword(
        email: string,
        password: string,
    ): Promise<EmailUserValidationResult | null> {
        const user = await this.prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });

        // User doesn't exist - return null without revealing why
        if (!user) {
            // Perform a dummy hash comparison to prevent timing attacks
            await bcrypt.compare(password, '$2b$12$invalidhashfortimingatack');
            return null;
        }

        // User has no password (OAuth-only account)
        if (!user.passwordHash) {
            await bcrypt.compare(password, '$2b$12$invalidhashfortimingatack');
            return null;
        }

        // Verify password
        const isPasswordValid = await this.verifyPassword(password, user.passwordHash);
        if (!isPasswordValid) {
            return null;
        }

        // Check if email is verified
        if (!user.emailVerified) {
            throw new ForbiddenException({
                code: 'EMAIL_NOT_VERIFIED',
                message: '이메일 인증이 필요합니다. 이메일을 확인해주세요.',
            });
        }

        return this.createLoginResultForUser(user);
    }

    /**
     * Request password reset
     * Always returns success to prevent email enumeration
     */
    async requestPasswordReset(email: string): Promise<RegistrationResult> {
        const user = await this.prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });

        // Always return success to prevent email enumeration
        if (!user) {
            return {
                success: true,
                message: '비밀번호 재설정 이메일이 발송되었습니다.',
            };
        }

        // Delete any existing reset tokens for this user
        await this.authTokenRepository.deleteByUserIdAndType(user.id, 'password_reset');

        // Generate token
        const rawToken = this.generateToken();
        const hashedToken = this.hashToken(rawToken);

        // Create token entity
        const tokenEntity = AuthTokenEntity.createPasswordResetToken(user.id, hashedToken);
        await this.authTokenRepository.create(tokenEntity);

        // Build reset URL
        const resetUrl = `${this.FRONTEND_URL}/reset-password?token=${rawToken}`;

        try {
            await this.emailService.sendPasswordResetEmail(user.email!, user.name, resetUrl);
            this.logger.log(`Password reset email sent to ${email}`);
        } catch (error) {
            this.logger.error(
                `Failed to send password reset email to ${email}`,
                error instanceof Error ? error.stack : String(error),
            );
        }

        return {
            success: true,
            message: '비밀번호 재설정 이메일이 발송되었습니다.',
        };
    }

    /**
     * Reset password with token
     */
    async resetPassword(token: string, newPassword: string): Promise<RegistrationResult> {
        // Validate password strength
        const passwordValidation = this.validatePasswordStrength(newPassword);
        if (!passwordValidation.valid) {
            throw new BadRequestException({
                message: '비밀번호가 보안 요구사항을 충족하지 않습니다.',
                errors: passwordValidation.errors,
            });
        }

        const hashedToken = this.hashToken(token);
        const tokenEntity = await this.authTokenRepository.findByToken(hashedToken);

        if (!tokenEntity) {
            throw new BadRequestException('유효하지 않은 재설정 토큰입니다.');
        }

        if (tokenEntity.type !== 'password_reset') {
            throw new BadRequestException('유효하지 않은 재설정 토큰입니다.');
        }

        if (!tokenEntity.isValid()) {
            throw new BadRequestException(
                tokenEntity.isExpired()
                    ? '재설정 토큰이 만료되었습니다. 새 재설정 이메일을 요청해주세요.'
                    : '이미 사용된 재설정 토큰입니다.'
            );
        }

        // Mark token as used
        tokenEntity.markAsUsed();
        await this.authTokenRepository.update(tokenEntity);

        // Get user to check if they have OAuth linked
        const user = await this.prisma.user.findUnique({
            where: { id: tokenEntity.userId },
        });

        // Hash new password
        const passwordHash = await this.hashPassword(newPassword);

        // Determine authProvider: if user has kakaoId, they now have both methods
        const authProvider = user?.kakaoId ? 'both' : 'email';

        // Update user's password
        await this.prisma.user.update({
            where: { id: tokenEntity.userId },
            data: {
                passwordHash: passwordHash,
                authProvider: authProvider,
            },
        });

        this.logger.log(`Password reset completed for user ${tokenEntity.userId}`);

        return {
            success: true,
            message: '비밀번호가 성공적으로 변경되었습니다.',
        };
    }

    /**
     * Resend verification email
     * Always returns success to prevent email enumeration
     */
    async resendVerificationEmail(email: string): Promise<RegistrationResult> {
        const user = await this.prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });

        // Always return success to prevent email enumeration
        if (!user) {
            return {
                success: true,
                message: '인증 이메일이 발송되었습니다.',
            };
        }

        // Already verified
        if (user.emailVerified) {
            return {
                success: true,
                message: '인증 이메일이 발송되었습니다.',
            };
        }

        try {
            await this.sendVerificationEmail(user.id, user.email!);
        } catch (error) {
            this.logger.error(
                `Failed to resend verification email to ${email}`,
                error instanceof Error ? error.stack : String(error),
            );
        }

        return {
            success: true,
            message: '인증 이메일이 발송되었습니다.',
        };
    }

    /**
     * Link password to an OAuth account
     * This allows users who signed up via OAuth to also login with email/password
     */
    async linkPasswordToOAuthAccount(
        userId: string,
        password: string,
    ): Promise<RegistrationResult> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
        }

        if (user.passwordHash) {
            throw new BadRequestException('이미 비밀번호가 설정되어 있습니다.');
        }

        if (!user.email) {
            throw new BadRequestException('이메일 주소가 설정되어 있지 않습니다. 먼저 이메일을 등록해주세요.');
        }

        // Validate password strength
        const passwordValidation = this.validatePasswordStrength(password);
        if (!passwordValidation.valid) {
            throw new BadRequestException({
                message: '비밀번호가 보안 요구사항을 충족하지 않습니다.',
                errors: passwordValidation.errors,
            });
        }

        // Hash password
        const passwordHash = await this.hashPassword(password);

        // Update user
        await this.prisma.user.update({
            where: { id: userId },
            data: {
                passwordHash: passwordHash,
                authProvider: 'both',
                emailVerified: true, // OAuth users are trusted
                emailVerifiedAt: new Date(),
            },
        });

        this.logger.log(`Password linked to OAuth account for user ${userId}`);

        return {
            success: true,
            message: '비밀번호가 성공적으로 설정되었습니다. 이제 이메일로도 로그인할 수 있습니다.',
        };
    }

    /**
     * Link Kakao account to an existing email-based account
     * This allows users who signed up via email to also login with Kakao
     */
    async linkKakaoToAccount(
        userId: string,
        kakaoData: KakaoData,
    ): Promise<RegistrationResult> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
        }

        if (user.kakaoId) {
            throw new BadRequestException('이미 카카오 계정이 연결되어 있습니다.');
        }

        // Check if this Kakao account is already linked to another user
        const existingKakaoUser = await this.prisma.user.findFirst({
            where: { kakaoId: kakaoData.kakaoId },
        });

        if (existingKakaoUser) {
            throw new BadRequestException('이 카카오 계정은 이미 다른 계정에 연결되어 있습니다.');
        }

        // Determine authProvider based on whether user has password
        const authProvider = user.passwordHash ? 'both' : 'kakao';

        // Update user with Kakao info
        await this.prisma.user.update({
            where: { id: userId },
            data: {
                kakaoId: kakaoData.kakaoId,
                authProvider: authProvider,
                // Update profile info from Kakao if not already set
                name: user.name || kakaoData.name,
                profileImage: user.profileImage || kakaoData.profileImage,
            },
        });

        this.logger.log(`Kakao account linked to user ${userId}`);

        return {
            success: true,
            message: '카카오 계정이 성공적으로 연결되었습니다. 이제 카카오로도 로그인할 수 있습니다.',
        };
    }

    /**
     * Create a linking state token for OAuth account linking
     * The state contains the user ID to link after OAuth callback
     */
    async createLinkingState(userId: string): Promise<string> {
        const state = crypto.randomBytes(32).toString('hex');
        const payload = {
            userId,
            purpose: 'link_kakao',
            state,
        };

        // Sign the state to prevent tampering
        const signedState = await this.jwt.signAsync(payload, { expiresIn: '10m' });
        return signedState;
    }

    /**
     * Verify and decode a linking state token
     */
    async verifyLinkingState(signedState: string): Promise<{ userId: string; purpose: string } | null> {
        try {
            const decoded = await this.jwt.verifyAsync<{ userId: string; purpose: string; state: string }>(signedState);
            if (decoded.purpose !== 'link_kakao') {
                return null;
            }
            return { userId: decoded.userId, purpose: decoded.purpose };
        } catch {
            return null;
        }
    }
}
