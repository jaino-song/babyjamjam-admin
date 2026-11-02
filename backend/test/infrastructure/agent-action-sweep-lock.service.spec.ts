import { EventEmitter } from "events";

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

import { AgentActionSweepLockService } from "infrastructure/locking/agent-action-sweep-lock.service";

jest.mock("ioredis", () => jest.fn());

describe("AgentActionSweepLockService", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("handles Valkey client error events instead of leaving them unhandled", () => {
        const client = new EventEmitter();
        jest.mocked(Redis).mockImplementation(() => client as unknown as Redis);
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const config = { get: () => "redis://127.0.0.1:6379" } as unknown as ConfigService;

        const service = new AgentActionSweepLockService(config);

        expect(service.isAvailable()).toBe(true);
        expect(client.listenerCount("error")).toBeGreaterThan(0);
        expect(() => client.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:6379"))).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("connect ECONNREFUSED"));
    });

    it("does not create a client when VALKEY_URL is unset", () => {
        const config = { get: () => undefined } as unknown as ConfigService;

        expect(new AgentActionSweepLockService(config).isAvailable()).toBe(false);
    });
});
