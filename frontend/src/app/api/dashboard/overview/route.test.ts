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

describe("GET /api/dashboard/overview", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/dashboard/overview"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_RATE_LIMITED",
            requestId: "req-dashboard-overview",
            outcome: "NOT_APPLIED",
        });
        mockGet.mockRejectedValue({
            response: {
                status: 429,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const response = await GET(
            new NextRequest("http://localhost/api/dashboard/overview", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(429);
        await expect(response.json()).resolves.toMatchObject({
            code: "REQUEST_RATE_LIMITED",
            status: 429,
        });
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockGet.mockRejectedValue(new Error("upstream 502 html page"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(
            new NextRequest("http://localhost/api/dashboard/overview", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain("502 html");
        consoleErrorSpy.mockRestore();
    });
});
