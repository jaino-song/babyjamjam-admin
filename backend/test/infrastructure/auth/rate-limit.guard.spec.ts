import { HttpException, HttpStatus, ServiceUnavailableException } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common/interfaces";
import { Request } from "express";
import Redis from "ioredis";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { PrismaService } from "infrastructure/database/prisma.service";

jest.mock("ioredis", () => jest.fn());

type MockRequest = {
    body: { email?: string };
    method?: string;
    socket?: { remoteAddress?: string };
    ip?: string;
    query?: { email?: string | string[] };
};

const createExecutionContext = (
    request: MockRequest,
    response?: { setHeader: jest.Mock },
): ExecutionContext => ({
    getHandler: () => ({ login() {} }).login,
    switchToHttp: () => ({
        getRequest: () => ({ method: "POST", ...request }) as Request,
        getResponse: () => response,
        getNext: () => undefined,
    }),
}) as unknown as ExecutionContext;

const row = (count: number, windowStart = new Date()): Array<{ count: number; window_start: Date }> => [
    { count, window_start: windowStart },
];

describe("RateLimitGuard", () => {
    const prisma = {
        $queryRaw: jest.fn(),
        $executeRaw: jest.fn(),
    };
    let guard: RateLimitGuard;
    const originalValkeyUrl = process.env["VALKEY_URL"];

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env["VALKEY_URL"];
        // A developer's local backend/.env may turn the guard off; these tests cover the enforced path.
        delete process.env["AUTH_RATE_LIMIT_DISABLED"];
        delete process.env["AUTH_RATE_LIMIT_EXEMPT_EMAILS"];
        prisma.$queryRaw.mockResolvedValue(row(1));
        prisma.$executeRaw.mockResolvedValue(1);
        guard = new RateLimitGuard(prisma as unknown as PrismaService);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        if (originalValkeyUrl === undefined) {
            delete process.env["VALKEY_URL"];
        } else {
            process.env["VALKEY_URL"] = originalValkeyUrl;
        }
    });

    it("should bind a five-minute window floor into both PostgreSQL upsert predicates", async () => {
        const now = new Date("2026-10-12T12:00:00.000Z");
        jest.useFakeTimers().setSystemTime(now);
        prisma.$queryRaw.mockResolvedValue(row(1, now));

        await expect(guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: { email: "user@example.com" },
        }))).resolves.toBe(true);

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
        for (const [query] of prisma.$queryRaw.mock.calls) {
            expect(query.values.slice(1)).toEqual([
                new Date(now.getTime() - 300_000),
                new Date(now.getTime() - 300_000),
            ]);
        }
    });

    it.each([5, 6])("should allow identity count 5 and reject count 6 (count %i)", async (count) => {
        const now = new Date("2026-10-12T12:00:00.000Z");
        jest.useFakeTimers().setSystemTime(now);
        prisma.$queryRaw
            .mockResolvedValueOnce(row(count, now))
            .mockResolvedValueOnce(row(1, now));
        const response = { setHeader: jest.fn() };
        const attempt = guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: { email: "user@example.com" },
        }, response));

        if (count === 5) {
            await expect(attempt).resolves.toBe(true);
            expect(response.setHeader).not.toHaveBeenCalledWith("Retry-After", expect.anything());
        } else {
            await expect(attempt).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
            expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "300");
        }
        expect(response.setHeader).toHaveBeenCalledWith("RateLimit-Limit", "5");
        expect(response.setHeader).toHaveBeenCalledWith("RateLimit-Remaining", "0");
        expect(response.setHeader).toHaveBeenCalledWith("RateLimit-Reset", "300");
    });

    it("should pass a five-minute expiry to the Valkey increment script", async () => {
        const redis = {
            status: "ready",
            eval: jest.fn().mockResolvedValue([1, 300_000]),
            disconnect: jest.fn(),
        };
        jest.mocked(Redis).mockImplementation(() => redis as unknown as Redis);
        process.env["VALKEY_URL"] = "redis://127.0.0.1:6379";
        guard = new RateLimitGuard(prisma as unknown as PrismaService);

        await expect(guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: { email: "user@example.com" },
        }))).resolves.toBe(true);

        expect(redis.eval).toHaveBeenCalledTimes(2);
        for (const [script, keyCount, key, expiry] of redis.eval.mock.calls) {
            expect(script).toContain('redis.call("PEXPIRE", KEYS[1], ARGV[1])');
            expect(keyCount).toBe(1);
            expect(key).toMatch(/^auth:rate-limit:[a-f0-9]{64}$/);
            expect(expiry).toBe(300_000);
        }
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
        await guard.onModuleDestroy();
        expect(redis.disconnect).toHaveBeenCalledTimes(1);
    });

    describe("environment switches", () => {
        const savedEnv = { ...process.env };
        const loginContext = () => createExecutionContext({
            ip: "198.51.100.10",
            body: { email: "E2E@Example.com" },
        });

        afterEach(() => {
            process.env = { ...savedEnv };
        });

        it("skips every counter when AUTH_RATE_LIMIT_DISABLED=true outside production", async () => {
            process.env["NODE_ENV"] = "development";
            process.env["AUTH_RATE_LIMIT_DISABLED"] = "true";
            prisma.$queryRaw.mockResolvedValue(row(999));

            await expect(new RateLimitGuard(prisma as unknown as PrismaService)
                .canActivate(loginContext())).resolves.toBe(true);
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
        });

        it("ignores AUTH_RATE_LIMIT_DISABLED when NODE_ENV=production", async () => {
            process.env["NODE_ENV"] = "production";
            process.env["AUTH_RATE_LIMIT_DISABLED"] = "true";
            prisma.$queryRaw.mockResolvedValue(row(6));

            await expect(new RateLimitGuard(prisma as unknown as PrismaService)
                .canActivate(loginContext())).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
        });

        it("drops only the per-account counter for an exempt email and keeps the per-IP ceiling", async () => {
            process.env["NODE_ENV"] = "production";
            process.env["AUTH_RATE_LIMIT_EXEMPT_EMAILS"] = " other@example.com , e2e@example.com ";
            prisma.$queryRaw.mockResolvedValue(row(6));

            await expect(new RateLimitGuard(prisma as unknown as PrismaService)
                .canActivate(loginContext())).resolves.toBe(true);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

            prisma.$queryRaw.mockResolvedValue(row(101));
            await expect(new RateLimitGuard(prisma as unknown as PrismaService)
                .canActivate(loginContext())).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
        });

        it("still applies the per-account ceiling to emails that are not exempt", async () => {
            process.env["AUTH_RATE_LIMIT_EXEMPT_EMAILS"] = "e2e@example.com";
            prisma.$queryRaw.mockResolvedValueOnce(row(6)).mockResolvedValueOnce(row(1));

            await expect(new RateLimitGuard(prisma as unknown as PrismaService).canActivate(createExecutionContext({
                ip: "198.51.100.10",
                body: { email: "someone@example.com" },
            }))).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
        });
    });

    it("should atomically enforce both per-identity and per-IP counters without storing email PII", async () => {
        await expect(guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: { email: "User@Example.com" },
        }))).resolves.toBe(true);

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
        const queries = prisma.$queryRaw.mock.calls.map(([query]) => query);
        for (const query of queries) {
            expect(query.strings.join(" ")).toContain("ON CONFLICT (key_hash) DO UPDATE");
            expect(query.strings.join(" ")).toContain("auth_rate_limit.count + 1");
            expect(query.values.join(" ")).not.toContain("User@Example.com");
        }
        expect(queries[0].values[0]).toMatch(/^[a-f0-9]{64}$/);
        expect(queries[1].values[0]).toMatch(/^[a-f0-9]{64}$/);
        expect(queries[0].values[0]).not.toBe(queries[1].values[0]);
    });

    // The 429 carries the registered REQUEST_RATE_LIMITED problem body: the
    // HTTP mapper keys on the code, so the legacy AUTH_RATE_LIMITED envelope
    // would never reach the problem contract. The Retry-After signal stays on
    // the response HEADERS (set before the limit assert), not the body.
    it("should reject with a 429 REQUEST_RATE_LIMITED problem when either counter exceeds the maximum", async () => {
        prisma.$queryRaw.mockResolvedValueOnce(row(6));

        const error = await guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: { email: "user@example.com" },
        })).then(() => null, (caught: unknown) => caught) as HttpException;

        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(error.getResponse()).toMatchObject({
            code: "REQUEST_RATE_LIMITED",
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        });
        expect(error.getResponse()).not.toHaveProperty("retryAfter");
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("should enforce the per-IP ceiling even when the identity counter is below its limit", async () => {
        // per-IP ceiling (100) is more lenient than per-identity (5) so shared-IP UX flows aren't
        // blocked; a value above 100 must still trip it.
        prisma.$queryRaw
            .mockResolvedValueOnce(row(1))
            .mockResolvedValueOnce(row(101));

        await expect(guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: { email: "user@example.com" },
        }))).rejects.toMatchObject({
            status: HttpStatus.TOO_MANY_REQUESTS,
            response: expect.objectContaining({ code: "REQUEST_RATE_LIMITED" }),
        });

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it.each([100, 101])("should enforce the unchanged IP-only ceiling (count %i)", async (count) => {
        const now = new Date("2026-10-12T12:00:00.000Z");
        jest.useFakeTimers().setSystemTime(now);
        prisma.$queryRaw.mockResolvedValue(row(count, now));
        const response = { setHeader: jest.fn() };
        const attempt = guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: {},
        }, response));

        if (count === 100) {
            await expect(attempt).resolves.toBe(true);
        } else {
            await expect(attempt).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
        }
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(response.setHeader).toHaveBeenCalledWith("RateLimit-Limit", "100");
        expect(response.setHeader).toHaveBeenCalledWith("RateLimit-Reset", "300");
    });

    it("should encode the atomic window reset predicate in SQL", async () => {
        prisma.$queryRaw.mockResolvedValue(row(1, new Date()));

        await expect(guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: { email: "user@example.com" },
        }))).resolves.toBe(true);

        const sql = prisma.$queryRaw.mock.calls[0][0].strings.join(" ");
        expect(sql).toContain("window_start <=");
        expect(sql).toContain("THEN 1");
        expect(sql).toContain("RETURNING count, window_start");
    });

    it("should delete the hashed identity key asynchronously", async () => {
        await guard.resetForKey("198.51.100.10", "user@example.com");

        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        const query = prisma.$executeRaw.mock.calls[0][0];
        expect(query.strings.join(" ")).toContain("DELETE FROM auth_rate_limit");
        expect(query.values[0]).toMatch(/^[a-f0-9]{64}$/);
        expect(query.values.join(" ")).not.toContain("user@example.com");
    });

    it("uses the same endpoint namespace when incrementing and resetting login", async () => {
        const random = jest.spyOn(Math, "random").mockReturnValue(1);

        await guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: { email: "user@example.com" },
        }));
        const incrementedKey = prisma.$queryRaw.mock.calls[0][0].values[0];

        await guard.resetForKey(
            "198.51.100.10",
            "user@example.com",
            "post:login",
        );
        const resetKey = prisma.$executeRaw.mock.calls[0][0].values[0];

        expect(resetKey).toBe(incrementedKey);
        random.mockRestore();
    });

    it("should probabilistically clean up expired windows inline", async () => {
        const random = jest.spyOn(Math, "random").mockReturnValue(0);

        await guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: {},
        }));

        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(prisma.$executeRaw.mock.calls[0][0].strings.join(" ")).toContain(
            "DELETE FROM auth_rate_limit WHERE window_start <=",
        );
        random.mockRestore();
    });

    it("should fail closed when the shared store is unavailable", async () => {
        prisma.$queryRaw.mockRejectedValue(new Error("database unavailable"));

        const error = await guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: {},
        })).then(() => null, (caught: unknown) => caught) as ServiceUnavailableException;

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        // The 503 stays an UNCODED legacy envelope on purpose: the production
        // mapper remaps uncoded 503s to DEPENDENCY_UNAVAILABLE, and this path
        // must keep relying on that remap (no problem body of its own).
        expect(error.getResponse()).toEqual(expect.objectContaining({ statusCode: 503 }));
        expect(error.getResponse()).not.toHaveProperty("code");
    });
});
