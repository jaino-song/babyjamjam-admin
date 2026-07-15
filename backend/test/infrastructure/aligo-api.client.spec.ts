import { ConfigService } from "@nestjs/config";
import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import { AligoCreateTemplateParams, AligoSendAlimtalkParams } from "domain/ports/aligo-api.port";

describe("AligoApiClient", () => {
    const createMockConfigService = (
        overrides: Record<string, string | undefined> = {}
    ): jest.Mocked<ConfigService> => {
        const config: Record<string, string | undefined> = {
            ALIGO_API_URL: "https://kakaoapi.aligo.in",
            ALIGO_SMS_API_URL: "https://apis.aligo.in",
            ALIGO_API_KEY: "test_api_key",
            ALIGO_USER_ID: "test_user_id",
            ALIGO_SENDER_KEY: "test_sender_key",
            ALIGO_SENDER_PHONE: "01012345678",
            ...overrides,
        };
        return {
            get: jest.fn((key: string) => config[key]),
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
            expect(configService.get).toHaveBeenCalledWith("ALIGO_API_URL");
            expect(configService.get).toHaveBeenCalledWith("ALIGO_SMS_API_URL");
            expect(configService.get).toHaveBeenCalledWith("ALIGO_API_KEY");
            expect(configService.get).toHaveBeenCalledWith("ALIGO_USER_ID");
            expect(configService.get).toHaveBeenCalledWith("ALIGO_SENDER_KEY");
            expect(configService.get).toHaveBeenCalledWith("ALIGO_SENDER_PHONE");
        });

        it("should disable integration and throw on use if required config is missing", async () => {
            const badConfig = createMockConfigService({ ALIGO_API_KEY: undefined });
            const disabledClient = new AligoApiClient(badConfig);

            await expect(
                disabledClient.sendSms({
                    receiver: "01011112222",
                    message: "테스트",
                }),
            ).rejects.toThrow("Aligo integration is not configured.");
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

            it("should include a timeout signal", async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ code: 0, message: "success" }),
                } as Response);

                await client.sendAlimtalk(createSendParams());

                const options = mockFetch.mock.calls[0][1] as RequestInit;
                expect(options.signal).toBeInstanceOf(AbortSignal);
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

    describe("sendSms", () => {
        it("should send sms to the official send endpoint", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    result_code: "1",
                    message: "success",
                    msg_id: "123",
                    success_cnt: "1",
                    error_cnt: "0",
                    msg_type: "LMS",
                }),
            } as Response);

            const result = await client.sendSms({
                receiver: "010-1111-2222",
                message: "장문 테스트 메시지",
                title: "안내",
                msgType: "LMS",
                destination: "01011112222|홍길동",
                scheduledDate: "20260309",
                scheduledTime: "2019",
                testModeYn: "Y",
            });

            expect(mockFetch).toHaveBeenCalledWith(
                "https://apis.aligo.in/send/",
                expect.objectContaining({
                    method: "POST",
                }),
            );

            const call = mockFetch.mock.calls[0];
            const body = call[1].body as FormData;

            expect(body.get("key")).toBe("test_api_key");
            expect(body.get("user_id")).toBe("test_user_id");
            expect(body.get("sender")).toBe("01012345678");
            expect(body.get("receiver")).toBe("010-1111-2222");
            expect(body.get("msg")).toBe("장문 테스트 메시지");
            expect(body.get("title")).toBe("안내");
            expect(body.get("msg_type")).toBe("LMS");
            expect(body.get("destination")).toBe("01011112222|홍길동");
            expect(body.get("rdate")).toBe("20260309");
            expect(body.get("rtime")).toBe("2019");
            expect(body.get("testmode_yn")).toBe("Y");
            expect(result).toEqual({
                result_code: 1,
                message: "success",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "LMS",
            });
        });

        it("should include a timeout signal", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ result_code: "1", message: "success" }),
            } as Response);

            await client.sendSms({
                receiver: "01011112222",
                message: "테스트",
            });

            const options = mockFetch.mock.calls[0][1] as RequestInit;
            expect(options.signal).toBeInstanceOf(AbortSignal);
        });

        it("should throw when sms request returns a non-ok response", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 502,
                text: () => Promise.resolve("Bad Gateway"),
            } as Response);

            await expect(
                client.sendSms({
                    receiver: "01011112222",
                    message: "테스트",
                }),
            ).rejects.toThrow("Aligo SMS API error (502): Bad Gateway");
        });

        it("defaults the sender to 010-9641-1878 (digits) when ALIGO_SENDER_PHONE is unset", async () => {
            const defaultClient = new AligoApiClient(
                createMockConfigService({ ALIGO_SENDER_PHONE: undefined }),
            );
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ result_code: "1", message: "success" }),
            } as Response);

            await defaultClient.sendSms({
                receiver: "01011112222",
                message: "테스트",
            });

            const body = mockFetch.mock.calls[0][1].body as FormData;
            expect(body.get("sender")).toBe("01096411878");
        });
    });

    describe("createTemplate", () => {
        const createTemplateParams = (overrides = {}): AligoCreateTemplateParams => ({
            templateName: "고객 등록 안내",
            templateContent: "#{고객명}님, 안녕하세요.",
            templateType: "BA",
            emphasisType: "NONE",
            ...overrides,
        });

        it("should send template request to correct endpoint", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ code: 0, message: "success" }),
            } as Response);

            await client.createTemplate(createTemplateParams());

            expect(mockFetch).toHaveBeenCalledWith(
                "https://kakaoapi.aligo.in/akv10/template/add/",
                expect.objectContaining({
                    method: "POST",
                })
            );
        });

        it("should include required template form data", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ code: 0, message: "success" }),
            } as Response);

            await client.createTemplate(createTemplateParams());

            const call = mockFetch.mock.calls[0];
            const body = call[1].body as FormData;

            expect(body.get("apikey")).toBe("test_api_key");
            expect(body.get("userid")).toBe("test_user_id");
            expect(body.get("senderkey")).toBe("test_sender_key");
            expect(body.get("tpl_name")).toBe("고객 등록 안내");
            expect(body.get("tpl_content")).toBe("#{고객명}님, 안녕하세요.");
            expect(body.get("tpl_type")).toBe("BA");
            expect(body.get("tpl_emtype")).toBe("NONE");
        });

        it("should include button payload when provided", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ code: 0, message: "success" }),
            } as Response);

            await client.createTemplate(
                createTemplateParams({
                    buttons: [{ name: "확인", linkType: "WL", linkM: "https://example.com" }],
                })
            );

            const call = mockFetch.mock.calls[0];
            const body = call[1].body as FormData;
            expect(body.get("tpl_button")).toBe(
                JSON.stringify({
                    button: [{ name: "확인", linkType: "WL", linkM: "https://example.com" }],
                })
            );
        });

        it("should include optional template fields when provided", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ code: 0, message: "success" }),
            } as Response);

            await client.createTemplate(
                createTemplateParams({
                    templateType: "MI",
                    emphasisType: "IMAGE",
                    title: "주문 완료",
                    subtitle: "확인해 주세요",
                    extra: "추가 정보",
                    advert: "수신거부: 고객센터",
                    image: {
                        buffer: Buffer.from("image"),
                        filename: "template.png",
                        mimeType: "image/png",
                    },
                })
            );

            const call = mockFetch.mock.calls[0];
            const body = call[1].body as FormData;
            const image = body.get("image");

            expect(body.get("tpl_type")).toBe("MI");
            expect(body.get("tpl_emtype")).toBe("IMAGE");
            expect(body.get("tpl_title")).toBe("주문 완료");
            expect(body.get("tpl_stitle")).toBe("확인해 주세요");
            expect(body.get("tpl_extra")).toBe("추가 정보");
            expect(body.get("tpl_advert")).toBe("수신거부: 고객센터");
            expect(image).toBeInstanceOf(File);
            expect((image as File).name).toBe("template.png");
            expect((image as File).type).toBe("image/png");
        });
    });
});
