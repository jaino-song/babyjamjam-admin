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
    return new NextRequest("http://localhost/api/generate-signature", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=auth-token",
        },
        body,
    });
}

describe("POST /api/generate-signature", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects bodies missing executionTime before proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({})));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects non-numeric executionTime before proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({ executionTime: "soon" })));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards the validated executionTime to the backend", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { signature: "sig" } });

        const response = await POST(createRequest(JSON.stringify({ executionTime: 1780000000000 })));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ signature: "sig" });
        expect(mockPost).toHaveBeenCalledWith(
            "/api/generate-signature",
            { executionTime: 1780000000000 },
            { headers: { Authorization: "Bearer auth-token" } },
        );
    });
});
