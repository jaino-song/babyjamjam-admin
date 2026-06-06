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

function createRequest(): NextRequest {
    return new NextRequest("http://localhost/api/access-token", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=auth-token",
        },
        body: JSON.stringify({ executionTime: 1780000000000, memberEmail: "member@example.com" }),
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
