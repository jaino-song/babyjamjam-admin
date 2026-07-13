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

function createRequest(body: BodyInit): NextRequest {
    return new NextRequest("http://localhost/api/auth/link-password", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=auth-token",
        },
        body,
    });
}

describe("POST /api/auth/link-password", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("rejects a body with a too-short password without proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({ password: "short" })));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards a valid body to the backend with the auth header", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { success: true } });

        const response = await POST(createRequest(JSON.stringify({ password: "password123" })));

        expect(response.status).toBe(200);
        expect(mockPost).toHaveBeenCalledWith(
            "/auth/link-password",
            { password: "password123" },
            { headers: { Authorization: "Bearer auth-token" } },
        );
    });
});
