/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { PATCH } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        patch: jest.fn(),
    },
}));

const mockPatch = serverAPIClient.patch as jest.Mock;

function createRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/admin/service-records/drafts/draft-1", {
        method: "PATCH",
        headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("PATCH /api/admin/service-records/drafts/[draftId]", () => {
    beforeEach(() => {
        mockPatch.mockReset();
    });

    it("rejects an unauthenticated save with a registered 401 problem body", async () => {
        const request = new NextRequest(
            "http://localhost/api/admin/service-records/drafts/draft-1",
            { method: "PATCH" },
        );

        const response = await PATCH(request, { params: Promise.resolve({ draftId: "draft-1" }) });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPatch).not.toHaveBeenCalled();
    });

    it("rejects a malformed body with a registered validation problem", async () => {
        const request = new NextRequest(
            "http://localhost/api/admin/service-records/drafts/draft-1",
            {
                method: "PATCH",
                headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
                body: "{bad-json",
            },
        );

        const response = await PATCH(request, { params: Promise.resolve({ draftId: "draft-1" }) });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            code: "VALIDATION_FAILED",
            outcome: "NOT_APPLIED",
        });
        expect(mockPatch).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_STALE",
            requestId: "req-draft-save",
            outcome: "NOT_APPLIED",
        });
        mockPatch.mockRejectedValue({
            response: {
                status: 409,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const response = await PATCH(createRequest({ note: "수정" }), {
            params: Promise.resolve({ draftId: "draft-1" }),
        });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({ code: "REQUEST_STALE", status: 409, outcome: "NOT_APPLIED" });
        expect(mockPatch).toHaveBeenCalledWith(
            "/admin/service-records/drafts/draft-1",
            { note: "수정" },
            expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
        );
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockPatch.mockRejectedValue(new Error("socket hang up"));

        const response = await PATCH(createRequest({ note: "수정" }), {
            params: Promise.resolve({ draftId: "draft-1" }),
        });

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).not.toContain("socket hang up");
    });
});
