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

function createRequest(authenticated = true, body: unknown = { scheduledFor: "2099-01-01T00:05:00.000Z" }) {
    return new NextRequest("http://localhost/api/message-trigger-jobs/job-1/reschedule", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
        },
        body: JSON.stringify(body),
    });
}

describe("POST /api/message-trigger-jobs/[id]/reschedule", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("forwards the authenticated reschedule request and its body to the backend", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: { id: "job-1", status: "pending", scheduledFor: "2099-01-01T00:05:00.000Z" },
        });

        const response = await POST(createRequest(), {
            params: Promise.resolve({ id: "job-1" }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: "job-1", status: "pending" });
        expect(mockPost).toHaveBeenCalledWith(
            "/message-trigger-jobs/job-1/reschedule",
            { scheduledFor: "2099-01-01T00:05:00.000Z" },
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("passes an upstream forbidden answer through on its status with sanitized copy", async () => {
        mockPost.mockRejectedValue(
            new AxiosError("Forbidden", "ERR_BAD_REQUEST", undefined, undefined, {
                status: 403,
                statusText: "Forbidden",
                headers: {},
                config: { headers: new AxiosHeaders() },
                data: { message: "Forbidden resource" },
            }),
        );

        const response = await POST(createRequest(), {
            params: Promise.resolve({ id: "job-1" }),
        });

        expect(response.status).toBe(403);
        expect(JSON.stringify(await response.json())).not.toContain("Forbidden resource");
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
