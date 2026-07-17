/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST as approveScheduleChange } from "../[id]/approve/route";
import { POST as rejectScheduleChange } from "../[id]/reject/route";
import { POST as applyScheduleChange } from "../schedules/[scheduleId]/apply/route";
import { GET as previewScheduleChange } from "../schedules/[scheduleId]/preview/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(
    path: string,
    method: "GET" | "POST",
    body?: object,
    authenticated = true,
): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method,
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

describe("mobile admin service schedule change proxy routes", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("forwards an authenticated preview request without caching", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { sessionIndex: 3 } });

        const response = await previewScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/preview", "GET"),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(mockGet).toHaveBeenCalledWith(
            "/schedule-change-requests/schedules/11/preview",
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("forwards only a valid selected date", async () => {
        mockPost.mockResolvedValue({ status: 201, data: { status: "approved" } });

        const response = await applyScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/apply", "POST", {
                toDate: "2026-07-23",
                ignored: "do-not-forward",
            }),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(201);
        expect(mockPost).toHaveBeenCalledWith(
            "/schedule-change-requests/schedules/11/apply",
            { toDate: "2026-07-23" },
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("rejects invalid dates before they reach the backend", async () => {
        const response = await applyScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/apply", "POST", {
                toDate: "2026-02-30",
            }),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("preserves an upstream stale-request status and code", async () => {
        mockPost.mockRejectedValue({
            response: { status: 409, data: { code: "REQUEST_STALE" } },
        });

        const response = await approveScheduleChange(
            createRequest("/api/schedule-change-requests/request-11/approve", "POST"),
            { params: Promise.resolve({ id: "request-11" }) },
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "REQUEST_STALE",
        }));
        expect(mockPost).toHaveBeenCalledWith(
            "/schedule-change-requests/request-11/approve",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("forwards only a string reject reason", async () => {
        mockPost.mockResolvedValue({ status: 200, data: {} });

        await rejectScheduleChange(
            createRequest("/api/schedule-change-requests/request-11/reject", "POST", {
                reason: "관리자가 확인했습니다.",
                ignored: true,
            }),
            { params: Promise.resolve({ id: "request-11" }) },
        );

        expect(mockPost).toHaveBeenCalledWith(
            "/schedule-change-requests/request-11/reject",
            { reason: "관리자가 확인했습니다." },
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("requires authentication before calling the backend", async () => {
        const response = await previewScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/preview", "GET", undefined, false),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(401);
        expect(mockGet).not.toHaveBeenCalled();
    });
});
