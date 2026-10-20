/**
 * @jest-environment node
 */
import { AxiosError, AxiosHeaders } from "axios";
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(authenticated = true) {
    return new NextRequest("http://localhost/api/message-trigger-jobs/job-1/resend", {
        method: "POST",
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    });
}

describe("POST /api/message-trigger-jobs/[id]/resend", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("forwards the authenticated resend request to the backend and relays status and reason", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: { id: "job-1", status: "needs_setup", reason: "수신자 연락처가 필요합니다." },
        });

        const response = await POST(createRequest(), {
            params: Promise.resolve({ id: "job-1" }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            id: "job-1",
            status: "needs_setup",
            reason: "수신자 연락처가 필요합니다.",
        });
        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(mockPost).toHaveBeenCalledWith(
            "/message-trigger-jobs/job-1/resend",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("answers a conflict with sanitized Korean copy on the upstream status", async () => {
        mockPost.mockRejectedValue(
            new AxiosError("Conflict", "ERR_BAD_RESPONSE", undefined, undefined, {
                status: 409,
                statusText: "Conflict",
                headers: {},
                config: { headers: new AxiosHeaders() },
                data: { message: "upstream internal detail" },
            }),
        );

        const response = await POST(createRequest(), {
            params: Promise.resolve({ id: "job-1" }),
        });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).toMatch(/[가-힣]/);
        expect(JSON.stringify(body)).not.toContain('"message"');
        expect(JSON.stringify(body)).not.toContain("upstream internal detail");
    });

    it("requires authentication before forwarding", async () => {
        const response = await POST(createRequest(false), {
            params: Promise.resolve({ id: "job-1" }),
        });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockPost).not.toHaveBeenCalled();
    });
});
