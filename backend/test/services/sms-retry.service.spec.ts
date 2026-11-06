import { OPTIONAL_DEPS_METADATA } from "@nestjs/common/constants";
import { SCHEDULE_CRON_OPTIONS } from "@nestjs/schedule/dist/schedule.constants";
import { SystemSettingService } from "application/services/system-setting.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { SmsCarrierCheckService } from "application/services/sms-carrier-check.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { publicMessageVariables, type MessageQuietHoursDecision, type MessageQuietHold } from "domain/message-policy-evaluator";
import { createLegacyAutomationDeliveryGate } from "../fixtures/legacy-automation-delivery-gate";
import { ConflictException, ForbiddenException, Logger, NotFoundException } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { SmsAutomationSafeguardService } from "application/services/sms-automation-safeguard.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { agentAutomationConcreteJobDigest } from "application/services/agent-automation-job-binding";
import { buildAutomationRetrySealVariables, readAutomationRetrySeal } from "application/services/automation-retry-seal";
import { SERVICE_RECORD_LINK_PRE_BOOKING_REASON, SERVICE_RECORD_LINK_RESCHEDULED_REASON, SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY } from "domain/constants/service-record-link-message";

describe("SmsRetryService", () => {
    const createMockLogRepository = () => ({
        startRetryAttempt: jest.fn(),
        findByIdInBranch: jest.fn(),
        findRetryFamilyInBranch: jest.fn().mockResolvedValue([]),
        hasNewerServiceRecordSmsInBranch: jest.fn().mockResolvedValue(false),
        update: jest.fn(),
        transitionQuietRetry: jest.fn(),
        findServiceRecordLinkClientState: jest.fn().mockResolvedValue(null),
    });
    const createMockAligoService = () => ({
        sendSms: jest.fn(),
    });
    const createMockMessageSenderApprovalService = () => ({
        ensureApproved: jest.fn().mockResolvedValue(undefined),
    });
    const createSmsRetryLog = (templateKey = "client_greeting_sms", id = 77) =>
        MessageLogEntity.reconstitute(
            id,
            "11111111-1111-1111-1111-111111111111",
            "aligo_sms",
            templateKey,
            null,
            "01012345678",
            7,
            "안녕하세요 김지니 산모님",
            {
                automationKey: "CLIENT_GREETING_SMS",
                systemTemplateKey: "GREETING",
                recipientName: "김지니",
                title: "인사 메시지",
                triggerType: "client_created",
                msgType: "AUTO",
                senderPhone: "0212345678",
                retrySafety: "provider-rejected",
            },
            "failed",
            null,
            "등록되지 않은 IP 입니다.",
            1,
            new Date("2026-06-05T09:20:00.000Z"),
            new Date("2026-06-05T10:20:00.000Z"),
            new Date("2026-06-05T09:20:00.000Z"),
            new Date("2026-06-05T09:20:00.000Z"),
        );
    const persistRetryAttempt = (_source: MessageLogEntity, draft: MessageLogEntity) => ({
        kind: "started" as const,
        log: MessageLogEntity.reconstitute(
            78,
            draft.branchId,
            draft.provider,
            draft.templateKey,
            draft.triggerJobId,
            draft.receiver,
            draft.clientId,
            draft.messageBody,
            draft.variables,
            draft.status,
            draft.aligoMid,
            draft.errorMessage,
            draft.attempts,
            draft.lastAttemptAt,
            draft.nextRetryAt,
            draft.createdAt,
            draft.updatedAt,
            draft.recipientName,
            draft.recipientPhone,
        ),
    });

    let service: SmsRetryService;
    let logRepository: ReturnType<typeof createMockLogRepository>;
    let aligoService: ReturnType<typeof createMockAligoService>;
    let messageSenderApprovalService: ReturnType<typeof createMockMessageSenderApprovalService>;
    let nowSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
        logRepository = createMockLogRepository();
        aligoService = createMockAligoService();
        messageSenderApprovalService = createMockMessageSenderApprovalService();
        logRepository.startRetryAttempt.mockImplementation(persistRetryAttempt);
        service = new SmsRetryService(
            logRepository as unknown as IMessageLogRepository,
            aligoService as unknown as AligoService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,undefined, undefined, undefined, undefined, undefined, undefined, new SystemSettingService({ execute: jest.fn().mockResolvedValue(null) } as never, {} as never),
        );
        nowSpy = jest.spyOn(Date, "now");
        nowSpy.mockReturnValue(0);
    });

    afterEach(() => {
        nowSpy.mockRestore();
        jest.clearAllMocks();
    });

    it("copies original mixed batch bindings unchanged into a manual retry attempt", async () => {
        const source = createSmsRetryLog("manual_sms");
        source.clientId = null;
        source.receiver = "01012345678,01088889999";
        const snapshot = JSON.stringify({ version: 1, branchId: source.branchId, recipients: [
            { kind: "CLIENT", id: 7, phone: "01012345678" }, { kind: "CAREGIVER", id: 12, phone: "01088889999" },
        ] });
        source.variables = { triggerType: "immediate", manualRecipientBindings: snapshot, retrySafety: "manual-provider-rejected" };
        aligoService.sendSms.mockResolvedValue({ request: { receiver: source.receiver },
            response: { result_code: -101, message: "rejected", success_cnt: 0, error_cnt: 2 } });
        const result = await service.retry(source, "manual");
        expect(logRepository.startRetryAttempt).toHaveBeenCalledTimes(1);
        expect(logRepository.startRetryAttempt.mock.calls[0]![1].variables["manualRecipientBindings"]).toBe(snapshot);
        expect(result!.variables["manualRecipientBindings"]).toBe(snapshot);
        expect(source.variables["manualRecipientBindings"]).toBe(snapshot);
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
    });

    it("excludes recipient bindings from the shared public history variables without changing template fields", () => {
        const variables = { recipientName: "합성 고객", title: "안내", optionalTemplateValue: null,
            manualRecipientBindings: JSON.stringify({ version: 1, branchId: "branch-a", recipients: [{ kind: "CLIENT", id: 7, phone: "01012345678" }] }),
            quietHoursDisposition: "DEFER", quietHoursReleaseAt: "2026-11-03T23:00:00.000Z",
            quietHoursOriginalScheduledFor: "2026-11-03T13:00:00.000Z", quietHoursPolicyRevision: "private-revision", quietHoursReason: "message_quiet_hours:DEFER",
            manualQueueMode: "internal", manualQueueSenderIdentity: "private-sender", retryInvocation: "manual", retrySenderIdentity: "private-retry-sender" };
        const before = structuredClone(variables);

        expect(publicMessageVariables(variables)).toEqual({ recipientName: "합성 고객", title: "안내", optionalTemplateValue: null });
        expect(variables).toEqual(before);
    });

    it("projects a newly deferred public retry while retaining internal binding and hold provenance", async () => {
        const source = createSmsRetryLog("manual_sms");
        const snapshot = JSON.stringify({ version: 1, branchId: source.branchId,
            recipients: [{ kind: "CLIENT", id: 7, phone: source.receiver }] });
        const releaseAt = new Date("2026-11-03T23:00:00.000Z");
        nowSpy.mockReturnValue(Date.parse("2026-11-03T13:00:00.000Z"));
        source.providerAcceptanceState = "rejected";
        source.variables = { recipientName: "합성 고객", title: "안내", triggerType: "immediate", msgType: "LMS",
            retrySafety: "provider-rejected", manualRecipientBindings: snapshot,
            quietHoursDisposition: "DEFER", quietHoursReleaseAt: releaseAt.toISOString(),
            quietHoursOriginalScheduledFor: "2026-11-03T12:00:00.000Z", quietHoursPolicyRevision: "private-revision", quietHoursReason: "message_quiet_hours:DEFER" };
        const sourceBefore = structuredClone(source);
        const transaction = { client: { findMany: jest.fn(async () => [{ id: 7, phone: source.receiver }]) },
            employee: { findMany: jest.fn(async () => []) } };
        let storedRetry: MessageLogEntity | undefined;
        logRepository.findByIdInBranch.mockImplementation(async (_branch: string, id: number) => id === source.id ? source : storedRetry);
        logRepository.startRetryAttempt.mockImplementation(async (_source: MessageLogEntity, draft: MessageLogEntity) => {
            storedRetry = Object.assign(createSmsRetryLog("manual_sms", 78), draft, { id: 78 });
            return { kind: "started", log: storedRetry };
        });
        logRepository.transitionQuietRetry.mockImplementation(async (log: MessageLogEntity, hold: MessageQuietHold, cancel: boolean,
            tx: typeof transaction, reason: unknown, invocation: string, senderIdentity: string) => {
            expect(tx).toBe(transaction); expect(cancel).toBe(false); expect(reason).toBeUndefined();
            expect(log).toBe(storedRetry);
            // The repository updates persistence, not the caller's entity.
            storedRetry = Object.assign(createSmsRetryLog("manual_sms", log.id), log, { nextRetryAt: hold.releaseAt,
                variables: { ...log.variables, quietHoursDisposition: "DEFER", quietHoursReleaseAt: hold.releaseAt.toISOString(),
                    quietHoursOriginalScheduledFor: hold.originalScheduledFor.toISOString(), quietHoursPolicyRevision: hold.policyRevision,
                    quietHoursReason: hold.reason, retrySafety: "quiet-deferred", retryInvocation: invocation, retrySenderIdentity: senderIdentity } });
        });
        Object.assign(service, { quietHours: { runAdmission: async (_branch: string, _receiver: string,
            work: (decision: MessageQuietHoursDecision, tx: typeof transaction, revision: string) => Promise<unknown>) =>
            work({ action: "DEFER", reevaluateAt: releaseAt }, transaction, "private-revision") },
            defaultSender: { read: () => ({ availability: "available", identityDigest: "private-sender" }) } });

        const result = await service.retryById(source.branchId!, source.id);

        expect(logRepository.startRetryAttempt).toHaveBeenCalledTimes(1);
        expect(logRepository.transitionQuietRetry).toHaveBeenCalledTimes(1);
        expect(result).toBeInstanceOf(MessageLogEntity);
        expect(Object.getPrototypeOf(result)).toBe(Object.getPrototypeOf(storedRetry));
        expect(result).not.toBe(storedRetry);
        expect(result.variables).toEqual({ recipientName: "합성 고객", title: "안내", triggerType: "immediate", msgType: "LMS",
            retrySafety: "quiet-deferred", retryOfLogId: "77", retryAttempt: "2" });
        expect(result).toMatchObject({ id: 78, status: "pending", attempts: 1, nextRetryAt: releaseAt,
            providerAcceptanceState: "prepared", providerCallStartedAt: null });
        expect(result).toEqual(expect.objectContaining({ ...storedRetry, variables: result.variables }));
        expect(result.canRetry()).toBe(true);
        expect(source).toEqual(sourceBefore);
        expect(storedRetry?.variables).toMatchObject({ manualRecipientBindings: snapshot, quietHoursDisposition: "DEFER",
            quietHoursReleaseAt: "2026-11-03T23:00:00.000Z", quietHoursOriginalScheduledFor: "2026-11-03T12:00:00.000Z",
            quietHoursPolicyRevision: "private-revision", quietHoursReason: "message_quiet_hours:DEFER",
            retryInvocation: "manual", retrySenderIdentity: "private-sender" });
        if (!storedRetry) throw new Error("Expected a persisted deferred retry");
        const heldVariables = structuredClone(storedRetry.variables);
        expect(await service.retry(storedRetry, "automatic")).toBe(storedRetry);
        expect(storedRetry.variables).toEqual(heldVariables);
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.update).not.toHaveBeenCalled();
    });

    it.each([undefined, "invalid-json", "null", JSON.stringify({ version: 2, recipients: [] })])(
        "rejects a quiet batch with missing/malformed provenance before creating any retry (%s)", async snapshot => {
            const source = createSmsRetryLog("manual_sms");
            source.clientId = null; source.receiver = "01012345678,01088889999";
            source.variables = { triggerType: "immediate", retrySafety: "manual-provider-rejected",
                ...(snapshot === undefined ? {} : { manualRecipientBindings: snapshot }) };
            logRepository.findByIdInBranch.mockResolvedValue(source);
            const before = structuredClone(source);
            Object.assign(service, { quietHours: { runAdmission: async (_branch: string, _receiver: string,
                work: (decision: unknown, tx: unknown, revision: string) => Promise<unknown>) =>
                work({ action: "DEFER", reevaluateAt: new Date(60_000) }, {}, "revision") } });
            await expect(service.retry(source, "manual")).rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" } });
            expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
            expect(logRepository.update).not.toHaveBeenCalled();
            expect(aligoService.sendSms).not.toHaveBeenCalled();
            expect(source).toEqual(before);
        });

    describe("manual retry duplicate guards", () => {
        it("returns 409 without sending when transactional family admission loses after the fast-path read", async () => {
            const source = createSmsRetryLog();
            logRepository.findByIdInBranch.mockResolvedValue(source);
            logRepository.findRetryFamilyInBranch.mockResolvedValue([source]);
            logRepository.startRetryAttempt.mockResolvedValueOnce({ kind: "lost" });

            await expect(service.retryById(source.branchId!, source.id)).rejects.toMatchObject({ status: 409 });
            expect(logRepository.startRetryAttempt).toHaveBeenCalledTimes(1);
            expect(aligoService.sendSms).not.toHaveBeenCalled();
        });

        const expectConflict = async (source: MessageLogEntity) => {
            logRepository.findByIdInBranch.mockResolvedValue(source);
            await expect(service.retryById(source.branchId!, source.id)).rejects.toMatchObject({
                status: 409, response: { code: "REQUEST_CONFLICT" },
            });
            expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
            expect(aligoService.sendSms).not.toHaveBeenCalled();
        };

        it.each([SERVICE_RECORD_LINK_RESCHEDULED_REASON, SERVICE_RECORD_LINK_PRE_BOOKING_REASON])("refuses a superseded source: %s", async (reason) => {
            const source = createSmsRetryLog();
            source.markRetrySuperseded(reason);
            await expectConflict(source);
        });

        it.each([
            ["sent child", "sent", {}, null],
            ["pending child", "pending", {}, null],
            ["partial child", "failed", { retrySafety: "partial" }, null],
            ["uncertain child", "failed", { retrySafety: "uncertain" }, null],
            ["started child", "failed", {}, "started"],
            ["provider-uncertain child", "failed", {}, "uncertain"],
            ["reconciled child", "failed", {}, "reconciled_delivered"],
        ] as const)("refuses a family with a %s", async (_name, status, variables, acceptance) => {
            const source = createSmsRetryLog();
            const child = createSmsRetryLog(undefined, 78);
            child.status = status;
            child.variables = { ...child.variables, ...variables, retryOfLogId: String(source.id) };
            if (acceptance) child.providerAcceptanceState = acceptance;
            logRepository.findRetryFamilyInBranch.mockResolvedValue([child]);
            await expectConflict(source);
            expect(logRepository.findRetryFamilyInBranch).toHaveBeenCalledWith(source.branchId, source.id);
        });

        it.each(["sent grandchild", "sent sibling"])("refuses a %s even when the immediate child failed", async (kind) => {
            const source = createSmsRetryLog();
            if (kind === "sent sibling") source.variables["retryOfLogId"] = "76";
            const failed = createSmsRetryLog(undefined, 78);
            failed.variables["retryOfLogId"] = String(source.id);
            const sent = createSmsRetryLog(undefined, 79);
            sent.variables["retryOfLogId"] = kind === "sent sibling" ? "76" : "78";
            sent.markSent();
            logRepository.findRetryFamilyInBranch.mockResolvedValue([failed, sent]);
            await expectConflict(source);
        });

        it("refuses an exhausted link log with a newer non-failed link send", async () => {
            const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
            source.nextRetryAt = null;
            logRepository.hasNewerServiceRecordSmsInBranch.mockResolvedValue(true);
            await expectConflict(source);
            expect(logRepository.hasNewerServiceRecordSmsInBranch).toHaveBeenCalledWith(source.branchId, source);
        });

        it.each(["no children", "failed children", "reconciled failure child", "later failed link", "reset without resend", "non-link"])("allows %s", async (kind) => {
            const source = createSmsRetryLog(kind === "later failed link" ? SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY : undefined);
            source.nextRetryAt = null;
            if (kind === "reset without resend") source.errorMessage = "Service record link reset without resend";
            if (kind === "failed children" || kind === "reconciled failure child") {
                const child = createSmsRetryLog(undefined, 78);
                child.variables["retryOfLogId"] = String(source.id);
                if (kind === "reconciled failure child") child.providerAcceptanceState = "reconciled_not_delivered";
                logRepository.findRetryFamilyInBranch.mockResolvedValue([source, child]);
            }
            if (kind === "non-link") logRepository.hasNewerServiceRecordSmsInBranch.mockResolvedValue(true);
            logRepository.findByIdInBranch.mockResolvedValue(source);
            aligoService.sendSms.mockResolvedValue({
                request: { senderPhone: "0212345678", receiver: source.receiver, msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "success", msg_id: 123, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
            });
            await expect(service.retryById(source.branchId!, source.id)).resolves.toMatchObject({ status: "sent" });
            expect(logRepository.startRetryAttempt).toHaveBeenCalledTimes(1);
            expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
            expect(source.status).toBe("failed");
            if (kind === "non-link") expect(logRepository.hasNewerServiceRecordSmsInBranch).not.toHaveBeenCalled();
        });

        it("does not apply the manual duplicate lookups to automatic retry", async () => {
            const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
            const sent = createSmsRetryLog(undefined, 79);
            sent.markSent();
            logRepository.findRetryFamilyInBranch.mockResolvedValue([sent]);
            logRepository.hasNewerServiceRecordSmsInBranch.mockResolvedValue(true);
            aligoService.sendSms.mockResolvedValue({
                request: { senderPhone: "0212345678", receiver: source.receiver, msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "success", msg_id: 123, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
            });
            await expect(service.retry(source, "automatic")).resolves.toMatchObject({ status: "sent" });
            expect(logRepository.findRetryFamilyInBranch).not.toHaveBeenCalled();
            expect(logRepository.hasNewerServiceRecordSmsInBranch).not.toHaveBeenCalled();
        });
    });

    describe("service-record link client status", () => {
        const states = [
            { serviceStatus: "pre_booking", startDate: new Date("2099-06-01"), endDate: new Date("2099-06-30") },
            { serviceStatus: "waiting", startDate: new Date("2099-06-01"), endDate: null },
        ];
        const createJobRepository = (result = true) => ({
            cancelFailedServiceRecordLinkJobForPreBooking: jest.fn().mockResolvedValue(result),
        });
        const createActivationHarness = (sourceLog: MessageLogEntity, jobRepository?: unknown) => {
            sourceLog.triggerJobId = "job-link";
            // No seal: legacy authority permits retry; activation really runs the callback.
            const findUnique = jest.fn().mockResolvedValue({
                id: sourceLog.triggerJobId, branchId: sourceLog.branchId, payload: {},
            });
            const transaction = { message_trigger_job: { findUnique } };
            const activation = {
                runAutomaticRetryIfEnabled: jest.fn().mockImplementation(async (_branch, _job, work) => ({
                    allowed: true, applies: true, value: await work(transaction),
                })),
            };
            service = new SmsRetryService(
                logRepository as unknown as IMessageLogRepository,
                aligoService as unknown as AligoService,
                messageSenderApprovalService as unknown as MessageSenderApprovalService,
                undefined,
                activation as never,
                undefined,
                undefined,
                jobRepository as never,undefined, new SystemSettingService({ execute: jest.fn().mockResolvedValue(null) } as never, {} as never),
            );
            return { activation, findUnique };
        };
        it.each(states)("supersedes automatic retry before activation for effective pre_booking: %j", async (state) => {
            const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
            const { activation, findUnique } = createActivationHarness(source);
            logRepository.findServiceRecordLinkClientState.mockResolvedValue(state);

            await expect(service.retry(source, "automatic")).resolves.toBe(source);

            expect(logRepository.findServiceRecordLinkClientState).toHaveBeenCalledWith(source);
            expect(activation.runAutomaticRetryIfEnabled).not.toHaveBeenCalled();
            expect(findUnique).not.toHaveBeenCalled();
            expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
            expect(aligoService.sendSms).not.toHaveBeenCalled();
            expect(logRepository.update).toHaveBeenCalledTimes(1);
            expect(logRepository.update).toHaveBeenCalledWith(source);
            expect(source.errorMessage).toBe(SERVICE_RECORD_LINK_PRE_BOOKING_REASON);
            expect(source.nextRetryAt).toBeNull();
        });
        describe("failed link job when the automatic retry is superseded for pre_booking", () => {
            const preBooking = states[0];
            it("cancels the failed link job in the log's branch before superseding the log, and sends nothing", async () => {
                const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
                const jobRepository = createJobRepository();
                const { activation } = createActivationHarness(source, jobRepository);
                logRepository.findServiceRecordLinkClientState.mockResolvedValue(preBooking);

                await expect(service.retry(source, "automatic")).resolves.toBe(source);

                expect(jobRepository.cancelFailedServiceRecordLinkJobForPreBooking).toHaveBeenCalledTimes(1);
                expect(jobRepository.cancelFailedServiceRecordLinkJobForPreBooking).toHaveBeenCalledWith("job-link", source.branchId);
                const [cancelOrder] = jobRepository.cancelFailedServiceRecordLinkJobForPreBooking.mock.invocationCallOrder;
                const [updateOrder] = logRepository.update.mock.invocationCallOrder;
                expect(cancelOrder).toBeLessThan(updateOrder!);
                expect(logRepository.update).toHaveBeenCalledWith(source);
                expect(source.errorMessage).toBe(SERVICE_RECORD_LINK_PRE_BOOKING_REASON);
                expect(activation.runAutomaticRetryIfEnabled).not.toHaveBeenCalled();
                expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
                expect(aligoService.sendSms).not.toHaveBeenCalled();
            });
            it("stays log-only when the log has no trigger job", async () => {
                const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
                const jobRepository = createJobRepository();
                createActivationHarness(source, jobRepository);
                source.triggerJobId = null;
                logRepository.findServiceRecordLinkClientState.mockResolvedValue(preBooking);

                await expect(service.retry(source, "automatic")).resolves.toBe(source);

                expect(jobRepository.cancelFailedServiceRecordLinkJobForPreBooking).not.toHaveBeenCalled();
                expect(logRepository.update).toHaveBeenCalledTimes(1);
                expect(source.errorMessage).toBe(SERVICE_RECORD_LINK_PRE_BOOKING_REASON);
            });
            it("stays log-only when the service has no job repository", async () => {
                const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
                createActivationHarness(source);
                logRepository.findServiceRecordLinkClientState.mockResolvedValue(preBooking);

                await expect(service.retry(source, "automatic")).resolves.toBe(source);

                expect(logRepository.update).toHaveBeenCalledTimes(1);
                expect(source.errorMessage).toBe(SERVICE_RECORD_LINK_PRE_BOOKING_REASON);
            });
            it("still supersedes the log when the job is no longer failed (repository returns false)", async () => {
                const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
                const jobRepository = createJobRepository(false);
                createActivationHarness(source, jobRepository);
                logRepository.findServiceRecordLinkClientState.mockResolvedValue(preBooking);

                await expect(service.retry(source, "automatic")).resolves.toBe(source);

                expect(jobRepository.cancelFailedServiceRecordLinkJobForPreBooking).toHaveBeenCalledTimes(1);
                expect(logRepository.update).toHaveBeenCalledWith(source);
                expect(source.errorMessage).toBe(SERVICE_RECORD_LINK_PRE_BOOKING_REASON);
            });
            it("propagates a job write failure without superseding the log or sending", async () => {
                const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
                const jobRepository = createJobRepository();
                jobRepository.cancelFailedServiceRecordLinkJobForPreBooking.mockRejectedValue(new Error("db down"));
                createActivationHarness(source, jobRepository);
                logRepository.findServiceRecordLinkClientState.mockResolvedValue(preBooking);

                await expect(service.retry(source, "automatic")).rejects.toThrow("db down");

                expect(logRepository.update).not.toHaveBeenCalled();
                expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
                expect(aligoService.sendSms).not.toHaveBeenCalled();
                expect(source.errorMessage).not.toBe(SERVICE_RECORD_LINK_PRE_BOOKING_REASON);
            });
            it("does not touch the job on a manual retry refused for pre_booking", async () => {
                const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
                const jobRepository = createJobRepository();
                createActivationHarness(source, jobRepository);
                logRepository.findByIdInBranch.mockResolvedValue(source);
                logRepository.findServiceRecordLinkClientState.mockResolvedValue(preBooking);

                await expect(service.retryById(source.branchId!, source.id)).rejects.toMatchObject({ status: 400 });

                expect(jobRepository.cancelFailedServiceRecordLinkJobForPreBooking).not.toHaveBeenCalled();
                expect(logRepository.update).not.toHaveBeenCalled();
            });
            it("does not touch the job and retries as before for a waiting client", async () => {
                const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
                const jobRepository = createJobRepository();
                const { activation } = createActivationHarness(source, jobRepository);
                logRepository.findServiceRecordLinkClientState.mockResolvedValue({ serviceStatus: "waiting", bookingConfirmedAt: new Date("2026-01-01"), startDate: new Date("2099-06-01"), endDate: new Date("2099-06-30") });
                aligoService.sendSms.mockResolvedValue({
                    request: { senderPhone: "0212345678", receiver: source.receiver, msgType: "LMS", testModeYn: "N" },
                    response: { result_code: 1, message: "success", msg_id: 123, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
                });

                const result = await service.retry(source, "automatic");

                expect(result?.status).toBe("sent");
                expect(jobRepository.cancelFailedServiceRecordLinkJobForPreBooking).not.toHaveBeenCalled();
                expect(activation.runAutomaticRetryIfEnabled).toHaveBeenCalledTimes(1);
                expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
            });
        });
        it.each(states)("refuses manual retryById without writes for effective pre_booking: %j", async (state) => {
            const source = createSmsRetryLog(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
            logRepository.findByIdInBranch.mockResolvedValue(source);
            logRepository.findServiceRecordLinkClientState.mockResolvedValue(state);

            await expect(service.retryById(source.branchId!, source.id)).rejects.toMatchObject({
                status: 400,
                response: {
                    code: "VALIDATION_FAILED",
                    errors: [{ pointer: "/id", code: "INVALID_VALUE", detail: "예약 전 고객에게는 제공기록지 링크를 보낼 수 없습니다", location: "path" }],
                },
            });
            expect(logRepository.update).not.toHaveBeenCalled();
            expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
            expect(aligoService.sendSms).not.toHaveBeenCalled();
        });
        it.each(["automatic", "manual"] as const)("still sends %s retry for waiting, unresolved and non-link logs", async (invocation) => {
            for (const kind of ["waiting", "unresolved", "non-link"]) {
                jest.clearAllMocks();
                const source = createSmsRetryLog(kind === "non-link" ? "client_greeting_sms" : SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
                const { activation } = createActivationHarness(source);
                logRepository.findByIdInBranch.mockResolvedValue(source);
                logRepository.findServiceRecordLinkClientState.mockResolvedValue(kind === "waiting"
                    ? { serviceStatus: "waiting", bookingConfirmedAt: new Date("2026-01-01"), startDate: new Date("2099-06-01"), endDate: new Date("2099-06-30") }
                    : null);
                aligoService.sendSms.mockResolvedValue({
                    request: { senderPhone: "0212345678", receiver: source.receiver, msgType: "LMS", testModeYn: "N" },
                    response: { result_code: 1, message: "success", msg_id: 123, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
                });

                const result = invocation === "manual"
                    ? await service.retryById(source.branchId!, source.id)
                    : await service.retry(source, invocation);

                expect(result?.status).toBe("sent");
                expect(logRepository.startRetryAttempt).toHaveBeenCalledTimes(1);
                expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
                expect(activation.runAutomaticRetryIfEnabled).toHaveBeenCalledTimes(invocation === "automatic" ? 1 : 0);
                expect(logRepository.findServiceRecordLinkClientState).toHaveBeenCalledTimes(kind === "non-link" ? 0 : 1);
            }
        });
    });

    it("creates a new sent history item without overwriting the original failed item", async () => {
        const log = createSmsRetryLog();
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "성공적으로 전송요청 하였습니다.",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "LMS",
            },
        });

        await service.retry(log);

        expect(aligoService.sendSms).toHaveBeenCalledWith({
            senderPhone: "0212345678",
            receiver: "01012345678",
            message: "안녕하세요 김지니 산모님",
            recipientName: "김지니",
            title: "인사 메시지",
            msgType: "AUTO",
        });
        expect(logRepository.startRetryAttempt).toHaveBeenCalledWith(
            log,
            expect.objectContaining({
                id: 0,
                status: "pending",
                attempts: 1,
                nextRetryAt: new Date(300_000),
                variables: expect.objectContaining({
                    retryOfLogId: "77",
                    retryAttempt: "2",
                    retrySafety: "uncertain",
                }),
            }),
            "manual",
        );
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 78,
                status: "sent",
                aligoMid: "123",
                errorMessage: null,
                nextRetryAt: null,
            }),
        );
        expect(log).toEqual(expect.objectContaining({
            id: 77,
            status: "failed",
            attempts: 1,
            errorMessage: "등록되지 않은 IP 입니다.",
        }));
    });

    it("logs the plain receiver number when a retry resends the SMS", async () => {
        const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        const log = createSmsRetryLog();
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "성공적으로 전송요청 하였습니다.",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "LMS",
            },
        });

        await service.retry(log);

        expect(logSpy).toHaveBeenCalledWith("[Retry] Successfully resent SMS client_greeting_sms to 01012345678");
        logSpy.mockRestore();
    });

    it("manually retries a branch-owned failure as a separate history item", async () => {
        const sourceLog = createSmsRetryLog("service_end_notice_sms");
        logRepository.findByIdInBranch.mockResolvedValue(sourceLog);
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "성공적으로 전송요청 하였습니다.",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "LMS",
            },
        });

        const result = await service.retryById(
            "11111111-1111-1111-1111-111111111111",
            77,
        );

        expect(logRepository.findByIdInBranch).toHaveBeenCalledWith(
            "11111111-1111-1111-1111-111111111111",
            77,
        );
        expect(result).toEqual(expect.objectContaining({ id: 78, status: "sent" }));
        expect(sourceLog).toEqual(expect.objectContaining({
            id: 77,
            status: "failed",
            errorMessage: "등록되지 않은 IP 입니다.",
        }));
        expect(logRepository.startRetryAttempt).toHaveBeenCalledWith(
            sourceLog,
            expect.any(MessageLogEntity),
            "manual",
        );
    });

    it("does not call the provider when an automatic service-end retry is transactionally suppressed", async () => {
        const sourceLog = createSmsRetryLog("service_end_notice_sms");
        sourceLog.markRetrySuperseded("서비스 종료 안내가 이미 발송됨");
        logRepository.startRetryAttempt.mockResolvedValue({
            kind: "suppressed",
            log: sourceLog,
        });

        const result = await service.retry(sourceLog, "automatic");

        expect(result).toBe(sourceLog);
        expect(logRepository.startRetryAttempt).toHaveBeenCalledWith(
            sourceLog,
            expect.any(MessageLogEntity),
            "automatic",
        );
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.update).not.toHaveBeenCalled();
    });

    it("does not reveal or retry a log owned by another branch", async () => {
        logRepository.findByIdInBranch.mockResolvedValue(null);

        await expect(service.retryById("branch-2", 77)).rejects.toThrow(NotFoundException);
        await expect(service.retryById("branch-2", 77)).rejects.toMatchObject({ response: { code: "RESOURCE_NOT_FOUND" } });

        expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("rejects retry of a non-failed message with REQUEST_CONFLICT", async () => {
        const sourceLog = createSmsRetryLog();
        sourceLog.status = "sent";
        logRepository.findByIdInBranch.mockResolvedValue(sourceLog);

        await expect(
            service.retryById("11111111-1111-1111-1111-111111111111", 77),
        ).rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" } });

        expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
    });

    it("rejects a duplicate manual retry when another request already claimed the log", async () => {        const sourceLog = createSmsRetryLog();
        logRepository.findByIdInBranch.mockResolvedValue(sourceLog);
        logRepository.startRetryAttempt.mockResolvedValue({ kind: "lost" });

        await expect(
            service.retryById("11111111-1111-1111-1111-111111111111", 77),
        ).rejects.toThrow(ConflictException);

        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("stops automatic retries when a provider call throws with an uncertain outcome", async () => {
        nowSpy.mockReturnValue(new Date("2026-06-05T10:20:00.000Z").getTime());
        const log = createSmsRetryLog();
        aligoService.sendSms.mockRejectedValue(
            new Error("Aligo SMS API error (403): 등록되지 않은 IP 입니다."),
        );

        await service.retry(log);

        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 78,
                status: "failed",
                attempts: 2,
                errorMessage: expect.stringContaining("제공자 이력 확인 후 수동 확인"),
                nextRetryAt: null,
                variables: expect.objectContaining({
                    retrySafety: "uncertain",
                }),
            }),
        );
    });

    it("keeps a definitively rejected explicit retry available without scheduling an automatic resend", async () => {
        nowSpy.mockReturnValue(new Date("2026-06-05T10:20:00.000Z").getTime());
        const log = createSmsRetryLog();
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: -101,
                message: "등록되지 않은 IP 입니다.",
                msg_id: 0,
                success_cnt: 0,
                error_cnt: 1,
                msg_type: "LMS",
            },
        });

        await service.retry(log, "manual");

        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 78,
                status: "failed",
                attempts: 2,
                errorMessage: "등록되지 않은 IP 입니다.",
                nextRetryAt: null,
                variables: expect.objectContaining({
                    retrySafety: "manual-provider-rejected",
                }),
            }),
        );
    });

    it("parks a manual retry with a permanent-class response as manual-provider-rejected", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: { receiver: "01012345678" },
            response: { result_code: -101, message: "인증오류입니다." },
        });

        const retry = await service.retry(createSmsRetryLog(), "manual");

        expect(retry).toMatchObject({
            status: "failed", attempts: 2, nextRetryAt: null,
            variables: expect.objectContaining({ retrySafety: "manual-provider-rejected" }),
        });
        expect(logRepository.startRetryAttempt).toHaveBeenCalledWith(
            expect.any(MessageLogEntity), expect.any(MessageLogEntity), "manual",
        );
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
    });

    it("retains the bounded schedule for an automated trigger rejection", async () => {
        nowSpy.mockReturnValue(new Date("2026-06-05T10:20:00.000Z").getTime());
        const log = createSmsRetryLog();
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: -999,
                message: "등록되지 않은 IP 입니다.",
                msg_id: 0,
                success_cnt: 0,
                error_cnt: 1,
                msg_type: "LMS",
            },
        });

        await service.retry(log, "automatic");

        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 78,
                status: "failed",
                nextRetryAt: new Date("2026-06-05T10:25:00.000Z"),
                variables: expect.objectContaining({ retrySafety: "provider-rejected" }),
            }),
        );
    });

    it.each([
        [-101, "인증오류입니다.", "인증 오류"],
        [-999, "잔액을 충전해주세요", "잔액 부족"],
    ])("stops automatic retries for permanent rejection %s although attempts remain", async (result_code, message, reason) => {
        aligoService.sendSms.mockResolvedValue({
            request: { receiver: "01012345678" },
            response: { result_code, message },
        });
        const retry = await service.retry(createSmsRetryLog(), "automatic");
        expect(retry).toMatchObject({
            status: "failed", attempts: 2, nextRetryAt: null, errorMessage: `발송 실패: ${reason}`,
            variables: expect.objectContaining({ retrySafety: "permanent-provider-rejected" }),
        });
        expect(retry?.canRetry()).toBe(true);
    });

    it("does not schedule a fourth attempt after a third transient rejection", async () => {
        const log = createSmsRetryLog();
        log.attempts = 2;
        aligoService.sendSms.mockResolvedValue({
            request: { receiver: "01012345678" },
            response: { result_code: -999, message: "일시적인 서버 장애" },
        });
        const retry = await service.retry(log, "automatic");
        expect(retry).toMatchObject({ status: "failed", attempts: 3, nextRetryAt: null });
        expect(retry?.canRetry()).toBe(false);
    });

    it("treats a result-code-one response without counters as uncertain", async () => {
        const log = createSmsRetryLog();
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
            },
        });

        await service.retry(log);

        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 78,
                status: "failed",
                providerAcceptanceState: "uncertain",
                nextRetryAt: null,
                variables: expect.objectContaining({ retrySafety: "uncertain" }),
            }),
        );
    });

    it("fences a partial retry response instead of resending the whole recipient list", async () => {
        const log = createSmsRetryLog();
        log.receiver = "01012345678,01087654321";
        log.recipientPhone = log.receiver;
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: log.receiver,
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "one recipient failed",
                success_cnt: 1,
                error_cnt: 1,
            },
        });

        await service.retry(log);

        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 78,
                status: "failed",
                providerAcceptanceState: "uncertain",
                nextRetryAt: null,
                variables: expect.objectContaining({ retrySafety: "partial" }),
            }),
        );
    });

    it.each([0, 2])("treats unregistered non-negative result code %s as uncertain", async (resultCode) => {
        const log = createSmsRetryLog();
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: resultCode,
                message: "provider response",
                success_cnt: 1,
                error_cnt: 0,
            },
        });

        await service.retry(log);

        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 78,
                providerAcceptanceState: "uncertain",
                nextRetryAt: null,
                variables: expect.objectContaining({ retrySafety: "uncertain" }),
            }),
        );
    });

    it("preserves scheduled SMS fields when retrying a scheduled delivery log", async () => {
        const log = createSmsRetryLog();
        log.variables = {
            ...log.variables,
            scheduledDate: "20260605",
            scheduledTime: "1430",
            testMode: "true",
        };
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                scheduledDate: "20260605",
                scheduledTime: "1430",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "성공적으로 전송요청 하였습니다.",
                msg_id: 124,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "LMS",
            },
        });

        await service.retry(log);

        expect(aligoService.sendSms).toHaveBeenCalledWith(
            expect.objectContaining({
                scheduledDate: "20260605",
                scheduledTime: "1430",
                testMode: true,
            }),
        );
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 78,
                status: "pending",
                aligoMid: "124",
                nextRetryAt: null,
            }),
        );
    });

    it.each([
        { scheduledDate: "20260230", scheduledTime: "1200", reason: "impossible calendar day" },
        { scheduledDate: "20260229", scheduledTime: "1200", reason: "non-leap-year calendar day" },
        { scheduledDate: "20240229", scheduledTime: "2400", reason: "out-of-range hour" },
        { scheduledDate: "20260605", scheduledTime: undefined, reason: "missing scheduled time" },
    ])("marks a $reason historical schedule failed before any retry or provider action", async ({ scheduledDate, scheduledTime }) => {
        const log = createSmsRetryLog();
        log.variables = {
            ...log.variables,
            scheduledDate,
            ...(scheduledTime ? { scheduledTime } : {}),
        };

        await service.retry(log);

        expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
        expect(messageSenderApprovalService.ensureApproved).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 77,
                status: "failed",
                nextRetryAt: null,
                errorMessage: expect.stringContaining("예약 발송 일시"),
            }),
        );
    });

    it("records a still-future scheduled retry as pending", async () => {
        const log = createSmsRetryLog();
        log.variables = {
            ...log.variables,
            scheduledDate: "20301231",
            scheduledTime: "2359",
        };
        aligoService.sendSms.mockResolvedValue({
            request: { senderPhone: "0212345678", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
            response: { result_code: 1, message: "성공적으로 전송요청 하였습니다.", msg_id: 200, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
        });

        await service.retry(log);

        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({ id: 78, status: "pending", nextRetryAt: null }),
        );
    });

    it("schedules the carrier check 30 minutes after the reserved time for a still-future scheduled retry", async () => {
        const log = createSmsRetryLog();
        log.variables = {
            ...log.variables,
            scheduledDate: "20301231",
            scheduledTime: "2359",
        };
        aligoService.sendSms.mockResolvedValue({
            request: { senderPhone: "0212345678", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
            response: { result_code: 1, message: "성공적으로 전송요청 하였습니다.", msg_id: 201, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
        });

        await service.retry(log);

        const updated = logRepository.update.mock.calls[0][0] as MessageLogEntity;
        expect(updated.carrierCheckDueAt).toEqual(new Date("2031-01-01T00:29:00+09:00"));
        expect(updated.hasPendingCarrierCheckSchedule()).toBe(true);
    });

    it("schedules the carrier check 30 minutes after acceptance for an immediate retry", async () => {
        const log = createSmsRetryLog();
        aligoService.sendSms.mockResolvedValue({
            request: { senderPhone: "0212345678", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
            response: { result_code: 1, message: "성공적으로 전송요청 하였습니다.", msg_id: 202, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
        });

        await service.retry(log);

        const updated = logRepository.update.mock.calls[0][0] as MessageLogEntity;
        expect(updated.providerAcceptanceState).toBe("accepted");
        expect(updated.carrierCheckDueAt).toEqual(new Date(30 * 60 * 1000));
    });

    it("does not schedule a carrier check when the retry is rejected by the provider", async () => {
        const log = createSmsRetryLog();
        aligoService.sendSms.mockResolvedValue({
            request: { senderPhone: "0212345678", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
            response: { result_code: -101, message: "rejected", success_cnt: 0, error_cnt: 1, msg_type: "LMS" },
        });

        await service.retry(log);

        const updated = logRepository.update.mock.calls[0][0] as MessageLogEntity;
        expect(updated.carrierCheckDueAt).toBeNull();
        expect(updated.hasPendingCarrierCheckSchedule()).toBe(false);
    });

    it("marks a scheduled historical row with no date or time failed before retrying immediately", async () => {
        const log = createSmsRetryLog();
        log.variables = {
            ...log.variables,
            triggerType: "scheduled",
        };

        await service.retry(log);

        expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 77,
                status: "failed",
                nextRetryAt: null,
                errorMessage: expect.stringContaining("예약 발송 일시"),
            }),
        );
    });

    it("drops schedule fields and marks sent when scheduled instant is in the past", async () => {
        const pastInstantKst = new Date("2025-01-01T10:00:00+09:00").getTime();
        nowSpy.mockReturnValue(pastInstantKst + 60_000);

        const log = createSmsRetryLog();
        log.variables = {
            ...log.variables,
            scheduledDate: "20250101",
            scheduledTime: "1000",
        };
        aligoService.sendSms.mockResolvedValue({
            request: { senderPhone: "0212345678", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
            response: { result_code: 1, message: "성공적으로 전송요청 하였습니다.", msg_id: 300, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
        });

        await service.retry(log);

        const sendSmsCall = aligoService.sendSms.mock.calls[0][0];
        expect(sendSmsCall).not.toHaveProperty("scheduledDate");
        expect(sendSmsCall).not.toHaveProperty("scheduledTime");
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({ id: 78, status: "sent", nextRetryAt: null }),
        );
    });

    it("permanently fails log without re-sending when branch sender approval is not granted", async () => {
        const log = createSmsRetryLog();
        messageSenderApprovalService.ensureApproved.mockRejectedValue(
            new ForbiddenException("메시지 발송 권한 승인이 필요합니다."),
        );

        await service.retry(log);

        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 78,
                status: "failed",
                nextRetryAt: null,
            }),
        );
    });

    it("denies an automatic retry while the branch automation parent is disabled before mutating or calling the provider", async () => {
        const sourceLog = createSmsRetryLog();
        sourceLog.triggerJobId = "job-automatic";
        const activationService = {
            runAutomaticRetryIfEnabled: jest.fn().mockResolvedValue({
                allowed: false,
                applies: true,
            }),
        };
        const retryService = new SmsRetryService(
            logRepository as unknown as IMessageLogRepository,
            aligoService as unknown as AligoService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            undefined,
            activationService as never,undefined, undefined, undefined, undefined, new SystemSettingService({ execute: jest.fn().mockResolvedValue(null) } as never, {} as never),
        );

        await expect(retryService.retry(sourceLog, "automatic")).resolves.toBeNull();

        expect(activationService.runAutomaticRetryIfEnabled).toHaveBeenCalledWith(
            sourceLog.branchId,
            sourceLog.triggerJobId,
            expect.any(Function),
        );
        expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
        expect(logRepository.update).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });
    it("keeps automatic retry suppression inside the branch activation transaction", async () => {
        const sourceLog = createSmsRetryLog();
        sourceLog.triggerJobId = "job-automatic";
        const transaction = { message_log: {} };
        const activationService = {
            runAutomaticRetryIfEnabled: jest.fn().mockImplementation(async (_branch, _job, work) => ({
                allowed: true, applies: true, value: await work(transaction),
            })),
        };
        logRepository.startRetryAttempt.mockResolvedValue({ kind: "suppressed", log: sourceLog });
        const retryService = new SmsRetryService(
            logRepository as unknown as IMessageLogRepository,
            aligoService as unknown as AligoService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            undefined,
            activationService as never,undefined, undefined, undefined, undefined, new SystemSettingService({ execute: jest.fn().mockResolvedValue(null) } as never, {} as never),
        );

        await expect(retryService.retry(sourceLog, "automatic")).resolves.toBe(sourceLog);
        expect(logRepository.startRetryAttempt).toHaveBeenCalledWith(
            sourceLog, expect.anything(), "automatic", transaction,
        );
        expect(messageSenderApprovalService.ensureApproved).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("rechecks a task-owned job seal and canonical snapshot before an automatic retry", async () => {
        const sourceLog = createSmsRetryLog();
        sourceLog.branchId = "11111111-1111-4111-8111-111111111111";
        sourceLog.triggerJobId = "33333333-3333-4333-8333-333333333333";
        const job = MessageTriggerJobEntity.reconstitute(
            sourceLog.triggerJobId,
            sourceLog.branchId,
            "client-rule",
            "failed",
            new Date("2026-06-05T09:20:00.000Z"),
            null,
            null,
            "provider rejected",
            7,
            null,
            MessageTriggerRecipientType.CLIENT,
            sourceLog.receiver,
            MessageTriggerTemplateKey.CLIENT_GREETING,
            "client-rule:7:2026-06-05",
            {
                clientId: 7,
                memberId: "7",
                recipientName: "김지니",
                recipientPhone: sourceLog.receiver,
                templateVariables: { name: "김지니" },
            },
            new Date("2026-06-04T09:20:00.000Z"),
            new Date("2026-06-05T09:20:00.000Z"),
            1,
            null,
            null,
        );
        const concreteJobDigest = agentAutomationConcreteJobDigest(job);
        job.payload.agentAutomationSeal = {
            version: 1,
            authorityId: "22222222-2222-4222-8222-222222222222",
            authorityDigest: "a".repeat(64),
            scope: {
                branchId: sourceLog.branchId!,
                clientId: 7,
                clientIdentity: "b".repeat(64),
                kind: "client-rule",
                ruleId: "client-rule",
                scheduleId: null,
                scheduleIdentity: null,
                recipientType: "client",
            },
            memberDigest: "c".repeat(64),
            reviewedEffectDigest: "d".repeat(64),
            concreteJobDigest,
        };
        const snapshotHash = "e".repeat(64);
        sourceLog.variables = { ...sourceLog.variables, ...buildAutomationRetrySealVariables(job, snapshotHash) };
        expect(readAutomationRetrySeal(job, sourceLog.variables)).toEqual(expect.objectContaining({ kind: "valid" }));

        const canonicalSnapshot = {
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            receiver: "01012345678",
            maskedReceiver: "010****5678",
            recipientName: "김지니",
            message: "정규화된 안내 문구",
            title: "정규화된 인사",
            requestedDeliveryType: "AUTO" as const,
            deliveryType: "LMS" as const,
            estimatedCost: "1",
            templateVersion: "synthetic-template-v1",
            templateHash: "f".repeat(64),
            configVersion: "synthetic-config-v1",
            configHash: "0".repeat(64),
            snapshotHash,
        };
        // The historical log is mutable; a retry must use the verified
        // canonical snapshot even if provider-bound fields were changed later.
        sourceLog.receiver = "01099999999";
        sourceLog.messageBody = "변조된 문구";
        sourceLog.variables = { ...sourceLog.variables, title: "변조된 제목", msgType: "LMS" };

        const transaction = { message_trigger_job: { findUnique: jest.fn().mockResolvedValue(job) } };
        const activationService = {
            runAutomaticRetryIfEnabled: jest.fn().mockImplementation(async (_branch: string, _id: string, work: (tx: unknown) => Promise<unknown>) => ({
                allowed: true,
                applies: true,
                value: await work(transaction),
            })),
        };
        const authorityService = {
            checkAutomaticJob: jest.fn().mockImplementation(async (_tx: unknown, current: MessageTriggerJobEntity, _phase: string, render: (current: MessageTriggerJobEntity, tx: unknown) => Promise<unknown>) => {
                await render(current, transaction);
                return { status: "allowed", seal: job.payload.agentAutomationSeal };
            }),
        };
        const deliveryService = {
            resolveCanonicalDeliverySnapshot: jest.fn().mockResolvedValue(canonicalSnapshot),
        };
        const retryService = new SmsRetryService(
            logRepository as unknown as IMessageLogRepository,
            aligoService as unknown as AligoService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            undefined,
            activationService as never,
            authorityService as never,
            deliveryService as never,undefined, undefined, new SystemSettingService({ execute: jest.fn().mockResolvedValue(null) } as never, {} as never),
        );
        aligoService.sendSms.mockResolvedValue({
            request: { senderPhone: "0212345678", receiver: canonicalSnapshot.receiver, msgType: "LMS", testModeYn: "N" },
            response: { result_code: 1, message: "성공적으로 전송요청 하였습니다.", msg_id: 321, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
        });

        await retryService.retry(sourceLog, "automatic");

        expect(authorityService.checkAutomaticJob).toHaveBeenCalledTimes(1);
        expect(deliveryService.resolveCanonicalDeliverySnapshot).toHaveBeenCalledTimes(1);
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
        expect(logRepository.startRetryAttempt).toHaveBeenCalledWith(
            sourceLog,
            expect.objectContaining({
                receiver: canonicalSnapshot.receiver,
                messageBody: canonicalSnapshot.message,
                recipientName: canonicalSnapshot.recipientName,
                variables: expect.objectContaining({
                    title: canonicalSnapshot.title,
                    msgType: canonicalSnapshot.requestedDeliveryType,
                }),
                providerAcceptanceFingerprint: expect.any(String),
            }),
            "automatic",
            transaction,
        );
        expect(aligoService.sendSms).toHaveBeenCalledWith(expect.objectContaining({
            receiver: canonicalSnapshot.receiver,
            message: canonicalSnapshot.message,
            recipientName: canonicalSnapshot.recipientName,
            title: canonicalSnapshot.title,
            msgType: canonicalSnapshot.requestedDeliveryType,
        }));
    });

    it("stops an automatic retry when the durable log copied a different task seal", async () => {
        const sourceLog = createSmsRetryLog();
        sourceLog.triggerJobId = "33333333-3333-4333-8333-333333333333";
        const transaction = { message_trigger_job: { findUnique: jest.fn().mockResolvedValue({
            id: sourceLog.triggerJobId,
            branchId: sourceLog.branchId,
            ruleId: "client-rule",
            status: "failed",
            scheduledFor: new Date("2026-06-05T09:20:00.000Z"),
            sentAt: null,
            canceledAt: null,
            cancelReason: "provider rejected",
            clientId: 7,
            employeeScheduleId: null,
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: sourceLog.receiver,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            dedupeKey: "client-rule:7:2026-06-05",
            payload: { memberId: "7", recipientName: "김지니", recipientPhone: sourceLog.receiver, templateVariables: { name: "김지니" }, agentAutomationSeal: {} },
            createdAt: new Date("2026-06-04T09:20:00.000Z"),
            updatedAt: new Date("2026-06-05T09:20:00.000Z"),
            attempts: 1,
            nextAttemptAt: null,
            claimToken: null,
        }) } };
        const activationService = {
            runAutomaticRetryIfEnabled: jest.fn().mockImplementation(async (_branch: string, _id: string, work: (tx: unknown) => Promise<unknown>) => ({
                allowed: true, applies: true, value: await work(transaction),
            })),
        };
        const retryService = new SmsRetryService(
            logRepository as unknown as IMessageLogRepository,
            aligoService as unknown as AligoService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            undefined,
            activationService as never,
            { checkAutomaticJob: jest.fn() } as never,
            { resolveCanonicalDeliverySnapshot: jest.fn() } as never,undefined, undefined, new SystemSettingService({ execute: jest.fn().mockResolvedValue(null) } as never, {} as never),
        );

        await expect(retryService.retry(sourceLog, "automatic")).resolves.toEqual(expect.objectContaining({ status: "failed" }));
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("권한 증거") }), transaction);
    });

    describe("rule 실패 시 재전송 / 대상 고객 상태 (규칙 메시지-04)", () => {
        type Policy = { targetClientStatus: string; retryOnFailure: boolean; clientId: number | null };
        const transientRejection = {
            request: { receiver: "01012345678" },
            response: { result_code: -999, message: "일시적인 서버 장애" },
        };
        const harness = (policy: Policy | undefined, clientFacts: unknown = null) => {
            const source = createSmsRetryLog();
            source.triggerJobId = "job-rule-policy";
            // No seal on the job: legacy authority, so the callback really runs.
            const clientFindFirst = jest.fn().mockResolvedValue(clientFacts);
            const transaction = {
                message_trigger_job: { findUnique: jest.fn().mockResolvedValue({
                    id: source.triggerJobId, branchId: source.branchId, payload: {},
                }) },
                client: { findFirst: clientFindFirst },
            };
            const activation = {
                runAutomaticRetryIfEnabled: jest.fn().mockImplementation(async (
                    _branch: string, _job: string, work: (tx: unknown, policy: Policy | undefined) => Promise<unknown>,
                ) => ({ allowed: true, applies: true, value: await work(transaction, policy) })),
                // The rule's CURRENT value when a rejection is finalized (defaults to the admission value).
                readJobRuleRetryPermission: jest.fn().mockResolvedValue(policy?.retryOnFailure === false ? "off" : "on"),
            };
            service = new SmsRetryService(
                logRepository as unknown as IMessageLogRepository,
                aligoService as unknown as AligoService,
                messageSenderApprovalService as unknown as MessageSenderApprovalService,
                undefined,
                activation as never,undefined, undefined, undefined, undefined, new SystemSettingService({ execute: jest.fn().mockResolvedValue(null) } as never, {} as never),
            );
            return { source, transaction, clientFindFirst, activation };
        };

        it("retry on: a transient rejection of the automatic retry is rescheduled as today", async () => {
            const { source } = harness({ targetClientStatus: "all", retryOnFailure: true, clientId: 7 });
            aligoService.sendSms.mockResolvedValue(transientRejection);

            const retry = await service.retry(source, "automatic");

            expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
            expect(retry).toMatchObject({ status: "failed", attempts: 2 });
            expect(retry?.nextRetryAt).toEqual(new Date(300_000));
        });

        it("retry switched off while the provider request is in flight: the rejection is final (nextRetryAt null)", async () => {
            const { source, activation } = harness({ targetClientStatus: "all", retryOnFailure: true, clientId: 7 });
            aligoService.sendSms.mockImplementation(async () => {
                activation.readJobRuleRetryPermission.mockResolvedValue("off");
                return transientRejection;
            });

            const retry = await service.retry(source, "automatic");

            expect(activation.readJobRuleRetryPermission).toHaveBeenCalledWith(source.branchId, "job-rule-policy");
            expect(activation.readJobRuleRetryPermission.mock.invocationCallOrder[0]!)
                .toBeGreaterThan(aligoService.sendSms.mock.invocationCallOrder[0]!);
            expect(retry).toMatchObject({ status: "failed", attempts: 2, nextRetryAt: null, providerAcceptanceState: "rejected" });
            expect(retry?.variables["retrySafety"]).toBe("provider-rejected");
        });

        it("rule row gone at finalization (missing) is treated as on: the rejection is still rescheduled", async () => {
            const { source, activation } = harness({ targetClientStatus: "all", retryOnFailure: true, clientId: 7 });
            activation.readJobRuleRetryPermission.mockResolvedValue("rule-missing");
            aligoService.sendSms.mockResolvedValue(transientRejection);

            const retry = await service.retry(source, "automatic");

            expect(retry?.nextRetryAt).toEqual(new Date(300_000));
        });

        it("a failed current-policy read at finalization is not permission: final, warned without content or phone numbers", async () => {
            const { source, activation } = harness({ targetClientStatus: "all", retryOnFailure: true, clientId: 7 });
            activation.readJobRuleRetryPermission.mockRejectedValue(new Error("db down 01012345678 안녕하세요"));
            const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
            aligoService.sendSms.mockResolvedValue(transientRejection);

            const retry = await service.retry(source, "automatic");

            expect(retry).toMatchObject({ status: "failed", attempts: 2, nextRetryAt: null, providerAcceptanceState: "rejected" });
            const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
            expect(logged).toContain("the rejection is final");
            expect(logged).not.toContain("01012345678");
            expect(logged).not.toContain("안녕하세요");
            warn.mockRestore();
        });

        it("retry off (toggled after the retry was scheduled): the pending automatic retry is superseded, nothing is sent", async () => {
            const { source, transaction } = harness({ targetClientStatus: "all", retryOnFailure: false, clientId: 7 });
            source.nextRetryAt = new Date(0);

            const result = await service.retry(source, "automatic");

            expect(result).toBe(source);
            expect(source).toMatchObject({ status: "failed", nextRetryAt: null });
            expect(source.errorMessage).toContain("rule_retry_disabled");
            expect(logRepository.update).toHaveBeenCalledWith(source, transaction);
            expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
            expect(aligoService.sendSms).not.toHaveBeenCalled();
        });

        it("manual [재발송] of a message whose rule has retry off still works", async () => {
            const { source } = harness({ targetClientStatus: "waiting", retryOnFailure: false, clientId: 7 });
            logRepository.findByIdInBranch.mockResolvedValue(source);
            aligoService.sendSms.mockResolvedValue({
                request: { senderPhone: "0212345678", receiver: source.receiver, msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "success", msg_id: 123, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
            });

            const result = await service.retryById(source.branchId!, source.id);

            expect(result.status).toBe("sent");
            expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
        });

        it("a manual rejection never reschedules, whatever the rule says", async () => {
            const { source } = harness({ targetClientStatus: "all", retryOnFailure: true, clientId: 7 });
            logRepository.findByIdInBranch.mockResolvedValue(source);
            aligoService.sendSms.mockResolvedValue(transientRejection);

            const result = await service.retryById(source.branchId!, source.id);

            expect(result.nextRetryAt).toBeNull();
        });

        const stateFacts = {
            pre_booking: { serviceStatus: null, bookingConfirmedAt: null, startDate: new Date("2099-06-01"), endDate: new Date("2099-06-30") },
            waiting: { serviceStatus: null, bookingConfirmedAt: new Date("2026-01-01"), startDate: new Date("2099-06-01"), endDate: new Date("2099-06-30") },
            terminated: { serviceStatus: "terminated", bookingConfirmedAt: new Date("2026-01-01"), startDate: new Date("2026-01-01"), endDate: new Date("2099-06-30") },
        };
        it.each([
            ["waiting", "pre_booking", true],
            ["pre_booking", "pre_booking", false],
            ["waiting", "waiting", false],
            ["active", "terminated", true],
            ["all", "terminated", false],
        ] as const)("automatic retry for target %s with a %s client is superseded=%s", async (target, status, superseded) => {
            const { source, clientFindFirst } = harness(
                { targetClientStatus: target, retryOnFailure: true, clientId: 7 },
                stateFacts[status],
            );
            aligoService.sendSms.mockResolvedValue({
                request: { senderPhone: "0212345678", receiver: source.receiver, msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "success", msg_id: 123, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
            });

            const result = await service.retry(source, "automatic");

            if (target === "all") expect(clientFindFirst).not.toHaveBeenCalled();
            if (superseded) {
                expect(result).toBe(source);
                expect(source.errorMessage).toContain("target_client_status_mismatch");
                expect(source.nextRetryAt).toBeNull();
                expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
                expect(aligoService.sendSms).not.toHaveBeenCalled();
            } else {
                expect(result?.status).toBe("sent");
                expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
            }
        });

        it("does not apply the status gate to a job with no client", async () => {
            const { source, clientFindFirst } = harness({ targetClientStatus: "waiting", retryOnFailure: true, clientId: null });
            aligoService.sendSms.mockResolvedValue({
                request: { senderPhone: "0212345678", receiver: source.receiver, msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "success", msg_id: 123, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
            });

            const result = await service.retry(source, "automatic");

            expect(result?.status).toBe("sent");
            expect(clientFindFirst).not.toHaveBeenCalled();
        });

        it("manual [재발송] is not gated by the rule's target client status", async () => {
            const { source, clientFindFirst } = harness(
                { targetClientStatus: "active", retryOnFailure: true, clientId: 7 },
                stateFacts.waiting,
            );
            logRepository.findByIdInBranch.mockResolvedValue(source);
            aligoService.sendSms.mockResolvedValue({
                request: { senderPhone: "0212345678", receiver: source.receiver, msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "success", msg_id: 123, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
            });

            const result = await service.retryById(source.branchId!, source.id);

            expect(result.status).toBe("sent");
            expect(clientFindFirst).not.toHaveBeenCalled();
        });
    });


    describe("SMS automation safeguard", () => {
        const okResponse = {
            request: { senderPhone: "0212345678", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
            response: { result_code: 1, message: "success", msg_id: 123, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
        };
        const jobRow = (overrides: Record<string, unknown> = {}) => ({
            id: "job-1", branchId: "11111111-1111-1111-1111-111111111111", ruleId: "rule-1",
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING, dedupeKey: "dedupe-1", clientId: 7,
            employeeScheduleId: null, recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: "010-1234-5678", payload: {}, ...overrides,
        });
        const harness = (options: {
            job?: Record<string, unknown>; clientEnabled?: boolean; branchOn?: boolean; applies?: boolean;
        } = {}) => {
            const row = jobRow(options.job);
            const db = {
                message_trigger_job: {
                    findFirst: jest.fn().mockResolvedValue(row),
                    findUnique: jest.fn().mockResolvedValue(row),
                },
                message_trigger_rule: { findFirst: jest.fn().mockResolvedValue({ isActive: true, branchId: row.branchId }) },
                message_trigger_rule_branch_override: { findFirst: jest.fn().mockResolvedValue(null) },
                client: {
                    // Reference lookup answers the flag; the phone-match lookup (flag-off filter) finds nobody.
                    findFirst: jest.fn(async ({ where }: { where: { smsAutomationEnabled?: boolean } }) =>
                        where.smsAutomationEnabled === false ? null : { smsAutomationEnabled: options.clientEnabled ?? true }),
                },
                employee: { findFirst: jest.fn().mockResolvedValue(null) },
                user: { findMany: jest.fn().mockResolvedValue([]) },
                // Deleted-client raw-phone lookup: no tombstone matches.
                $queryRaw: jest.fn().mockResolvedValue([]),
            };
            const activation = {
                runAutomaticRetryIfEnabled: jest.fn().mockImplementation(async (
                    _branch: string, _job: string, work: (tx: unknown, policy: undefined) => Promise<unknown>,
                ) => options.applies === false
                    ? { allowed: true, applies: false }
                    : { allowed: true, applies: true, value: await work(db, undefined) }),
                getTriggerDispatchEnabled: jest.fn().mockResolvedValue(options.branchOn ?? true),
            };
            const safeguard = new SmsAutomationSafeguardService(db as never, activation as never);
            const retryService = new SmsRetryService(
                logRepository as unknown as IMessageLogRepository,
                aligoService as unknown as AligoService,
                messageSenderApprovalService as unknown as MessageSenderApprovalService,
                undefined, activation as never, undefined, undefined, undefined, safeguard,new SystemSettingService({ execute: jest.fn().mockResolvedValue(null) } as never, {} as never),
            );
            const source = createSmsRetryLog();
            source.triggerJobId = row.id;
            jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
            return { retryService, source, db, activation };
        };

        it("supersedes an automatic retry of a job-bound log whose recipient flag is off: no retry row, no send", async () => {
            const { retryService, source, db } = harness({ clientEnabled: false });

            const result = await retryService.retry(source, "automatic");

            expect(result).toBe(source);
            expect(source).toMatchObject({ status: "failed", nextRetryAt: null });
            expect(source.errorMessage).toBe("sms_automation_safeguard:recipient");
            expect(logRepository.update).toHaveBeenCalledWith(source, db);
            expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
            expect(aligoService.sendSms).not.toHaveBeenCalled();
        });

        it("still lets an admin retryById of the same log proceed", async () => {
            const { retryService, source } = harness({ clientEnabled: false });
            logRepository.findByIdInBranch.mockResolvedValue(source);
            aligoService.sendSms.mockResolvedValue(okResponse);

            const result = await retryService.retryById(source.branchId!, source.id);

            expect(result.status).toBe("sent");
            expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
        });

        it("retries normally when rule, recipient and branch all allow", async () => {
            const { retryService, source } = harness();
            aligoService.sendSms.mockResolvedValue(okResponse);

            const result = await retryService.retry(source, "automatic");

            expect(result?.status).toBe("sent");
            expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
        });

        it("supersedes an automatic retry of an AI-agent SMS log (outside the activation boundary) when the branch switch is off", async () => {
            const { retryService, source, db } = harness({
                applies: false, branchOn: false,
                job: { ruleId: "agent-sms:11111111-1111-1111-1111-111111111111", dedupeKey: "agent-sms:action-1", clientId: null },
            });

            const result = await retryService.retry(source, "automatic");

            expect(result).toBe(source);
            expect(source.errorMessage).toBe("sms_automation_safeguard:branch");
            expect(logRepository.update).toHaveBeenCalledWith(source);
            expect(db.message_trigger_rule.findFirst).not.toHaveBeenCalled();
            expect(logRepository.startRetryAttempt).not.toHaveBeenCalled();
            expect(aligoService.sendSms).not.toHaveBeenCalled();
        });

        it("leaves an automatic retry of an admin-direct job alone", async () => {
            const { retryService, source, db } = harness({
                applies: false, branchOn: false, clientEnabled: false,
                job: {
                    ruleId: "system:service_record_link", templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                    dedupeKey: "system:service_record_link:schedule:10:primary:manual:3f2b1c9e-0a4d-4b6e-9d11-5c7a8e2f4b10",
                },
            });
            aligoService.sendSms.mockResolvedValue(okResponse);

            const result = await retryService.retry(source, "automatic");

            expect(result?.status).toBe("sent");
            expect(db.client.findFirst).not.toHaveBeenCalled();
        });

        it("does not consult the safeguard for a log with no job", async () => {
            const { retryService, source, db } = harness({ clientEnabled: false, applies: false });
            source.triggerJobId = null;
            aligoService.sendSms.mockResolvedValue(okResponse);

            const result = await retryService.retry(source, "automatic");

            expect(result?.status).toBe("sent");
            expect(db.message_trigger_job.findFirst).not.toHaveBeenCalled();
        });
    });

});


describe("TIME-2 branch SMS retry timing", () => {
    const branchId = "11111111-1111-1111-1111-111111111111";
    const rejection = { request: { receiver: "01012345678" }, response: { result_code: -999, message: "일시적인 서버 장애" } };
    const accepted = { request: { receiver: "01012345678" }, response: { result_code: 1, message: "success", msg_id: 123, success_cnt: 1, error_cnt: 0 } };
    const policy = (interval: number | null | "corrupt" | "unavailable") => {
        const execute = jest.fn(async () => {
            if (interval === "unavailable") throw new Error("policy unavailable");
            return interval === null ? null : JSON.stringify({ ...defaultMessageAutomationPolicy(), smsRetryIntervalMinutes: interval });
        });
        const settings = new SystemSettingService({ execute } as never, {} as never);
        jest.spyOn(settings, "getMessageSettingsPolicyEnabled").mockResolvedValue(true);
        return settings;
    };
    const retryHarness = (settings = policy(1), bound = true) => {
        const source = MessageLogEntity.create({ branchId, provider: "aligo_sms", templateKey: "client_greeting_sms",
            ...(bound ? { triggerJobId: "job-time-2" } : {}), receiver: "01012345678", messageBody: "timing fixture",
            variables: { retrySafety: "provider-rejected" } });
        Object.assign(source, { id: 77, status: "failed", attempts: 1, nextRetryAt: new Date("2026-11-03T21:00:00+09:00") });
        const checkpoints: { due: Date | null; state: string }[] = [];
        const logs = {
            findByIdInBranch: jest.fn(async (branch: string) => branch === branchId ? source : null),
            findRetryFamilyInBranch: jest.fn().mockResolvedValue([]),
            hasNewerServiceRecordSmsInBranch: jest.fn().mockResolvedValue(false),
            findPendingRetriesSystemScope: jest.fn().mockResolvedValue([source]),
            startRetryAttempt: jest.fn(async (_source: MessageLogEntity, draft: MessageLogEntity) => {
                checkpoints.push({ due: draft.nextRetryAt, state: draft.providerAcceptanceState });
                Object.assign(draft, { id: 78 });
                return { kind: "started", log: draft };
            }), update: jest.fn(),
        };
        const aligo = { sendSms: jest.fn().mockResolvedValue(rejection) };
        const activation = { runAutomaticRetryIfEnabled: jest.fn().mockResolvedValue({ applies: false, allowed: true }),
            readJobRuleRetryPermission: jest.fn().mockResolvedValue("on") };
        const retry: SmsRetryService = Reflect.construct(SmsRetryService, [logs, aligo, { ensureApproved: jest.fn() }, undefined,
            activation, undefined, undefined, undefined, { checkJobById: jest.fn().mockResolvedValue({ allowed: true }) }, settings]);
        const scheduler = () => new MessageRetrySchedulerService(logs as never, retry, { holdsLease: () => true } as never, settings);
        return { source, logs, aligo, retry, checkpoints, scheduler, activation };
    };
    const deliveryHarness = (settings = policy(1), manualOwned = false) => {
        const job = MessageTriggerJobEntity.create({ branchId, ruleId: manualOwned ? "agent-sms:timing" : "rule-time-2",
            scheduledFor: new Date("2026-11-03T21:00:00+09:00"), recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: "01012345678", templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            dedupeKey: manualOwned ? "agent-sms:timing" : "time-2",
            payload: { memberId: "7", recipientName: "fixture", recipientPhone: "01012345678", templateVariables: { name: "fixture" } } });
        Object.assign(job, { id: "job-time-2" });
        const logs = { save: jest.fn(async (log: MessageLogEntity) => log), update: jest.fn() };
        const aligo = { sendSms: jest.fn().mockResolvedValue(rejection) };
        const delivery: SmsTriggerDeliveryService = Reflect.construct(SmsTriggerDeliveryService, [aligo,
            { getByKeyForBranch: jest.fn().mockResolvedValue({ content: "{{name}} fixture" }) }, logs,
            undefined, undefined, createLegacyAutomationDeliveryGate(), undefined, settings]);
        return { job, logs, aligo, delivery };
    };
    beforeEach(() => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-11-03T21:00:00+09:00").getTime());
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it.each([[1, "2026-11-03T21:01:00+09:00"], [5, "2026-11-03T21:05:00+09:00"], [null, "2026-11-03T21:05:00+09:00"]] as const)(
        "initial rejection uses interval %s (missing settings default5)", async (interval, due) => {
            const { delivery, job, logs, aligo } = deliveryHarness(policy(interval));
            await expect(delivery.sendJob(job)).resolves.toBe(false);
            expect(aligo.sendSms).toHaveBeenCalledTimes(1);
            expect(logs.save.mock.calls[0]![0].nextRetryAt).toEqual(new Date(due));
        });
    it.each([[1, "2026-11-03T21:01:00+09:00"], [5, "2026-11-03T21:05:00+09:00"], [null, "2026-11-03T21:05:00+09:00"]] as const)(
        "automatic retry uses interval %s for prepared recovery and rejection", async (interval, due) => {
            const { retry, source, checkpoints, aligo } = retryHarness(policy(interval));
            const result = await retry.retry(source, "automatic");
            expect(checkpoints).toEqual([{ due: new Date(due), state: "prepared" }]);
            expect(result?.nextRetryAt).toEqual(new Date(due));
            expect(aligo.sendSms).toHaveBeenCalledTimes(1);
        });
    it.each(["corrupt", "unavailable", "missing-dependency"] as const)("initial delivery refuses %s before log/provider", async (failure) => {
        const h = deliveryHarness();
        Object.assign(h.delivery, { systemSettingService: failure === "missing-dependency" ? undefined : policy(failure) });
        await expect(h.delivery.sendJob(h.job)).rejects.toThrow();
        expect(h.logs.save).not.toHaveBeenCalled();
        expect(h.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["automatic", "manual"] as const)("%s retry refuses corrupt/unavailable policy before admission/provider", async (invocation) => {
        for (const invalid of ["corrupt", "unavailable"] as const) {
            const h = retryHarness(policy(invalid));
            await expect(h.retry.retry(h.source, invocation)).rejects.toThrow();
            expect(h.logs.startRetryAttempt).not.toHaveBeenCalled();
            expect(h.aligo.sendSms).not.toHaveBeenCalled();
        }
    });
    it("missing retry dependency fails closed before admission/provider", async () => {
        const h = retryHarness();
        Object.assign(h.retry, { systemSettingService: undefined });
        await expect(h.retry.retry(h.source, "manual")).rejects.toThrow();
        expect(h.logs.startRetryAttempt).not.toHaveBeenCalled();
        expect(h.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each([true, false])("explicit history bound=%s keeps prepared recovery then parks rejection", async (bound) => {
        const h = retryHarness(policy(1), bound);
        const result = await h.retry.retryById(branchId, h.source.id);
        expect(h.checkpoints).toEqual([{ due: new Date("2026-11-03T21:01:00+09:00"), state: "prepared" }]);
        expect(result.nextRetryAt).toBeNull();
        expect(result.variables["retrySafety"]).toBe("manual-provider-rejected");
        expect(h.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it("preserves branch authorization on explicit history retry", async () => {
        const h = retryHarness();
        await expect(h.retry.retryById("other-branch", h.source.id)).rejects.toBeInstanceOf(NotFoundException);
        expect(h.logs.startRetryAttempt).not.toHaveBeenCalled();
        expect(h.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("keeps persisted future due when interval changes without an early send", async () => {
        const h = retryHarness(policy(1));
        h.source.nextRetryAt = new Date("2026-11-03T21:05:00+09:00");
        h.logs.findPendingRetriesSystemScope.mockImplementation(async () => h.source.nextRetryAt && h.source.nextRetryAt.getTime() <= Date.now() ? [h.source] : []);
        await h.scheduler().retryFailedMessages();
        expect(h.source.nextRetryAt).toEqual(new Date("2026-11-03T21:05:00+09:00"));
        expect(h.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("scheduler never submits direct manual-origin logs, including legacy due", async () => {
        const h = retryHarness(policy(1), false);
        h.source.variables["retrySafety"] = "manual-provider-rejected";
        h.source.nextRetryAt = null;
        await h.scheduler().retryFailedMessages();
        expect(h.source.nextRetryAt).toBeNull();
        h.source.nextRetryAt = new Date("2026-11-03T21:00:00+09:00");
        await h.scheduler().retryFailedMessages();
        expect(h.source.nextRetryAt).toBeNull();
        expect(h.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("preserves configured automatic retry for a general manual-owned agent job", async () => {
        const h = deliveryHarness(policy(1), true);
        await h.delivery.sendJob(h.job);
        expect(h.logs.save.mock.calls[0]![0].nextRetryAt).toEqual(new Date("2026-11-03T21:01:00+09:00"));
    });
    it("keeps max3 after third transient rejection with interval1", async () => {
        const h = retryHarness();
        h.source.attempts = 2;
        const result = await h.retry.retry(h.source, "automatic");
        expect(result?.attempts).toBe(3);
        expect(result?.canRetry()).toBe(false);
        expect(result?.nextRetryAt).toBeNull();
    });
    it("independent scheduler instances converge at attempt admission on provider1", async () => {
        const h = retryHarness();
        let admitted = false;
        let release!: () => void;
        let lost!: () => void;
        let entered!: () => void;
        const paused = new Promise<void>(resolve => { release = resolve; });
        const loser = new Promise<void>(resolve => { lost = resolve; });
        const provider = new Promise<void>(resolve => { entered = resolve; });
        h.logs.startRetryAttempt.mockImplementation(async (_source, draft) => {
            if (admitted) { lost(); return { kind: "lost" } as never; }
            admitted = true;
            Object.assign(draft, { id: 78 });
            return { kind: "started", log: draft };
        });
        h.aligo.sendSms.mockImplementation(async () => { entered(); await paused; return accepted; });
        const runs = [h.scheduler().retryFailedMessages(), h.scheduler().retryFailedMessages()];
        try {
            await Promise.all([provider, loser]);
            expect(h.logs.startRetryAttempt).toHaveBeenCalledTimes(2);
            expect(h.aligo.sendSms).toHaveBeenCalledTimes(1);
        } finally { release(); await Promise.all(runs); }
        expect(h.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it.each(["partial", "uncertain"])("scheduler refuses %s while permitting definite rejection", async (safety) => {
        const refused = retryHarness();
        refused.source.variables["retrySafety"] = safety;
        await refused.scheduler().retryFailedMessages();
        expect(refused.aligo.sendSms).not.toHaveBeenCalled();
        const allowed = retryHarness();
        allowed.aligo.sendSms.mockResolvedValue(accepted);
        await allowed.scheduler().retryFailedMessages();
        expect(allowed.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it.each(["corrupt", "unavailable"] as const)("scheduler preserves persisted state on %s timing policy", async (failure) => {
        const h = retryHarness(policy(failure));
        const stored = { status: h.source.status, due: h.source.nextRetryAt, attempts: h.source.attempts };
        await h.scheduler().retryFailedMessages();
        expect({ status: h.source.status, due: h.source.nextRetryAt, attempts: h.source.attempts }).toEqual(stored);
        expect(h.logs.update).not.toHaveBeenCalled();
        expect(h.logs.startRetryAttempt).not.toHaveBeenCalled();
        expect(h.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each([[1, "2026-11-03T21:01:00+09:00"], [5, "2026-11-03T21:05:00+09:00"]] as const)(
        "scheduler generic failure uses validated interval %s", async (interval, due) => {
            const h = retryHarness(policy(interval));
            h.logs.startRetryAttempt.mockRejectedValue(new Error("admission unavailable"));
            await h.scheduler().retryFailedMessages();
            expect(h.source.nextRetryAt).toEqual(new Date(due));
            expect(h.source.attempts).toBe(2);
            expect(h.logs.update).toHaveBeenCalledTimes(1);
            expect(h.aligo.sendSms).not.toHaveBeenCalled();
        });
    it("uses configured timing inside the automatic activation transaction", async () => {
        const h = retryHarness(policy(1));
        const transaction = { message_trigger_job: { findUnique: jest.fn().mockResolvedValue({ id: h.source.triggerJobId, branchId, payload: {} }) } };
        h.activation.runAutomaticRetryIfEnabled.mockImplementation(async (_branch, _job, work) => ({
            applies: true, allowed: true, value: await work(transaction),
        }));
        const result = await h.retry.retry(h.source, "automatic");
        expect(h.checkpoints).toEqual([{ due: new Date("2026-11-03T21:01:00+09:00"), state: "prepared" }]);
        expect(result?.nextRetryAt).toEqual(new Date("2026-11-03T21:01:00+09:00"));
        expect(h.logs.startRetryAttempt).toHaveBeenCalledWith(h.source, expect.any(MessageLogEntity), "automatic", transaction);
        expect(h.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it("does not consume admission when policy lookup fails inside the activation transaction", async () => {
        const h = retryHarness(policy("unavailable"));
        const transaction = { message_trigger_job: { findUnique: jest.fn().mockResolvedValue({ id: h.source.triggerJobId, branchId, payload: {} }) } };
        h.activation.runAutomaticRetryIfEnabled.mockImplementation(async (_branch, _job, work) => ({
            applies: true, allowed: true, value: await work(transaction),
        }));
        await expect(h.retry.retry(h.source, "automatic")).rejects.toThrow("timing policy is unavailable");
        expect(h.logs.startRetryAttempt).not.toHaveBeenCalled();
        expect(h.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("keeps the rejection timestamp base after a provider delay", async () => {
        const h = retryHarness(policy(1));
        h.aligo.sendSms.mockImplementation(async () => {
            jest.spyOn(Date, "now").mockReturnValue(new Date("2026-11-03T21:02:00+09:00").getTime());
            return rejection;
        });
        const result = await h.retry.retry(h.source, "automatic");
        expect(h.checkpoints).toEqual([{ due: new Date("2026-11-03T21:01:00+09:00"), state: "prepared" }]);
        expect(result?.nextRetryAt).toEqual(new Date("2026-11-03T21:03:00+09:00"));
    });
    it("preserves state if the generic catch cannot resolve a fresh validated interval", async () => {
        const h = retryHarness();
        const read = h.retry.getRetryDelayMs.bind(h.retry);
        // Quiet admission also reads configuration. Fail the recovery timing
        // lookup itself, after the initial validated timing and failed admission.
        const timing = jest.spyOn(h.retry, "getRetryDelayMs").mockImplementationOnce(read).mockRejectedValueOnce(new Error("read unavailable"));
        h.logs.startRetryAttempt.mockRejectedValue(new Error("admission unavailable"));
        const stored = { status: h.source.status, due: h.source.nextRetryAt, attempts: h.source.attempts };
        await h.scheduler().retryFailedMessages();
        expect({ status: h.source.status, due: h.source.nextRetryAt, attempts: h.source.attempts }).toEqual(stored);
        expect(h.logs.update).not.toHaveBeenCalled();
        expect(h.logs.startRetryAttempt).toHaveBeenCalledTimes(1);
        expect(timing).toHaveBeenCalledTimes(2);
        expect(h.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("requires the timing settings dependency in Nest for both services", () => {
        expect(Reflect.getMetadata("design:paramtypes", SmsRetryService)[9]).toBe(SystemSettingService);
        expect(Reflect.getMetadata(OPTIONAL_DEPS_METADATA, SmsRetryService)).not.toContain(9);
        expect(Reflect.getMetadata("design:paramtypes", SmsTriggerDeliveryService)[7]).toBe(SystemSettingService);
        expect(Reflect.getMetadata(OPTIONAL_DEPS_METADATA, SmsTriggerDeliveryService)).not.toContain(7);
    });
    it("only SMS retry cron becomes one minute and history reconciliation remains wired", async () => {
        expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, MessageRetrySchedulerService.prototype.retryFailedMessages)).toMatchObject({ cronTime: "* * * * *", timeZone: "Asia/Seoul" });
        expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, SmsCarrierCheckService.prototype.checkDueCarrierResults)).toMatchObject({ cronTime: "*/5 * * * *", timeZone: "Asia/Seoul" });
        expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, MessageAutomationIntentService.prototype.reconcilePendingIntents)).toMatchObject({ cronTime: "*/5 * * * *", timeZone: "Asia/Seoul" });
        const h = retryHarness();
        h.logs.findPendingRetriesSystemScope.mockResolvedValue([]);
        const reconcile = jest.fn().mockResolvedValue(undefined);
        await new MessageRetrySchedulerService(h.logs as never, h.retry, { holdsLease: () => true } as never, policy(1), { reconcile } as never).retryFailedMessages();
        expect(reconcile).toHaveBeenCalledTimes(1);
        expect(h.logs.findPendingRetriesSystemScope).toHaveBeenCalledTimes(1);
    });
});
