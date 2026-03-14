import { AlimtalkRetrySchedulerService } from "application/services/alimtalk-retry-scheduler.service";
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

    let scheduler: AlimtalkRetrySchedulerService;
    let logRepository: ReturnType<typeof createMockLogRepository>;
    let aligoApi: ReturnType<typeof createMockAligoApi>;
    let nowSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
        logRepository = createMockLogRepository();
        aligoApi = createMockAligoApi();
        scheduler = new AlimtalkRetrySchedulerService(
            logRepository as unknown as IAlimtalkLogRepository,
            aligoApi as unknown as IAligoApiPort,
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
});
