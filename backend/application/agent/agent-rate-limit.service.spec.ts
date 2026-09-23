import { ConfigService } from "@nestjs/config";

import { AgentRateLimitService } from "./agent-rate-limit.service";

describe("AgentRateLimitService", () => {
    it("increments and repairs the TTL in one atomic Valkey script", async () => {
        const redis = {
            status: "ready",
            eval: jest.fn().mockResolvedValue(1),
            disconnect: jest.fn(),
        };
        const service = new AgentRateLimitService(new ConfigService({
            VALKEY_URL: "redis://unused",
            AGENT_RATE_LIMIT_PER_MINUTE: "20",
        }));
        Object.assign(service, { redis });

        await service.check("user-a", "branch-a");

        expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('INCR'"), 1, expect.stringMatching(/^agent:rate-limit:/), 60);
        expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('TTL'"), 1, expect.any(String), 60);
    });

    // The 429 carries the registered REQUEST_RATE_LIMITED problem body: the
    // HTTP mapper keys on the code, so a raw English string would fall back to
    // the legacy envelope instead of the problem contract.
    const expectRateLimitedProblem = async (promise: Promise<unknown>): Promise<void> => {
        const error: unknown = await promise.then(
            () => { throw new Error("expected the limiter to reject"); },
            (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(Error);
        expect((error as { getStatus?: () => number }).getStatus?.()).toBe(429);
        expect((error as { getResponse?: () => unknown }).getResponse?.()).toMatchObject({
            code: "REQUEST_RATE_LIMITED",
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        });
    };

    it("rejects over-limit requests through the Valkey path with a problem body", async () => {
        const redis = {
            status: "ready",
            eval: jest.fn().mockResolvedValue(21),
            disconnect: jest.fn(),
        };
        const service = new AgentRateLimitService(new ConfigService({
            VALKEY_URL: "redis://unused",
            AGENT_RATE_LIMIT_PER_MINUTE: "20",
        }));
        Object.assign(service, { redis });

        await expectRateLimitedProblem(service.check("user-a", "branch-a"));
    });

    it("rejects over-limit requests through the process-local fallback with a problem body", async () => {
        const service = new AgentRateLimitService(new ConfigService({ AGENT_RATE_LIMIT_PER_MINUTE: "1" }));

        await service.check("user-b", "branch-b");
        await expectRateLimitedProblem(service.check("user-b", "branch-b"));
    });
});
