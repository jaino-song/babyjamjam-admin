/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { AxiosError } from "axios";
import { cookies } from "next/headers";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
        defaults: {
            baseURL: "https://internal-api.local",
        },
    },
}));

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

const mockPost = serverAPIClient.post as jest.Mock;
const mockCookies = cookies as jest.Mock;

function createRequest(body: BodyInit = JSON.stringify({ code: "oauth-code" })): NextRequest {
    return new NextRequest("http://localhost/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });
}

function createAxiosError(status: number, data: unknown): AxiosError {
    return new AxiosError(
        "connect ECONNREFUSED https://internal-api.local",
        "ECONNREFUSED",
        { url: "/auth/token", baseURL: "https://internal-api.local" } as never,
        undefined,
        {
            status,
            statusText: "Forbidden",
            headers: {},
            config: {} as never,
            data,
        } as never,
    );
}

describe("POST /api/auth/token", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        mockCookies.mockReset();
        mockCookies.mockResolvedValue({ set: jest.fn() } as never);
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("rejects a body missing the required code without proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({})));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON without proxying", async () => {
        const response = await POST(createRequest("{bad-json"));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards a valid code to the backend token exchange", async () => {
        mockPost.mockResolvedValue({ data: { accessToken: "a", refreshToken: "r" } });

        const response = await POST(createRequest());

        expect(response.status).toBe(200);
        expect(mockPost).toHaveBeenCalledWith("/auth/token", { code: "oauth-code" });
    });

    it("does not expose upstream token exchange messages in the response", async () => {
        mockPost.mockRejectedValue(
            createAxiosError(403, {
                message: "database host https://internal-api.local rejected oauth-code",
            }),
        );

        const response = await POST(createRequest());

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({ error: "Token exchange failed" });
    });

    it("does not log backend URL or upstream response bodies on token exchange failures", async () => {
        mockPost.mockRejectedValue(
            createAxiosError(500, {
                message: "private backend detail",
                url: "https://internal-api.local/auth/token",
            }),
        );

        await POST(createRequest());

        const logged = consoleErrorSpy.mock.calls
            .flat()
            .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
            .join(" ");

        expect(logged).not.toContain("https://internal-api.local");
        expect(logged).not.toContain("private backend detail");
    });
});
