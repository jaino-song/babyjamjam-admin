import { createHash } from "crypto";

import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
    Logger,
    OnModuleDestroy,
    ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import Redis from "ioredis";

import { PrismaService } from "../database/prisma.service";

type RateLimitRow = {
    count: number;
    window_start: Date | string;
};

type RateLimitResult = {
    count: number;
    resetAt: Date;
};

const RATE_LIMIT_SCOPES = {
    identity: "identity",
    ip: "ip",
} as const;

@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
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
    private readonly redis: Redis | null;

    constructor(private readonly prisma: PrismaService) {
        const valkeyUrl = process.env["VALKEY_URL"]?.trim();
        this.redis = valkeyUrl
            ? new Redis(valkeyUrl, {
                lazyConnect: true,
                enableOfflineQueue: false,
                maxRetriesPerRequest: 1,
                connectTimeout: 2_000,
            })
            : null;
    }

    async onModuleDestroy(): Promise<void> {
        if (this.redis) {
            this.redis.disconnect();
        }
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();
        const response = context.switchToHttp().getResponse<Response | undefined>();
        const ip = this.getClientIp(request);
        const identity = this.getEmailFromRequest(request)?.trim().toLowerCase() ?? "";
        const endpoint = this.getEndpointScope(context, request);
        const now = new Date();

        try {
            const [identityResult, ipResult] = await Promise.all([
                identity
                    ? this.incrementCounter(
                        this.hashKey(endpoint, RATE_LIMIT_SCOPES.identity, ip, identity),
                        now,
                    )
                    : Promise.resolve(null),
                this.incrementCounter(
                    this.hashKey(endpoint, RATE_LIMIT_SCOPES.ip, ip, ""),
                    now,
                ),
            ]);
            const effective = identityResult ?? ipResult;
            const effectiveLimit = identityResult
                ? this.maxAttempts
                : this.maxAttemptsPerIp;
            if (response?.setHeader) {
                this.setRateLimitHeaders(response, effective, effectiveLimit, now);
            }
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

    async resetForKey(ip: string, email?: string, endpoint = "login"): Promise<void> {
        const identity = email?.trim().toLowerCase() ?? "";
        const scope = email ? RATE_LIMIT_SCOPES.identity : RATE_LIMIT_SCOPES.ip;
        const keyHash = this.hashKey(endpoint, scope, ip, identity);

        try {
            if (this.redis) {
                await this.ensureRedisConnected();
                await this.redis.del(this.redisKey(keyHash));
                return;
            }
        } catch (error) {
            this.logger.warn(
                `Valkey rate-limit reset failed; using PostgreSQL fallback: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }

        await this.deletePostgresCounter(keyHash);
    }

    private async incrementCounter(keyHash: string, now: Date): Promise<RateLimitResult> {
        if (this.redis) {
            try {
                return await this.incrementValkeyCounter(keyHash, now);
            } catch (error) {
                this.logger.warn(
                    `Valkey rate-limit increment failed; using PostgreSQL fallback: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        return this.incrementPostgresCounter(keyHash, now);
    }

    private async incrementValkeyCounter(
        keyHash: string,
        now: Date,
    ): Promise<RateLimitResult> {
        if (!this.redis) {
            throw new Error("Valkey is not configured");
        }
        await this.ensureRedisConnected();
        const result = await this.redis.eval(
            `
                local count = redis.call("INCR", KEYS[1])
                if count == 1 then
                    redis.call("PEXPIRE", KEYS[1], ARGV[1])
                end
                local ttl = redis.call("PTTL", KEYS[1])
                return {count, ttl}
            `,
            1,
            this.redisKey(keyHash),
            this.windowMs,
        ) as [number, number];
        const [count, ttl] = result;
        if (!Number.isFinite(count) || !Number.isFinite(ttl) || ttl <= 0) {
            throw new Error("Valkey rate-limit script returned an invalid result");
        }
        return {
            count: Number(count),
            resetAt: new Date(now.getTime() + Number(ttl)),
        };
    }

    private async incrementPostgresCounter(
        keyHash: string,
        now: Date,
    ): Promise<RateLimitResult> {
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

        return {
            count: result.count,
            resetAt: new Date(
                new Date(result.window_start).getTime() + this.windowMs,
            ),
        };
    }

    private assertWithinLimit(result: RateLimitResult, now: Date, maxAttempts: number): void {
        if (result.count <= maxAttempts) {
            return;
        }

        const remainingSeconds = Math.max(
            1,
            Math.ceil((result.resetAt.getTime() - now.getTime()) / 1000),
        );
        const remainingMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));

        throw new HttpException(
            {
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                code: "AUTH_RATE_LIMITED",
                message: `요청 횟수가 초과되었습니다. ${remainingMinutes}분 후에 다시 시도해주세요.`,
                error: "Too Many Requests",
                retryAfter: remainingSeconds,
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }

    private setRateLimitHeaders(
        response: Response,
        result: RateLimitResult,
        limit: number,
        now: Date,
    ): void {
        const resetSeconds = Math.max(
            1,
            Math.ceil((result.resetAt.getTime() - now.getTime()) / 1000),
        );
        response.setHeader("RateLimit-Limit", limit.toString());
        response.setHeader(
            "RateLimit-Remaining",
            Math.max(0, limit - result.count).toString(),
        );
        response.setHeader("RateLimit-Reset", resetSeconds.toString());
        if (result.count > limit) {
            response.setHeader("Retry-After", resetSeconds.toString());
        }
    }

    private async deleteExpiredWindows(now: Date): Promise<void> {
        const windowFloor = new Date(now.getTime() - this.windowMs);
        await this.prisma.$executeRaw(
            Prisma.sql`DELETE FROM auth_rate_limit WHERE window_start <= ${windowFloor}`,
        );
    }

    private hashKey(endpoint: string, scope: string, ip: string, identity: string): string {
        return createHash("sha256")
            .update(`${endpoint}:${scope}:${ip}:${identity}`)
            .digest("hex");
    }

    private getEndpointScope(context: ExecutionContext, request: Request): string {
        const routePath = request.route?.path;
        const handler = typeof context.getHandler === "function"
            ? context.getHandler()
            : undefined;
        const path = handler?.name
            ?? (typeof routePath === "string" ? routePath : "unknown");
        return `${request.method?.toLowerCase() ?? "unknown"}:${path}`;
    }

    private redisKey(keyHash: string): string {
        return `auth:rate-limit:${keyHash}`;
    }

    private async ensureRedisConnected(): Promise<void> {
        if (this.redis?.status === "wait") {
            await this.redis.connect();
        }
        if (this.redis?.status !== "ready") {
            throw new Error(`Valkey connection is ${this.redis?.status ?? "missing"}`);
        }
    }

    private async deletePostgresCounter(keyHash: string): Promise<void> {
        await this.prisma.$executeRaw(
            Prisma.sql`DELETE FROM auth_rate_limit WHERE key_hash = ${keyHash}`,
        );
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
