import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../database/prisma.service";

interface JwtPayload {
    sub: string;
    role: string;
    type: 'access' | 'refresh';
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
            secretOrKey: process.env['JWT_SECRET'],
        });
    }

    async validate(payload: JwtPayload) {
        if (payload.type !== 'access') {
            throw new UnauthorizedException('Invalid token type');
        }

        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: { id: true, role: true },
        });
        if (!user || !user.role || !["owner", "admin", "manager"].includes(user.role)) {
            throw new UnauthorizedException();
        }
        return {
            userId: user.id,
            role: user.role,
        };
    }
}
