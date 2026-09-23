/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

import { GET as fetchByType } from "../type/route";
import { GET as fetchYears } from "../years/route";

const mockGet = serverAPIClient.get as jest.Mock;

function request(path: string, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        headers: authenticated ? { cookie: "auth_token=auth-token" } : {},
    });
}

describe("voucher-price-infos reads BFF problem conversion (BJJ-319 6h2)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("returns an AUTH_REQUIRED problem for the type listing without a token", async () => {
        const response = await fetchByType(request("/api/voucher-price-infos/type", false));

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
        }));
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("returns an AUTH_REQUIRED problem for the years listing without a token", async () => {
        const response = await fetchYears(request("/api/voucher-price-infos/years", false));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            outcome: "NOT_APPLIED",
        }));
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("keeps the years success passthrough", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { years: [2026] } });

        const response = await fetchYears(request("/api/voucher-price-infos/years"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ years: [2026] });
    });
});
