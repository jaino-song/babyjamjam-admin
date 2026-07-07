import { Logger } from "@nestjs/common";
import { AlimtalkRetryService } from "application/services/alimtalk-retry.service";
import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";

describe("MessageRetrySchedulerService", () => {
    const createLog = (provider: string) =>
        MessageLogEntity.reconstitute(
            provider === "aligo_sms" ? 77 : 78,
            "branch-1",
            provider,
            provider === "aligo_sms" ? "client_greeting_sms" : "CLIENT_CREATED",
            null,
            "01012345678",
            7,
            "message",
            {},
            "failed",
            null,
            "retryable",
            1,
            new Date("2026-06-05T09:20:00.000Z"),
            new Date("2026-06-05T10:20:00.000Z"),
            new Date("2026-06-05T09:20:00.000Z"),
            new Date("2026-06-05T09:20:00.000Z"),
        );

    const createMockLogRepository = () => ({
        findPendingRetries: jest.fn(),
        update: jest.fn(),
    });

    let scheduler: MessageRetrySchedulerService;
    let logRepository: ReturnType<typeof createMockLogRepository>;
    let smsRetryService: { retry: jest.Mock };
    let alimtalkRetryService: { retry: jest.Mock };
    let nowSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
        logRepository = createMockLogRepository();
        smsRetryService = { retry: jest.fn().mockResolvedValue(undefined) };
        alimtalkRetryService = { retry: jest.fn().mockResolvedValue(undefined) };
        scheduler = new MessageRetrySchedulerService(
            logRepository as unknown as IMessageLogRepository,
            smsRetryService as unknown as SmsRetryService,
            alimtalkRetryService as unknown as AlimtalkRetryService,
        );
        nowSpy = jest.spyOn(Date, "now");
        nowSpy.mockReturnValue(0);
    });

    afterEach(() => {
        nowSpy.mockRestore();
        jest.clearAllMocks();
    });

    it("routes SMS and alimtalk retry logs to their dedicated services", async () => {
        const smsLog = createLog("aligo_sms");
        const alimtalkLog = createLog("aligo_alimtalk");
        logRepository.findPendingRetries.mockResolvedValue([smsLog, alimtalkLog]);

        await scheduler.retryFailedMessages();

        expect(smsRetryService.retry).toHaveBeenCalledWith(smsLog);
        expect(alimtalkRetryService.retry).toHaveBeenCalledWith(alimtalkLog);
    });

    it("warns and skips unsupported message providers", async () => {
        const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const unsupportedLog = createLog("legacy_provider");
        logRepository.findPendingRetries.mockResolvedValue([unsupportedLog]);

        await scheduler.retryFailedMessages();

        expect(smsRetryService.retry).not.toHaveBeenCalled();
        expect(alimtalkRetryService.retry).not.toHaveBeenCalled();
        expect(logRepository.update).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
            "[Retry] Unsupported message provider legacy_provider for log 78; skipping retry",
        );
        warnSpy.mockRestore();
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
});
