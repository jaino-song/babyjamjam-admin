/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as listInquiries } from "../route";
import { PATCH as markRead } from "../[id]/read/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        patch: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;

function request(path: string, init: { method?: string; cookie?: boolean } = {}): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: init.method ?? "GET",
        headers: init.cookie === false ? {} : { cookie: "auth_token=auth-token" },
    });
}

const readParams = { params: Promise.resolve({ id: "inquiry-1" }) };

describe("consultation-inquiries BFF problem conversion (BJJ-319 6h2)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        mockPatch.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("returns an AUTH_REQUIRED problem for the list without a token", async () => {
        const response = await listInquiries(request("/api/consultation-inquiries", { cookie: false }));

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
        }));
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("returns an AUTH_REQUIRED problem for the read mark without a token", async () => {
        const response = await markRead(request("/api/consultation-inquiries/inquiry-1/read", { method: "PATCH", cookie: false }), readParams);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            outcome: "NOT_APPLIED",
        }));
        expect(mockPatch).not.toHaveBeenCalled();
    });

    it("rejects a malformed inquiry id with a VALIDATION_FAILED path problem", async () => {
        const response = await markRead(
            request("/api/consultation-inquiries/bad%2Fid/read", { method: "PATCH" }),
            { params: Promise.resolve({ id: "bad/id" }) },
        );

        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const requestId = response.headers.get("X-Request-Id");
        expect(requestId).toBeTruthy();
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            error: "Invalid inquiry id",
            requestId,
            errors: [{ pointer: "/id", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" }],
        }));
        expect(mockPatch).not.toHaveBeenCalled();
    });

    it("keeps the list success passthrough", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { items: [] } });

        const response = await listInquiries(request("/api/consultation-inquiries"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ items: [] });
    });
});
