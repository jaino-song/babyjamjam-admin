import { HttpStatus } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common/interfaces";
import { Request } from "express";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";

type MockRequest = {
    headers: Record<string, string | string[] | undefined>;
    body: { email?: string };
    socket: { remoteAddress?: string } | undefined;
    ip?: string;
    query?: { email?: string | string[] };
};

const createExecutionContext = (request: MockRequest): ExecutionContext =>
    ({
        switchToHttp: () => ({
            getRequest: () => request as Request,
            getResponse: () => undefined,
            getNext: () => undefined,
        }),
    }) as ExecutionContext;

describe("RateLimitGuard", () => {
    let guard: RateLimitGuard;

    beforeEach(() => {
        guard = new RateLimitGuard();
    });

    afterEach(() => {
        guard.onModuleDestroy();
    });

    it("should ignore a forged x-forwarded-for header when deriving the rate-limit key", async () => {
        const email = "user@example.com";

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const request: MockRequest = {
                ip: "198.51.100.10",
                headers: {
                    "x-forwarded-for": `203.0.113.${attempt + 1}`,
                },
                body: { email },
                socket: undefined,
            };

            await expect(
                guard.canActivate(createExecutionContext(request)),
            ).resolves.toBe(true);
        }

        const spoofedRequest: MockRequest = {
            ip: "198.51.100.10",
            headers: {
                "x-forwarded-for": "203.0.113.250",
            },
            body: { email },
            socket: undefined,
        };

        await expect(guard.canActivate(createExecutionContext(spoofedRequest))).rejects.toMatchObject({
            response: expect.objectContaining({
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                error: "Too Many Requests",
            }),
        });
    });

    it("should fall back to socket.remoteAddress when req.ip is unavailable", async () => {
        const request: MockRequest = {
            headers: {},
            body: {},
            socket: {
                remoteAddress: "::1",
            },
        };

        await expect(
            guard.canActivate(createExecutionContext(request)),
        ).resolves.toBe(true);

        const attempts = (guard as unknown as {
            attempts: Map<string, unknown>;
        }).attempts;

        expect(attempts.has("::1")).toBe(true);
    });
});
