import { ConfigService } from "@nestjs/config";
import { hostname } from "node:os";

import {
    LEASE_RENEW_INTERVAL_MS,
    SchedulerLeaseService,
} from "application/services/scheduler-lease.service";
import type { ISchedulerLeaseRepository } from "domain/repositories/scheduler-lease.repository.interface";

jest.mock("node:os", () => ({ hostname: jest.fn() }));

describe.each(["lightnode", "lightsail"])("SchedulerLeaseService on hostname %s", (provider) => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.mocked(hostname).mockReturnValue(provider);
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.mocked(hostname).mockReset();
    });

    it.each([
        { holder: undefined, mode: "required" },
        { holder: "", mode: "required" },
        { holder: undefined, mode: "off" },
        { holder: "", mode: "off" },
    ])("rejects explicit holder $holder in $mode mode despite a matching hostname", async ({ holder, mode }) => {
        const values: Record<string, string | undefined> = {
            NODE_ENV: "production",
            PRODUCTION_DEPLOYMENT_PROVIDER: provider,
            SCHEDULER_LEASE_HOLDER_ID: holder,
            SCHEDULER_LEASE_MODE: mode,
        };
        const config = { get: (key: string) => values[key] } as unknown as ConfigService;
        const repository: jest.Mocked<ISchedulerLeaseRepository> = {
            acquireOrRenew: jest.fn().mockResolvedValue({
                acquired: true,
                expiresAt: new Date("2030-01-01T00:00:00.000Z"),
                dbNow: new Date("2030-01-01T00:00:00.000Z"),
            }),
            release: jest.fn().mockResolvedValue(true),
            read: jest.fn().mockResolvedValue(null),
        };
        const service = new SchedulerLeaseService(repository, config, true);

        try {
            // Pin the fallback identity so a provider-named host exercises the regression.
            expect(service.holderId).toBe(provider);
            await service.onModuleInit();

            expect(service.snapshot()).toEqual(expect.objectContaining({
                provider,
                mode,
                eligible: false,
                eligibilityReason: "holder_unrecognized",
                held: false,
            }));
            expect(service.holdsLease()).toBe(false);
            expect(repository.acquireOrRenew).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS * 3);

            expect(service.holdsLease()).toBe(false);
            expect(repository.acquireOrRenew).not.toHaveBeenCalled();
        } finally {
            await service.onModuleDestroy();
        }
        expect(repository.release).not.toHaveBeenCalled();
    });
});
