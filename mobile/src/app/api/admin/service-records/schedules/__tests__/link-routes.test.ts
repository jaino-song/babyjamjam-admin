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
        expect(mockPost).not.toHaveBeenCalled();
    });
});
