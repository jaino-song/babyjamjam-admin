/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST as adoptDocument } from "../adopt/route";
import { POST as eformsignAccessToken } from "../access-token/route";
import { POST as eformsignRefreshToken } from "../refresh-token/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function request(path: string, init: { method?: string; cookie?: boolean; body?: string } = {}): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: init.method ?? "POST",
        headers: {
            ...(init.cookie === false ? {} : { cookie: "auth_token=auth-token" }),
            ...(init.body ? { "content-type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
    });
}

describe("eformsign-docs BFF problem conversion (BJJ-319 6.1e)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        ["provider access-token tombstone", () => eformsignAccessToken(request("/api/eformsign-docs/access-token", { body: "{}" }))],
        ["provider refresh-token tombstone", () => eformsignRefreshToken(request("/api/eformsign-docs/refresh-token", { body: "{}" }))],
    ])("returns a REQUEST_EXPIRED problem for %s with no unregistered code", async (_name, act) => {
        const response = await act();

        expect(response.status).toBe(410);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        expect(response.headers.get("Content-Language")).toBe("ko-KR");
        expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
        const body = await response.json();
        expect(body).toEqual(expect.objectContaining({
            code: "REQUEST_EXPIRED",
            status: 410,
            outcome: "NOT_APPLIED",
            error: "Raw eformsign credentials are not exposed",
        }));
        expect(body.code).not.toBe("EFORMSIGN_CREDENTIALS_SERVER_ONLY");
    });

    it("returns an AUTH_REQUIRED problem for adopt without a token", async () => {
        const response = await adoptDocument(
            request("/api/eformsign-docs/adopt", { cookie: false, body: JSON.stringify({ documentId: "doc-1" }) }),
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
            error: "Unauthorized",
        }));
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("sanitizes an adopt upstream rejection with the status preserved", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { message: "Version is already current: Bearer upstream-secret" },
            },
        });

        const response = await adoptDocument(
            request("/api/eformsign-docs/adopt", { body: JSON.stringify({ documentId: "doc-1" }) }),
        );

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).toMatch(/[가-힣]/);
        expect(body.code).not.toBe("UPSTREAM_ERROR");
        expect(JSON.stringify(body)).not.toContain("upstream-secret");
    });

    it("forwards a registered upstream problem body verbatim on adopt", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 422,
                data: {
                    type: "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#validation-failed",
                    title: "Validation failed",
                    status: 422,
                    detail: "입력 정보가 처리 조건에 맞지 않아요.",
                    code: "VALIDATION_FAILED",
                    requestId: "req-adopt-1",
                    params: {},
                },
            },
        });

        const response = await adoptDocument(
            request("/api/eformsign-docs/adopt", { body: JSON.stringify({ documentId: "doc-1" }) }),
        );

        expect(response.status).toBe(422);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 422, requestId: "req-adopt-1" });
    });
});
