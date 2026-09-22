/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;
const mockPost = serverAPIClient.post as jest.Mock;
const cookieStore = {
    set: jest.fn(),
    delete: jest.fn(),
};

function createRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/auth/login", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCookies.mockResolvedValue(cookieStore as never);
    });

    it("sets the session cookies and keeps the success envelope on login", async () => {
        mockPost.mockResolvedValue({
            data: {
                success: true,
                accessToken: "access-1",
                refreshToken: "refresh-1",
                requiresBranchSelection: true,
            },
            status: 200,
        });

        const response = await POST(createRequest({ email: "a@b.c", password: "pw" }));

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ success: true, requiresBranchSelection: true });
        expect(cookieStore.set).toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_RATE_LIMITED",
            requestId: "req-login",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({
            response: {
                status: 429,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ email: "a@b.c", password: "pw" }));

        expect(response.status).toBe(429);
        await expect(response.json()).resolves.toMatchObject({
            code: "REQUEST_RATE_LIMITED",
            status: 429,
        });
        consoleErrorSpy.mockRestore();
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockPost.mockRejectedValue(new Error("connect EHOSTUNREACH 10.0.0.1:443"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ email: "a@b.c", password: "pw" }));

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain("EHOSTUNREACH");
        consoleErrorSpy.mockRestore();
    });
});
