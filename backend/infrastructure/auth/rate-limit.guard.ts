import { createHash } from "crypto";

import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Request } from "express";

import { PrismaService } from "../database/prisma.service";

type RateLimitRow = {
    count: number;
    window_start: Date | string;
};

const RATE_LIMIT_SCOPES = {
    identity: "identity",
    ip: "ip",
} as const;

@Injectable()
export class RateLimitGuard implements CanActivate {
    private readonly logger = new Logger(RateLimitGuard.name);
    // Per-account (ip+email) brute-force ceiling — strict.
    private readonly maxAttempts = 5;
    // Per-IP anti-stuffing ceiling — lenient, because UX/lookup endpoints (check-email fired per
    // keystroke on the register form, branches-all on page load) also flow through this guard and a
    // shared office IP must not exhaust a 5-request budget. Still throttles credential stuffing,
    // which needs orders of magnitude more than this per window.
    private readonly maxAttemptsPerIp = 100;
    private readonly windowMs = 15 * 60 * 1000;
    private readonly cleanupProbability = 0.01;

    constructor(private readonly prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();
        const ip = this.getClientIp(request);
        const identity = this.getEmailFromRequest(request)?.trim().toLowerCase() ?? "";
        const now = new Date();

        try {
            const [identityResult, ipResult] = await Promise.all([
                identity
                    ? this.incrementCounter(this.hashKey(RATE_LIMIT_SCOPES.identity, ip, identity), now)
                    : Promise.resolve(null),
                this.incrementCounter(this.hashKey(RATE_LIMIT_SCOPES.ip, ip, ""), now),
            ]);
            if (identityResult) {
                this.assertWithinLimit(identityResult, now, this.maxAttempts);
            }
            this.assertWithinLimit(ipResult, now, this.maxAttemptsPerIp);

            if (Math.random() < this.cleanupProbability) {
                await this.deleteExpiredWindows(now);
            }

            return true;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            this.logger.error(
                "Authentication rate-limit store is unavailable",
                error instanceof Error ? error.stack : undefined,
            );
            throw new ServiceUnavailableException("인증 요청을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.");
        }
    }

    async resetForKey(ip: string, email?: string): Promise<void> {
        const identity = email?.trim().toLowerCase() ?? "";
        const scope = email ? RATE_LIMIT_SCOPES.identity : RATE_LIMIT_SCOPES.ip;
        const keyHash = this.hashKey(scope, ip, identity);

        await this.prisma.$executeRaw(
            Prisma.sql`DELETE FROM auth_rate_limit WHERE key_hash = ${keyHash}`,
        );
    }

    private async incrementCounter(keyHash: string, now: Date): Promise<RateLimitRow> {
        const windowFloor = new Date(now.getTime() - this.windowMs);
        const rows = await this.prisma.$queryRaw<RateLimitRow[]>(Prisma.sql`
            INSERT INTO auth_rate_limit (key_hash, window_start, count, updated_at)
            VALUES (${keyHash}, NOW(), 1, NOW())
            ON CONFLICT (key_hash) DO UPDATE SET
                count = CASE
                    WHEN auth_rate_limit.window_start <= ${windowFloor} THEN 1
                    ELSE auth_rate_limit.count + 1
                END,
                window_start = CASE
                    WHEN auth_rate_limit.window_start <= ${windowFloor} THEN NOW()
                    ELSE auth_rate_limit.window_start
                END,
                updated_at = NOW()
            RETURNING count, window_start
        `);
        const [result] = rows;
        if (!result) {
            throw new Error("Authentication rate-limit upsert returned no row");
        }

        return result;
    }

    private assertWithinLimit(result: RateLimitRow, now: Date, maxAttempts: number): void {
        if (result.count <= maxAttempts) {
            return;
        }

        const windowStart = new Date(result.window_start).getTime();
        const remainingSeconds = Math.max(
            1,
            Math.ceil((windowStart + this.windowMs - now.getTime()) / 1000),
        );
        const remainingMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));

        throw new HttpException(
            {
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                message: `요청 횟수가 초과되었습니다. ${remainingMinutes}분 후에 다시 시도해주세요.`,
                error: "Too Many Requests",
                retryAfter: remainingSeconds,
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }

    private async deleteExpiredWindows(now: Date): Promise<void> {
        const windowFloor = new Date(now.getTime() - this.windowMs);
        await this.prisma.$executeRaw(
            Prisma.sql`DELETE FROM auth_rate_limit WHERE window_start <= ${windowFloor}`,
        );
    }

    private hashKey(scope: string, ip: string, identity: string): string {
        return createHash("sha256").update(`${scope}:${ip}:${identity}`).digest("hex");
    }

    private getClientIp(request: Request): string {
        return request.ip || request.socket?.remoteAddress || "unknown";
    }

    private getEmailFromRequest(request: Request): string | undefined {
        const body = request.body as { email?: string } | undefined;
        if (body?.email) {
            return body.email;
        }

        const query = request.query as { email?: string | string[] } | undefined;
        const queryEmail = query?.email;
        return Array.isArray(queryEmail) ? queryEmail[0] : queryEmail;
    }
}
