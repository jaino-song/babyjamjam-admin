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

describe("GET /api/eformsign-docs/jobs", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/eformsign-docs/jobs"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("sanitizes a legacy upstream failure instead of a raw English body", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "job ledger shard-6 exploded" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await GET(
                new NextRequest("http://localhost/api/eformsign-docs/jobs", {
                    headers: { cookie: "auth_token=token-1" },
                }),
            );

            expect(response.status).toBe(500);
            const body = await response.json();
            expect(typeof body.error).toBe("string");
            expect(JSON.stringify(body)).not.toContain("shard-6");
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
