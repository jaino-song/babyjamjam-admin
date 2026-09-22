/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";

import { serverAPIClient } from "@/lib/api/server";
import {
    proxyGetRequest,
    proxyLocalGetRequest,
    proxyPostRequest,
    upstreamStatusProblemResponse,
} from "../route-utils";

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
        await expect(response.json()).resolves.toMatchObject({
            code: "VALIDATION_FAILED",
            outcome: "NOT_APPLIED",
            requestId: response.headers.get("X-Request-Id"),
            error: "Request body must be valid JSON",
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("preserves safe GET query params while dropping provider credentials", async () => {
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
                    limit: "20",
                    skip: "40",
                },
                headers: { Authorization: "Bearer token-1" },
            },
        );
    });

    it("proxies local reads without requiring or forwarding an eformsign token", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: { documents: [], total_rows: 0 },
        });
        const request = new NextRequest(
            "http://localhost/api/eformsign/documents?limit=20&accessToken=client-token"
            + "&refresh_token=refresh-secret&external-token=external-secret"
            + "&oauth_token=oauth-secret&apiKey=api-secret&authorization=bearer-secret",
            {
                headers: { cookie: "auth_token=token-1" },
            },
        );

        const response = await proxyLocalGetRequest(
            request,
            "/api/documents",
            "fetch local documents",
        );

        expect(response.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith("/api/documents", {
            params: { limit: "20" },
            headers: { Authorization: "Bearer token-1" },
        });
    });
});

describe("upstreamStatusProblemResponse outcome defaults (EM-STATE-01)", () => {
    it("defaults an upstream 5xx on a mutation to UNKNOWN with CHECK_STATUS recovery", async () => {
        const response = upstreamStatusProblemResponse(503, "confirm chat intent", undefined, "mutation");

        expect(response.status).toBe(503);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const body = await response.json();
        expect(body).toMatchObject({
            code: "DEPENDENCY_UNAVAILABLE",
            status: 503,
            outcome: "UNKNOWN",
        });
        expect(body.recovery).toMatchObject({ action: "CHECK_STATUS", retry: { mode: "NEVER" } });
    });

    it("keeps the NOT_APPLIED default for a read regardless of the upstream status", async () => {
        const response = upstreamStatusProblemResponse(503, "fetch widget", undefined, "read");

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body).toMatchObject({
            code: "DEPENDENCY_UNAVAILABLE",
            status: 503,
            outcome: "NOT_APPLIED",
        });
        expect(body).not.toHaveProperty("recovery");
    });

    it("keeps NOT_APPLIED for an explicit upstream 4xx rejection on a mutation", async () => {
        const response = upstreamStatusProblemResponse(409, "confirm chat intent", undefined, "mutation");

        const body = await response.json();
        expect(body).toMatchObject({
            code: "REQUEST_CONFLICT",
            status: 409,
            outcome: "NOT_APPLIED",
        });
        expect(body).not.toHaveProperty("recovery");
    });

    it("propagates a faithful upstream problem body with its own registered code and outcome", async () => {
        const upstreamProblem = createProblemDetails({
            code: "REQUEST_CONFLICT",
            requestId: "upstream-request-1",
            outcome: "UNKNOWN",
        });
        const response = upstreamStatusProblemResponse(
            409,
            "confirm chat intent",
            undefined,
            "mutation",
            upstreamProblem,
        );

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({
            code: "REQUEST_CONFLICT",
            status: 409,
            outcome: "UNKNOWN",
            requestId: "upstream-request-1",
        });
        expect(body.recovery).toMatchObject({ action: "CHECK_STATUS" });
    });
});
