/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { AxiosError } from "axios";

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

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(): NextRequest {
    return new NextRequest("http://localhost/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "oauth-code" }),
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
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
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
