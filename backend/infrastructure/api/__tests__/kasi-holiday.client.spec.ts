import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KasiHolidayClient, KasiHolidayError } from "../kasi-holiday.client";

const SECRET = "SECRET+KEY/with==chars";

function makeClient(key: string | undefined = SECRET) {
    const config = { get: jest.fn((name: string) => (name === "DATA_GO_KR_SERVICE_KEY" ? key : undefined)) };
    return new KasiHolidayClient(config as unknown as ConfigService);
}

type Item = { locdate: number | string; dateName: string; isHoliday: string };

function kasiBody(items: Item[] | Item | "", totalCount: number | string, resultCode = "00") {
    return {
        response: {
            header: { resultCode, resultMsg: "NORMAL SERVICE." },
            body: {
                items: items === "" ? "" : { item: items },
                numOfRows: 100,
                pageNo: 1,
                totalCount,
            },
        },
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("KasiHolidayClient", () => {
    let fetchSpy: jest.SpiedFunction<typeof fetch>;

    beforeEach(() => {
        fetchSpy = jest.spyOn(globalThis, "fetch");
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        fetchSpy.mockRestore();
        jest.restoreAllMocks();
    });

    /** Respond per requested month; months without an entry are empty. */
    function respondByMonth(byMonth: Record<string, unknown>) {
        fetchSpy.mockImplementation(async (input) => {
            const url = new URL(String(input));
            const month = url.searchParams.get("solMonth") ?? "";
            return jsonResponse(byMonth[month] ?? kasiBody("", 0));
        });
    }

    it("parses array, single-object and empty items across all 12 months and keeps only isHoliday=Y", async () => {
        respondByMonth({
            "01": kasiBody({ locdate: 20260101, dateName: "1월1일", isHoliday: "Y" }, 1),
            "02": kasiBody([
                { locdate: 20260216, dateName: "설날 연휴", isHoliday: "Y" },
                { locdate: 20260217, dateName: "설날", isHoliday: "Y" },
                { locdate: 20260218, dateName: "설날 연휴", isHoliday: "Y" },
            ], 3),
            "04": kasiBody([
                { locdate: 20260405, dateName: "식목일", isHoliday: "N" },
                { locdate: 20260410, dateName: "선거일", isHoliday: "Y" },
            ], 2),
        });

        const result = await makeClient().fetchYear(2026);

        expect(fetchSpy).toHaveBeenCalledTimes(12);
        expect(result.year).toBe(2026);
        expect(result.rawCount).toBe(6);
        expect(result.items).toEqual([
            { date: "2026-01-01", name: "1월1일" },
            { date: "2026-02-16", name: "설날 연휴" },
            { date: "2026-02-17", name: "설날" },
            { date: "2026-02-18", name: "설날 연휴" },
            { date: "2026-04-10", name: "선거일" },
        ]);
    });

    it("requests every month with two-digit month, the documented params and an encoded key", async () => {
        respondByMonth({});
        await makeClient().fetchYear(2026);

        const urls = fetchSpy.mock.calls.map(([input]) => new URL(String(input)));
        expect(urls.map((u) => u.searchParams.get("solMonth")).sort()).toEqual(
            ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"],
        );
        for (const url of urls) {
            expect(url.origin + url.pathname).toBe(
                "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo",
            );
            expect(url.searchParams.get("solYear")).toBe("2026");
            expect(url.searchParams.get("numOfRows")).toBe("100");
            expect(url.searchParams.get("pageNo")).toBe("1");
            expect(url.searchParams.get("_type")).toBe("json");
            // Decoding key goes through URLSearchParams, so it is encoded exactly once.
            expect(url.searchParams.get("serviceKey")).toBe(SECRET);
        }
    });

    it("coerces string totalCount and locdate with Number()", async () => {
        respondByMonth({
            "03": kasiBody({ locdate: "20260301", dateName: "삼일절", isHoliday: "Y" }, "1"),
        });
        const result = await makeClient().fetchYear(2026);
        expect(result.items).toEqual([{ date: "2026-03-01", name: "삼일절" }]);
        expect(result.rawCount).toBe(1);
    });

    it("reports rawCount 0 when every month is empty (not published)", async () => {
        respondByMonth({});
        await expect(makeClient().fetchYear(2027)).resolves.toEqual({ year: 2027, items: [], rawCount: 0 });
    });

    it("throws not_configured without calling fetch when the key is missing", async () => {
        await expect(makeClient("").fetchYear(2026)).rejects.toMatchObject({ reason: "not_configured" });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a non-00 resultCode", async () => {
        respondByMonth({ "05": kasiBody("", 0, "30") });
        await expect(makeClient().fetchYear(2026)).rejects.toMatchObject({ reason: "result_code", month: 5 });
    });

    it("rejects when item count differs from totalCount", async () => {
        respondByMonth({
            "08": kasiBody({ locdate: 20260815, dateName: "광복절", isHoliday: "Y" }, 2),
        });
        await expect(makeClient().fetchYear(2026)).rejects.toMatchObject({ reason: "count_mismatch", month: 8 });
    });

    it("rejects a non-200 status", async () => {
        fetchSpy.mockResolvedValue(new Response("nope", { status: 503 }));
        await expect(makeClient().fetchYear(2026)).rejects.toMatchObject({ reason: "http_error", httpStatus: 503 });
    });

    it("classifies an XML gateway error returned with HTTP 200 as upstream_invalid without leaking the body", async () => {
        const xml = `<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR ${SECRET}</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>`;
        fetchSpy.mockResolvedValue(new Response(xml, { status: 200, headers: { "content-type": "text/xml" } }));

        const error = await makeClient().fetchYear(2026).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(KasiHolidayError);
        expect((error as KasiHolidayError).reason).toBe("upstream_invalid");
        expect((error as Error).message).not.toContain("SERVICE_KEY");
        expect((error as Error).message).not.toContain(SECRET);
    });

    it("rejects a locdate outside the requested month/year as upstream_invalid", async () => {
        respondByMonth({
            "03": kasiBody({ locdate: 20270301, dateName: "삼일절", isHoliday: "Y" }, 1),
        });
        await expect(makeClient().fetchYear(2026)).rejects.toMatchObject({ reason: "upstream_invalid", month: 3 });
    });

    it("rejects a malformed envelope as upstream_invalid", async () => {
        fetchSpy.mockResolvedValue(jsonResponse({ unexpected: true }));
        await expect(makeClient().fetchYear(2026)).rejects.toMatchObject({ reason: "upstream_invalid" });
    });

    it("maps a timeout and a network failure to short reasons without the URL or key", async () => {
        fetchSpy.mockRejectedValue(Object.assign(new Error(`timed out calling serviceKey=${SECRET}`), { name: "TimeoutError" }));
        const timeout = (await makeClient().fetchYear(2026).catch((e: unknown) => e)) as KasiHolidayError;
        expect(timeout.reason).toBe("timeout");
        expect(timeout.message).not.toContain(SECRET);

        fetchSpy.mockRejectedValue(new TypeError(`fetch failed https://apis.data.go.kr/?serviceKey=${SECRET}`));
        const network = (await makeClient().fetchYear(2026).catch((e: unknown) => e)) as KasiHolidayError;
        expect(network.reason).toBe("network");
        expect(network.message).not.toContain(SECRET);
    });

    it("keeps at most 3 month requests in flight", async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        fetchSpy.mockImplementation(async () => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 2));
            inFlight -= 1;
            return jsonResponse(kasiBody("", 0));
        });
        await makeClient().fetchYear(2026);
        expect(maxInFlight).toBeLessThanOrEqual(3);
    });
});
