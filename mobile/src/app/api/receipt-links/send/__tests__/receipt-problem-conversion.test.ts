/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST as sendReceiptLink } from "../route";
import { GET as probeAccess } from "../../../receipt/[token]/access/route";
import { GET as receiptImage } from "../../../receipt/[token]/image/route";
import { GET as receiptStatus } from "../../../receipt/[token]/status/route";
import { POST as verifyReceipt } from "../../../receipt/[token]/verify/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function postJson(path: string, body: string, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: "POST",
        headers: {
            ...(authenticated ? { cookie: "auth_token=auth-token" } : {}),
            "content-type": "application/json",
        },
        body,
    });
}

function request(path: string, cookie?: string): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        headers: cookie ? { cookie } : {},
    });
}

const tokenParams = { params: Promise.resolve({ token: "link-token" }) };

describe("receipt BFF problem conversion (BJJ-319 6h2)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    describe("receipt-links/send", () => {
        it("returns an AUTH_REQUIRED problem without a token", async () => {
            const response = await sendReceiptLink(
                postJson("/api/receipt-links/send", JSON.stringify({ documentId: "doc-1" }), false),
            );

            expect(response.status).toBe(401);
            expect(response.headers.get("Content-Type")).toBe("application/problem+json");
            await expect(response.json()).resolves.toEqual(expect.objectContaining({
                code: "AUTH_REQUIRED",
                status: 401,
                outcome: "NOT_APPLIED",
            }));
            expect(mockPost).not.toHaveBeenCalled();
        });

        it("forwards the backend's 4xx reason body verbatim so the UI keeps its reason mapping", async () => {
            mockPost.mockRejectedValue({
                response: { status: 422, data: { reason: "not_voucher_client", message: "모바일 등록된 고객이 아니에요." } },
            });

            const response = await sendReceiptLink(
                postJson("/api/receipt-links/send", JSON.stringify({ documentId: "doc-1" })),
            );

            expect(response.status).toBe(422);
            await expect(response.json()).resolves.toEqual({
                reason: "not_voucher_client",
                message: "모바일 등록된 고객이 아니에요.",
            });
        });

        it("routes a 5xx through the shared problem boundary with a Korean fallback", async () => {
            mockPost.mockRejectedValue({
                response: { status: 500, data: { message: "raw internals", diagnostics: { secret: "upstream-secret" } } },
            });

            const response = await sendReceiptLink(
                postJson("/api/receipt-links/send", JSON.stringify({ documentId: "doc-1" })),
            );

            expect(response.status).toBe(500);
            const body = await response.json();
            expect(body.error).toMatch(/[가-힣]/);
            expect(JSON.stringify(body)).not.toContain("raw internals");
            expect(JSON.stringify(body)).not.toContain("upstream-secret");
        });
    });

    describe("receipt/[token] access + image", () => {
        it.each([
            ["access", () => probeAccess(request("/api/receipt/link-token/access"), tokenParams)],
            ["image", () => receiptImage(request("/api/receipt/link-token/image"), tokenParams)],
        ])("answers a missing access cookie on %s with an AUTH_REQUIRED problem that keeps the reason contract", async (_name, act) => {
            const response = await act();

            expect(response.status).toBe(401);
            expect(response.headers.get("Content-Type")).toBe("application/problem+json");
            expect(response.headers.get("Cache-Control")).toContain("no-store");
            await expect(response.json()).resolves.toEqual(expect.objectContaining({
                code: "AUTH_REQUIRED",
                status: 401,
                outcome: "NOT_APPLIED",
                reason: "access_required",
            }));
            expect(mockGet).not.toHaveBeenCalled();
        });
    });

    describe("receipt/[token] status + verify", () => {
        it("forwards the backend's 4xx reason body verbatim on status", async () => {
            mockGet.mockRejectedValue({
                response: { status: 410, data: { reason: "expired" } },
            });

            const response = await receiptStatus(request("/api/receipt/link-token/status"), tokenParams);

            expect(response.status).toBe(410);
            await expect(response.json()).resolves.toEqual({ reason: "expired" });
        });

        it("forwards the backend's locked reason body with remaining attempts on verify", async () => {
            mockPost.mockRejectedValue({
                response: { status: 423, data: { reason: "locked", lockedUntil: "2026-09-17T00:00:00.000Z" } },
            });

            const response = await verifyReceipt(
                postJson("/api/receipt/link-token/verify", JSON.stringify({ birthday: "260917" })),
                tokenParams,
            );

            expect(response.status).toBe(423);
            await expect(response.json()).resolves.toEqual({
                reason: "locked",
                lockedUntil: "2026-09-17T00:00:00.000Z",
            });
        });

        it("routes a status 5xx through the shared problem boundary", async () => {
            mockGet.mockRejectedValue({
                response: { status: 503, data: { message: "raw internals" } },
            });

            const response = await receiptStatus(request("/api/receipt/link-token/status"), tokenParams);

            expect(response.status).toBe(503);
            const body = await response.json();
            expect(body.error).toMatch(/[가-힣]/);
            expect(JSON.stringify(body)).not.toContain("raw internals");
        });
    });
});
