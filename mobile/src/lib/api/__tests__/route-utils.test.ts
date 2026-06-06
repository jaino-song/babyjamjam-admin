/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, proxyDeleteRequest, proxyGetRequest, proxyPostRequest } from "../route-utils";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        delete: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
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

function createCookieRequest(method: string): NextRequest {
    return new NextRequest("http://localhost/api/proxy", {
        method,
        headers: {
            cookie: "auth_token=token-1; eformsign_access_token=eformsign-token",
        },
    });
}

describe("route-utils proxy body parsing", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockDelete.mockReset();
        mockGet.mockReset();
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
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

    it("does not return or log raw upstream messages from errorResponse", async () => {
        const response = errorResponse(
            {
                response: {
                    status: 418,
                    data: {
                        error: "database path /tmp/route-utils",
                        code: "BACKEND_ERROR",
                        diagnostics: { host: "api.internal" },
                    },
                },
            },
            "fetch clients",
        );

        expect(response.status).toBe(418);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to fetch clients",
            code: "BACKEND_ERROR",
        });

        const logged = consoleErrorSpy.mock.calls
            .flat()
            .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
            .join(" ");
        expect(logged).not.toContain("/tmp/route-utils");
        expect(logged).not.toContain("api.internal");
    });

    it("sanitizes raw upstream payloads from non-throwing proxy GET errors", async () => {
        mockGet.mockResolvedValue({
            status: 502,
            data: {
                error: "database path /tmp/proxy-get",
                code: "UPSTREAM_GET_ERROR",
                diagnostics: { host: "api.internal" },
            },
        });

        const response = await proxyGetRequest(
            createCookieRequest("GET"),
            "/api/documents",
            "fetch eformsign documents",
        );

        expect(response.status).toBe(502);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to fetch eformsign documents",
            code: "UPSTREAM_GET_ERROR",
        });
    });

    it("sanitizes raw upstream payloads from non-throwing proxy POST errors", async () => {
        mockPost.mockResolvedValue({
            status: 409,
            data: {
                message: "internal workflow /tmp/proxy-post",
                code: "UPSTREAM_POST_ERROR",
                diagnostics: { host: "api.internal" },
            },
        });

        const response = await proxyPostRequest(
            createJsonRequest("POST", JSON.stringify({ documentId: "doc-1" })),
            "/api/documents",
            "create eformsign document",
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to create eformsign document",
            code: "UPSTREAM_POST_ERROR",
        });
    });

    it("sanitizes raw upstream payloads from non-throwing proxy DELETE errors", async () => {
        mockDelete.mockResolvedValue({
            status: 500,
            data: {
                error: "internal workflow /tmp/proxy-delete",
                code: "UPSTREAM_DELETE_ERROR",
                diagnostics: { host: "api.internal" },
            },
        });

        const response = await proxyDeleteRequest(
            createJsonRequest("DELETE", JSON.stringify({ documentId: "doc-1" })),
            "/api/documents",
            "delete eformsign document",
        );

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to delete eformsign document",
            code: "UPSTREAM_DELETE_ERROR",
        });
    });
});
