/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as downloadGet } from "../[documentId]/download_files/route";
import { DELETE as deleteDocuments, GET as listDocuments } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        delete: jest.fn(),
        get: jest.fn(),
        head: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockDelete = serverAPIClient.delete as jest.Mock;

function request(path: string, init: { method?: string; cookie?: boolean; body?: string } = {}): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: init.method ?? "GET",
        headers: {
            ...(init.cookie === false ? {} : { cookie: "auth_token=auth-token" }),
            ...(init.body ? { "content-type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
    });
}

const documentParams = { params: Promise.resolve({ documentId: "doc-1" }) };

describe("eformsign documents BFF problem conversion (BJJ-319 6.1e)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        mockDelete.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        ["list GET", () => listDocuments(request("/api/eformsign/documents", { cookie: false }))],
        ["delete DELETE", () => deleteDocuments(request("/api/eformsign/documents", { method: "DELETE", cookie: false, body: "{}" }))],
        ["download GET", () => downloadGet(request("/api/eformsign/documents/doc-1/download_files", { cookie: false }), documentParams)],
    ])("returns an AUTH_REQUIRED problem for %s without a token", async (_name, act) => {
        const response = await act();

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
            error: "Unauthorized",
        }));
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it("rejects a non-integer download page with a VALIDATION_FAILED query problem", async () => {
        const response = await downloadGet(
            request("/api/eformsign/documents/doc-1/download_files?page=abc"),
            documentParams,
        );

        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            error: "Invalid page number",
            errors: [{ pointer: "/page", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "query" }],
        }));
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards a registered upstream problem body verbatim on list GET", async () => {
        mockGet.mockRejectedValue({
            response: {
                status: 422,
                data: {
                    type: "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#validation-failed",
                    title: "Validation failed",
                    status: 422,
                    detail: "입력 정보가 처리 조건에 맞지 않아요.",
                    code: "VALIDATION_FAILED",
                    requestId: "req-documents-1",
                    params: {},
                },
            },
        });

        const response = await listDocuments(request("/api/eformsign/documents"));

        expect(response.status).toBe(422);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 422, requestId: "req-documents-1" });
    });

    it("sanitizes a delete upstream rejection with the status preserved", async () => {
        mockDelete.mockRejectedValue({
            response: {
                status: 409,
                data: { message: "Document locked by member@example.com" },
            },
        });

        const response = await deleteDocuments(
            request("/api/eformsign/documents", { method: "DELETE", body: JSON.stringify({ document_ids: ["doc-1"] }) }),
        );

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).toMatch(/[가-힣]/);
        expect(body.code).not.toBe("UPSTREAM_ERROR");
        expect(JSON.stringify(body)).not.toContain("member@example.com");
    });
});
