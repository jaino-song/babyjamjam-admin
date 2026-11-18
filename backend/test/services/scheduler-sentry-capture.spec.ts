import { Logger } from "@nestjs/common";
import { ContractAutoFinalizeSchedulerService } from "application/services/contract-auto-finalize-scheduler.service";
import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { MessageTriggerSchedulerService } from "application/services/message-trigger-scheduler.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { NotificationCleanupSchedulerService } from "application/services/notification-cleanup-scheduler.service";
import { SmsCarrierCheckService } from "application/services/sms-carrier-check.service";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { captureBackendError } from "infrastructure/observability/service-record-sentry";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

jest.mock("infrastructure/observability/service-record-sentry", () => ({
    captureBackendError: jest.fn(),
}));

const capture = jest.mocked(captureBackendError);

interface SchedulerHarness {
    run: () => Promise<void>;
    dependency: jest.Mock;
}

const schedulers: Array<{ operation: string; build: () => SchedulerHarness }> = [
    {
        operation: "message-retry-scheduler:tick",
        build: () => {
            const dependency = jest.fn().mockResolvedValue([]);
            const service = new MessageRetrySchedulerService(
                { findPendingRetriesSystemScope: dependency } as never,
                {} as never,
                createSchedulerLeaseMock(),
            );
            return { run: () => service.retryFailedMessages(), dependency };
        },
    },
    {
        operation: "contract-auto-finalize-scheduler:tick",
        build: () => {
            const dependency = jest.fn().mockResolvedValue([]);
            const config: Record<string, string> = {
                CONTRACT_AUTO_FINALIZE_ENABLED: "true",
                EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED: "true",
                CONTRACT_AUTO_FINALIZE_SINCE: "2020-01-01",
            };
            const service = new ContractAutoFinalizeSchedulerService(
                { get: (key: string) => config[key] } as never,
                { findReviewStageContracts: dependency } as never,
                {} as never,
                {} as never,
                createSchedulerLeaseMock(),
            );
            return { run: () => service.autoFinalizeDueContracts(), dependency };
        },
    },
    {
        operation: "sms-carrier-check:tick",
        build: () => {
            const dependency = jest.fn().mockResolvedValue([]);
            const service = new SmsCarrierCheckService(
                { findCarrierChecksDueSystemScope: dependency } as never,
                { getSmsDeliveryDetails: jest.fn() } as never,
                createSchedulerLeaseMock(),
            );
            return { run: () => service.checkDueCarrierResults(), dependency };
        },
    },
    {
        operation: "notification-cleanup-scheduler:tick",
        build: () => {
            const dependency = jest.fn().mockResolvedValue([]);
            const service = new NotificationCleanupSchedulerService(
                {} as never,
                { findAllActive: dependency } as never,
                createSchedulerLeaseMock(),
            );
            return { run: () => service.cleanupOldNotifications(), dependency };
        },
    },
    {
        operation: "message-trigger-scheduler:tick",
        build: () => {
            const dependency = jest.fn().mockResolvedValue(undefined);
            const service = new MessageTriggerSchedulerService(
                { dispatchDueJobs: dependency } as never,
                createSchedulerLeaseMock(),
            );
            return { run: () => service.dispatchDueJobs(), dependency };
        },
    },
];

function createJob(): MessageTriggerJobEntity {
    const job = MessageTriggerJobEntity.create({
        branchId: "dev-qa",
        ruleId: "QA-rule",
        scheduledFor: new Date(),
        recipientType: MessageTriggerRecipientType.CLIENT,
        templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        dedupeKey: "QA-delivery",
        payload: {
            memberId: "QA-member",
            recipientName: "QA-recipient",
            recipientPhone: "",
            templateVariables: {},
        },
    });
    job.markProcessing("QA-claim");
    return job;
}

function createDeliveryService(sendJob: jest.Mock): MessageTriggerService {
    return new MessageTriggerService(
        {} as never,
        { sendJob } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
    );
}

