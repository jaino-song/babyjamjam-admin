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
    return new NextRequest("http://localhost/api/auth/link-password", {
        method: "POST",
        headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/auth/link-password", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated request with a registered 401 problem body", async () => {
        const request = new NextRequest("http://localhost/api/auth/link-password", {
            method: "POST",
        });

        const response = await POST(request);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "VALIDATION_FAILED",
            requestId: "req-link-password",
            outcome: "NOT_APPLIED",
            status: 422,
        });
        mockPost.mockRejectedValue({
            response: {
                status: 422,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const response = await POST(createRequest({ password: "short" }));

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toMatchObject({
            code: "VALIDATION_FAILED",
            status: 422,
        });
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockPost.mockRejectedValue(new Error("read ECONNRESET"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ password: "secret-1" }));

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain("ECONNRESET");
        consoleErrorSpy.mockRestore();
    });
});
