import { createProblemDetails, normalizeApiError } from "../errors/problem-details";
import { getUserErrorMessage } from "../errors/user-error-message";
import { NextRequest } from "next/server";
import { createRouteUtils, errorResponse, sanitizeUpstreamClientError } from "./route-utils";

describe("problem proxy", () => {
    beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());

    it("normalizes a direct problem object without dropping its payload", () => {
        const problem = createProblemDetails({ code: "VALIDATION_FAILED", requestId: "request-direct" });
        expect(normalizeApiError(problem)).toMatchObject({ verified: true, problem });
    });

    it("preserves validation fields and reference through the HTTP proxy", async () => {
        const problem = createProblemDetails({
            code: "VALIDATION_FAILED", requestId: "request-1", outcome: "NOT_APPLIED",
            errors: ["/phone", "/name"].map((pointer) => ({ pointer, code: "REQUIRED", detail: "필수 항목을 입력해 주세요." })),
        });
        const response = errorResponse({ response: { status: 400, data: problem } }, "create-client");
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(response.headers.get("Cache-Control")).toContain("no-store");
        expect(response.headers.get("X-Request-Id")).toBe("request-1");
        const body = await response.json();
        expect(body.errors.map((field: { pointer: string }) => field.pointer)).toEqual(["/phone", "/name"]);
        expect(body.outcome).toBe("NOT_APPLIED");
        expect(getUserErrorMessage({ response: { status: 400, data: body } })).toBe(problem.detail);
    });

    it("does not route mismatched identifiers through legacy message inference", () => {
        const problem = createProblemDetails({ code: "CONTRACT_ALREADY_SIGNED", requestId: "request-2" });
        const payload = sanitizeUpstreamClientError({ ...problem, type: "https://invalid.example/other" }, "fallback", 409);
        expect(payload.code).toBeUndefined();
        expect(payload.error).not.toBe(problem.detail);
    });

    it("strips diagnostic extensions while preserving confirmed unknown outcomes", () => {
        const problem = createProblemDetails({ code: "INTERNAL_ERROR", requestId: "request-3", outcome: "UNKNOWN" });
        const payload = sanitizeUpstreamClientError({ ...problem, stack: "private", token: "secret" }, "fallback", 500);
        expect(payload.outcome).toBe("UNKNOWN");
        expect(JSON.stringify(payload)).not.toMatch(/private|secret/);
    });
});


describe("resolved proxy error boundary", () => {
    beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());
    it("uses problem transport for resolved errors and read copy for malformed reads", async () => {
        const problem = createProblemDetails({ code: "INTERNAL_ERROR", requestId: "resolved-request" });
        const get = jest.fn().mockResolvedValue({ status: 500, data: problem });
        const routes = createRouteUtils({ secureCookies: false, serverAPIClient: { get, post: jest.fn(), delete: jest.fn() } });
        const request = new NextRequest("http://localhost/api/clients", { headers: { cookie: "auth_token=test-token" } });
        const response = await routes.proxyGetRequest(request, "/clients", "load-clients");
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(response.headers.get("Cache-Control")).toContain("no-store");
        expect(response.headers.get("X-Request-Id")).toBe("resolved-request");
        get.mockResolvedValue({ status: 500, data: { ...problem, type: "invalid" } });
        const malformed = await routes.proxyGetRequest(request, "/clients", "load-clients");
        expect((await malformed.json()).error).toBe("요청한 정보를 불러오지 못했어요.");
    });
});
