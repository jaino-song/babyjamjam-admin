/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

function createRequest(phone: string | null, authenticated = true): NextRequest {
    const url = phone === null
        ? "http://localhost/api/clients/check-phone"
        : `http://localhost/api/clients/check-phone?phone=${encodeURIComponent(phone)}`;
    return new NextRequest(url, {
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    });
}

describe("GET /api/clients/check-phone", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated lookup with a registered 401 problem body", async () => {
        const response = await GET(createRequest("01012345678", false));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("treats a missing or malformed number as not-registered without calling upstream", async () => {
        for (const phone of [null, "010-1234", "not-a-number"]) {
            const response = await GET(createRequest(phone));

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ exists: false });
        }
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards an 11-digit lookup and reports the upstream verdict", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { exists: true } });

        const response = await GET(createRequest("010-1234-5678"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ exists: true });
        expect(mockGet).toHaveBeenCalledWith(
            "/clients/check-phone",
            expect.objectContaining({ params: { phone: "01012345678" } }),
        );
    });

    it("surfaces an upstream failure as an error instead of a false negative", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "phone index shard-4 exploded" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await GET(createRequest("01012345678"));

            expect(response.status).toBe(500);
            const body = await response.json();
            expect(body.exists).toBeUndefined();
            expect(typeof body.error).toBe("string");
            expect(JSON.stringify(body)).not.toContain("shard-4");
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
