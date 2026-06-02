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
    beforeEach(() => {
        mockServerPost.mockReset();
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
});
