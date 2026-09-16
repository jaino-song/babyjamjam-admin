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

describe("POST /api/admin/service-records/drafts/[draftId]/preview", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated preview with a registered 401 problem body", async () => {
        const request = new NextRequest(
            "http://localhost/api/admin/service-records/drafts/draft-1/preview",
            { method: "POST" },
        );

        const response = await POST(request, { params: Promise.resolve({ draftId: "draft-1" }) });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects a malformed body with a registered validation problem", async () => {
        const request = new NextRequest(
            "http://localhost/api/admin/service-records/drafts/draft-1/preview",
            {
                method: "POST",
                headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
                body: "[1,2,3]",
            },
        );

        const response = await POST(request, { params: Promise.resolve({ draftId: "draft-1" }) });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            code: "VALIDATION_FAILED",
            outcome: "NOT_APPLIED",
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE",
            requestId: "req-draft-preview",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const request = new NextRequest(
            "http://localhost/api/admin/service-records/drafts/draft-1/preview",
            {
                method: "POST",
                headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
                body: JSON.stringify({ plannedDate: "2026-09-18" }),
            },
        );
        const response = await POST(request, { params: Promise.resolve({ draftId: "draft-1" }) });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({
            code: "SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE",
            status: 409,
        });
    });
});
