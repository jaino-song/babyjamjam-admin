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

function createRequest(path: string, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        headers: authenticated ? { cookie: "auth_token=token-1" } : undefined,
    });
}

describe("GET /api/admin/service-records/client/[clientId]/editor", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("requires the browser auth cookie before making an upstream request", async () => {
        const response = await GET(
            createRequest("/api/admin/service-records/client/17/editor", false),
            { params: Promise.resolve({ clientId: "17" }) },
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards a bearer token, encodes the id, and disables caching", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: { record: null, assignments: [] },
        });

        const response = await GET(
            createRequest("/api/admin/service-records/client/17%2Feditor/editor"),
            { params: Promise.resolve({ clientId: "17/editor" }) },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(mockGet).toHaveBeenCalledWith(
            "/admin/service-records/client/17%2Feditor/editor",
            { headers: { Authorization: "Bearer token-1" } },
        );
        await expect(response.json()).resolves.toEqual({ record: null, assignments: [] });
    });

    it.each([401, 403, 404])("preserves upstream authorization/not-found status %s", async (status) => {
        mockGet.mockRejectedValue({
            isAxiosError: true,
            response: {
                status,
                data: { code: `EDITOR_${status}` },
            },
        });

        const response = await GET(
            createRequest("/api/admin/service-records/client/17/editor"),
            { params: Promise.resolve({ clientId: "17" }) },
        );

        expect(response.status).toBe(status);
        expect(response.headers.get("cache-control")).toBe("no-store");
        await expect(response.json()).resolves.toEqual({ code: `EDITOR_${status}` });
    });

    it("returns a generic 500 and logs only a fixed message for an unavailable upstream", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const upstreamError = Object.assign(new Error("private upstream details"), {
            config: { headers: { Authorization: "Bearer secret-jwt" } },
        });
        mockGet.mockRejectedValue(upstreamError);

        const response = await GET(
            createRequest("/api/admin/service-records/client/17/editor"),
            { params: Promise.resolve({ clientId: "17" }) },
        );

        expect(response.status).toBe(500);
        expect(response.headers.get("cache-control")).toBe("no-store");
        await expect(response.json()).resolves.toEqual({ error: "Failed to fetch service records" });
        expect(consoleError).toHaveBeenCalledWith("[API] Error fetching service-record editor");
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private upstream details");
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-jwt");
        consoleError.mockRestore();
    });
});
