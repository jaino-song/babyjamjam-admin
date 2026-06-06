/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { GET } from "../route";
import { proxyGetRequest } from "@/lib/api/route-utils";

jest.mock("@/lib/api/route-utils", () => ({
    proxyDeleteRequest: jest.fn(),
    proxyGetRequest: jest.fn(),
}));

const mockProxyGetRequest = proxyGetRequest as jest.Mock;

function createRequest(path: string): NextRequest {
    return new NextRequest(`http://localhost${path}`);
}

describe("GET /api/eformsign/documents", () => {
    beforeEach(() => {
        mockProxyGetRequest.mockReset();
        mockProxyGetRequest.mockResolvedValue(new Response("{}", { status: 200 }));
    });

    it("rejects non-integer limits before proxying", async () => {
        const response = await GET(createRequest("/api/eformsign/documents?limit=abc"));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "limit must be an integer" });
        expect(mockProxyGetRequest).not.toHaveBeenCalled();
    });

    it("rejects out-of-range limits before proxying", async () => {
        const response = await GET(createRequest("/api/eformsign/documents?limit=101"));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "limit must be between 1 and 100" });
        expect(mockProxyGetRequest).not.toHaveBeenCalled();
    });

    it("rejects negative skip values before proxying", async () => {
        const response = await GET(createRequest("/api/eformsign/documents?skip=-1"));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "skip must be greater than or equal to 0" });
        expect(mockProxyGetRequest).not.toHaveBeenCalled();
    });

    it("normalizes valid pagination params before proxying", async () => {
        await GET(createRequest("/api/eformsign/documents?limit=25&skip=50"));

        expect(mockProxyGetRequest).toHaveBeenCalledWith(
            expect.any(NextRequest),
            "/api/documents?limit=25&skip=50",
            "fetch all eformsign documents",
        );
    });
});
