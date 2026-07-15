import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    Logger,
} from "@nestjs/common";
import { Request } from "express";
import {
    EmployeeFeedbackTokenService,
    FeedbackTokenContext,
} from "application/services/employee-feedback-token.service";

/**
 * DB-backed bearer guard for the no-login feedback data endpoints (BJJ-247).
 * Expects the minted ACCESS token (post-DOB) as `Authorization: Bearer <token>`;
 * attaches the resolved assignment context to request.feedbackContext.
 * The DOB-challenge endpoint itself is NOT guarded by this — it takes the link token in the body.
 */
@Injectable()
export class EmployeeFeedbackGuard implements CanActivate {
    private readonly logger = new Logger(EmployeeFeedbackGuard.name);

    constructor(private readonly tokenService: EmployeeFeedbackTokenService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<Request & { feedbackContext?: FeedbackTokenContext }>();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            throw new UnauthorizedException("Missing Authorization header");
        }

        const authMatch = authHeader.match(/^Bearer\s+(.+)$/);
        const token = authMatch?.[1]?.trim();
        if (!token) {
            throw new UnauthorizedException("Invalid Authorization format");
        }

        const ctx = await this.tokenService.resolveAccess(token);
        if (!ctx) {
            this.logger.warn("Feedback access rejected: unknown, unverified, revoked, or expired token");
            throw new UnauthorizedException("Invalid or expired token");
        }

        request.feedbackContext = ctx;
        return true;
    }
}
