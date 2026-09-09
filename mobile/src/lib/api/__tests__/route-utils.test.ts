/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { z } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import { getErrorMessage } from "@/lib/errors/api-error-mapper";
import {
    errorResponse,
    proxyDeleteRequest,
    proxyGetRequest,
    proxyLocalGetRequest,
    proxyPostRequest,
} from "../route-utils";

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
            error: expect.stringMatching(/[가-힣].*요[.!]?$/),
            code: "BACKEND_ERROR",
        });

        const logged = consoleErrorSpy.mock.calls
            .flat()
            .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
            .join(" ");
        expect(logged).not.toContain("/tmp/route-utils");
        expect(logged).not.toContain("api.internal");
    });

    it.each([
        ["create client", "duration must equal the Korean business-day count (15) for the submitted service period", "서비스 기간의 실제 이용일 수는 15일이에요. 입력한 이용일 수를 확인해 주세요."],
        ["create employee", "전화번호 형식이 올바르지 않습니다.", "전화번호 형식이 올바르지 않아요."],
    ])("passes a controlled 400 validation message through to the mapper (%s)", async (context, message, expected) => {
        const response = errorResponse(
            {
                response: {
                    status: 400,
                    data: {
                        message,
                        error: "Bad Request",
                        diagnostics: { host: "api.internal" },
                    },
                },
            },
            context,
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toEqual({ error: expected });
        expect(getErrorMessage({ response: { status: response.status, data: body } }, "ko")).toBe(expected);
        expect(JSON.stringify(body)).not.toContain("api.internal");
    });

    it("keeps safe Prisma metadata available for localized mapping", async () => {
        const response = errorResponse(
            {
                response: {
                    status: 409,
                    data: {
                        code: "P2002",
                        field: "phone",
                        message: "이미 등록된 전화번호입니다.",
                        error: "Conflict",
                    },
                },
            },
            "create client",
        );

        const body = await response.json();
        expect(body).toEqual({
            error: "연락처 정보가 이미 등록돼 있어요.",
            code: "P2002",
            field: "phone",
        });
        expect(getErrorMessage({ response: { status: 409, data: body } }, "ko")).toBe(body.error);
    });

    it("keeps Prisma metadata when the upstream only sends a bare conflict label", async () => {
        const response = errorResponse(
            {
                response: {
                    status: 409,
                    data: {
                        code: "P2002",
                        field: "phone",
                        error: "Conflict",
                    },
                },
            },
            "create employee",
        );

        const body = await response.json();
        expect(body).toEqual({
            error: expect.stringMatching(/[가-힣].*요[.!]?$/),
            code: "P2002",
            field: "phone",
        });
        expect(getErrorMessage({ response: { status: 409, data: body } }, "ko")).toBe(
            "연락처 정보가 이미 등록돼 있어요.",
        );
    });

    it.each([
        [400, "SELECT * FROM Client"],
        [400, "Invalid API key: sk_test_secret"],
        [401, "Invalid access token: eyJ.secret"],
        [500, "PrismaClientKnownRequestError: SELECT * FROM Client"],
    ])("suppresses unsafe upstream details at the mobile proxy (%i)", async (status, message) => {
        const response = errorResponse(
            { response: { status, data: { message, error: "Bad Request" } } },
            "create client",
        );

        expect(response.status).toBe(status);
        const body = await response.json();
        expect(body).toEqual({ error: expect.stringMatching(/[가-힣].*요[.!]?$/) });
        expect(JSON.stringify(body)).not.toContain(message);
        expect(JSON.stringify(body)).not.toContain("sk_test_secret");
        expect(JSON.stringify(body)).not.toContain("eyJ.secret");
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
            error: expect.stringMatching(/[가-힣].*요[.!]?$/),
            code: "UPSTREAM_GET_ERROR",
        });
    });

    it("allows a local document read with app auth only", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: { id: "doc-1" },
        });
        const request = new NextRequest(
            "http://localhost/api/eformsign/documents/doc-1?accessToken=ignored"
            + "&refresh_token=refresh-secret&external-token=external-secret"
            + "&oauth_token=oauth-secret&apiKey=api-secret&authorization=bearer-secret",
            {
                headers: { cookie: "auth_token=token-1" },
            },
        );

        const response = await proxyLocalGetRequest(
            request,
            "/api/documents/doc-1",
            "fetch local document",
        );

        expect(response.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith("/api/documents/doc-1", {
            params: {},
            headers: { Authorization: "Bearer token-1" },
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
            error: expect.stringMatching(/[가-힣].*요[.!]?$/),
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
            error: expect.stringMatching(/[가-힣].*요[.!]?$/),
            code: "UPSTREAM_DELETE_ERROR",
        });
    });
});

describe("route-utils proxy bodySchema validation", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockDelete.mockReset();
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    // re-request: { stepType + stepSeq required non-empty strings }
    const reRequestSchema = z
        .object({ stepType: z.string().min(1), stepSeq: z.string().min(1) })
        .passthrough();

    it("rejects a POST body missing stepSeq before proxying", async () => {
        const response = await proxyPostRequest(
            createJsonRequest("POST", JSON.stringify({ stepType: "01" })),
            "/api/documents/doc-1/re_request_outsider",
            "re-request eformsign document",
            { bodySchema: reRequestSchema },
        );

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards a re-request POST body that satisfies bodySchema", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { ok: true } });

        const response = await proxyPostRequest(
            createJsonRequest("POST", JSON.stringify({ stepType: "01", stepSeq: "1", comment: "hi" })),
            "/api/documents/doc-1/re_request_outsider",
            "re-request eformsign document",
            { bodySchema: reRequestSchema },
        );

        expect(response.status).toBe(200);
        const [, payload] = mockPost.mock.calls[0];
        expect(payload).toMatchObject({ stepType: "01", stepSeq: "1", comment: "hi" });
    });

    // delete documents: { document_ids: non-empty string array }
    const deleteDocumentsSchema = z
        .object({ document_ids: z.array(z.string()).nonempty() })
        .passthrough();

    it("rejects a DELETE body with an empty document_ids array before proxying", async () => {
        const response = await proxyDeleteRequest(
            createJsonRequest("DELETE", JSON.stringify({ document_ids: [] })),
            "/api/documents",
            "delete eformsign documents",
            { bodySchema: deleteDocumentsSchema },
        );

        expect(response.status).toBe(400);
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it("forwards a DELETE body that satisfies bodySchema", async () => {
        mockDelete.mockResolvedValue({ status: 200, data: { ok: true } });

        const response = await proxyDeleteRequest(
            createJsonRequest("DELETE", JSON.stringify({ document_ids: ["doc-1", "doc-2"] })),
            "/api/documents",
            "delete eformsign documents",
            { bodySchema: deleteDocumentsSchema },
        );

        expect(response.status).toBe(200);
        expect(mockDelete).toHaveBeenCalledTimes(1);
        const [path, config] = mockDelete.mock.calls[0];
        expect(path).toBe("/api/documents");
        expect(config.data).toMatchObject({ document_ids: ["doc-1", "doc-2"] });
    });
});
