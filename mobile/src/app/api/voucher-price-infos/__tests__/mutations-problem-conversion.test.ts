/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST as bulkUpdate } from "../bulk-update/route";
import { POST as parseImage } from "../parse-image/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function jsonRequest(path: string, body: string, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: "POST",
        headers: {
            ...(authenticated ? { cookie: "auth_token=auth-token" } : {}),
            "content-type": "application/json",
        },
        body,
    });
}

function imageRequest(authenticated = true): NextRequest {
    const formData = new FormData();
    formData.append("image", new File(["bytes"], "statement.png", { type: "image/png" }));
    return new NextRequest("http://localhost/api/voucher-price-infos/parse-image", {
        method: "POST",
        headers: authenticated ? { cookie: "auth_token=auth-token" } : {},
        body: formData,
    });
}

describe("voucher-price-infos mutations BFF problem conversion (BJJ-319 6h2)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        ["bulk-update", () => bulkUpdate(jsonRequest("/api/voucher-price-infos/bulk-update", "{}", false))],
        ["parse-image", () => parseImage(imageRequest(false))],
    ])("returns an AUTH_REQUIRED problem for %s without a token", async (_name, act) => {
        const response = await act();

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
        }));
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects an empty bulk-update body with a VALIDATION_FAILED problem instead of a raw Korean 400", async () => {
        const response = await bulkUpdate(jsonRequest("/api/voucher-price-infos/bulk-update", "{}"));

        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const body = await response.json();
        expect(body).toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            error: "업데이트할 항목이 없습니다",
        }));
        expect(Array.isArray(body.errors)).toBe(true);
        expect(body.errors[0].pointer).toBe("/items");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects an out-of-range year with a VALIDATION_FAILED problem on /year", async () => {
        const response = await bulkUpdate(jsonRequest(
            "/api/voucher-price-infos/bulk-update",
            JSON.stringify({ items: [{ amount: 1 }], year: 1900 }),
        ));

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            error: "유효한 연도를 입력해주세요 (2000-2100)",
        }));
        expect(body.errors[0].pointer).toBe("/year");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects a missing parse-image file with a VALIDATION_FAILED problem", async () => {
        const formData = new FormData();
        const request = new NextRequest("http://localhost/api/voucher-price-infos/parse-image", {
            method: "POST",
            headers: { cookie: "auth_token=auth-token" },
            body: formData,
        });

        const response = await parseImage(request);

        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const body = await response.json();
        expect(body).toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            outcome: "NOT_APPLIED",
            error: "이미지 파일이 필요합니다",
        }));
        expect(body.errors[0].pointer).toBe("/image");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("preserves an upstream rejection status through the shared problem boundary for bulk-update", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 403,
                data: { message: "권한이 없어요.", diagnostics: { secret: "upstream-secret" } },
            },
        });

        const response = await bulkUpdate(jsonRequest(
            "/api/voucher-price-infos/bulk-update",
            JSON.stringify({ items: [{ amount: 1 }], year: 2026 }),
        ));

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.error).toMatch(/[가-힣]/);
        expect(JSON.stringify(body)).not.toContain("upstream-secret");
    });

    it("preserves an upstream rejection status through the shared problem boundary for parse-image", async () => {
        mockPost.mockRejectedValue({
            response: { status: 413, data: { message: "raw upstream detail" } },
        });

        const response = await parseImage(imageRequest());

        expect(response.status).toBe(413);
        const body = await response.json();
        expect(body.error).toMatch(/[가-힣]/);
        expect(JSON.stringify(body)).not.toContain("raw upstream detail");
    });

    it("keeps the bulk-update success passthrough", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { updated: 2 } });

        const response = await bulkUpdate(jsonRequest(
            "/api/voucher-price-infos/bulk-update",
            JSON.stringify({ items: [{ amount: 1 }], year: 2026 }),
        ));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ updated: 2 });
    });
});
