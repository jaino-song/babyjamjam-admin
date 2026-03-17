import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { getJwtSecret } from "./jwt-secret";

interface JwtPayload {
    sub: string;
    role: string;
    type: 'access' | 'refresh';
    organizationId?: string;
    orgRole?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor() {
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
            throw new Error('Invalid token type');
        }
        return {
            userId: payload.sub,
            role: payload.role,
            organizationId: payload.organizationId,
            orgRole: payload.orgRole,
        };
    }
}
