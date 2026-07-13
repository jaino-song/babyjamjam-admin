import { HttpStatus, ServiceUnavailableException } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common/interfaces";
import { Request } from "express";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { PrismaService } from "infrastructure/database/prisma.service";

type MockRequest = {
    body: { email?: string };
    socket?: { remoteAddress?: string };
    ip?: string;
    query?: { email?: string | string[] };
};

const createExecutionContext = (request: MockRequest): ExecutionContext => ({
    switchToHttp: () => ({
        getRequest: () => request as Request,
        getResponse: () => undefined,
        getNext: () => undefined,
    }),
}) as ExecutionContext;

const row = (count: number, windowStart = new Date()): Array<{ count: number; window_start: Date }> => [
    { count, window_start: windowStart },
];

describe("RateLimitGuard", () => {
    const prisma = {
        $queryRaw: jest.fn(),
        $executeRaw: jest.fn(),
    };
    let guard: RateLimitGuard;

    beforeEach(() => {
        jest.clearAllMocks();
        prisma.$queryRaw.mockResolvedValue(row(1));
        prisma.$executeRaw.mockResolvedValue(1);
        guard = new RateLimitGuard(prisma as unknown as PrismaService);
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

    it("should reject with 429 when either counter exceeds the maximum", async () => {
        prisma.$queryRaw.mockResolvedValueOnce(row(6));

        await expect(guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: { email: "user@example.com" },
        }))).rejects.toMatchObject({
            status: HttpStatus.TOO_MANY_REQUESTS,
            response: expect.objectContaining({ retryAfter: expect.any(Number) }),
        });
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
        }))).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("should allow a rolled-over window and encode the atomic reset predicate in SQL", async () => {
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

        await expect(guard.canActivate(createExecutionContext({
            ip: "198.51.100.10",
            body: {},
        }))).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
});
