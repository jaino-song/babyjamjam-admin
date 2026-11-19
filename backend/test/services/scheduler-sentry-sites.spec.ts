import { Logger } from "@nestjs/common";
import { ActionCoordinatorService } from "application/agent/action-coordinator.service";
import { AuthEmailOutboxService } from "application/services/auth-email-outbox.service";
import { CallExtractionRetrySchedulerService } from "application/services/call-extraction-retry-scheduler.service";
import { ClientDueDateSchedulerService } from "application/services/client-due-date-scheduler.service";
import { ContractAutoFinalizeSchedulerService } from "application/services/contract-auto-finalize-scheduler.service";
import { EformsignDocReconcileSchedulerService } from "application/services/eformsign-doc-reconcile-scheduler.service";
import { HolidayReviewProcessorService } from "application/services/holiday-review-processor.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { PwaNotificationSchedulerService } from "application/services/pwa-notification-scheduler.service";
import { ReceiptLinkCleanupSchedulerService } from "application/services/receipt-link-cleanup-scheduler.service";
import { SmsCarrierCheckService } from "application/services/sms-carrier-check.service";
import { messageQuietHoldVariables } from "domain/message-policy-evaluator";
import { EmailProviderError } from "domain/ports/email.port";
import { EformsignBackfillAlreadyRunningError } from "infrastructure/locking/eformsign-backfill-lock.service";
import { captureBackendError } from "infrastructure/observability/service-record-sentry";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

jest.mock("infrastructure/observability/service-record-sentry", () => ({ captureBackendError: jest.fn() }));

const capture = jest.mocked(captureBackendError);
const rejected = (failure: Error) => jest.fn().mockRejectedValue(failure);
const lease = createSchedulerLeaseMock;
const branchId = "dev-qa";
const emailItem = {
    id: "QA-outbox", auth_token_id: "QA-token", kind: "email_verification",
    recipient: "qa@example.invalid", name: "QA-recipient", attempts: 1,
    attempt_version: 1, provider_idempotency_key: "QA-idempotency",
};

