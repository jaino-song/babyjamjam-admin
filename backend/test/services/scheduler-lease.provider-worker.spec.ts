import { ConfigService } from "@nestjs/config";

import { EformsignDocumentJobWorkerService } from "application/services/eformsign-document-job-worker.service";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";
import type { ISchedulerLeaseRepository } from "domain/repositories/scheduler-lease.repository.interface";

describe("document worker uses shared provider eligibility and explicit feature flag", () => {
    it.each(["lightnode", "lightsail"])("only the selected %s host polls document jobs", async (provider) => {
        for (const holder of ["lightnode", "lightsail"]) {
            for (const enabled of ["true", "false"]) {
                const config = new ConfigService({
                    NODE_ENV: "production",
                    SCHEDULER_LEASE_MODE: "required",
                    PRODUCTION_DEPLOYMENT_PROVIDER: provider,
                    SCHEDULER_LEASE_HOLDER_ID: holder,
                    EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED: enabled,
                });
                const leaseRepository: ISchedulerLeaseRepository = {
                    acquireOrRenew: jest.fn().mockResolvedValue({ acquired: true, expiresAt: null, dbNow: null }),
                    release: jest.fn().mockResolvedValue(true),
                    read: jest.fn().mockResolvedValue(null),
                };
                const lease = new SchedulerLeaseService(leaseRepository, config, true);
                const jobs = {
                    recoverStale: jest.fn().mockResolvedValue([]),
                    claimDue: jest.fn().mockResolvedValue([]),
                    deleteExpiredTerminal: jest.fn().mockResolvedValue(0),
                    purgeExpiredAttentionPayloads: jest.fn().mockResolvedValue(0),
                    listRecentStaffFailures: jest.fn().mockResolvedValue([]),
                };
                const worker = new EformsignDocumentJobWorkerService(
                    config, jobs as never, {} as never, {} as never, {} as never,
                    {} as never, {} as never, {} as never, lease, {} as never, {} as never,
                );
                try {
                    await lease.onModuleInit();
                    await worker.processDueJobs();
                    const shouldPoll = holder === provider && enabled === "true";
                    expect(jobs.claimDue).toHaveBeenCalledTimes(shouldPoll ? 1 : 0);
                    expect(jobs.recoverStale).toHaveBeenCalledTimes(shouldPoll ? 1 : 0);
                    expect(leaseRepository.acquireOrRenew).toHaveBeenCalledTimes(holder === provider ? 1 : 0);
                } finally {
                    await lease.onModuleDestroy();
                }
            }
        }
    });
});
