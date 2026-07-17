import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { getJwtSecret } from "./jwt-secret";
import { PrismaService } from "../database/prisma.service";

interface JwtPayload {
    sub: string;
    sid?: string;
    role: string | null;
    tokenVersion?: number;
    type: 'access' | 'refresh';
    branchId?: string;
    branchRole?: string;
    organizationId?: string;
    orgRole?: string;
}

interface JwtRequest {
    cookies?: {
        auth_token?: string;
    };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private readonly prisma: PrismaService) {
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                ExtractJwt.fromAuthHeaderAsBearerToken(),
                (req: JwtRequest) => {
                    // Try to get token from cookie
                    if (req && req.cookies) {
                        return req.cookies.auth_token ?? null;
                    }
                    return null;
                },
            ]),
            ignoreExpiration: false,
            secretOrKey: getJwtSecret(),
        });
    }

    async validate(payload: JwtPayload) {
        if (payload.type !== 'access' || !payload.sid) {
            throw new UnauthorizedException('Invalid token type');
        }

        let session: {
            userId: string;
            selectedBranchId: string | null;
            expiresAt: Date;
            revokedAt: Date | null;
            user: {
                tokenVersion: number;
                approvalStatus: string;
                role: string | null;
            };
        } | null;
        try {
            session = await this.prisma.auth_session.findUnique({
                where: { id: payload.sid },
                select: {
                    userId: true,
                    selectedBranchId: true,
                    expiresAt: true,
                    revokedAt: true,
                    user: {
                        select: {
                            tokenVersion: true,
                            approvalStatus: true,
                            role: true,
                        },
                    },
                },
            });
        } catch {
            // fail-closed: a store outage must not let an unvalidated token through.
            throw new UnauthorizedException('Unable to validate token');
        }

        if (
            !session
            || session.userId !== payload.sub
            || session.revokedAt
            || session.expiresAt.getTime() <= Date.now()
            || (session.selectedBranchId ?? undefined)
                !== (payload.branchId ?? payload.organizationId)
            || payload.tokenVersion === undefined
            || payload.tokenVersion !== session.user.tokenVersion
        ) {
            throw new UnauthorizedException('Invalid or revoked token');
        }
        const user = session.user;
        if (user.role !== 'owner' && user.approvalStatus !== 'approved') {
            throw new UnauthorizedException('Account is not approved');
        }

        return {
            userId: payload.sub,
            sessionId: payload.sid,
            // Use the fresh DB role, never the (possibly stale) role baked into the token: an owner
            // demoting a user via PATCH /users must take effect on the very next request, not only
            // after the token expires (7–30d). Also closes stale-role authz after any role change.
            role: user.role,
            branchId: payload.branchId ?? payload.organizationId,
            branchRole: payload.branchRole ?? payload.orgRole,
        };
    }
}
