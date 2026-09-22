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

describe("GET /api/message-trigger-jobs/upcoming", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/message-trigger-jobs/upcoming"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("sanitizes a legacy upstream failure instead of a raw English 500", async () => {
        mockGet.mockRejectedValue({
            response: { status: 503, data: { message: "job scheduler offline at 10.0.0.14" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(
            new NextRequest("http://localhost/api/message-trigger-jobs/upcoming?limit=3", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("10.0.0.14");
        expect(JSON.stringify(body)).not.toContain("Failed to fetch upcoming message trigger jobs");
        consoleErrorSpy.mockRestore();
    });
});
