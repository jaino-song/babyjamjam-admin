import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";

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
    };
    expiresAt: number;
}

@Injectable()
export class AuthService {
    private authCodes = new Map<string, StoredAuthCode>();

    constructor(private prisma: PrismaService, private jwt: JwtService) { }

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

        const accessSignOptions = { ...signOptions, type: 'access' } as Parameters<JwtService["signAsync"]>[1];
        const refreshSignWithTypeOptions = { ...refreshSignOptions, type: 'refresh' } as Parameters<JwtService["signAsync"]>[1];

        const accessToken = await this.jwt.signAsync(
            { ...payload, type: 'access' },
            accessSignOptions
        );
        const refreshToken = await this.jwt.signAsync(
            { ...payload, type: 'refresh' },
            refreshSignWithTypeOptions
        );

        return { accessToken, refreshToken };
    }

    async validateKakaoUser(kakaoData: KakaoData): Promise<UserValidationResult> {
        let user = await this.prisma.user.findFirst({
            where: {
                kakao_id: kakaoData.kakaoId
            },
        });

        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    kakao_id: kakaoData.kakaoId,
                    email: kakaoData.email,
                    name: kakaoData.name,
                    profile_image: kakaoData.profileImage,
                    role: "user",
                },
            });
        }

        const userOrgs = await this.prisma.user_organization.findMany({
            where: { user_id: user.id }
        });

        let organizationId: string | undefined;
        let orgRole: string | undefined;
        let requiresOrgSelection = false;

        const [firstOrg] = userOrgs;

        if (userOrgs.length === 1 && firstOrg) {
            organizationId = firstOrg.organization_id;
            orgRole = firstOrg.role;
        } else if (userOrgs.length > 1) {
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

        const accessSignOptions = { ...signOptions, type: 'access' } as Parameters<JwtService["signAsync"]>[1];
        const refreshSignWithTypeOptions = { ...refreshSignOptions, type: 'refresh' } as Parameters<JwtService["signAsync"]>[1];

        const refreshToken = await this.jwt.signAsync(
            { ...payload, type: 'refresh' },
            refreshSignWithTypeOptions
        );
        const accessToken = await this.jwt.signAsync(
            { ...payload, type: 'access' },
            accessSignOptions
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

        const userOrg = await this.prisma.user_organization.findFirst({
            where: { user_id: userid, organization_id: organizationid }
        });
        if (!userOrg) {
            throw new ForbiddenException("User does not belong to this organization");
        }

        const payload = {
            sub: user.id,
            role: user.role,
            organizationId: organizationid,
            orgRole: userOrg.role,
        };
        return this.issueOrganizationTokens(user, payload.organizationId, payload.orgRole);
    }

    async switchOrganization(
        userid: string,
        currentorgid: string,
        neworgid: string
    ): Promise<{ accessToken: string; refreshToken: string }> {
        const userOrg = await this.prisma.user_organization.findFirst({
            where: { user_id: userid, organization_id: neworgid }
        });
        if (!userOrg) {
            throw new ForbiddenException("User does not belong to target organization");
        }

        const user = { id: userid, role: null };
        return this.issueOrganizationTokens(user, neworgid, userOrg.role);
    }

    async getUserOrganizations(userid: string): Promise<Array<{ id: string; name: string; slug: string; role: string }>> {
        const userOrgs = await this.prisma.user_organization.findMany({
            where: { user_id: userid }
        });

        if (userOrgs.length === 0) {
            return [];
        }

        const result = await Promise.all(
            userOrgs.map(async (userOrg) => {
                const org = await this.prisma.organization.findUnique({
                    where: { id: userOrg.organization_id }
                });

                return {
                    id: org!.id,
                    name: org!.name,
                    slug: org!.slug,
                    role: userOrg.role,
                };
            })
        );

        return result;
    }

    async createAuthCode(tokens: { accessToken: string; refreshToken: string }): Promise<string> {
        const code = crypto.randomBytes(32).toString("hex");

        this.authCodes.set(code, {
            tokens,
            expiresAt: Date.now() + 30 * 1000,
        });

        this.cleanupExpiredCodes();

        return code;
    }

    async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string }> {
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
                    where: { user_id: decoded.sub, organization_id: decoded.organizationId }
                });
                if (stillMember !== null) {
                    payload.organizationId = decoded.organizationId;
                    if (stillMember) {
                        payload.orgRole = stillMember.role;
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

            const accessSignOptions = { ...signOptions, type: 'access' } as Parameters<JwtService["signAsync"]>[1];
            const refreshSignWithTypeOptions = { ...refreshSignOptions, type: 'refresh' } as Parameters<JwtService["signAsync"]>[1];

            const newRefreshToken = await this.jwt.signAsync(
                { ...payload, type: 'refresh' },
                refreshSignWithTypeOptions
            );
            const newAccessToken = await this.jwt.signAsync(
                { ...payload, type: 'access' },
                accessSignOptions
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
}
