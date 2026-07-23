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

function createRequest(body: unknown, cookie?: string): NextRequest {
    return new NextRequest("http://localhost/api/eformsign-docs/sync-status", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
    });
}

describe("eformsign document status sync route", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("requires staff authentication", async () => {
        const response = await POST(createRequest({ documentId: "doc-1" }));

        expect(response.status).toBe(401);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects an empty document id before proxying", async () => {
        const response = await POST(createRequest(
            { documentId: "" },
            "auth_token=auth-token; eformsign_access_token=eformsign-token",
        ));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("injects cookie-owned tokens when proxying a valid sync", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: { documentId: "doc-1", statusType: "completed" },
        });

        const response = await POST(createRequest(
            { documentId: "doc-1", accessToken: "client-controlled-token" },
            "auth_token=auth-token; eformsign_access_token=eformsign-token",
        ));

        expect(response.status).toBe(200);
        expect(mockPost).toHaveBeenCalledWith(
            "/eformsign-docs/sync-status",
            { documentId: "doc-1", accessToken: "eformsign-token" },
            { headers: { Authorization: "Bearer auth-token" } },
        );
    });
});