function emailHarness(failure?: Error, valid = true) {
    const prisma = {
        $queryRaw: jest.fn().mockResolvedValue(valid ? [{ id: emailItem.id }] : []),
        auth_email_outbox: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const send = failure ? rejected(failure) : jest.fn().mockResolvedValue("QA-provider-id");
    const service = new AuthEmailOutboxService(prisma as never,
        { publicTokenForId: jest.fn().mockReturnValue("QA-public-token") } as never,
        { sendVerificationEmail: send } as never, lease());
    return { service, prisma, send };
}

function reconcileHarness(failure: Error) {
    const execute = rejected(failure);
    const service = new EformsignDocReconcileSchedulerService(
        { get: () => "true" } as never, { execute } as never,
        { isAvailable: () => false } as never, lease(),
        { purgeOlderThan: rejected(failure) } as never,
    );
    return { service, execute };
}

function retryLog(quiet = false) {
    const now = new Date();
    return {
        id: 2, branchId, provider: "aligo_sms", triggerJobId: "QA-trigger",
        status: "pending", providerAcceptanceState: "prepared",
        providerCallStartedAt: null, providerAcceptedAt: null, aligoMid: null,
        providerAcceptanceKey: "QA-key", providerAcceptanceFingerprint: "QA-fingerprint",
        nextRetryAt: quiet ? now : null,
        variables: quiet ? {
            retryOfLogId: "1", retryInvocation: "automatic",
            ...messageQuietHoldVariables({ releaseAt: now, originalScheduledFor: now,
                policyRevision: "QA-revision", reason: "message_quiet_hours:DEFER" }),
        } : {},
        isPartialProviderOutcome: () => false, isManualProviderRejection: () => false,
        markFailed: jest.fn(),
    };
}

function pwaHarness(failure: Error) {
    const settings = {
        claimPwaDigestDelivery: jest.fn().mockResolvedValue("QA-claim"),
        getPwaUndeliveredDigestWatermark: jest.fn().mockResolvedValue(null),
        completePwaDigestDelivery: jest.fn().mockResolvedValue(true),
    };
    const clients = {
        findStartingWithinDays: jest.fn().mockResolvedValue([{ id: 1 }]),
        findEndingWithinDays: jest.fn().mockResolvedValue([]),
        findWithIncompleteContractsStartingWithinDays: jest.fn().mockResolvedValue([]),
        findWithoutContractSentStartingWithinDays: jest.fn().mockResolvedValue([]),
        findServiceRecordAlertCandidates: jest.fn().mockResolvedValue([]),
    };
    const jobs = {
        findRecentUndeliveredByBranch: jest.fn().mockResolvedValue([]),
        countRecentUndeliveredByBranch: jest.fn().mockResolvedValue(0),
    };
    const service = new PwaNotificationSchedulerService(
        { sendDailyDigestToBranchUsers: rejected(failure) } as never, clients as never,
        { findAllActive: jest.fn().mockResolvedValue([{ id: branchId, name: "QA-branch" }]) } as never,
        jobs as never, settings as never, lease(), { forBranch: jest.fn().mockResolvedValue({}) } as never,
    );
    return { service, settings, clients, jobs };
}

interface CaptureCase {
    operation: string;
    run: (failure: Error) => Promise<unknown>;
}

// Each row injects the same sentinel at one dependency boundary. Exact error,
// count, operation and handled assertions below make deletion of that site fail.
const sites: CaptureCase[] = [
    {
        operation: "action-coordinator:reconcile-uncertain",
        run: async (failure) => {
            const service = new ActionCoordinatorService(
                { agent_action: { findMany: jest.fn().mockResolvedValue([{ id: "QA-action", branchId }]),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }) } } as never,
                { get: jest.fn(() => { throw failure; }) } as never, {} as never,
                { isAvailable: () => true,
                    runExclusive: async (callback: (held: { isHeld(): boolean }) => Promise<number>) => callback({ isHeld: () => true }) } as never,
                {} as never, {} as never, lease(),
            );
            return service.reconcileUncertainActions();
        },
    },
    {
        operation: "action-coordinator:advance-uncertain",
        run: async (failure) => {
            const service = new ActionCoordinatorService(
                { agent_action: { updateMany: rejected(failure) } } as never,
                {} as never, {} as never, {} as never, {} as never, {} as never, lease(),
            );
            return service["advanceUncertainAction"]("QA-action", branchId);
        },
    },
    {
        operation: "auth-email-outbox:deliver",
        run: (failure) => emailHarness(failure).service["deliver"](emailItem),
    },
    {
        operation: "auth-email-outbox:persist-pre-send-failure",
        run: (failure) => {
            const { service, prisma } = emailHarness();
            prisma.auth_email_outbox.updateMany.mockRejectedValue(failure);
            return service["releaseBeforeSend"](emailItem, new Error("QA-pre-send"));
        },
    },
    {
        operation: "auth-email-outbox:persist-uncertain",
        run: (failure) => {
            const { service, prisma } = emailHarness();
            prisma.auth_email_outbox.updateMany.mockRejectedValue(failure);
            return service["markUncertain"](emailItem, new Error("QA-provider-uncertain"));
        },
    },
    ...(["process", "tick"] as const).map((stage): CaptureCase => ({
        operation: `call-extraction-retry-scheduler:${stage}`,
        run: (failure) => new CallExtractionRetrySchedulerService(
            { call_record: { findMany: stage === "tick" ? rejected(failure)
                : jest.fn().mockResolvedValue([{ id: "QA-call", processingStatus: "RECEIVED" }]) },
            client_draft: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } } as never,
            { processCallRecord: rejected(failure) } as never, lease(),
        ).retryFailedExtractions(),
    })),
    {
        operation: "client-due-date-scheduler:tick",
        run: (failure) => new ClientDueDateSchedulerService(
            { client: { findMany: rejected(failure) } } as never, lease(),
        ).syncUpcomingDueDatesToStartDates(),
    },
    {
        operation: "client-due-date-scheduler:sync-rules",
        run: (failure) => new ClientDueDateSchedulerService(
            {} as never, lease(), { syncClientRulesForClient: rejected(failure) } as never,
        )["syncTriggerRules"](branchId, 1),
    },
    ...(["enqueue", "notify"] as const).map((stage): CaptureCase => ({
        operation: `contract-auto-finalize-scheduler:${stage}`,
        run: (failure) => {
            const service = new ContractAutoFinalizeSchedulerService(
                {} as never, {} as never, { enqueueFinalizeDocument: rejected(failure) } as never,
                { sendToBranchUsers: rejected(failure) } as never, lease(),
            );
            const contract = { documentId: "QA-document", branchId } as never;
            return stage === "enqueue" ? service["enqueueFinalization"](contract, "2026-11-18")
                : service["notifyExhausted"](contract, "QA-exhausted");
        },
    })),
    {
        operation: "eformsign-doc-reconcile-scheduler:purge-ledger",
        run: (failure) => reconcileHarness(failure).service.purgeWebhookEventLedger(),
    },
    {
        operation: "eformsign-doc-reconcile-scheduler:sweep",
        run: (failure) => reconcileHarness(failure).service.reconcileDocuments(),
    },
    ...(["tick", "list-events", "process-event"] as const).map((stage): CaptureCase => ({
        operation: `holiday-review-processor:${stage}`,
        run: (failure) => {
            const service = new HolidayReviewProcessorService(
                { listUnprocessedEvents: stage === "list-events" ? rejected(failure)
                    : jest.fn().mockResolvedValue([{ id: "QA-event", createdAt: new Date(0), branchId: null }]) } as never,
                {} as never, { findAll: rejected(failure) } as never, lease(),
            );
            if (stage === "tick") {
                jest.spyOn(service, "processDueEvents").mockRejectedValue(failure);
                return service.processScheduled();
            }
            return service.processDueEvents();
        },
    })),
    {
        operation: "message-automation-intent:retry",
        run: (failure) => new MessageAutomationIntentService(
            { message_trigger_job: { findMany: jest.fn().mockResolvedValue([
                { id: "QA-orphan", branchId: null },
            ]), deleteMany: rejected(failure) } } as never,
            {} as never, {} as never, lease(),
        ).reconcilePendingIntents(),
    },
    {
        operation: "message-automation-intent:release-claim",
        run: (failure) => new MessageAutomationIntentService(
            { message_trigger_job: { updateMany: rejected(failure) } } as never,
            {} as never, {} as never, lease(),
        )["releaseAfterFailure"]({ id: "QA-intent", scheduledFor: new Date(), updatedAt: new Date() }, new Error("QA-original")),
    },
    {
        operation: "message-retry-scheduler:reconcile-history",
        run: (failure) => new MessageRetrySchedulerService(
            { findPendingRetriesSystemScope: jest.fn().mockResolvedValue([]) } as never,
            {} as never, lease(), undefined, { reconcile: rejected(failure) } as never,
        ).retryFailedMessages(),
    },
    ...(["quiet-admission", "retry"] as const).map((stage): CaptureCase => ({
        operation: `message-retry-scheduler:${stage}`,
        run: (failure) => new MessageRetrySchedulerService(
            { findPendingRetriesSystemScope: jest.fn().mockResolvedValue([retryLog(stage === "quiet-admission")]),
                update: jest.fn().mockResolvedValue(undefined) } as never,
            { retry: rejected(failure), getRetryDelayMs: jest.fn().mockResolvedValue(1000) } as never, lease(),
        ).retryFailedMessages(),
    })),
    {
        operation: "pwa-notification-scheduler:branch",
        run: (failure) => {
            const { service, settings } = pwaHarness(failure);
            settings.claimPwaDigestDelivery.mockRejectedValue(failure);
            return service.sendDailySummaryNotifications();
        },
    },
    {
        operation: "pwa-notification-scheduler:send-digest",
        run: (failure) => pwaHarness(failure).service.sendDailySummaryNotifications(),
    },
    {
        operation: "pwa-notification-scheduler:load-undelivered",
        run: (failure) => {
            const { service, jobs } = pwaHarness(failure);
            jobs.findRecentUndeliveredByBranch.mockRejectedValue(failure);
            return service["collectUndeliveredMessages"](branchId, new Date(0), new Date());
        },
    },
    {
        operation: "pwa-notification-scheduler:collect",
        run: (failure) => pwaHarness(failure).service["collect"](branchId, "QA-section", rejected(failure)),
    },
    {
        operation: "receipt-link-cleanup-scheduler:delete-image",
        run: (failure) => new ReceiptLinkCleanupSchedulerService(
            { collectExpired: jest.fn().mockResolvedValue({ ids: ["QA-token"], orphanStoragePaths: ["QA-image"] }),
                deleteByIds: jest.fn().mockResolvedValue(0) } as never,
            { delete: rejected(failure) } as never, lease(),
        ).cleanupExpiredLinks(),
    },
    {
        operation: "sms-carrier-check:process",
        run: (failure) => new SmsCarrierCheckService(
            { findCarrierChecksDueSystemScope: jest.fn().mockResolvedValue([{ id: 1, aligoMid: "QA-mid", receiver: "" }]),
                saveCarrierCheckResult: rejected(failure), postponeCarrierCheck: jest.fn().mockResolvedValue(undefined) } as never,
            { getSmsDeliveryDetails: jest.fn() } as never, lease(),
        ).checkDueCarrierResults(),
    },
    ...(["close-lookup", "postpone"] as const).map((stage): CaptureCase => ({
        operation: `sms-carrier-check:${stage}`,
        run: (failure) => new SmsCarrierCheckService(
            { saveCarrierCheckResult: rejected(failure), postponeCarrierCheck: stage === "postpone"
                ? rejected(failure) : jest.fn().mockResolvedValue(undefined) } as never,
            {} as never, lease(),
        )["postponeFailedRow"]({ id: 1, aligoMid: "QA-mid",
            createdAt: stage === "close-lookup" ? new Date(0) : new Date() } as never),
    })),
];

