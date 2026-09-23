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
        "http://localhost/api/admin/service-records/schedules/sch-1/prepare-link",
        {
            method: "POST",
            headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
            body: JSON.stringify(body),
        },
    );
}

describe("POST /api/admin/service-records/schedules/[scheduleId]/prepare-link", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated prepare with a registered 401 problem body", async () => {
        const request = new NextRequest(
            "http://localhost/api/admin/service-records/schedules/sch-1/prepare-link",
            { method: "POST" },
        );

        const response = await POST(request, { params: Promise.resolve({ scheduleId: "sch-1" }) });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects an invalid recipient phone as a registered validation problem", async () => {
        const response = await POST(createRequest({ recipientPhone: "not-a-phone" }), {
            params: Promise.resolve({ scheduleId: "sch-1" }),
        });

        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", outcome: "NOT_APPLIED" });
        expect(body.errors?.[0]).toMatchObject({ pointer: "/recipientPhone", location: "body" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "CLIENT_SERVICE_TERMINATED",
            requestId: "req-prepare-link",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const response = await POST(createRequest({ recipientPhone: "010-1234-5678" }), {
            params: Promise.resolve({ scheduleId: "sch-1" }),
        });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({ code: "CLIENT_SERVICE_TERMINATED", status: 409 });
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockPost.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.4:5432"));

        const response = await POST(createRequest({}), {
            params: Promise.resolve({ scheduleId: "sch-1" }),
        });

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).not.toContain("ECONNREFUSED");
    });
});
