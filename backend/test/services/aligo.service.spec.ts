import { Logger } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { SendAligoSmsUsecase } from "application/usecases/aligo";
import { ConfigService } from "@nestjs/config";
import { AligoApiClient } from "infrastructure/api/aligo-api.client";

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
        jest.restoreAllMocks();
    });

    describe("error handling", () => {
        it.each(["HTTP rejection", "transport throws"])("keeps confidential receipt details out of service errors and logs when %s", async failure => {
            const receiver = "01000005432";
            const url = "https://receipt.invalid/receipt/efr_synthetic_bearer";
            const reflected = "synthetic provider-reflected text";
            const privateText = [receiver, url, reflected].join(" ");
            const transport = jest.spyOn(global, "fetch");
            if (failure === "HTTP rejection") {
                transport.mockResolvedValue(new Response(privateText, { status: 503 }));
            } else {
                transport.mockRejectedValue(new Error(privateText));
            }
            const logs = [
                jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined),
                jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined),
                jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined),
                jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined),
            ];
            const client = new AligoApiClient(new ConfigService({
                ALIGO_SMS_API_URL: "https://provider.invalid", ALIGO_API_KEY: "fake-key",
                ALIGO_USER_ID: "fake-user", ALIGO_SENDER_PHONE: "01000005431",
            }));
            const adapter = new AligoService(new SendAligoSmsUsecase(client));
            const error: Error & { cause?: unknown } = await adapter.sendSms({ receiver, message: url, confidential: true })
                .then(() => { throw new Error("Expected the synthetic provider to fail"); }, reason => reason);
            expect(error.message).toBe("Confidential SMS delivery failed");
            const diagnostic = JSON.stringify([error.stack, error.cause, ...logs.map(log => log.mock.calls)]);
            for (const sentinel of [receiver, url, reflected]) expect(diagnostic).not.toContain(sentinel);
            expect(transport).toHaveBeenCalledTimes(1);
            const body = transport.mock.calls[0]?.[1]?.body as FormData;
            expect([body.get("receiver"), body.get("msg")]).toEqual([receiver, url]);
        });

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