describe("background failure reporting", () => {
    beforeEach(() => {
        capture.mockReset();
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe.each(schedulers)("$operation", ({ operation, build }) => {
        it.each([false, true])("keeps the scheduler recoverable when reporting throws: %s", async (reportingThrows) => {
            const { run, dependency } = build();
            const failure = new Error("dependency failed");
            dependency.mockRejectedValueOnce(failure);
            if (reportingThrows) {
                capture.mockImplementation(() => { throw new Error("reporting unavailable"); });
            }

            await expect(run()).resolves.toBeUndefined();

            expect(capture).toHaveBeenCalledTimes(1);
            expect(capture).toHaveBeenCalledWith(failure, { handled: true, operation });
            expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
            // The original finally must still release the run guard for the next tick.
            await expect(run()).resolves.toBeUndefined();
            expect(dependency).toHaveBeenCalledTimes(2);
            expect(capture).toHaveBeenCalledTimes(1);
        });

        it("reports transient database failures and preserves the existing retry behaviour", async () => {
            const { run, dependency } = build();
            const failure = Object.assign(new Error("database unavailable"), { code: "P1001" });
            dependency.mockRejectedValueOnce(failure);
            capture.mockImplementation(() => { throw new Error("reporting unavailable"); });

            await expect(run()).resolves.toBeUndefined();
            await expect(run()).resolves.toBeUndefined();

            // Notification cleanup has no execution guard or cooldown.
            expect(dependency).toHaveBeenCalledTimes(operation === "notification-cleanup-scheduler:tick" ? 2 : 1);
            expect(capture).toHaveBeenCalledTimes(1);
            expect(capture).toHaveBeenCalledWith(failure, { handled: true, operation });
        });
    });

    it.each([false, true])("saves a failed carrier lookup and continues when reporting throws: %s", async (reportingThrows) => {
        const failure = new Error("carrier lookup failed");
        const repository = {
            findCarrierChecksDueSystemScope: jest.fn().mockResolvedValue([
                { id: 1, aligoMid: "QA-mid", receiver: "01000000000" },
            ]),
            saveCarrierCheckResult: jest.fn().mockResolvedValue("saved"),
        };
        const service = new SmsCarrierCheckService(
            repository as never,
            { getSmsDeliveryDetails: jest.fn().mockRejectedValue(failure) } as never,
            createSchedulerLeaseMock(),
        );
        if (reportingThrows) {
            capture.mockImplementation(() => { throw new Error("reporting unavailable"); });
        }

        await expect(service.checkDueCarrierResults()).resolves.toBeUndefined();

        expect(capture).toHaveBeenCalledTimes(1);
        expect(capture).toHaveBeenCalledWith(failure, { handled: true, operation: "sms-carrier-check:lookup" });
        expect(repository.saveCarrierCheckResult).toHaveBeenCalledWith(expect.objectContaining({
            id: 1, state: "lookup_error", results: [], failureMessage: null,
        }));
    });

    it.each([false, true])("marks delivery failed without reporting the raw provider reason when reporting throws: %s", async (reportingThrows) => {
        const providerReason = "provider rejected QA-private-recipient 01000000000";
        const service = createDeliveryService(jest.fn().mockRejectedValue(providerReason));
        const job = createJob();
        if (reportingThrows) {
            capture.mockImplementation(() => { throw new Error("reporting unavailable"); });
        }

        await expect(service["deliverClaimedJob"](job)).resolves.toBe("persist-result");

        expect(job.status).toBe("failed");
        expect(job.cancelReason).toBe(providerReason);
        expect(capture).toHaveBeenCalledTimes(1);
        expect(capture).toHaveBeenCalledWith(expect.any(Error), { handled: true, operation: "message-delivery:send" });
        const reported = capture.mock.calls[0]?.[0];
        expect(reported).toBeInstanceOf(Error);
        expect((reported as Error).message).toBe("Message delivery send failed");
        expect((reported as Error).message).not.toContain(providerReason);
        expect((reported as Error).message).not.toContain("01000000000");
    });

    it("reports a fixed failure when the provider returns false", async () => {
        const service = createDeliveryService(jest.fn().mockResolvedValue(false));
        const job = createJob();

        await expect(service["deliverClaimedJob"](job)).resolves.toBe("persist-result");

        expect(job.status).toBe("failed");
        expect(job.cancelReason).toBe("Provider disabled or delivery failed");
        expect(capture).toHaveBeenCalledTimes(1);
        expect(capture).toHaveBeenCalledWith(expect.any(Error), {
            handled: true, operation: "message-delivery:provider-disabled",
        });
    });
});
