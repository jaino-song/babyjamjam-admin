/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/auth/resend-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/auth/resend-verification", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_RATE_LIMITED",
            requestId: "req-resend-verification",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({
            response: {
                status: 429,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ email: "staff@example.com" }));

        expect(response.status).toBe(429);
        await expect(response.json()).resolves.toMatchObject({ code: "REQUEST_RATE_LIMITED" });
        consoleErrorSpy.mockRestore();
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockPost.mockRejectedValue(new Error("connect ECONNREFUSED"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ email: "staff@example.com" }));

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
        consoleErrorSpy.mockRestore();
    });
});
