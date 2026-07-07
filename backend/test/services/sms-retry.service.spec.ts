import { ForbiddenException } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";

describe("SmsRetryService", () => {
    const createMockLogRepository = () => ({
        update: jest.fn(),
    });
    const createMockAligoService = () => ({
        sendSms: jest.fn(),
    });
    const createMockMessageSenderApprovalService = () => ({
        ensureApproved: jest.fn().mockResolvedValue(undefined),
    });
    const createSmsRetryLog = () =>
        MessageLogEntity.reconstitute(
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

    let service: SmsRetryService;
    let logRepository: ReturnType<typeof createMockLogRepository>;
    let aligoService: ReturnType<typeof createMockAligoService>;
    let messageSenderApprovalService: ReturnType<typeof createMockMessageSenderApprovalService>;
    let nowSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
        logRepository = createMockLogRepository();
        aligoService = createMockAligoService();
        messageSenderApprovalService = createMockMessageSenderApprovalService();
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

    it("retries failed automatic SMS logs with the original sender and message", async () => {
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
        aligoService.sendSms.mockRejectedValue(
            new Error("Aligo SMS API error (403): 등록되지 않은 IP 입니다."),
        );

        await service.retry(log);

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
                id: 77,
                status: "pending",
                aligoMid: "124",
                nextRetryAt: null,
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
            expect.objectContaining({ id: 77, status: "pending", nextRetryAt: null }),
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
            expect.objectContaining({ id: 77, status: "sent", nextRetryAt: null }),
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
                id: 77,
                status: "failed",
                nextRetryAt: null,
            }),
        );
    });
});
