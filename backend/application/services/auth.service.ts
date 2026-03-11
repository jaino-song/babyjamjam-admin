import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";
import * as bcrypt from "bcrypt";
import { EMAIL_PORT, EmailPort } from "../../domain/ports/email.port";
import { AUTH_TOKEN_REPOSITORY, IAuthTokenRepository } from "../../domain/repositories/auth-token.repository.interface";
import { AuthTokenEntity } from "../../domain/entities/auth-token.entity";

export interface KakaoData {
    kakaoId: string;
    email?: string;
    name?: string;
    profileImage?: string;
}

export interface TokenPayload {
    sub: string;
    role: string | null;
    organizationId?: string;
    orgRole?: string;
    type: 'access' | 'refresh';
}

export interface UserValidationResult {
    user: string;
    accessToken: string;
    refreshToken: string;
    requiresOrgSelection?: boolean;
}

interface StoredAuthCode {
    tokens: {
        accessToken: string;
        refreshToken: string;
        requiresOrgSelection?: boolean;
    };
    expiresAt: number;
}

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
    private authCodes = new Map<string, StoredAuthCode>();
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

    private cleanupExpiredCodes() {
        const now = Date.now();
        for (const [code, stored] of this.authCodes.entries()) {
            if (now > stored.expiresAt) {
                this.authCodes.delete(code);
            }
        }
    }

    private async issueOrganizationTokens(
        user: { id: string; role: string | null },
        organizationId: string,
        orgRole: string
    ): Promise<{ accessToken: string; refreshToken: string }> {
        const payload = {
            sub: user.id,
            role: user.role,
            organizationId,
            orgRole,
        };

        const privilegedRoles = ["owner", "admin", "manager"];
        const isPrivileged = user.role !== null && privilegedRoles.includes(user.role);
        const signOptions = isPrivileged ? { expiresIn: "30d" } : { expiresIn: "3d" };
        const refreshSignOptions = isPrivileged ? { expiresIn: "7d" } : { expiresIn: "1d" };

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

    async validateKakaoUser(kakaoData: KakaoData): Promise<UserValidationResult> {
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

            // If still no user found, create a new one
            if (!user) {
                user = await this.prisma.user.create({
                    data: {
                        kakaoId: kakaoData.kakaoId,
                        email: kakaoData.email?.toLowerCase(),
                        name: kakaoData.name,
                        profileImage: kakaoData.profileImage,
                        role: "user",
                        authProvider: "kakao",
                    },
                });
            }
        }

        // Owners have implicit access to ALL organizations, so they always need to select
        if (user.role === 'owner') {
            const payload = {
                sub: user.id,
                role: user.role,
            };

            const signOptions = { expiresIn: "30d" };
            const refreshSignOptions = { expiresIn: "7d" };

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
                requiresOrgSelection: true, // Owners always need to select an organization
            };
        }

        // Regular users: check organization membership
        const userOrgs = await this.prisma.user_organization.findMany({
            where: { userId: user.id }
        });

        let organizationId: string | undefined;
        let orgRole: string | undefined;
        let requiresOrgSelection = false;

        const [firstOrg] = userOrgs;

        if (userOrgs.length === 1 && firstOrg) {
            organizationId = firstOrg.organizationId;
            orgRole = firstOrg.role ?? undefined;
        } else if (userOrgs.length > 1) {
            requiresOrgSelection = true;
        } else if (userOrgs.length === 0) {
            // User has no organization membership - still need to handle this
            requiresOrgSelection = true;
        }

        const payload = {
            sub: user.id,
            role: user.role,
            ...(organizationId && { organizationId, orgRole }),
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
            requiresOrgSelection: requiresOrgSelection || undefined,
        };
    }

    async selectOrganization(userid: string, organizationid: string): Promise<{ accessToken: string; refreshToken: string }> {
        const user = await this.prisma.user.findUnique({ where: { id: userid } });
        if (!user) {
            throw new UnauthorizedException("User not found");
        }

        // Owners can access any organization
        if (user.role === 'owner') {
            const org = await this.prisma.organization.findUnique({
                where: { id: organizationid },
                select: { id: true },
            });
            if (!org) {
                throw new ForbiddenException("Organization not found");
            }
            return this.issueOrganizationTokens(user, organizationid, 'owner');
        }

        // Regular users must be linked to the organization
        const userOrg = await this.prisma.user_organization.findFirst({
            where: { userId: userid, organizationId: organizationid }
        });
        if (!userOrg) {
            throw new ForbiddenException("User does not belong to this organization");
        }

        return this.issueOrganizationTokens(user, organizationid, userOrg.role ?? 'member');
    }

    async switchOrganization(
        userid: string,
        _currentorgid: string,
        neworgid: string
    ): Promise<{ accessToken: string; refreshToken: string }> {
        const user = await this.prisma.user.findUnique({ where: { id: userid } });
        if (!user) {
            throw new UnauthorizedException("User not found");
        }

        // Owners can switch to any organization
        if (user.role === 'owner') {
            const org = await this.prisma.organization.findUnique({
                where: { id: neworgid },
                select: { id: true },
            });
            if (!org) {
                throw new ForbiddenException("Organization not found");
            }
            return this.issueOrganizationTokens(user, neworgid, 'owner');
        }

        // Regular users must be linked to the organization
        const userOrg = await this.prisma.user_organization.findFirst({
            where: { userId: userid, organizationId: neworgid }
        });
        if (!userOrg) {
            throw new ForbiddenException("User does not belong to target organization");
        }

        return this.issueOrganizationTokens(user, neworgid, userOrg.role ?? 'member');
    }

    async getUserOrganizations(userid: string): Promise<Array<{ id: string; name: string; slug: string; role: string }>> {
        // Check if user is owner - owners have access to ALL organizations
        const user = await this.prisma.user.findUnique({
            where: { id: userid },
            select: { role: true }
        });

        this.logger.log(`[getUserOrganizations] User ${userid} has role: ${user?.role}`);

        if (user?.role === 'owner') {
            // Owner gets access to all organizations
            const allOrgs = await this.prisma.organization.findMany({
                where: { isActive: true },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                },
                orderBy: { name: 'asc' }
            });

            this.logger.log(`[getUserOrganizations] Owner access - found ${allOrgs.length} active organizations`);

            return allOrgs.map(org => ({
                id: org.id,
                name: org.name,
                slug: org.slug,
                role: 'owner',
            }));
        }

        // Regular users: only get organizations they're linked to
        const userOrgs = await this.prisma.user_organization.findMany({
            where: { userId: userid },
            include: { organization: true }
        });

        if (userOrgs.length === 0) {
            return [];
        }

        return userOrgs.map(userOrg => ({
            id: userOrg.organization.id,
            name: userOrg.organization.name,
            slug: userOrg.organization.slug,
            role: userOrg.role ?? 'member',
        }));
    }

    async createAuthCode(tokens: { accessToken: string; refreshToken: string; requiresOrgSelection?: boolean }): Promise<string> {
        const code = crypto.randomBytes(32).toString("hex");

        this.authCodes.set(code, {
            tokens,
            expiresAt: Date.now() + 30 * 1000,
        });

        this.cleanupExpiredCodes();

        return code;
    }

    async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string; requiresOrgSelection?: boolean }> {
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
            const payload: Omit<TokenPayload, "type"> = {
                sub: user.id,
                role: user.role,
            };

            if (decoded.organizationId) {
                const stillMember = await this.prisma.user_organization.findFirst({
                    where: { userId: decoded.sub, organizationId: decoded.organizationId }
                });
                if (stillMember !== null) {
                    payload.organizationId = decoded.organizationId;
                    if (stillMember) {
                        payload.orgRole = stillMember.role ?? undefined;
                    }
                }
            }

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
        organizationId: string,
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

        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
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

        await this.prisma.user_organization.create({
            data: {
                userId: user.id,
                organizationId: organizationId,
                role: 'user',
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
    ): Promise<UserValidationResult | null> {
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

        // Generate tokens (same logic as validateKakaoUser)
        // Owners have implicit access to ALL organizations, so they always need to select
        if (user.role === 'owner') {
            const payload = {
                sub: user.id,
                role: user.role,
            };

            const signOptions = { expiresIn: "30d" };
            const refreshSignOptions = { expiresIn: "7d" };

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
                requiresOrgSelection: true, // Owners always need to select an organization
            };
        }

        // Regular users: check organization membership
        const userOrgs = await this.prisma.user_organization.findMany({
            where: { userId: user.id }
        });

        let organizationId: string | undefined;
        let orgRole: string | undefined;
        let requiresOrgSelection = false;

        const [firstOrg] = userOrgs;

        if (userOrgs.length === 1 && firstOrg) {
            organizationId = firstOrg.organizationId;
            orgRole = firstOrg.role ?? undefined;
        } else if (userOrgs.length > 1) {
            requiresOrgSelection = true;
        } else if (userOrgs.length === 0) {
            // User has no organization membership - still need to handle this
            requiresOrgSelection = true;
        }

        const payload = {
            sub: user.id,
            role: user.role,
            ...(organizationId && { organizationId, orgRole }),
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
            requiresOrgSelection: requiresOrgSelection || undefined,
        };
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

        // Send email
        await this.emailService.sendPasswordResetEmail(user.email!, user.name, resetUrl);
        this.logger.log(`Password reset email sent to ${email}`);

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

        // Send new verification email
        await this.sendVerificationEmail(user.id, user.email!);

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
