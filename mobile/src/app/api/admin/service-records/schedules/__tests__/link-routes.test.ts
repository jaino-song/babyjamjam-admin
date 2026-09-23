/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST as resetLink } from "../[scheduleId]/reset-link/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/admin/service-records/schedules/11/reset-link", {
        method: "POST",
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    });
}

describe("mobile service-record reset link proxy", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("resets the link without sending a message", async () => {
        mockPost.mockResolvedValue({
            status: 201,
            data: {
                serviceRecordUrl: "https://mobile.test/service-record/token-1",
                expiresAt: "2026-07-20T00:00:00.000Z",
            },
        });

        const response = await resetLink(createRequest(), {
            params: Promise.resolve({ scheduleId: "11" }),
        });

        expect(response.status).toBe(201);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/schedules/11/reset-link",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
        expect(mockPost).not.toHaveBeenCalledWith(
            expect.stringContaining("/send-link"),
            expect.anything(),
            expect.anything(),
        );
    });

    it("requires authentication", async () => {
        const response = await resetLink(createRequest(false), {
            params: Promise.resolve({ scheduleId: "11" }),
        });

        expect(response.status).toBe(401);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
            error: "Unauthorized",
        }));
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects a non-positive schedule id with a VALIDATION_FAILED problem", async () => {
        const response = await resetLink(createRequest(), {
            params: Promise.resolve({ scheduleId: "abc" }),
        });

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(response.headers.get("content-language")).toBe("ko-KR");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            error: "Invalid schedule id",
            errors: [{
                pointer: "/scheduleId",
                code: "INVALID_FORMAT",
                detail: "입력 형식이 올바르지 않아요.",
                location: "path",
            }],
        }));
        expect(mockPost).not.toHaveBeenCalled();
    });
});
