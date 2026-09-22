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

describe("GET /api/clients/stats", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/clients/stats"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("preserves a successful stats payload with its upstream status", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { total: 3 } });

        const response = await GET(
            new NextRequest("http://localhost/api/clients/stats", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ total: 3 });
    });

    it("sanitizes a legacy upstream failure instead of a raw English 500", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "stats aggregate shard-1 exploded" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await GET(
                new NextRequest("http://localhost/api/clients/stats", {
                    headers: { cookie: "auth_token=token-1" },
                }),
            );

            expect(response.status).toBe(500);
            const body = await response.json();
            expect(typeof body.error).toBe("string");
            expect(JSON.stringify(body)).not.toContain("shard-1");
            expect(JSON.stringify(body)).not.toContain("Failed to fetch client stats");
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
