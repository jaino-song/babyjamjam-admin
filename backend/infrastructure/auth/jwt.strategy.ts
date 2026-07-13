import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { getJwtSecret } from "./jwt-secret";
import { PrismaService } from "../database/prisma.service";

interface JwtPayload {
    sub: string;
    role: string | null;
    tokenVersion?: number;
    type: 'access' | 'refresh';
    branchId?: string;
    branchRole?: string;
    organizationId?: string;
    orgRole?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private readonly prisma: PrismaService) {
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                ExtractJwt.fromAuthHeaderAsBearerToken(),
                (req: any) => {
                    // Try to get token from cookie
                    if (req && req.cookies) {
                        return req.cookies.auth_token;
                    }
                    return null;
                },
            ]),
            ignoreExpiration: false,
            secretOrKey: getJwtSecret(),
        });
    }

    async validate(payload: JwtPayload) {
        if (payload.type !== 'access') {
            throw new UnauthorizedException('Invalid token type');
        }

        let user: { tokenVersion: number; approvalStatus: string; role: string | null } | null;
        try {
            user = await this.prisma.user.findUnique({
                where: { id: payload.sub },
                select: { tokenVersion: true, approvalStatus: true, role: true },
            });
        } catch {
            // fail-closed: a store outage must not let an unvalidated token through.
            throw new UnauthorizedException('Unable to validate token');
        }

        if (!user || payload.tokenVersion === undefined || payload.tokenVersion !== user.tokenVersion) {
            throw new UnauthorizedException('Invalid or revoked token');
        }
        if (user.role !== 'owner' && user.approvalStatus !== 'approved') {
            throw new UnauthorizedException('Account is not approved');
        }

        return {
            userId: payload.sub,
            // Use the fresh DB role, never the (possibly stale) role baked into the token: an owner
            // demoting a user via PATCH /users must take effect on the very next request, not only
            // after the token expires (7–30d). Also closes stale-role authz after any role change.
            role: user.role,
            branchId: payload.branchId ?? payload.organizationId,
            branchRole: payload.branchRole ?? payload.orgRole,
        };
    }
}
