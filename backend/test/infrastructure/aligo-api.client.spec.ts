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

    it("reads the actual normalized default sender and endpoint as an opaque policy without calling the provider", () => {
        const values = { ALIGO_API_KEY: "synthetic-key", ALIGO_USER_ID: "synthetic-user", ALIGO_SENDER_PHONE: "010-0000-0031" };
        const fetchMock = jest.spyOn(global, "fetch");
        const first = createClient(values).client.getDefaultSenderPolicy();
        expect(first).toMatchObject({ availability: "available", provider: "aligo", mode: "live", identityDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
        expect(createClient({ ...values, ALIGO_SENDER_PHONE: "01000000031" }).client.getDefaultSenderPolicy()).toEqual(first);
        expect(createClient({ ...values, ALIGO_SENDER_PHONE: "01000000032" }).client.getDefaultSenderPolicy()).not.toEqual(first);
        expect(createClient({ ...values, ALIGO_SMS_API_URL: "https://synthetic-provider.invalid" }).client.getDefaultSenderPolicy()).not.toEqual(first);
        // Credential rotation is not exposed or copied into a persisted consent digest.
        expect(createClient({ ...values, ALIGO_API_KEY: "rotated-synthetic-key" }).client.getDefaultSenderPolicy()).toEqual(first);
        expect(createClient({ ALIGO_USER_ID: "synthetic-user" }).client.getDefaultSenderPolicy()).toEqual({ availability: "unavailable" });
        for (const raw of [...Object.values(values), "01000000031", "https://apis.aligo.in"]) expect(JSON.stringify(first)).not.toContain(raw);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
