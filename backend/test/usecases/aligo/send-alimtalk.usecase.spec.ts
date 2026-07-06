import { SendAligoAlimtalkUsecase } from "application/usecases/aligo/send-alimtalk.usecase";
import { IAligoApiPort } from "domain/ports/aligo-api.port";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { MessageLogEntity } from "domain/entities/message-log.entity";

describe("SendAligoAlimtalkUsecase", () => {
    const createMockAligoApi = (): jest.Mocked<IAligoApiPort> => ({
        sendAlimtalk: jest.fn(),
        createTemplate: jest.fn(),
        listTemplates: jest.fn(),
    });

    const createMockLogRepository = (): jest.Mocked<IMessageLogRepository> => ({
        save: jest.fn().mockImplementation((log: MessageLogEntity) => {
            // Return a real entity instance so methods like markSent/markFailed work
            return Promise.resolve(MessageLogEntity.reconstitute(
                1,
                log.branchId,
                log.provider,
                log.templateKey,
                log.triggerJobId,
                log.receiver,
                log.clientId,
                log.messageBody,
                log.variables,
                log.status,
                log.aligoMid,
                log.errorMessage,
                log.attempts,
                log.lastAttemptAt,
                log.nextRetryAt,
                log.createdAt,
                log.updatedAt,
            ));
        }),
        update: jest.fn().mockResolvedValue(undefined),
        findPendingRetries: jest.fn().mockResolvedValue([]),
        findRecentByBranch: jest.fn().mockResolvedValue([]),
    });

    let usecase: SendAligoAlimtalkUsecase;
    let aligoApi: jest.Mocked<IAligoApiPort>;
    let logRepository: jest.Mocked<IMessageLogRepository>;

    beforeEach(() => {
        aligoApi = createMockAligoApi();
        logRepository = createMockLogRepository();
        usecase = new SendAligoAlimtalkUsecase(aligoApi, logRepository);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("execute", () => {
        describe("given valid dto", () => {
            it("should send alimtalk with built message", async () => {
                aligoApi.sendAlimtalk.mockResolvedValue({
                    code: 0,
                    message: "success",
                });

                const result = await usecase.execute({
                    templateKey: "CLIENT_CREATED",
                    receiver: "01012345678",
                    variables: {
                        고객명: "홍길동",
                        등록일: "2025-01-14",
                        서비스타입: "방문요양",
                    },
                });

                expect(aligoApi.sendAlimtalk).toHaveBeenCalledWith(
                    expect.objectContaining({
                        receiver: "01012345678",
                        message: expect.stringContaining("홍길동"),
                    })
                );
                expect(result.code).toBe(0);
                expect(logRepository.save).toHaveBeenCalledTimes(1);
                expect(logRepository.save).toHaveBeenCalledWith(
                    expect.objectContaining({ provider: "aligo_alimtalk" }),
                );
                expect(logRepository.update).toHaveBeenCalledTimes(1);
            });

            it("should include button when buttonUrl is provided", async () => {
                aligoApi.sendAlimtalk.mockResolvedValue({
                    code: 0,
                    message: "success",
                });

                await usecase.execute({
                    templateKey: "CLIENT_CREATED",
                    receiver: "01012345678",
                    variables: {
                        고객명: "홍길동",
                        등록일: "2025-01-14",
                        서비스타입: "방문요양",
                    },
                    buttonUrl: "https://example.com/survey",
                });

                expect(aligoApi.sendAlimtalk).toHaveBeenCalledWith(
                    expect.objectContaining({
                        buttonJson: expect.stringContaining("https://example.com/survey"),
                    })
                );
            });
        });

        describe("given API failure", () => {
            it("should return error response without throwing", async () => {
                aligoApi.sendAlimtalk.mockResolvedValue({
                    code: -101,
                    message: "인증 실패",
                });

                const result = await usecase.execute({
                    templateKey: "CLIENT_CREATED",
                    receiver: "01012345678",
                    variables: { 고객명: "test", 등록일: "2025-01-14", 서비스타입: "test" },
                });

                expect(result.code).toBe(-101);
            });
        });

        describe("given API throws", () => {
            it("should log failure and rethrow", async () => {
                aligoApi.sendAlimtalk.mockRejectedValue(new Error("Network error"));

                await expect(
                    usecase.execute({
                        templateKey: "CLIENT_CREATED",
                        receiver: "01012345678",
                        variables: { 고객명: "test", 등록일: "2025-01-14", 서비스타입: "test" },
                    })
                ).rejects.toThrow("Network error");

                expect(logRepository.update).toHaveBeenCalledTimes(1);
            });
        });
    });
});
