/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

const JOB_ID = "3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b";
const BACKEND_PATH = `/eformsign-docs/jobs/${JOB_ID}/resolve`;

function createRequest(authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/eformsign-docs/jobs/job/resolve", {
        method: "POST",
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    });
}

function call(jobId: string, authenticated = true) {
    return POST(createRequest(authenticated), { params: Promise.resolve({ jobId }) });
}

function upstreamRejection(status: number, data: Record<string, unknown>) {
    return { response: { status, data } };
}

describe("POST /api/eformsign-docs/jobs/[jobId]/resolve", () => {
    beforeEach(() => {
        mockPost.mockReset();
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated request with a 401 problem and no backend call", async () => {
        const response = await call(JOB_ID, false);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it.each(["not-a-uuid", "..", "a/b", "%2e%2e", "%2F", "../../x", "3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b/extra", ""])(
        "rejects job id %p with 400 before calling the backend",
        async (jobId) => {
            const response = await call(jobId);

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_FAILED" });
            expect(mockPost).not.toHaveBeenCalled();
        },
    );

    it("calls the backend path with the auth header and no body, and passes a 200 through", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { job: { jobId: JOB_ID }, alreadyResolved: false } });

        const response = await call(JOB_ID);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ job: { jobId: JOB_ID }, alreadyResolved: false });
        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(mockPost).toHaveBeenCalledWith(BACKEND_PATH, undefined, {
            headers: { Authorization: "Bearer token-1" },
        });
    });

    it("passes a 409 MANUAL_RECOVERY_CLAIMED through with expiresAt", async () => {
        mockPost.mockRejectedValue(
            upstreamRejection(409, {
                code: "MANUAL_RECOVERY_CLAIMED",
                expiresAt: "2026-11-01T01:10:00.000Z",
                message: "internal detail that must not leak",
            }),
        );

        const response = await call(JOB_ID);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            code: "MANUAL_RECOVERY_CLAIMED",
            expiresAt: "2026-11-01T01:10:00.000Z",
        });
    });

    it("passes a 409 JOB_NOT_RECOVERABLE through with its status", async () => {
        mockPost.mockRejectedValue(upstreamRejection(409, { code: "JOB_NOT_RECOVERABLE", status: "completed" }));

        const response = await call(JOB_ID);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ code: "JOB_NOT_RECOVERABLE", status: "completed" });
    });

    it("passes a 410 RECOVERY_PAYLOAD_EXPIRED through with claimExpiresAt", async () => {
        mockPost.mockRejectedValue(
            upstreamRejection(410, { code: "RECOVERY_PAYLOAD_EXPIRED", claimExpiresAt: "2026-11-01T01:10:00.000Z" }),
        );

        const response = await call(JOB_ID);

        expect(response.status).toBe(410);
        await expect(response.json()).resolves.toEqual({
            code: "RECOVERY_PAYLOAD_EXPIRED",
            claimExpiresAt: "2026-11-01T01:10:00.000Z",
        });
    });

    it("passes a 404 through", async () => {
        mockPost.mockRejectedValue(upstreamRejection(404, { code: "RESOURCE_NOT_FOUND", message: "Job not found" }));

        const response = await call(JOB_ID);

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ code: "RESOURCE_NOT_FOUND" });
    });

    it("keeps a 403 status without forwarding its body", async () => {
        mockPost.mockRejectedValue(upstreamRejection(403, { message: "Forbidden resource detail" }));

        const response = await call(JOB_ID);

        expect(response.status).toBe(403);
        expect(JSON.stringify(await response.json())).not.toContain("Forbidden resource detail");
    });

    it("does not forward an unknown code or field from a 4xx body", async () => {
        mockPost.mockRejectedValue(upstreamRejection(409, { code: "SOMETHING_ELSE", secret: "shard-8" }));

        const response = await call(JOB_ID);

        expect(response.status).toBe(409);
        expect(JSON.stringify(await response.json())).not.toContain("shard-8");
    });

    it("sanitizes a 5xx upstream failure", async () => {
        mockPost.mockRejectedValue(upstreamRejection(500, { message: "queue shard-8 exploded" }));

        const response = await call(JOB_ID);

        expect(response.status).toBe(500);
        expect(JSON.stringify(await response.json())).not.toContain("shard-8");
    });
});