describe("scheduler Sentry capture sites", () => {
    beforeEach(() => {
        capture.mockReset();
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it.each(sites)("reports exactly $operation as handled", async ({ operation, run }) => {
        const failure = new Error(`QA-${operation}`);
        await run(failure);
        expect(capture.mock.calls).toEqual([[failure, { handled: true, operation }]]);
    });

    it("does not capture an invalidated auth token before the provider boundary", async () => {
        const { service, prisma, send } = emailHarness(undefined, false);
        await service["deliver"](emailItem);
        expect(prisma.auth_email_outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ errorCode: "auth_token_invalid" }),
        }));
        expect(send).not.toHaveBeenCalled();
        // Kills an unconditional deliver reporting guard.
        expect(capture).not.toHaveBeenCalled();
    });

    it("captures a provider error once at auth-email-outbox:deliver", async () => {
        const failure = new EmailProviderError("QA-provider", "pre_send");
        const { service, send } = emailHarness(failure);
        await service["deliver"](emailItem);
        expect(send).toHaveBeenCalledTimes(1);
        expect(capture.mock.calls).toEqual([[failure, { handled: true, operation: "auth-email-outbox:deliver" }]]);
    });

    it("skips an already-running eformsign sweep but captures an unrelated sweep failure", async () => {
        const { service, execute } = reconcileHarness(new EformsignBackfillAlreadyRunningError());
        await service.reconcileDocuments();
        expect(execute).toHaveBeenCalledTimes(1);
        expect(capture).not.toHaveBeenCalled();

        const failure = new Error("QA-sweep");
        await reconcileHarness(failure).service.reconcileDocuments();
        // The paired positive case kills if (true) on the early-return guard.
        expect(capture.mock.calls).toEqual([
            [failure, { handled: true, operation: "eformsign-doc-reconcile-scheduler:sweep" }],
        ]);
    });

    it("reports retry-delay separately from the original retry failure", async () => {
        const original = new Error("QA-retry");
        const timing = new Error("QA-timing");
        const service = new MessageRetrySchedulerService(
            { findPendingRetriesSystemScope: jest.fn().mockResolvedValue([retryLog()]) } as never,
            { retry: rejected(original), getRetryDelayMs: rejected(timing) } as never, lease(),
        );
        await service.retryFailedMessages();
        // Removing either nested capture changes this exact sequence.
        expect(capture.mock.calls).toEqual([
            [original, { handled: true, operation: "message-retry-scheduler:retry" }],
            [timing, { handled: true, operation: "message-retry-scheduler:retry-delay" }],
        ]);
    });

    it("reports uncertain digest persistence separately from the branch failure", async () => {
        const original = new Error("QA-watermark");
        const persist = new Error("QA-persist-uncertain");
        const { service, settings } = pwaHarness(original);
        settings.getPwaUndeliveredDigestWatermark.mockRejectedValue(original);
        settings.completePwaDigestDelivery.mockRejectedValue(persist);
        await service.sendDailySummaryNotifications();
        expect(capture.mock.calls).toEqual([
            [original, { handled: true, operation: "pwa-notification-scheduler:branch" }],
            [persist, { handled: true, operation: "pwa-notification-scheduler:persist-uncertain" }],
        ]);
    });
});
