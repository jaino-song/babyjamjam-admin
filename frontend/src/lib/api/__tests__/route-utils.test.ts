/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { proxyPostRequest } from "../route-utils";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createJsonRequest(body: string): NextRequest {
    return new NextRequest("http://localhost/api/proxy", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=token-1; eformsign_access_token=eformsign-token",
        },
        body,
    });
}

describe("route-utils proxy body parsing", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects malformed JSON POST bodies before proxying", async () => {
        const response = await proxyPostRequest(
            createJsonRequest("{bad-json"),
            "/api/documents/doc-1/re_request_outsider",
            "re-request outsider",
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "Request body must be valid JSON",
        });
        expect(mockPost).not.toHaveBeenCalled();
    });
});
