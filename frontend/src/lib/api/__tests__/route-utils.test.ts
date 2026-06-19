/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { proxyGetRequest, proxyPostRequest } from "../route-utils";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
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
        mockGet.mockReset();
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

    it("preserves GET query params while keeping accessToken cookie-owned", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: { documents: [], total_count: 0 },
        });

        const request = new NextRequest(
            "http://localhost/api/eformsign/documents/expired?limit=20&skip=40&accessToken=client-token",
            {
                method: "GET",
                headers: {
                    cookie: "auth_token=token-1; eformsign_access_token=eformsign-token",
                },
            },
        );

        const response = await proxyGetRequest(
            request,
            "/api/documents/rejected",
            "fetch expired documents",
        );

        expect(response.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith(
            "/api/documents/rejected",
            {
                params: {
                    accessToken: "eformsign-token",
                    limit: "20",
                    skip: "40",
                },
                headers: { Authorization: "Bearer token-1" },
            },
        );
    });
});
