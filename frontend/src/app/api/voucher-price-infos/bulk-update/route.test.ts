/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function postRequest(body: unknown, authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/voucher-price-infos/bulk-update", {
        method: "POST",
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            "content-type": "application/json",
        },
        body: JSON.stringify(body),
    });
}

describe("POST /api/voucher-price-infos/bulk-update", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated mutation with a registered 401 problem body", async () => {
        const response = await POST(postRequest({ items: [{ type: "A" }], year: 2026 }, false));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("answers an empty items list with a structured VALIDATION_FAILED problem", async () => {
        const response = await POST(postRequest({ items: [], year: 2026 }));

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
        expect(JSON.stringify(body)).toContain("/items");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("answers an out-of-range year with a structured VALIDATION_FAILED problem", async () => {
        const response = await POST(postRequest({ items: [{ type: "A" }], year: 1900 }));

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
        expect(JSON.stringify(body)).toContain("/year");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body faithfully", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    type: "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#request-conflict",
                    title: "요청 충돌",
                    status: 409,
                    detail: "같은 연도의 가격 정보가 이미 있어요.",
                    code: "REQUEST_CONFLICT",
                    requestId: "req-bulk-1",
                    params: {},
                },
            },
        });

        const response = await POST(postRequest({ items: [{ type: "A" }], year: 2026 }));

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({ code: "REQUEST_CONFLICT", status: 409, requestId: "req-bulk-1" });
        expect(response.headers.get("content-type")).toContain("application/problem+json");
    });

    it("sanitizes a legacy upstream failure instead of a raw data passthrough", async () => {
        mockPost.mockRejectedValue({
            response: { status: 500, data: { message: "bulk copy failed on db-writer-2" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(postRequest({ items: [{ type: "A" }], year: 2026 }));

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("db-writer-2");
        expect(JSON.stringify(body)).not.toContain("업데이트 실패");
        consoleErrorSpy.mockRestore();
    });

    it("answers a transport failure with the sanitized 500 problem contract", async () => {
        mockPost.mockRejectedValue(new Error("socket hang up on 10.0.0.3"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(postRequest({ items: [{ type: "A" }], year: 2026 }));

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body).toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
        expect(JSON.stringify(body)).not.toContain("10.0.0.3");
        consoleErrorSpy.mockRestore();
    });
});
