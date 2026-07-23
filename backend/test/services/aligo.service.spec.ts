import { AligoService } from "application/services/aligo.service";
import { SendAligoSmsUsecase } from "application/usecases/aligo";

describe("AligoService", () => {
    const createMockSendSmsUsecase = () => ({
        execute: jest.fn(),
    });

    let service: AligoService;
    let sendSmsUsecase: ReturnType<typeof createMockSendSmsUsecase>;

    beforeEach(() => {
        sendSmsUsecase = createMockSendSmsUsecase();
        service = new AligoService(sendSmsUsecase as unknown as SendAligoSmsUsecase);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("error handling", () => {
        it("should rethrow when sms API fails", async () => {
            sendSmsUsecase.execute.mockRejectedValue(new Error("API Error"));

            await expect(
                service.sendSms({
                    receiver: "01012345678",
                    message: "테스트",
                })
            ).rejects.toThrow("API Error");
        });
    });
});
