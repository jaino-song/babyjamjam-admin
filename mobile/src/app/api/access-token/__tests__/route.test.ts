/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(
    body: BodyInit = JSON.stringify({ executionTime: 1780000000000, memberEmail: "member@example.com" }),
): NextRequest {
    return new NextRequest("http://localhost/api/access-token", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=auth-token",
        },
        body,
    });
}

describe("POST /api/access-token", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("rejects bodies missing executionTime before proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({ memberEmail: "member@example.com" })));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards validated executionTime/memberEmail and sets auth cookies", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: {
                oauth_token: {
                    access_token: "new-access-token",
                    refresh_token: "new-refresh-token",
                },
            },
        });

        const response = await POST(createRequest());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ success: true });
        expect(response.headers.get("set-cookie")).toContain("eformsign_access_token=new-access-token");
        expect(response.headers.get("set-cookie")).toContain("eformsign_refresh_token=new-refresh-token");
        expect(mockPost).toHaveBeenCalledWith(
            "/api/access-token",
            { executionTime: 1780000000000, memberEmail: "member@example.com" },
            { headers: { Authorization: "Bearer auth-token" } },
        );
    });

    it("does not return or log raw backend error response details", async () => {
        mockPost.mockResolvedValue({
            status: 502,
            data: {
                error: "oauth service path /tmp/eformsign-token",
                code: "EFORM_TOKEN_ERROR",
                diagnostics: { host: "oauth.internal" },
            },
        });

        const response = await POST(createRequest());

        expect(response.status).toBe(502);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to get access token",
            code: "EFORM_TOKEN_ERROR",
        });

        const logged = consoleErrorSpy.mock.calls
            .flat()
            .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
            .join(" ");
        expect(logged).not.toContain("/tmp/eformsign-token");
        expect(logged).not.toContain("oauth.internal");
    });

    it("does not log raw backend data when token response shape is invalid", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: {
                diagnostics: { host: "oauth.internal" },
                path: "/tmp/eformsign-token",
            },
        });

        const response = await POST(createRequest());

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            error: "Invalid response from authentication service",
        });

        const logged = consoleErrorSpy.mock.calls
            .flat()
            .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
            .join(" ");
        expect(logged).not.toContain("/tmp/eformsign-token");
        expect(logged).not.toContain("oauth.internal");
    });
});
