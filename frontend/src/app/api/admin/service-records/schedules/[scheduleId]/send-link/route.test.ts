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

const PREPARED_TOKEN = `efl_${"a".repeat(48)}`;

function createRequest(body: unknown): NextRequest {
    return new NextRequest(
        "http://localhost/api/admin/service-records/schedules/sch-1/send-link",
        {
            method: "POST",
            headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
            body: JSON.stringify(body),
        },
    );
}

describe("POST /api/admin/service-records/schedules/[scheduleId]/send-link", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated send with a registered 401 problem body", async () => {
        const request = new NextRequest(
            "http://localhost/api/admin/service-records/schedules/sch-1/send-link",
            { method: "POST" },
        );

        const response = await POST(request, { params: Promise.resolve({ scheduleId: "sch-1" }) });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects an invalid prepared link token as a registered validation problem", async () => {
        const response = await POST(createRequest({ preparedLinkToken: "short" }), {
            params: Promise.resolve({ scheduleId: "sch-1" }),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", outcome: "NOT_APPLIED" });
        expect(body.errors?.[0]).toMatchObject({ pointer: "/preparedLinkToken", location: "body" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects an invalid recipient phone as a registered validation problem", async () => {
        const response = await POST(
            createRequest({ preparedLinkToken: PREPARED_TOKEN, recipientPhone: "123" }),
            { params: Promise.resolve({ scheduleId: "sch-1" }) },
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.errors?.[0]).toMatchObject({ pointer: "/recipientPhone", location: "body" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "DOCUMENT_PROVIDER_MISMATCH",
            requestId: "req-send-link",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const response = await POST(
            createRequest({ preparedLinkToken: PREPARED_TOKEN, recipientPhone: "010-1234-5678" }),
            { params: Promise.resolve({ scheduleId: "sch-1" }) },
        );

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({ code: "DOCUMENT_PROVIDER_MISMATCH", status: 409 });
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockPost.mockRejectedValue(new Error("read ECONNRESET"));

        const response = await POST(createRequest({ preparedLinkToken: PREPARED_TOKEN }), {
            params: Promise.resolve({ scheduleId: "sch-1" }),
        });

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).not.toContain("ECONNRESET");
    });
});
