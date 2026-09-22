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
    return new NextRequest("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/auth/register", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "EMPLOYEE_PHONE_ALREADY_REGISTERED",
            requestId: "req-register",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ email: "s@e.c", password: "pw", name: "n" }));

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
            code: "EMPLOYEE_PHONE_ALREADY_REGISTERED",
            status: 409,
        });
        consoleErrorSpy.mockRestore();
    });

    it("keeps the legacy hasKakaoAccount compatibility field on sanitized upstream failures", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { message: "카카오 계정", code: "KAKAO_LINKED", hasKakaoAccount: true },
            },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ email: "s@e.c", password: "pw", name: "n" }));

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.hasKakaoAccount).toBe(true);
        expect(typeof body.error).toBe("string");
        consoleErrorSpy.mockRestore();
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockPost.mockRejectedValue(new Error("connect ETIMEDOUT"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ email: "s@e.c", password: "pw", name: "n" }));

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("ETIMEDOUT");
        consoleErrorSpy.mockRestore();
    });
});
