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
        const body = await response.json();
        expect(body.error).toMatch(/[가-힣]/);
        expect(body).not.toHaveProperty("code");
        expect(JSON.stringify(body)).not.toContain("oauth-code");
        expect(JSON.stringify(body)).not.toContain("internal-api.local");
    });

    it("maps a network failure to a registered DEPENDENCY_UNAVAILABLE problem at 503", async () => {
        mockPost.mockRejectedValue(new AxiosError("network down", "ECONNREFUSED"));

        const response = await POST(createRequest());

        expect(response.status).toBe(503);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "DEPENDENCY_UNAVAILABLE",
            status: 503,
            outcome: "UNKNOWN",
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
        }));
    });

    it("logs the network failure data-free (name/code/status only, no bodies)", async () => {
        mockPost.mockRejectedValue(new AxiosError("network down", "ECONNREFUSED"));

        await POST(createRequest());

        const logCall = consoleErrorSpy.mock.calls.find(
            (call) => typeof call[0] === "string" && call[0].includes("exchange authorization code"),
        );
        expect(logCall).toBeDefined();
        expect(logCall?.[1]).toEqual({ status: 500, code: "ECONNREFUSED", name: "AxiosError" });
        const logged = consoleErrorSpy.mock.calls
            .flat()
            .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
            .join(" ");
        expect(logged).not.toContain("network down");
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
