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

function createRequest(body: unknown): NextRequest {
    return new NextRequest(
        "http://localhost/api/admin/service-records/revisions/rev-1/documents/state-1/retry",
        {
            method: "POST",
            headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
            body: JSON.stringify(body),
        },
    );
}

describe("POST /api/admin/service-records/.../retry", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated retry with a registered 401 problem body", async () => {
        const request = new NextRequest(
            "http://localhost/api/admin/service-records/revisions/rev-1/documents/state-1/retry",
            { method: "POST" },
        );

        const response = await POST(request, {
            params: Promise.resolve({ revisionId: "rev-1", documentStateId: "state-1" }),
        });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects a body without expectedGeneration as a registered validation problem", async () => {
        const response = await POST(createRequest({}), {
            params: Promise.resolve({ revisionId: "rev-1", documentStateId: "state-1" }),
        });

        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const body = await response.json();
        expect(body).toMatchObject({
            code: "VALIDATION_FAILED",
            outcome: "NOT_APPLIED",
        });
        expect(body.errors?.[0]).toMatchObject({ pointer: "/expectedGeneration", location: "body" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects an over-long expectedGeneration as out of range", async () => {
        const response = await POST(createRequest({ expectedGeneration: "g".repeat(129) }), {
            params: Promise.resolve({ revisionId: "rev-1", documentStateId: "state-1" }),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.errors?.[0]).toMatchObject({ pointer: "/expectedGeneration" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_CONFLICT",
            requestId: "req-document-retry",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const response = await POST(createRequest({ expectedGeneration: "gen-7" }), {
            params: Promise.resolve({ revisionId: "rev-1", documentStateId: "state-1" }),
        });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({ code: "REQUEST_CONFLICT", status: 409 });
        expect(mockPost).toHaveBeenCalledWith(
            expect.stringContaining("/documents/state-1/retry"),
            { expectedGeneration: "gen-7" },
            expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
        );
    });
});
