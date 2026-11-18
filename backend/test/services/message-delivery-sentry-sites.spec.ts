import { Logger } from "@nestjs/common";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { AGENT_SMS_RULE_ID_PREFIX, MANUAL_SMS_RULE_PREFIX, MANUAL_SMS_TEMPLATE_KEY, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";
import { captureBackendError } from "infrastructure/observability/service-record-sentry";

jest.mock("infrastructure/observability/service-record-sentry", () => ({ captureBackendError: jest.fn() }));
const capture = jest.mocked(captureBackendError);

function jobFixture() {
    const job = MessageTriggerJobEntity.create({
        branchId: "dev-qa", ruleId: "QA-rule", scheduledFor: new Date(),
        recipientType: MessageTriggerRecipientType.CLIENT,
        templateKey: MessageTriggerTemplateKey.SERVICE_INFO, dedupeKey: "QA-delivery",
        payload: { memberId: "QA-member", recipientName: "QA-recipient", recipientPhone: "", templateVariables: {} },
    });
    job.markProcessing("QA-claim");
    return job;
}

function harness(failure: Error) {
    const jobs = {
        update: jest.fn().mockResolvedValue(undefined),
        findStaleProcessingSystemScope: jest.fn().mockResolvedValue([]),
        reclaimWithClaimFence: jest.fn().mockResolvedValue(true),
    };
    const logs = {
        findSentTriggerJobIdsSystemScope: jest.fn().mockResolvedValue(new Set()),
        findUncertainTriggerJobIdsSystemScope: jest.fn().mockResolvedValue(new Set()),
    };
    const service = new MessageTriggerService(
        { message_log: { findFirst: jest.fn().mockResolvedValue(null) } } as never,
        { prepareJob: jest.fn().mockRejectedValue(failure) } as never,
        {} as never, {} as never, jobs as never, logs as never, {} as never, {} as never,
    );
    return { service, jobs, logs };
}

describe("message delivery Sentry sites", () => {
    beforeEach(() => {
        capture.mockReset();
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it("reports the preparation-side provider-disabled site before dispatch authorization", async () => {
        const job = jobFixture();
        job.status = "pending";
        job.ruleId = AGENT_SMS_RULE_ID_PREFIX + "QA-manual";
        const transaction = { $queryRaw: jest.fn().mockResolvedValue([
            { status: "processing", claim_token: "QA-claim" },
        ]) };
        const delivery = {
            prepareJob: jest.fn().mockResolvedValue(null), sendPreparedJob: jest.fn(),
        };
        const jobs = {
            claimPendingWithRuleFence: jest.fn().mockResolvedValue("QA-claim"),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const service = new MessageTriggerService(
            { $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) } as never,
            delivery as never, {} as never, {} as never, jobs as never, {} as never,
            {} as never, {} as never,
            { getMessageAutomationPolicyConfig: jest.fn().mockResolvedValue({ configuration: defaultMessageAutomationPolicy() }) } as never,
        );

        await service["dispatchClaimedJob"](job, new Set(), new Set(["dev-qa"]));

        // Distinct from deliverClaimedJob's false result: no provider call or dispatch marker.
        expect(delivery.prepareJob).toHaveBeenCalledTimes(1);
        expect(delivery.sendPreparedJob).not.toHaveBeenCalled();
        expect(job.status).toBe("failed");
        expect(capture.mock.calls).toEqual([
            [expect.any(Error), { handled: true, operation: "message-delivery:provider-disabled" }],
        ]);
    });

    it("reports preparation failure at message-delivery:prepare", async () => {
        const failure = new Error("QA-preparation");
        const { service, jobs } = harness(failure);
        await expect(service["prepareClaimedJob"](jobFixture())).resolves.toBeNull();
        expect(jobs.update).toHaveBeenCalledTimes(1);
        // Exact call assertions pin the individual site, not just any Sentry call.
        expect(capture.mock.calls).toEqual([[failure, { handled: true, operation: "message-delivery:prepare" }]]);
    });

    it("reports snapshot write failure at message-delivery:persist-prepared", async () => {
        const failure = new Error("QA-snapshot-write");
        const { service, jobs } = harness(failure);
        jobs.update.mockRejectedValueOnce(failure);
        await expect(service["persistPreparedDelivery"](jobFixture())).resolves.toBe(false);
        expect(jobs.update).toHaveBeenCalledTimes(2);
        expect(capture.mock.calls).toEqual([[failure, { handled: true, operation: "message-delivery:persist-prepared" }]]);
    });

    it("reports a manual deferral at message-delivery:manual-deferred", async () => {
        const failure = new TriggerJobDeferredError("transient", "QA-deferral");
        const { service } = harness(failure);
        const job = jobFixture();
        job.ruleId = MANUAL_SMS_RULE_PREFIX + job.branchId;
        await service["deferOrReturnToNeedsSetup"](job, failure, false);
        expect(job.status).toBe("failed");
        expect(capture.mock.calls).toEqual([[failure, { handled: true, operation: "message-delivery:manual-deferred" }]]);
    });

    it.each(["uncertain log", "dispatching without log", "manual without prepared acceptance"] as const)(
        "reports the distinct reclaim site for %s", async (scenario) => {
            const { service, jobs, logs } = harness(new Error("QA-unused"));
            const job = jobFixture();
            if (scenario === "uncertain log") {
                logs.findUncertainTriggerJobIdsSystemScope.mockResolvedValue(new Set([job.id]));
            } else if (scenario === "dispatching without log") {
                job.markDispatchAuthorized();
            } else {
                job.templateKey = MANUAL_SMS_TEMPLATE_KEY;
                job.attempts = 0;
            }
            jobs.findStaleProcessingSystemScope.mockResolvedValue([job]);

            await service["reclaimStaleProcessingJobs"]();

            expect(job.status).toBe("failed");
            expect(jobs.reclaimWithClaimFence).toHaveBeenCalledTimes(1);
            // Each row reaches only one of the three identically named capture sites.
            expect(capture.mock.calls).toEqual([
                [expect.any(Error), { handled: true, operation: "message-delivery:sms-acceptance-uncertain" }],
            ]);
        },
    );
});
