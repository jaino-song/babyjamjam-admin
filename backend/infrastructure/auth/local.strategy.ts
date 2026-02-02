import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-local";
import { AuthService } from "../../application/services/auth.service";

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
    constructor(private authService: AuthService) {
        super({
            usernameField: 'email', // Use email instead of username
            passwordField: 'password',
        });
    }

    /**
     * Validate email and password for local authentication
     * This method is called automatically by passport-local
     */
    async validate(email: string, password: string): Promise<{ userId: string }> {
        const result = await this.authService.validateEmailPassword(email, password);

        if (!result) {
            throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
        }

        return { userId: result.user };
    }
}
