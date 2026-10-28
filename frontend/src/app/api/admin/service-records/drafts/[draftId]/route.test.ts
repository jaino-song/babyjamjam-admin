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

    it("keeps a known scheduleCode on a 400 and drops every other unknown member", async () => {
        const problem = createProblemDetails({
            code: "VALIDATION_FAILED",
            requestId: "req-draft-schedule",
            outcome: "NOT_APPLIED",
        });
        mockPatch.mockRejectedValue({
            response: {
                status: 400,
                data: {
                    ...problem,
                    statusCode: problem.status,
                    message: "Session 3 must use a Korean business day",
                    error: problem.detail,
                    scheduleCode: "SCHEDULE_COUNT_MISMATCH",
                    sessionIndex: 3,
                    stack: "Error: secret",
                },
            },
        });

        const response = await PATCH(createRequest({ schedule: {} }), {
            params: Promise.resolve({ draftId: "draft-1" }),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", scheduleCode: "SCHEDULE_COUNT_MISMATCH" });
        expect(body).not.toHaveProperty("stack");
        expect(body).not.toHaveProperty("sessionIndex");
        expect(JSON.stringify(body)).not.toContain("Session 3 must use");
    });

    it("rejects an unknown scheduleCode and keeps only well-formed blockingReasons on a 409", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_CONFLICT",
            requestId: "req-draft-schedule-409",
            outcome: "NOT_APPLIED",
        });
        mockPatch.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    ...problem,
                    statusCode: problem.status,
                    message: problem.detail,
                    error: problem.detail,
                    scheduleCode: "NOT_A_KNOWN_CODE",
                    blockingReasons: [
                        { code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 3, message: "private", assignmentId: "a-1" },
                        { code: "lowercase-is-rejected" },
                        "not-an-object",
                    ],
                },
            },
        });

        const response = await PATCH(createRequest({ schedule: {} }), {
            params: Promise.resolve({ draftId: "draft-1" }),
        });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).not.toHaveProperty("scheduleCode");
        expect(body.blockingReasons).toEqual([{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 3 }]);
    });

    it("does not attach the extensions to other statuses", async () => {
        mockPatch.mockRejectedValue({
            response: { status: 500, data: { scheduleCode: "SCHEDULE_COUNT_MISMATCH", blockingReasons: [{ code: "NON_SERVICE_DAY" }] } },
        });

        const response = await PATCH(createRequest({ schedule: {} }), {
            params: Promise.resolve({ draftId: "draft-1" }),
        });

        const body = await response.json();
        expect(body).not.toHaveProperty("scheduleCode");
        expect(body).not.toHaveProperty("blockingReasons");
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
