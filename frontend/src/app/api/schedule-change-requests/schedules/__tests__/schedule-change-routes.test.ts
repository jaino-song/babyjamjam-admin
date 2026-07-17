/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

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

describe("admin service schedule change proxy routes", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("forwards a tenant-authenticated preview request", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: { sessionIndex: 3, fromDate: "2026-07-20", minimumDate: "2026-07-20" },
        });

        const response = await previewScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/preview", "GET"),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(200);
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

    it("rejects malformed dates before they reach the backend", async () => {
        const response = await applyScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/apply", "POST", {
                toDate: "07/23/2026",
            }),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects calendar dates that do not exist", async () => {
        const response = await applyScheduleChange(
            createRequest("/api/schedule-change-requests/schedules/11/apply", "POST", {
                toDate: "2026-02-30",
            }),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("requires admin authentication", async () => {
        const response = await previewScheduleChange(
            createRequest(
                "/api/schedule-change-requests/schedules/11/preview",
                "GET",
                undefined,
                false,
            ),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(401);
        expect(mockGet).not.toHaveBeenCalled();
    });
});
