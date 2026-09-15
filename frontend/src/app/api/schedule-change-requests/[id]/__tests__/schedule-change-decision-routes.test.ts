/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";

import { serverAPIClient } from "@/lib/api/server";

import { POST as approveScheduleChange } from "../approve/route";
import { POST as rejectScheduleChange } from "../reject/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, body?: object, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: "POST",
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

const APPROVE_PARAMS = { params: Promise.resolve({ id: "request-11" }) };

describe("admin schedule change decision proxy routes", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("requires authentication before calling the backend", async () => {
        const approveResponse = await approveScheduleChange(
            createRequest("/api/schedule-change-requests/request-11/approve", undefined, false),
            APPROVE_PARAMS,
        );
        const rejectResponse = await rejectScheduleChange(
            createRequest("/api/schedule-change-requests/request-11/reject", undefined, false),
            APPROVE_PARAMS,
        );

        expect(approveResponse.status).toBe(401);
        await expect(approveResponse.json()).resolves.toEqual({ error: "Unauthorized" });
        expect(rejectResponse.status).toBe(401);
        await expect(rejectResponse.json()).resolves.toEqual({ error: "Unauthorized" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("passes a registered upstream problem through with its status and problem headers", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_NOT_PENDING",
            requestId: "req-1",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({ response: { status: 409, data: problem } });

        const response = await approveScheduleChange(
            createRequest("/api/schedule-change-requests/request-11/approve"),
            APPROVE_PARAMS,
        );

        expect(response.status).toBe(409);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(response.headers.get("content-language")).toBe("ko-KR");
        expect(response.headers.get("x-request-id")).toBe("req-1");
        expect(response.headers.get("cache-control")).toContain("no-store");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "REQUEST_NOT_PENDING",
            requestId: "req-1",
            outcome: "NOT_APPLIED",
        }));
    });

    it("sanitizes a legacy upstream failure without reflecting its body", async () => {
        mockPost.mockRejectedValue({
            response: { status: 500, data: { message: "internal stack trace" } },
        });

        const response = await rejectScheduleChange(
            createRequest("/api/schedule-change-requests/request-11/reject", { reason: "사유" }),
            APPROVE_PARAMS,
        );

        expect(response.status).toBe(500);
        expect(response.headers.get("content-type")).not.toBe("application/problem+json");
        const body = await response.json();
        expect(body.message).toBeUndefined();
        expect(typeof body.error).toBe("string");
        expect(body.error).not.toContain("internal stack trace");
    });

    it("returns the backend success body without caching", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { status: "approved" } });

        const response = await approveScheduleChange(
            createRequest("/api/schedule-change-requests/request-11/approve"),
            APPROVE_PARAMS,
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: "approved" });
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(mockPost).toHaveBeenCalledWith(
            "/schedule-change-requests/request-11/approve",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
    });
});
