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

const mockServerPost = serverAPIClient.post as jest.Mock;

function createRequest(): NextRequest {
    return new NextRequest("http://localhost/api/refresh-access-token", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=auth-token; eformsign_refresh_token=old-refresh-token",
        },
        body: JSON.stringify({ executionTime: 1780000000000 }),
    });
}

describe("POST /api/refresh-access-token", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockServerPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("sets eformsign cookies from nested oauth_token response", async () => {
        mockServerPost.mockResolvedValue({
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
        expect(mockServerPost).toHaveBeenCalledWith(
            "/api/refresh-token",
            {
                executionTime: 1780000000000,
                refreshToken: "old-refresh-token",
            },
            {
                headers: { Authorization: "Bearer auth-token" },
            },
        );
    });

    it("does not expose raw backend error details from refresh failures", async () => {
        mockServerPost.mockResolvedValue({
            status: 502,
            data: {
                message: "oauth service path /tmp/refresh-token",
                code: "EFORM_REFRESH_ERROR",
                diagnostics: { host: "oauth.internal" },
            },
        });

        const response = await POST(createRequest());

        expect(response.status).toBe(502);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to refresh access token",
            code: "EFORM_REFRESH_ERROR",
        });

        const logged = consoleErrorSpy.mock.calls
            .flat()
            .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
            .join(" ");
        expect(logged).not.toContain("/tmp/refresh-token");
        expect(logged).not.toContain("oauth.internal");
    });
});
