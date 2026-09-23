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

describe("POST /api/admin/service-records/schedules/[scheduleId]/reset-link", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated reset with a registered 401 problem body", async () => {
        const request = new NextRequest(
            "http://localhost/api/admin/service-records/schedules/sch-1/reset-link",
            { method: "POST" },
        );

        const response = await POST(request, { params: Promise.resolve({ scheduleId: "sch-1" }) });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "SCHEDULE_RETENTION_BLOCKED",
            requestId: "req-reset-link",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const request = new NextRequest(
            "http://localhost/api/admin/service-records/schedules/sch-1/reset-link",
            {
                method: "POST",
                headers: { cookie: "auth_token=access-token", "content-type": "application/json" },
                body: "{}",
            },
        );
        const response = await POST(request, { params: Promise.resolve({ scheduleId: "sch-1" }) });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({ code: "SCHEDULE_RETENTION_BLOCKED", status: 409 });
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockPost.mockRejectedValue(new Error("upstream socket closed"));

        const request = new NextRequest(
            "http://localhost/api/admin/service-records/schedules/sch-1/reset-link",
            {
                method: "POST",
                headers: { cookie: "auth_token=access-token" },
            },
        );
        const response = await POST(request, { params: Promise.resolve({ scheduleId: "sch-1" }) });

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).not.toContain("socket");
    });
});
