import { AlimtalkRetrySchedulerService } from "application/services/alimtalk-retry-scheduler.service";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";
import { IAlimtalkLogRepository } from "domain/repositories/alimtalk-log.repository.interface";
import { IAligoApiPort } from "domain/ports/aligo-api.port";
import { ForbiddenException } from "@nestjs/common";

describe("AlimtalkRetrySchedulerService", () => {
    const createMockLogRepository = () => ({
        findPendingRetries: jest.fn(),
        update: jest.fn(),
    });

    const createMockAligoApi = () => ({
        sendAlimtalk: jest.fn(),
    });
    const createMockAligoService = () => ({
        sendSms: jest.fn(),
    });
    const createMockMessageSenderApprovalService = () => ({
        ensureApproved: jest.fn().mockResolvedValue(undefined),
    });
    const createSmsRetryLog = () =>
        AlimtalkLogEntity.reconstitute(
            77,
            "11111111-1111-1111-1111-111111111111",
            "aligo_sms",
            "client_greeting_sms",
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

    let scheduler: AlimtalkRetrySchedulerService;
    let logRepository: ReturnType<typeof createMockLogRepository>;
    let aligoApi: ReturnType<typeof createMockAligoApi>;
    let aligoService: ReturnType<typeof createMockAligoService>;
    let messageSenderApprovalService: ReturnType<typeof createMockMessageSenderApprovalService>;
    let nowSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
        logRepository = createMockLogRepository();
        aligoApi = createMockAligoApi();
        aligoService = createMockAligoService();
        messageSenderApprovalService = createMockMessageSenderApprovalService();
        scheduler = new AlimtalkRetrySchedulerService(
            logRepository as unknown as IAlimtalkLogRepository,
            aligoApi as unknown as IAligoApiPort,
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

    it("enters cooldown after transient prisma connectivity errors", async () => {
        const prismaError = Object.assign(
            new Error("Timed out fetching a new connection from the connection pool"),
            { code: "P2024" },
        );
        logRepository.findPendingRetries.mockRejectedValue(prismaError);

        await scheduler.retryFailedMessages();
        await scheduler.retryFailedMessages();

        expect(logRepository.findPendingRetries).toHaveBeenCalledTimes(1);
    });

    it("clears a stale lock and starts a fresh run", async () => {
        let releaseFirstRun: (() => void) | undefined;
        logRepository.findPendingRetries.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseFirstRun = () => resolve([]);
                }),
        );
        logRepository.findPendingRetries.mockResolvedValueOnce([]);

        const firstRun = scheduler.retryFailedMessages();

        nowSpy.mockReturnValue(16 * 60 * 1000);
        await scheduler.retryFailedMessages();

        expect(logRepository.findPendingRetries).toHaveBeenCalledTimes(2);

        releaseFirstRun?.();
        await firstRun;
    });

    it("retries failed automatic SMS logs with the original sender and message", async () => {
        const log = createSmsRetryLog();
        logRepository.findPendingRetries.mockResolvedValue([log]);
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

        await scheduler.retryFailedMessages();

        expect(aligoService.sendSms).toHaveBeenCalledWith({
            senderPhone: "0212345678",
            receiver: "01012345678",
            message: "안녕하세요 김지니 산모님",
            recipientName: "김지니",
            title: "인사 메시지",
            msgType: "AUTO",
        });
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 77,
                status: "sent",
                aligoMid: "123",
                nextRetryAt: null,
            }),
        );
    });

    it("schedules another five-minute retry when an automatic SMS retry is still rejected", async () => {
        nowSpy.mockReturnValue(new Date("2026-06-05T10:20:00.000Z").getTime());
        const log = createSmsRetryLog();
        logRepository.findPendingRetries.mockResolvedValue([log]);
        aligoService.sendSms.mockRejectedValue(
            new Error("Aligo SMS API error (403): 등록되지 않은 IP 입니다."),
        );

        await scheduler.retryFailedMessages();

        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 77,
                status: "failed",
                attempts: 2,
                errorMessage: "Aligo SMS API error (403): 등록되지 않은 IP 입니다.",
                nextRetryAt: new Date("2026-06-05T10:25:00.000Z"),
            }),
        );
    });

    it("preserves scheduled SMS fields when retrying a scheduled delivery log", async () => {
        // Date.now() is mocked to 0 (epoch); "20260605" 14:30 KST is far in the future.
        const log = createSmsRetryLog();
        log.variables = {
            ...log.variables,
            scheduledDate: "20260605",
            scheduledTime: "1430",
            testMode: "true",
        };
        logRepository.findPendingRetries.mockResolvedValue([log]);
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

        await scheduler.retryFailedMessages();

        expect(aligoService.sendSms).toHaveBeenCalledWith(
            expect.objectContaining({
                scheduledDate: "20260605",
                scheduledTime: "1430",
                testMode: true,
            }),
        );
        // Still-future scheduled send: Aligo merely re-queued it, so status must be 'pending'.
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 77,
                status: "pending",
                aligoMid: "124",
                nextRetryAt: null,
            }),
        );
    });

    it("a still-future scheduled retry records status='pending' not 'sent'", async () => {
        // Date.now() = 0 (epoch); future date far ahead.
        const log = createSmsRetryLog();
        log.variables = {
            ...log.variables,
            scheduledDate: "20301231",
            scheduledTime: "2359",
        };
        logRepository.findPendingRetries.mockResolvedValue([log]);
        aligoService.sendSms.mockResolvedValue({
            request: { senderPhone: "0212345678", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
            response: { result_code: 1, message: "성공적으로 전송요청 하였습니다.", msg_id: 200, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
        });

        await scheduler.retryFailedMessages();

        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({ id: 77, status: "pending", nextRetryAt: null }),
        );
    });

    it("drops schedule fields and marks 'sent' when scheduled instant is in the past", async () => {
        // Move Date.now() to AFTER the scheduled instant so Fix 1 strips the schedule fields.
        const pastInstantKst = new Date("2025-01-01T10:00:00+09:00").getTime();
        nowSpy.mockReturnValue(pastInstantKst + 60_000); // 1 minute after scheduled time

        const log = createSmsRetryLog();
        log.variables = {
            ...log.variables,
            scheduledDate: "20250101",
            scheduledTime: "1000",
        };
        logRepository.findPendingRetries.mockResolvedValue([log]);
        aligoService.sendSms.mockResolvedValue({
            request: { senderPhone: "0212345678", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
            response: { result_code: 1, message: "성공적으로 전송요청 하였습니다.", msg_id: 300, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
        });

        await scheduler.retryFailedMessages();

        // Schedule fields must have been stripped from the sendSms call.
        const sendSmsCall = aligoService.sendSms.mock.calls[0][0];
        expect(sendSmsCall).not.toHaveProperty("scheduledDate");
        expect(sendSmsCall).not.toHaveProperty("scheduledTime");

        // Immediate send → status='sent'.
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({ id: 77, status: "sent", nextRetryAt: null }),
        );
    });

    it("permanently fails log without re-sending when branch sender approval is not granted", async () => {
        const log = createSmsRetryLog();
        logRepository.findPendingRetries.mockResolvedValue([log]);
        messageSenderApprovalService.ensureApproved.mockRejectedValue(
            new ForbiddenException("메시지 발송 권한 승인이 필요합니다."),
        );

        await scheduler.retryFailedMessages();

        // Must NOT have attempted to send.
        expect(aligoService.sendSms).not.toHaveBeenCalled();

        // Must have persisted the permanently-failed log with no further retry.
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 77,
                status: "failed",
                nextRetryAt: null,
            }),
        );
    });
});
