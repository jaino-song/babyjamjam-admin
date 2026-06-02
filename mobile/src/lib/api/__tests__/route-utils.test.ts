/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { proxyDeleteRequest, proxyPostRequest } from "../route-utils";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        delete: jest.fn(),
        post: jest.fn(),
    },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function createJsonRequest(method: string, body: string): NextRequest {
    return new NextRequest("http://localhost/api/proxy", {
        method,
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=token-1; eformsign_access_token=eformsign-token",
        },
        body,
    });
}

describe("route-utils proxy body parsing", () => {
    beforeEach(() => {
        mockDelete.mockReset();
        mockPost.mockReset();
    });

    it("rejects malformed JSON POST bodies before proxying", async () => {
        const response = await proxyPostRequest(
            createJsonRequest("POST", "{bad-json"),
            "/api/documents/doc-1/re_request_outsider",
            "re-request outsider",
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "Request body must be valid JSON",
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON DELETE bodies before proxying", async () => {
        const response = await proxyDeleteRequest(
            createJsonRequest("DELETE", "{bad-json"),
            "/api/documents",
            "delete eformsign documents",
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "Request body must be valid JSON",
        });
        expect(mockDelete).not.toHaveBeenCalled();
    });
});
