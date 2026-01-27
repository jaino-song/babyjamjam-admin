import { ConfigService } from "@nestjs/config";
import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import { AligoSendAlimtalkParams } from "domain/ports/aligo-api.port";

describe("AligoApiClient", () => {
    const createMockConfigService = (overrides = {}): jest.Mocked<ConfigService> => {
        const config: Record<string, string> = {
            ALIGO_API_URL: "https://kakaoapi.aligo.in",
            ALIGO_API_KEY: "test_api_key",
            ALIGO_USER_ID: "test_user_id",
            ALIGO_SENDER_KEY: "test_sender_key",
            ALIGO_SENDER_PHONE: "01012345678",
            ...overrides,
        };
        return {
            getOrThrow: jest.fn((key: string) => {
                if (config[key] === undefined) {
                    throw new Error(`Config ${key} not found`);
                }
                return config[key];
            }),
        } as unknown as jest.Mocked<ConfigService>;
    };

    let client: AligoApiClient;
    let configService: jest.Mocked<ConfigService>;
    let mockFetch: jest.SpyInstance;

    beforeEach(() => {
        configService = createMockConfigService();
        client = new AligoApiClient(configService);
        mockFetch = jest.spyOn(global, "fetch");
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("constructor", () => {
        it("should load all required config values", () => {
            expect(configService.getOrThrow).toHaveBeenCalledWith("ALIGO_API_URL");
            expect(configService.getOrThrow).toHaveBeenCalledWith("ALIGO_API_KEY");
            expect(configService.getOrThrow).toHaveBeenCalledWith("ALIGO_USER_ID");
            expect(configService.getOrThrow).toHaveBeenCalledWith("ALIGO_SENDER_KEY");
            expect(configService.getOrThrow).toHaveBeenCalledWith("ALIGO_SENDER_PHONE");
        });

        it("should throw if required config is missing", () => {
            const badConfig = createMockConfigService();
            badConfig.getOrThrow.mockImplementation((key: string) => {
                if (key === "ALIGO_API_KEY") throw new Error("Config not found");
                return "value";
            });

            expect(() => new AligoApiClient(badConfig)).toThrow("Config not found");
        });
    });

    describe("sendAlimtalk", () => {
        const createSendParams = (overrides = {}): AligoSendAlimtalkParams => ({
            tplCode: "TPL_TEST",
            receiver: "01098765432",
            subject: "Test Subject",
            message: "Test Message",
            ...overrides,
        });

        describe("given successful API response", () => {
            it("should send alimtalk and return response", async () => {
                const mockResponse = {
                    code: 0,
                    message: "성공적으로 전송요청 하였습니다.",
                    info: {
                        type: "AT",
                        mid: 123456789,
                        current: "2025-01-14 01:50:00",
                        unit: 1,
                        total: 1,
                        scnt: 1,
                        fcnt: 0,
                    },
                };

                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                } as Response);

                const params = createSendParams();
                const result = await client.sendAlimtalk(params);

                expect(result.code).toBe(0);
                expect(result.message).toBe("성공적으로 전송요청 하였습니다.");
                expect(result.info?.scnt).toBe(1);
            });

            it("should send request to correct endpoint", async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ code: 0, message: "success" }),
                } as Response);

                await client.sendAlimtalk(createSendParams());

                expect(mockFetch).toHaveBeenCalledWith(
                    "https://kakaoapi.aligo.in/akv10/alimtalk/send/",
                    expect.objectContaining({
                        method: "POST",
                    })
                );
            });

            it("should include all required form data", async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ code: 0, message: "success" }),
                } as Response);

                const params = createSendParams({
                    tplCode: "TPL_CLIENT_CREATED",
                    receiver: "01011112222",
                    message: "Hello World",
                });

                await client.sendAlimtalk(params);

                const call = mockFetch.mock.calls[0];
                const body = call[1].body as FormData;

                expect(body.get("apikey")).toBe("test_api_key");
                expect(body.get("userid")).toBe("test_user_id");
                expect(body.get("senderkey")).toBe("test_sender_key");
                expect(body.get("sender")).toBe("01012345678");
                expect(body.get("tpl_code")).toBe("TPL_CLIENT_CREATED");
                expect(body.get("receiver_1")).toBe("01011112222");
                expect(body.get("message_1")).toBe("Hello World");
            });
        });

        describe("given API error response", () => {
            it("should throw error when HTTP request fails", async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: false,
                    status: 500,
                    text: () => Promise.resolve("Internal Server Error"),
                } as Response);

                await expect(client.sendAlimtalk(createSendParams())).rejects.toThrow(
                    "Aligo API error (500)"
                );
            });

            it("should return error response when code is non-zero", async () => {
                const errorResponse = {
                    code: -101,
                    message: "인증에 실패하였습니다.",
                };

                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve(errorResponse),
                } as Response);

                const result = await client.sendAlimtalk(createSendParams());

                expect(result.code).toBe(-101);
                expect(result.message).toBe("인증에 실패하였습니다.");
            });
        });

        describe("given optional parameters", () => {
            it("should include button JSON when provided", async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ code: 0, message: "success" }),
                } as Response);

                const buttonJson = JSON.stringify({
                    button: [{ name: "확인", linkType: "WL", linkM: "https://example.com" }],
                });

                await client.sendAlimtalk(
                    createSendParams({
                        buttonJson,
                    })
                );

                const call = mockFetch.mock.calls[0];
                const body = call[1].body as FormData;
                expect(body.get("button_1")).toBe(buttonJson);
            });

            it("should include failover settings when provided", async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ code: 0, message: "success" }),
                } as Response);

                await client.sendAlimtalk(
                    createSendParams({
                        failoverYn: "Y",
                        failoverSubject: "SMS Subject",
                        failoverMessage: "SMS Fallback Message",
                    })
                );

                const call = mockFetch.mock.calls[0];
                const body = call[1].body as FormData;
                expect(body.get("failover")).toBe("Y");
                expect(body.get("fsubject_1")).toBe("SMS Subject");
                expect(body.get("fmessage_1")).toBe("SMS Fallback Message");
            });
        });
    });
});
