/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

const mockPost = serverAPIClient.post as jest.Mock;
const mockCookies = cookies as jest.Mock;

function createRequest(body: BodyInit): NextRequest {
    return new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });
}

const validBody = {
    email: "user@example.com",
    password: "password123",
};

describe("POST /api/auth/login", () => {
    let consoleErrorSpy: jest.SpyInstance;
    let cookieSet: jest.Mock;

    beforeEach(() => {
        mockPost.mockReset();
        mockCookies.mockReset();
        cookieSet = jest.fn();
        mockCookies.mockResolvedValue({ set: cookieSet } as never);
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("rejects a body missing required fields without proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({ email: "user@example.com" })));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects an invalid email without proxying", async () => {
        const response = await POST(
            createRequest(JSON.stringify({ email: "not-an-email", password: "password123" })),
        );

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON without proxying", async () => {
        const response = await POST(createRequest("{bad-json"));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards only the login payload (no autoLogin) to the backend", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: { success: true, accessToken: "access", refreshToken: "refresh" },
        });

        const response = await POST(
            createRequest(JSON.stringify({ ...validBody, autoLogin: false })),
        );

        expect(response.status).toBe(200);
        expect(mockPost).toHaveBeenCalledWith("/auth/login", validBody);
        expect(cookieSet).toHaveBeenCalled();
    });

    it("returns the backend response when login fails (no cookies set)", async () => {
        mockPost.mockResolvedValue({
            status: 401,
            data: { success: false, message: "이메일 또는 비밀번호가 올바르지 않습니다." },
        });

        const response = await POST(createRequest(JSON.stringify(validBody)));

        expect(response.status).toBe(401);
        expect(cookieSet).not.toHaveBeenCalled();
    });
});
