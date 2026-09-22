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

describe("GET /api/auth/check-email", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("keeps the empty-param success contract untouched", async () => {
        const response = await GET(new NextRequest("http://localhost/api/auth/check-email"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ exists: false });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("no longer converts an upstream failure into a false-negative exists flag", async () => {
        mockGet.mockRejectedValue({ response: { status: 503, data: {} } });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(
            new NextRequest("http://localhost/api/auth/check-email?email=staff@example.com"),
        );

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body).not.toHaveProperty("exists");
        expect(typeof body.error).toBe("string");
        consoleErrorSpy.mockRestore();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_RATE_LIMITED",
            requestId: "req-check-email",
            outcome: "NOT_APPLIED",
        });
        mockGet.mockRejectedValue({
            response: {
                status: 429,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const response = await GET(
            new NextRequest("http://localhost/api/auth/check-email?email=staff@example.com"),
        );

        expect(response.status).toBe(429);
        await expect(response.json()).resolves.toMatchObject({ code: "REQUEST_RATE_LIMITED" });
    });
});
