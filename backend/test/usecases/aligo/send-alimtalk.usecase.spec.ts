import { SendAligoAlimtalkUsecase } from "application/usecases/aligo/send-alimtalk.usecase";
import { IAligoApiPort } from "domain/ports/aligo-api.port";

describe("SendAligoAlimtalkUsecase", () => {
    const createMockAligoApi = (): jest.Mocked<IAligoApiPort> => ({
        sendAlimtalk: jest.fn(),
    });

    let usecase: SendAligoAlimtalkUsecase;
    let aligoApi: jest.Mocked<IAligoApiPort>;

    beforeEach(() => {
        aligoApi = createMockAligoApi();
        usecase = new SendAligoAlimtalkUsecase(aligoApi);
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
            });

            it("should include button when buttonUrl is provided", async () => {
                aligoApi.sendAlimtalk.mockResolvedValue({
                    code: 0,
                    message: "success",
                });

                await usecase.execute({
                    templateKey: "SURVEY_REQUEST",
                    receiver: "01012345678",
                    variables: {
                        고객명: "홍길동",
                        서비스종료일: "2025-01-14",
                        담당자명: "김담당",
                        설문링크: "https://example.com/survey",
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
    });
});
