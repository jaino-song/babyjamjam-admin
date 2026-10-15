import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";

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

    it.each(["list", "sms_list"] as const)("posts %s with existing credentials and a ten second signal", async endpoint => {
        const { client } = createClient({ ALIGO_API_KEY: "synthetic-key", ALIGO_USER_ID: "synthetic-user" });
        const timeout = jest.spyOn(AbortSignal, "timeout");
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ result_code: 1, message: "ok", list: [], next_yn: "N" })));
        if (endpoint === "list") await client.listHistory({ page: 1, page_size: 500, start_date: "20261012", limit_day: 1 });
        else await client.listSmsHistory({ mid: "123", page: 1, page_size: 500 });
        expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://apis.aligo.in/${endpoint}/`);
        const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
        expect(form.get("key")).toBe("synthetic-key"); expect(form.get("user_id")).toBe("synthetic-user");
        expect(timeout).toHaveBeenCalledWith(10_000);
    });

    it.each(["not JSON", "{}", JSON.stringify({ result_code: -1, message: "failure" }), JSON.stringify({ result_code: 1, message: "ok", list: [], next_yn: "bad" })])("rejects malformed/failed history (%s)", async body => {
        const { client } = createClient({ ALIGO_API_KEY: "synthetic-key", ALIGO_USER_ID: "synthetic-user" });
        jest.spyOn(global, "fetch").mockResolvedValue(new Response(body));
        await expect(client.listHistory({ page: 1, page_size: 500, start_date: "20261012", limit_day: 1 })).rejects.toThrow();
    });

    it("does not log response bodies or credentials on history HTTP failure", async () => {
        const { client } = createClient({ ALIGO_API_KEY: "synthetic-key", ALIGO_USER_ID: "synthetic-user" });
        const error = jest.spyOn(Logger.prototype, "error");
        jest.spyOn(global, "fetch").mockResolvedValue(new Response("private body", { status: 500 }));
        await expect(client.listSmsHistory({ mid: "123", page: 1, page_size: 500 })).rejects.toThrow("Aligo history HTTP failure");
        expect(error).not.toHaveBeenCalled();
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

    it("logs the plain receiver number when sending an SMS", async () => {
        const debugSpy = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
        const { client } = createClient({
            ALIGO_API_KEY: "api-key",
            ALIGO_USER_ID: "user-id",
        });
        jest.spyOn(global, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ result_code: 1, message: "success" }), { status: 200 }),
        );

        await client.sendSms({ receiver: "01033334444", message: "테스트" });

        expect(debugSpy).toHaveBeenCalledWith("[Aligo] Sending sms to 01033334444");
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

    describe("getSmsDeliveryDetails", () => {
        const credentials = { ALIGO_API_KEY: "api-key", ALIGO_USER_ID: "user-id" };
        const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

        it("posts mid/page/page_size to /sms_list/ and normalizes rows", async () => {
            const { client } = createClient(credentials);
            const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(jsonResponse({
                result_code: "1",
                message: "success",
                next_yn: "N",
                list: [
                    { mdid: 987, receiver: "010-1111-2222", sms_state: " 발송완료 ", send_date: "2026-10-14 10:00:00" },
                    { receiver: 1033334444, sms_state: null },
                ],
            }));

            const result = await client.getSmsDeliveryDetails("987");

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0]?.[0]).toBe("https://apis.aligo.in/sms_list/");
            const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
            expect(formData.get("key")).toBe("api-key");
            expect(formData.get("user_id")).toBe("user-id");
            expect(formData.get("mid")).toBe("987");
            expect(formData.get("page")).toBe("1");
            expect(formData.get("page_size")).toBe("500");
            expect(result).toEqual({
                resultCode: 1,
                message: "success",
                rows: [
                    { mdid: "987", receiver: "01011112222", smsState: "발송완료", sendDate: "2026-10-14 10:00:00" },
                    { mdid: null, receiver: "1033334444", smsState: "", sendDate: null },
                ],
            });
        });

        it("follows next_yn across pages and concatenates rows", async () => {
            const { client } = createClient(credentials);
            const fetchMock = jest.spyOn(global, "fetch")
                .mockResolvedValueOnce(jsonResponse({ result_code: 1, message: "ok", next_yn: "Y", list: [{ receiver: "01011112222", sms_state: "발송완료" }] }))
                .mockResolvedValueOnce(jsonResponse({ result_code: 1, message: "ok", next_yn: "N", list: [{ receiver: "01033334444", sms_state: "결번" }] }));

            const result = await client.getSmsDeliveryDetails("1");

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect((fetchMock.mock.calls[1]?.[1]?.body as FormData).get("page")).toBe("2");
            expect(result.rows.map((r) => r.receiver)).toEqual(["01011112222", "01033334444"]);
        });

        it("caps paging at 20 pages", async () => {
            const { client } = createClient(credentials);
            const fetchMock = jest.spyOn(global, "fetch").mockImplementation(() =>
                Promise.resolve(jsonResponse({ result_code: 1, message: "ok", next_yn: "Y", list: [{ receiver: "01011112222", sms_state: "발송완료" }] })),
            );

            const result = await client.getSmsDeliveryDetails("1");

            expect(fetchMock).toHaveBeenCalledTimes(20);
            expect(result.rows).toHaveLength(20);
        });

        it("returns a non-1 result_code without throwing and stops paging", async () => {
            const { client } = createClient(credentials);
            const fetchMock = jest.spyOn(global, "fetch")
                .mockResolvedValueOnce(jsonResponse({ result_code: 1, message: "ok", next_yn: "Y", list: [{ receiver: "01011112222", sms_state: "발송완료" }] }))
                .mockResolvedValueOnce(jsonResponse({ result_code: -101, message: "인증오류" }));

            const result = await client.getSmsDeliveryDetails("1");

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(result).toEqual({ resultCode: -101, message: "인증오류", rows: [] });
        });

        it("throws on HTTP non-OK responses", async () => {
            const { client } = createClient(credentials);
            jest.spyOn(global, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));

            await expect(client.getSmsDeliveryDetails("1")).rejects.toThrow("Aligo SMS list API error (500): boom");
        });

        it("rejects when credentials are missing", async () => {
            const { client } = createClient();
            const fetchMock = jest.spyOn(global, "fetch");

            await expect(client.getSmsDeliveryDetails("1")).rejects.toThrow("Aligo SMS integration is not configured.");
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });
});
