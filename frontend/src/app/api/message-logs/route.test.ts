/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/message-logs", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/message-logs"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body faithfully", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_INVALID",
            requestId: "req-message-logs",
            outcome: "NOT_APPLIED",
        });
        mockGet.mockRejectedValue({
            response: { status: 400, data: problem },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(
            new NextRequest("http://localhost/api/message-logs?limit=5", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "REQUEST_INVALID", status: 400 });
        expect(response.headers.get("content-type")).toContain("application/problem+json");
        consoleErrorSpy.mockRestore();
    });

    it("sanitizes a legacy upstream failure instead of a raw English 500", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "select * failed on internal table" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(
            new NextRequest("http://localhost/api/message-logs", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("internal table");
        expect(JSON.stringify(body)).not.toContain("Failed to fetch message logs");
        consoleErrorSpy.mockRestore();
    });
});
