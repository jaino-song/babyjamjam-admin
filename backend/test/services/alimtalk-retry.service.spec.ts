import { AlimtalkRetryService } from "application/services/alimtalk-retry.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { IAligoApiPort } from "domain/ports/aligo-api.port";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";

describe("AlimtalkRetryService", () => {
    const createMockLogRepository = () => ({
        update: jest.fn(),
    });
    const createMockAligoApi = () => ({
        sendAlimtalk: jest.fn(),
    });
    const createAlimtalkRetryLog = (templateKey = "CLIENT_CREATED") =>
        MessageLogEntity.reconstitute(
            88,
            "branch-1",
            "aligo_alimtalk",
            templateKey,
            null,
            "01012345678",
            7,
            "알림톡 메시지",
            {},
            "failed",
            null,
            "temporary failure",
            1,
            new Date("2026-06-05T09:20:00.000Z"),
            new Date("2026-06-05T10:20:00.000Z"),
            new Date("2026-06-05T09:20:00.000Z"),
            new Date("2026-06-05T09:20:00.000Z"),
        );

    let service: AlimtalkRetryService;
    let logRepository: ReturnType<typeof createMockLogRepository>;
    let aligoApi: ReturnType<typeof createMockAligoApi>;

    beforeEach(() => {
        logRepository = createMockLogRepository();
        aligoApi = createMockAligoApi();
        service = new AlimtalkRetryService(
            logRepository as unknown as IMessageLogRepository,
            aligoApi as unknown as IAligoApiPort,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("retries failed alimtalk logs through the Aligo alimtalk API", async () => {
        const log = createAlimtalkRetryLog();
        aligoApi.sendAlimtalk.mockResolvedValue({ info: { mid: 321 } });

        await service.retry(log);

        expect(aligoApi.sendAlimtalk).toHaveBeenCalledWith({
            tplCode: expect.any(String),
            receiver: "01012345678",
            subject: "알림톡 - CLIENT_CREATED",
            message: "알림톡 메시지",
        });
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 88,
                status: "sent",
                aligoMid: "321",
                nextRetryAt: null,
            }),
        );
    });

    it("marks unknown alimtalk templates as failed", async () => {
        const log = createAlimtalkRetryLog("UNKNOWN_TEMPLATE");

        await service.retry(log);

        expect(aligoApi.sendAlimtalk).not.toHaveBeenCalled();
        expect(logRepository.update).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 88,
                status: "failed",
                errorMessage: "Unknown template: UNKNOWN_TEMPLATE",
            }),
        );
    });
});
