/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(): NextRequest {
    return new NextRequest("http://localhost/api/admin/service-records/drafts/draft-1/confirm", {
        method: "POST",
        headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
        body: JSON.stringify({ expectedDraftVersion: 2, previewId: "preview-1", idempotencyKey: "key-1" }),
    });
}

function upstreamConflict(extra: Record<string, unknown>) {
    const problem = createProblemDetails({
        code: "REQUEST_CONFLICT",
        requestId: "req-draft-confirm",
        outcome: "NOT_APPLIED",
    });
    return {
        response: {
            status: 409,
            data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail, ...extra },
        },
    };
}

describe("POST /api/admin/service-records/drafts/[draftId]/confirm", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated confirm with a registered 401 problem body", async () => {
        const request = new NextRequest(
            "http://localhost/api/admin/service-records/drafts/draft-1/confirm",
            { method: "POST" },
        );

        const response = await POST(request, { params: Promise.resolve({ draftId: "draft-1" }) });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards the confirm body and returns the upstream success body", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { status: "confirmed", caseVersion: 4 } });

        const response = await POST(createRequest(), { params: Promise.resolve({ draftId: "draft-1" }) });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: "confirmed", caseVersion: 4 });
        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/drafts/draft-1/confirm",
            { expectedDraftVersion: 2, previewId: "preview-1", idempotencyKey: "key-1" },
            expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
        );
    });

    it("keeps reduced blockingReasons on a 409 so a locked session is explained", async () => {
        mockPost.mockRejectedValue(upstreamConflict({
            blockingReasons: [
                { code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 3, message: "private", assignmentId: "a-1" },
            ],
            internalNote: "do not leak",
        }));

        const response = await POST(createRequest(), { params: Promise.resolve({ draftId: "draft-1" }) });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({ code: "REQUEST_CONFLICT", status: 409 });
        expect(body.blockingReasons).toEqual([{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 3 }]);
        expect(body).not.toHaveProperty("internalNote");
    });

    it("keeps a known scheduleCode but drops one outside the allow-list", async () => {
        mockPost.mockRejectedValueOnce(upstreamConflict({ scheduleCode: "INCOMPLETE_VECTOR" }));
        const known = await POST(createRequest(), { params: Promise.resolve({ draftId: "draft-1" }) });
        await expect(known.json()).resolves.toMatchObject({ scheduleCode: "INCOMPLETE_VECTOR" });

        mockPost.mockRejectedValueOnce(upstreamConflict({ scheduleCode: "made-up" }));
        const unknown = await POST(createRequest(), { params: Promise.resolve({ draftId: "draft-1" }) });
        await expect(unknown.json()).resolves.not.toHaveProperty("scheduleCode");
    });

    it("still re-attaches a blockingOperation next to the schedule extensions", async () => {
        mockPost.mockRejectedValue(upstreamConflict({
            blockingOperation: { operation: "record_snapshot", status: "running", lastErrorCode: null },
            blockingReasons: [{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 1 }],
        }));

        const response = await POST(createRequest(), { params: Promise.resolve({ draftId: "draft-1" }) });

        const body = await response.json();
        expect(body.blockingOperation).toEqual({ operation: "record_snapshot", status: "running", lastErrorCode: null });
        expect(body.blockingReasons).toEqual([{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 1 }]);
    });
});
