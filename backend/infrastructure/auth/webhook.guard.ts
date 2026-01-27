import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";

/**
 * Guard for validating eformsign webhook requests using Bearer token authentication.
 *
 * Eformsign sends the token in the Authorization header:
 * Authorization: Bearer <token>
 *
 * The expected token is stored in EFORMSIGN_WEBHOOK_SECRET environment variable.
 */
@Injectable()
export class WebhookGuard implements CanActivate {
    private readonly logger = new Logger(WebhookGuard.name);

    constructor(private readonly configService: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            this.logger.warn("Webhook request rejected: Missing Authorization header");
            throw new UnauthorizedException("Missing Authorization header");
        }

        // Extract token from "Bearer <token>" format
        const [type, token] = authHeader.split(" ");

        if (type !== "Bearer" || !token) {
            this.logger.warn("Webhook request rejected: Invalid Authorization format");
            throw new UnauthorizedException("Invalid Authorization format");
        }

        const expectedToken = this.configService.get<string>("EFORMSIGN_WEBHOOK_SECRET");

        if (!expectedToken) {
            this.logger.error("EFORMSIGN_WEBHOOK_SECRET not configured");
            throw new UnauthorizedException("Webhook authentication not configured");
        }

        // Constant-time comparison to prevent timing attacks
        if (!this.secureCompare(token, expectedToken)) {
            this.logger.warn("Webhook request rejected: Invalid token");
            throw new UnauthorizedException("Invalid token");
        }

        this.logger.debug("Webhook request authenticated successfully");
        return true;
    }

    /**
     * Constant-time string comparison to prevent timing attacks.
     * This ensures the comparison takes the same amount of time
     * regardless of how many characters match.
     */
    private secureCompare(a: string, b: string): boolean {
        if (a.length !== b.length) {
            return false;
        }

        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }
}
