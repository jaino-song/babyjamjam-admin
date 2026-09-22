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
        expect(response.headers.get("cache-control")).toContain("no-store");
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
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
                data: { code: `EDITOR_${status}`, message: "secret editor internals" },
            },
        });

        const response = await GET(
            createRequest("/api/admin/service-records/client/17/editor"),
            { params: Promise.resolve({ clientId: "17" }) },
        );

        expect(response.status).toBe(status);
        expect(response.headers.get("cache-control")).toContain("no-store");
        const body = await response.json();
        expect(body).toMatchObject({ code: `EDITOR_${status}` });
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain("secret editor internals");
    });

    it("returns a sanitized 500 and logs only sanitized diagnostics for an unavailable upstream", async () => {
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
        expect(response.headers.get("cache-control")).toContain("no-store");
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain("private upstream details");
        expect(consoleError).toHaveBeenCalled();
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private upstream details");
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-jwt");
        consoleError.mockRestore();
    });
});
