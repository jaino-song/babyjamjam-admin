/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";

import { serverAPIClient } from "@/lib/api/server";

import { POST as applyScheduleChange } from "../[scheduleId]/apply/route";
import { GET as previewScheduleChange } from "../[scheduleId]/preview/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, method: "GET" | "POST", body?: object, authenticated = true) {
    return new NextRequest(`http://localhost${path}`, {
        method,
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

const APPLY_PARAMS = { params: Promise.resolve({ scheduleId: "11" }) };

async function expectInvalidScheduleDate(response: Response): Promise<void> {
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
        code: "VALIDATION_FAILED",
        status: 400,
        outcome: "NOT_APPLIED",
        error: "Invalid schedule date",
        errors: [{
            pointer: "/toDate",
            code: "INVALID_FORMAT",
            detail: "입력 형식이 올바르지 않아요.",
            location: "body",
        }],
    }));
}

describe("admin service schedule change proxy routes", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("forwards a tenant-authenticated preview request without caching", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: { sessionIndex: 3, fromDate: "2026-07-20", minimumDate: "2026-07-20" },
        });

        const response = await previewScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/preview", "GET"),
            APPLY_PARAMS,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toContain("no-store");
        await expect(response.json()).resolves.toEqual({
            sessionIndex: 3,
            fromDate: "2026-07-20",
            minimumDate: "2026-07-20",
        });
        expect(mockGet).toHaveBeenCalledWith(
            "/schedule-change-requests/schedules/11/preview",
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("passes a registered upstream preview problem through with its status", async () => {
        const problem = createProblemDetails({
            code: "RESOURCE_NOT_FOUND",
            requestId: "req-2",
            outcome: "NOT_APPLIED",
        });
        mockGet.mockRejectedValue({ response: { status: 404, data: problem } });

        const response = await previewScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/preview", "GET"),
            APPLY_PARAMS,
        );

        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(response.headers.get("x-request-id")).toBe("req-2");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "RESOURCE_NOT_FOUND",
            requestId: "req-2",
        }));
    });

    it("forwards only a valid selected date", async () => {
        mockPost.mockResolvedValue({ status: 201, data: { status: "approved" } });

        const response = await applyScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/apply", "POST", {
                toDate: "2026-07-23",
                ignored: "do-not-forward",
            }),
            APPLY_PARAMS,
        );

        expect(response.status).toBe(201);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(mockPost).toHaveBeenCalledWith(
            "/schedule-change-requests/schedules/11/apply",
            { toDate: "2026-07-23" },
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("rejects malformed dates with a problem body before they reach the backend", async () => {
        const response = await applyScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/apply", "POST", {
                toDate: "07/23/2026",
            }),
            APPLY_PARAMS,
        );

        await expectInvalidScheduleDate(response);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects calendar dates that do not exist with a problem body", async () => {
        const response = await applyScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/apply", "POST", {
                toDate: "2026-02-30",
            }),
            APPLY_PARAMS,
        );

        await expectInvalidScheduleDate(response);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("requires admin authentication with the shared 401 shape", async () => {
        const response = await previewScheduleChange(
            createRequest(
                "/api/schedule-change-requests/schedules/11/preview",
                "GET",
                undefined,
                false,
            ),
            APPLY_PARAMS,
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
        expect(mockGet).not.toHaveBeenCalled();
    });
});
