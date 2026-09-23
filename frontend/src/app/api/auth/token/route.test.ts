/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { AxiosError } from "axios";

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
    return new NextRequest("http://localhost/api/auth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/auth/token", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCookies.mockResolvedValue(cookieStore as never);
    });

    it("rejects a missing authorization code with a registered validation problem", async () => {
        const response = await POST(createRequest({}));

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", outcome: "NOT_APPLIED" });
        expect(body.errors?.[0]).toMatchObject({ pointer: "/code", location: "body" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_EXPIRED",
            requestId: "req-token-exchange",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({
            response: {
                status: 410,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ code: "auth-code" }));

        expect(response.status).toBe(410);
        await expect(response.json()).resolves.toMatchObject({ code: "REQUEST_EXPIRED" });
        consoleErrorSpy.mockRestore();
    });

    it("maps an unreachable backend to a registered 503 dependency problem", async () => {
        mockPost.mockRejectedValue(new AxiosError("Network Error", "ECONNABORTED"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ code: "auth-code" }));

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 });
        expect(body).not.toHaveProperty("details");
        consoleErrorSpy.mockRestore();
    });

    it("stops leaking the caught error message on unknown failures", async () => {
        mockPost.mockRejectedValue(new Error("secret internal stack hint"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ code: "auth-code" }));

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("secret internal stack hint");
        expect(typeof body.error).toBe("string");
        consoleErrorSpy.mockRestore();
    });

    it("keeps the success exchange flow and cookie lifecycle untouched", async () => {
        mockPost.mockResolvedValue({
            data: { accessToken: "a-1", refreshToken: "r-1" },
            status: 200,
        });

        const response = await POST(createRequest({ code: "auth-code" }));

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ requiresBranchSelection: false });
        expect(cookieStore.set).toHaveBeenCalled();
        expect(cookieStore.delete).toHaveBeenCalledWith("pending_kakao_signup");
        expect(cookieStore.delete).toHaveBeenCalledWith("pending_account_onboarding");
    });
});
