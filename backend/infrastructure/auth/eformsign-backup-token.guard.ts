import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import * as crypto from "crypto";

import { codeOnlyProblemBody } from "application/utils/problem-bodies";

@Injectable()
export class EformsignBackupTokenGuard implements CanActivate {
    constructor(private readonly config: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
        const expectedToken = this.config.get<string>("EFORMSIGN_BACKUP_TOKEN")?.trim();
        if (!expectedToken) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        const request = context.switchToHttp().getRequest<Request>();
        const authMatch = request.headers.authorization?.match(/^Bearer\s+(.+)$/);
        const token = authMatch?.[1]?.trim();
        if (!token || !this.secureCompare(token, expectedToken)) {
            throw new UnauthorizedException(codeOnlyProblemBody("AUTH_REQUIRED"));
        }
        return true;
    }

    private secureCompare(a: string, b: string): boolean {
        const left = Buffer.from(a, "utf8");
        const right = Buffer.from(b, "utf8");
        if (left.length === 0 || right.length === 0 || left.length !== right.length) {
            return false;
        }
        try {
            return crypto.timingSafeEqual(left, right);
        } catch {
            return false;
        }
    }
}
