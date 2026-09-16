/**
 * @jest-environment node
 */
import {
    unauthorizedProblemResponse,
    upstreamUnavailableProblemResponse,
    validationProblemResponse,
    dependencyUnavailableProblemResponse,
    requestExpiredProblemResponse,
    upstreamSseTransportErrorResponse,
    upstreamSseUpstreamErrorResponse,
} from "../problem-responses";

import { PROBLEM_CATALOG } from "@babyjamjam/shared";

describe("mobile BFF local problem responses", () => {
    const problemHeaders = (response: Response): void => {
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(response.headers.get("content-language")).toBe("ko-KR");
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(response.headers.get("x-request-id")).toBeTruthy();
    };

    it("shapes a missing-token rejection as a registered AUTH_REQUIRED problem", async () => {
        const response = unauthorizedProblemResponse();

        expect(response.status).toBe(401);
        problemHeaders(response);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
            error: "Unauthorized",
        }));
        expect(PROBLEM_CATALOG.AUTH_REQUIRED.status).toBe(401);
    });

    it("shapes a local parameter rejection as a registered VALIDATION_FAILED problem", async () => {
        const response = validationProblemResponse("Invalid schedule id", [
            { pointer: "/scheduleId", code: "INVALID_FORMAT", detail: "일정 ID 형식이 올바르지 않아요.", location: "path" },
        ]);

        expect(response.status).toBe(400);
        problemHeaders(response);
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
    });

    it("marks an unconfirmable mutation transport failure UNKNOWN with CHECK_STATUS", async () => {
        const response = upstreamUnavailableProblemResponse("mutation");

        expect(response.status).toBe(502);
        problemHeaders(response);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "UPSTREAM_INVALID_RESPONSE",
            status: 502,
            outcome: "UNKNOWN",
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
            error: "Upstream unavailable",
        }));
    });

    it("marks an unapplied read transport failure NOT_APPLIED with NONE", async () => {
        const response = upstreamUnavailableProblemResponse("read");

        expect(response.status).toBe(502);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "UPSTREAM_INVALID_RESPONSE",
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        }));
    });

    it("shapes an unreachable exchange as a registered DEPENDENCY_UNAVAILABLE problem", async () => {
        const response = dependencyUnavailableProblemResponse("mutation");

        expect(response.status).toBe(503);
        problemHeaders(response);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "DEPENDENCY_UNAVAILABLE",
            status: 503,
            outcome: "UNKNOWN",
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
        }));
    });

    it("shapes a retired endpoint as a registered REQUEST_EXPIRED problem", async () => {
        const response = requestExpiredProblemResponse("Legacy token callback is disabled");

        expect(response.status).toBe(410);
        problemHeaders(response);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "REQUEST_EXPIRED",
            status: 410,
            outcome: "NOT_APPLIED",
            error: "Legacy token callback is disabled",
        }));
    });

    it("keeps the SSE error envelope while upgrading a transport failure to a problem", async () => {
        const response = upstreamSseTransportErrorResponse("mutation");

        expect(response.status).toBe(502);
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        const text = await response.text();
        expect(text).toMatch(/^event: error\ndata: /);
        const payload = JSON.parse(text.replace(/^event: error\ndata: /, "").trim());
        expect(payload).toMatchObject({
            type: "error",
            code: "UPSTREAM_INVALID_RESPONSE",
            status: 502,
            outcome: "UNKNOWN",
        });
        expect(typeof payload.error).toBe("string");
        expect(payload.requestId).toBeTruthy();
    });

    it("forwards a verbatim upstream problem body through the SSE envelope", async () => {
        const upstreamProblem = {
            type: PROBLEM_CATALOG.REQUEST_INVALID.type,
            title: PROBLEM_CATALOG.REQUEST_INVALID.title["ko-KR"],
            status: 400,
            detail: PROBLEM_CATALOG.REQUEST_INVALID.detail["ko-KR"],
            code: "REQUEST_INVALID",
            requestId: "req-1",
            params: {},
        };
        const response = upstreamSseUpstreamErrorResponse(400, JSON.stringify(upstreamProblem));

        expect(response.status).toBe(400);
        const payload = JSON.parse((await response.text()).replace(/^event: error\ndata: /, "").trim());
        expect(payload).toMatchObject({
            type: "error",
            code: "REQUEST_INVALID",
            status: 400,
            requestId: "req-1",
        });
    });

    it("falls back to the sanitized Korean message without inventing a code for a non-problem upstream body", async () => {
        const response = upstreamSseUpstreamErrorResponse(429, "too many requests");

        expect(response.status).toBe(429);
        const payload = JSON.parse((await response.text()).replace(/^event: error\ndata: /, "").trim());
        expect(payload).toMatchObject({ type: "error", error: expect.stringMatching(/[가-힣]/) });
        expect(payload).not.toHaveProperty("code");
        expect(JSON.stringify(payload)).not.toContain("too many requests");
    });
});
