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
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
        );
        nowSpy = jest.spyOn(Date, "now");
        nowSpy.mockReturnValue(0);
    });

    afterEach(() => {
        nowSpy.mockRestore();
        jest.clearAllMocks();
    });

    describe("manual retry duplicate guards", () => {
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
                jobRepository as never,
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
            activationService as never,
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
            activationService as never,
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
            deliveryService as never,
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
            { resolveCanonicalDeliverySnapshot: jest.fn() } as never,
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
                activation as never,
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
                undefined, activation as never, undefined, undefined, undefined, safeguard,
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
