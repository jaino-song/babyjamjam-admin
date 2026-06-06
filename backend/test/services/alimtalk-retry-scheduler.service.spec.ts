import { AlimtalkRetrySchedulerService } from "application/services/alimtalk-retry-scheduler.service";
import { AligoService } from "application/services/aligo.service";
import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";
import { IAlimtalkLogRepository } from "domain/repositories/alimtalk-log.repository.interface";
import { IAligoApiPort } from "domain/ports/aligo-api.port";

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
    let nowSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
        logRepository = createMockLogRepository();
        aligoApi = createMockAligoApi();
        aligoService = createMockAligoService();
        scheduler = new AlimtalkRetrySchedulerService(
            logRepository as unknown as IAlimtalkLogRepository,
            aligoApi as unknown as IAligoApiPort,
            aligoService as unknown as AligoService,
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

    it("schedules another one-hour retry when an automatic SMS retry is still rejected", async () => {
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
                nextRetryAt: new Date("2026-06-05T11:20:00.000Z"),
            }),
        );
    });
});
