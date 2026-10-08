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

describe("GET /api/message-logs/client/[clientId]", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("requires authentication before forwarding", async () => {
        const response = await GET(
            createRequest("/api/message-logs/client/42", false),
            { params: Promise.resolve({ clientId: "42" }) },
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards the client id, page size and opaque cursor with the bearer token", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: {
                items: [{ id: 1 }],
                page: { snapshotAt: "2026-09-17T00:00:00.000Z", nextCursor: "opaque-next", hasMore: true },
            },
        });

        const response = await GET(
            createRequest("/api/message-logs/client/42?limit=50&cursor=opaque-current"),
            { params: Promise.resolve({ clientId: "42" }) },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        await expect(response.json()).resolves.toMatchObject({ page: { nextCursor: "opaque-next" } });
        expect(mockGet).toHaveBeenCalledWith("/message-logs/client/42", {
            headers: { Authorization: "Bearer token-1" },
            params: { limit: "50", cursor: "opaque-current" },
        });
    });

    it("encodes the client id and omits absent query params", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { items: [], page: { nextCursor: null } } });

        await GET(
            createRequest("/api/message-logs/client/42%2Flegacy"),
            { params: Promise.resolve({ clientId: "42/legacy" }) },
        );

        expect(mockGet).toHaveBeenCalledWith("/message-logs/client/42%2Flegacy", {
            headers: { Authorization: "Bearer token-1" },
            params: {},
        });
    });

    it("sanitizes an upstream failure instead of leaking it", async () => {
        mockGet.mockRejectedValue({ response: { status: 404, data: { message: "Cannot GET" } } });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(
            createRequest("/api/message-logs/client/42"),
            { params: Promise.resolve({ clientId: "42" }) },
        );

        expect(response.status).toBe(404);
        expect(JSON.stringify(await response.json())).not.toContain("Cannot GET");
        consoleErrorSpy.mockRestore();
    });
});
