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

describe("POST /api/notifications/unsubscribe", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated unsubscribe with a registered 401 problem body", async () => {
        const response = await POST(
            new NextRequest("http://localhost/api/notifications/unsubscribe", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ endpoint: "https://push.example/1" }),
            }),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockPost).not.toHaveBeenCalled();
    });
});
