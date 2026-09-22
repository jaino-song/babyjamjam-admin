/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function subscribeRequest(body: unknown, authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/notifications/subscribe", {
        method: "POST",
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            "content-type": "application/json",
        },
        body: JSON.stringify(body),
    });
}

describe("POST /api/notifications/subscribe", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated subscription with a registered 401 problem body", async () => {
        const response = await POST(subscribeRequest({ endpoint: "https://push.example/1" }, false));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("keeps a successful subscription untouched", async () => {
        mockPost.mockResolvedValue({ status: 201, data: { id: "sub-1" } });

        const response = await POST(subscribeRequest({ endpoint: "https://push.example/1" }));

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toEqual({ id: "sub-1" });
    });
});
