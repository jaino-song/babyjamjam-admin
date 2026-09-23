import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-local";
import { AuthService } from "../../application/services/auth.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";

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

        if (!result || ("onboardingRequired" in result && result.onboardingRequired)) {
            throw new UnauthorizedException(codeOnlyProblemBody("AUTH_REQUIRED"));
        }

        const validatedResult = result as { user: string };

        return { userId: validatedResult.user };
    }
}
