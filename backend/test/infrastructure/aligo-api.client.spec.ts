import { ConfigService } from "@nestjs/config";

import { AligoApiClient, DEFAULT_ALIGO_SENDER_PHONE } from "infrastructure/api/aligo-api.client";

describe("AligoApiClient SMS", () => {
    const createClient = (values: Record<string, string> = {}) => {
        const config = {
            get: jest.fn((key: string) => values[key]),
        };
        return {
            client: new AligoApiClient(config as unknown as ConfigService),
            config,
        };
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("sends SMS without Alimtalk-only environment variables", async () => {
        const { client } = createClient({
            ALIGO_API_KEY: "api-key",
            ALIGO_USER_ID: "user-id",
            ALIGO_SENDER_PHONE: "010-1111-2222",
        });
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
            new Response(JSON.stringify({
                result_code: "1",
                message: "success",
                msg_id: "123",
                success_cnt: "1",
                error_cnt: "0",
                msg_type: "SMS",
            }), { status: 200 }),
        );

        const result = await client.sendSms({
            receiver: "01033334444",
            message: "테스트",
        });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://apis.aligo.in/send/",
            expect.objectContaining({ method: "POST" }),
        );
        expect(result).toMatchObject({
            result_code: 1,
            msg_id: 123,
            success_cnt: 1,
            error_cnt: 0,
        });
    });

    it("uses the default sender phone when no override is configured", async () => {
        const { client } = createClient({
            ALIGO_API_KEY: "api-key",
            ALIGO_USER_ID: "user-id",
        });
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ result_code: 1, message: "success" }), { status: 200 }),
        );

        await client.sendSms({ receiver: "01033334444", message: "테스트" });

        const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
        expect(formData.get("sender")).toBe(DEFAULT_ALIGO_SENDER_PHONE.replace(/\D/g, ""));
    });

    it("rejects SMS when required SMS credentials are missing", async () => {
        const { client } = createClient();

        await expect(
            client.sendSms({ receiver: "01033334444", message: "테스트" }),
        ).rejects.toThrow("Aligo SMS integration is not configured.");
    });
});
