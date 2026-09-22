import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { agentAutomationConcreteJobDigest } from "application/services/agent-automation-job-binding";
import { buildAutomationRetrySealVariables, readAutomationRetrySeal } from "application/services/automation-retry-seal";

describe("SmsRetryService", () => {
    const createMockLogRepository = () => ({
        startRetryAttempt: jest.fn(),
        findByIdInBranch: jest.fn(),
        update: jest.fn(),
    });
    const createMockAligoService = () => ({
        sendSms: jest.fn(),
    });
    const createMockMessageSenderApprovalService = () => ({
        ensureApproved: jest.fn().mockResolvedValue(undefined),
    });
    const createSmsRetryLog = (templateKey = "client_greeting_sms") =>
        MessageLogEntity.reconstitute(
            77,
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
                result_code: -101,
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

});
