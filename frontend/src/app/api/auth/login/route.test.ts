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

    it.each([
        [401, "로그인 인증을 확인할 수 없어요. 다시 로그인해 주세요."],
        [403, "이 작업을 할 권한이 없어요."],
        [400, "입력 정보가 요청 조건에 맞지 않아요. 입력 내용을 확인해 주세요."],
    ])("serializes the status-generic message for an uncoded diagnostic %i failure", async (status, generic) => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockPost.mockRejectedValue({
            response: {
                status,
                data: { message: "인증 서비스 analytics.internal 확인 중 /srv/auth/verify.ts:88에서 오류가 발생했습니다." },
            },
        });

        const response = await POST(createRequest({ email: "a@b.c", password: "pw" }));
        consoleError.mockRestore();

        expect(response.status).toBe(status);
        const text = JSON.stringify(await response.json());
        expect(JSON.parse(text)).toEqual({ error: generic });
        expect(text).not.toMatch(/analytics|srv|verify\.ts/);
        expect(cookieStore.set).not.toHaveBeenCalled();
    });

    it("keeps an uncoded business failure message (control)", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockPost.mockRejectedValue({
            response: { status: 401, data: { message: "이메일 또는 비밀번호가 올바르지 않습니다." } },
        });

        const response = await POST(createRequest({ email: "a@b.c", password: "pw" }));
        consoleError.mockRestore();

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: "이메일 또는 비밀번호가 올바르지 않아요." });
    });

    it("does not reflect a diagnostic body from a 200 {success:false} login response", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockPost.mockResolvedValue({
            data: {
                success: false,
                message: 'Cannot read properties of undefined (reading "client_id")',
            },
            status: 200,
        });

        const response = await POST(createRequest({ email: "a@b.c", password: "pw" }));
        consoleError.mockRestore();

        expect(response.status).toBe(401);
        const text = JSON.stringify(await response.json());
        expect(text).not.toMatch(/Cannot read|client_id|undefined/);
        expect(JSON.parse(text)).toEqual({ error: "로그인 인증을 확인할 수 없어요. 다시 로그인해 주세요." });
        expect(cookieStore.set).not.toHaveBeenCalled();
    });

    it("keeps the Korean credentials message with the upstream status for a resolved 401 failure", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockPost.mockResolvedValue({
            data: { success: false, message: "이메일 또는 비밀번호가 올바르지 않습니다." },
            status: 401,
        });

        const response = await POST(createRequest({ email: "a@b.c", password: "pw" }));
        consoleError.mockRestore();

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body).toEqual({ error: "이메일 또는 비밀번호가 올바르지 않아요." });
        expect(body).not.toHaveProperty("success");
        expect(cookieStore.set).not.toHaveBeenCalled();
    });

    it("keeps the problem code of a resolved coded failure body", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const problem = createProblemDetails({
            code: "REQUEST_RATE_LIMITED",
            requestId: "req-login-resolved",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockResolvedValue({
            data: { ...problem, success: false, message: "stack at /srv/auth/login.ts:12" },
            status: 429,
        });

        const response = await POST(createRequest({ email: "a@b.c", password: "pw" }));
        consoleError.mockRestore();

        expect(response.status).toBe(429);
        const body = await response.json();
        expect(body).toMatchObject({ code: "REQUEST_RATE_LIMITED", status: 429 });
        expect(JSON.stringify(body)).not.toMatch(/srv|login\.ts/);
        expect(cookieStore.set).not.toHaveBeenCalled();
    });
});
