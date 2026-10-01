/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getHolidays } from "../holidays/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("service-record holidays route", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("forwards the access cookie as a Bearer token and the year to the token endpoint", async () => {
        const payload = { year: 2026, revision: 2, supported: true, holidays: [{ date: "2026-08-12", name: "지점 휴무" }] };
        mockGet.mockResolvedValue({ status: 200, data: payload });
        const request = new NextRequest("http://localhost/api/service-record/link-token/holidays?year=2026", {
            headers: { cookie: "service_record_access=persisted-access-token" },
        });

        const response = await getHolidays(request);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(payload);
        expect(response.headers.get("cache-control")).toEqual(expect.stringContaining("no-store"));
        expect(mockGet).toHaveBeenCalledWith("/service-record/holidays", {
            headers: { Authorization: "Bearer persisted-access-token" },
            params: { year: "2026" },
        });
    });

    it("passes the backend rejection through instead of inventing a calendar", async () => {
        mockGet.mockRejectedValue({
            isAxiosError: true,
            response: { status: 401, data: { message: "Unauthorized" } },
        });
        const request = new NextRequest("http://localhost/api/service-record/link-token/holidays?year=2026");

        const response = await getHolidays(request);

        expect(response.status).toBe(401);
    });
});
