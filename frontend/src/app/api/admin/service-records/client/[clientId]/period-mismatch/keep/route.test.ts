/** @jest-environment node */
import { NextRequest } from "next/server";
import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { POST as keep } from "./route";
import { POST as fit } from "../fit/route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
const mockPost = serverAPIClient.post as jest.Mock;
const params = { params: Promise.resolve({ clientId: "client/1" }) };

function request(body: string, authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/admin/service-records/client/1/period-mismatch/keep", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authenticated ? { cookie: "auth_token=access-token" } : {}) },
        body,
    });
}

describe.each([
    ["keep", keep, { sessionIndexes: [1, 3] }, { keptSessionIndexes: [1, 3] }],
    ["fit", fit, {}, { startDate: "2026-08-07", endDate: "2026-08-20" }],
] as const)("period mismatch %s BFF", (action, post, payload, result) => {
    beforeEach(() => mockPost.mockReset());

    it("requires authentication before calling the backend", async () => {
        const response = await post(request(JSON.stringify(payload), false), params);
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards the encoded client, JSON payload and auth headers", async () => {
        mockPost.mockResolvedValue({ status: 200, data: result });
        const response = await post(request(JSON.stringify(payload)), params);
        expect(mockPost).toHaveBeenCalledWith(
            `/admin/service-records/client/client%2F1/period-mismatch/${action}`,
            payload,
            { headers: expect.objectContaining({ Authorization: "Bearer access-token" }) },
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(result);
    });

    it.each(["{", "[]", "null"])("rejects invalid JSON object %s", async (body) => {
        const response = await post(request(body), params);
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_FAILED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it.each(["VALIDATION_FAILED", "RESOURCE_NOT_FOUND", "EMPLOYEE_SCHEDULE_OVERLAP"] as const)("preserves registered %s problems", async (code) => {
        const problem = createProblemDetails({ code, requestId: "req-period", outcome: "NOT_APPLIED" });
        const data = { ...problem, ...(code === "VALIDATION_FAILED" ? { errors: [{ pointer: "/sessionIndexes", code: "INVALID_VALUE", location: "body", detail: "잘못된 회차예요" }] } : {}) };
        mockPost.mockRejectedValue({ response: { status: problem.status, data } });
        const response = await post(request(JSON.stringify(payload)), params);
        expect(response.status).toBe(problem.status);
        await expect(response.json()).resolves.toMatchObject({ code, ...(code === "VALIDATION_FAILED" ? { errors: [expect.objectContaining({ pointer: "/sessionIndexes" })] } : {}) });
    });

    it("sanitizes unexpected transport errors", async () => {
        mockPost.mockRejectedValue(new Error("private upstream secret ECONNRESET"));
        const response = await post(request(JSON.stringify(payload)), params);
        expect(response.status).toBe(500);
        expect(JSON.stringify(await response.json())).not.toContain("ECONNRESET");
    });
});
