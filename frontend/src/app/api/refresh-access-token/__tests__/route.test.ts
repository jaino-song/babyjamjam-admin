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

describe("POST /api/refresh-access-token", () => {
    beforeEach(() => mockServerPost.mockReset());

    it("returns a deterministic 410 problem without reading cookies or proxying", async () => {
        const request = new NextRequest("http://localhost/api/refresh-access-token", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                cookie: "auth_token=auth-token",
            },
            body: JSON.stringify({ executionTime: 1780000000000 }),
        });

        const response = await POST(request);

        expect(response.status).toBe(410);
        const body = await response.json();
        expect(body).toMatchObject({
            code: "EFORMSIGN_CREDENTIALS_SERVER_ONLY",
            status: 410,
            outcome: "NOT_APPLIED",
        });
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain("Raw eformsign credentials are not exposed");
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(response.headers.get("Cache-Control")).toContain("no-store");
        expect(mockServerPost).not.toHaveBeenCalled();
    });
});
