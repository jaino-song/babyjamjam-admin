import { Logger } from "@nestjs/common";
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

        it("logs the plain receiver number when sms API fails", async () => {
            const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
            sendSmsUsecase.execute.mockRejectedValue(new Error("API Error"));

            await expect(
                service.sendSms({ receiver: "01012345678", message: "테스트" })
            ).rejects.toThrow("API Error");

            expect(errorSpy).toHaveBeenCalledWith(
                "[Aligo] Failed to send sms to 01012345678",
                expect.any(String),
            );
            errorSpy.mockRestore();
        });
    });
});
