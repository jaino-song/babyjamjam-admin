import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    Logger,
} from "@nestjs/common";
import { Request } from "express";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";

/**
 * DB-backed bearer guard for the call-transcript webhook.
 * The token IS the branch allocation: payloads never carry branch identity.
 * Attaches the resolved branchId to request.callIngestBranchId.
 */
@Injectable()
export class CallIngestGuard implements CanActivate {
    private readonly logger = new Logger(CallIngestGuard.name);

    constructor(private readonly tokenService: CallIngestTokenService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request & { callIngestBranchId?: string }>();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            this.logger.warn("Call ingest rejected: Missing Authorization header");
            throw new UnauthorizedException("Missing Authorization header");
        }

        const authMatch = authHeader.match(/^Bearer\s+(.+)$/);
        const token = authMatch?.[1]?.trim();
        if (!token) {
            this.logger.warn("Call ingest rejected: Invalid Authorization format");
            throw new UnauthorizedException("Invalid Authorization format");
        }

        const branchId = await this.tokenService.resolveBranchId(token);
        if (!branchId) {
            this.logger.warn("Call ingest rejected: Unknown or revoked token");
            throw new UnauthorizedException("Invalid token");
        }

        request.callIngestBranchId = branchId;
        return true;
    }
}
