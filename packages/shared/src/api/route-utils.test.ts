import { NextRequest } from "next/server";
import { z } from "zod";

import { normalizeApiError } from "../errors/problem-details";
import { createRouteUtils, logUpstreamError, parseBody } from "./route-utils";

function createJsonRequest(body: string): NextRequest {
    return new NextRequest("http://localhost/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: "auth_token=test-token" },
        body,
    });
}

describe("logUpstreamError", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("caps the upstream response body at 2,000 characters", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError("proxy", new Error("upstream failed"), "a".repeat(2_001));

        expect(errorSpy).toHaveBeenCalledWith("[proxy] Error:", expect.objectContaining({
            body: `${"a".repeat(2_000)}…(truncated)`,
        }));
    });

    it("preserves the existing two-argument call shape", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError("proxy", new Error("upstream failed"));

        expect(errorSpy).toHaveBeenCalledWith("[proxy] Error:", expect.not.objectContaining({
            body: expect.anything(),
        }));
    });

    it("redacts provider credentials and member identity from upstream bodies", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError(
            "proxy",
            new Error("provider failed"),
            JSON.stringify({
                access_token: "access-secret",
                refreshToken: "refresh-secret",
                memberEmail: "staff@example.com",
                safe: "kept",
            }),
        );

        const logged = JSON.stringify(errorSpy.mock.calls);
        expect(logged).toContain("[REDACTED]");
        expect(logged).not.toContain("access-secret");
        expect(logged).not.toContain("refresh-secret");
        expect(logged).not.toContain("staff@example.com");
        expect(logged).toContain("safe");
    });

    it("redacts every credential in compound Cookie and Set-Cookie headers", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError(
            "proxy",
            new Error("provider failed"),
            JSON.stringify({
                Cookie: "auth_token=auth-secret; refresh_token=refresh-secret",
                "Set-Cookie": "auth_token=set-cookie-secret; Path=/",
                safe: "kept",
            }),
        );

        const logged = errorSpy.mock.calls[0]?.[1] as { body?: string };
        expect(logged.body).toContain('"Cookie":[REDACTED]');
        expect(logged.body).toContain('"Set-Cookie":[REDACTED]');
        const loggedText = JSON.stringify(logged);
        expect(loggedText).not.toContain("auth-secret");
        expect(loggedText).not.toContain("refresh-secret");
        expect(loggedText).not.toContain("set-cookie-secret");
        expect(loggedText).toContain("safe");
    });

    it("redacts folded Set-Cookie values before the logger truncates them", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError(
            "proxy",
            new Error("provider failed"),
            "Set-Cookie: sid=first-secret; Expires=Wed, 21 Oct 2030 07:28:00 GMT, "
            + "session=second-secret; Path=/",
        );

        const logged = errorSpy.mock.calls[0]?.[1] as { body?: string };
        expect(logged.body).toBe("Set-Cookie: [REDACTED]");
        expect(JSON.stringify(logged)).not.toContain("first-secret");
        expect(JSON.stringify(logged)).not.toContain("second-secret");
    });
});

describe("createRouteUtils legacy-message errorResponse", () => {
    const serverAPIClient = {
        delete: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
    } as unknown as Parameters<typeof createRouteUtils>[0]["serverAPIClient"];

    const { errorResponse } = createRouteUtils({
        errorResponseMode: "legacy-message",
        secureCookies: false,
        serverAPIClient,
    });

    function upstreamError(status: number, data: unknown) {
        return { response: { status, data } };
    }

    beforeEach(() => {
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("surfaces the Nest exception message instead of the generic HTTP error name", async () => {
        const response = errorResponse(
            upstreamError(400, {
                message: "duration must equal the Korean business-day count (15) for the submitted service period",
                error: "Bad Request",
                statusCode: 400,
            }),
            "create client",
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "서비스 기간의 실제 이용일 수는 15일이에요. 입력한 이용일 수를 확인해 주세요.",
        });
    });

    it("joins a ValidationPipe message array into one readable line", async () => {
        const response = errorResponse(
            upstreamError(400, {
                message: ["name must be a string", "phone must be a valid Korean phone number"],
                error: "Bad Request",
                statusCode: 400,
            }),
            "create client",
        );

        await expect(response.json()).resolves.toEqual({
            error: "이름 항목은 문자로 입력해 주세요. 연락처 항목에 올바른 국내 전화번호를 입력해 주세요.",
        });
    });

    it("falls back to the upstream error field when no message is present", async () => {
        const response = errorResponse(
            upstreamError(409, { error: "자동 고객 등록이 꺼져 있습니다." }),
            "create client",
        );

        await expect(response.json()).resolves.toEqual({
            error: "자동 고객 등록이 꺼져 있어요.",
        });
    });

    it("falls back to the context placeholder when the upstream body carries nothing usable", async () => {
        const response = errorResponse(upstreamError(500, {}), "create client");

        await expect(response.json()).resolves.toEqual({ error: "서버 내부 오류로 요청을 처리하지 못했어요." });
    });

    it("still redacts credentials that appear inside an upstream message", async () => {
        const response = errorResponse(
            upstreamError(400, { message: "upstream rejected Bearer abc.def.ghi" }),
            "create client",
        );

        const body = await response.json();
        expect(body.error).toBe("입력 정보가 요청 조건에 맞지 않아요. 입력 내용을 확인해 주세요.");
        expect(body.error).not.toContain("abc.def.ghi");
    });

    it.each([
        "auth_token=auth-secret 오류입니다.",
        "refresh_token: refresh-secret 오류입니다.",
        '"Cookie": "auth_token=auth-secret; refresh_token=refresh-secret"',
        "Set-Cookie: auth_token=auth-secret; Path=/",
    ])("does not reflect session cookie diagnostics from a 4xx message (%s)", async (message) => {
        const response = errorResponse(
            upstreamError(400, { message }),
            "create client",
        );

        const body = await response.json();
        expect(body.error).toBe("입력 정보가 요청 조건에 맞지 않아요. 입력 내용을 확인해 주세요.");
        expect(JSON.stringify(body)).not.toContain("auth-secret");
        expect(JSON.stringify(body)).not.toContain("refresh-secret");
    });
});

describe("local request-body validation", () => {
    it("returns a canonical validation problem for every issue without reflecting custom messages", async () => {
        const secret = "Bearer validation-secret";
        const schema = z.object({
            "a/b": z.string().refine(() => false, { message: secret }),
            "tilde~field": z.string(),
            one: z.number(),
            two: z.boolean(),
            three: z.string(),
            four: z.number(),
            five: z.boolean(),
        });

        const { data, response } = await parseBody(schema, createJsonRequest(JSON.stringify({ "a/b": "value" })));

        expect(data).toBeNull();
        expect(response?.status).toBe(400);
        expect(response?.headers.get("Cache-Control")).toBe("no-store, max-age=0");
        expect(response?.headers.get("Content-Type")).toBe("application/problem+json");
        expect(response?.headers.get("Content-Language")).toBe("ko-KR");

        const body = await response!.json();
        expect(body).toEqual(expect.objectContaining({
            type: expect.stringContaining("#validation-failed"),
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            error: "Invalid request body",
        }));
        expect(body.requestId).toEqual(response?.headers.get("X-Request-Id"));
        expect(body.requestId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
        expect(body.errors).toHaveLength(7);
        expect(body.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ pointer: "/a~1b", code: "INVALID_VALUE" }),
            expect.objectContaining({ pointer: "/tilde~0field", code: "REQUIRED" }),
            expect.objectContaining({ pointer: "/one", code: "REQUIRED" }),
        ]));
        expect(body.issues).toHaveLength(7);
        expect(JSON.stringify(body)).not.toContain(secret);

        const normalized = normalizeApiError({ response: { status: 400, data: body } }, { operation: "mutation" });
        expect(normalized.problem?.code).toBe("VALIDATION_FAILED");
        expect(normalized.outcome).toBe("NOT_APPLIED");
        expect(normalized.problem?.requestId).toBe(body.requestId);
    });

    it("maps malformed JSON to a known NOT_APPLIED validation problem", async () => {
        const { data, response } = await parseBody(z.object({}), createJsonRequest("{bad-json"));

        expect(data).toBeNull();
        expect(response?.status).toBe(400);
        expect(response?.headers.get("Content-Type")).toBe("application/problem+json");

        const body = await response!.json();
        expect(body).toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            outcome: "NOT_APPLIED",
            error: "Request body must be valid JSON",
        }));
        expect(body.errors).toEqual([
            expect.objectContaining({ pointer: "", code: "INVALID_FORMAT" }),
        ]);
        expect(body.requestId).toBe(response?.headers.get("X-Request-Id"));
    });

    it("distinguishes missing fields from supplied values with the same Zod invalid_type code", async () => {
        const schema = z.object({ required: z.string(), wrongType: z.string() });
        const { response } = await parseBody(
            schema,
            createJsonRequest(JSON.stringify({ wrongType: 42 })),
        );
        const body = await response!.json();

        expect(body.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ pointer: "/required", code: "REQUIRED" }),
            expect.objectContaining({ pointer: "/wrongType", code: "INVALID_FORMAT" }),
        ]));
        expect(JSON.stringify(body)).not.toContain("42");
    });

    it("maps unsafe or overlong issue paths to form-level errors", async () => {
        const schema = z.object({}).superRefine((_value, context) => {
            context.addIssue({ code: "custom", path: ["x".repeat(513)], message: "secret-long-path" });
            context.addIssue({ code: "custom", path: ["unsafe\u0000path"], message: "secret-control-path" });
        });

        const { response } = await parseBody(schema, createJsonRequest("{}"));
        const body = await response!.json();

        expect(body.errors).toEqual([
            expect.objectContaining({ pointer: "", code: "INVALID_VALUE" }),
            expect.objectContaining({ pointer: "", code: "INVALID_VALUE" }),
        ]);
        expect(JSON.stringify(body)).not.toContain("secret-long-path");
        expect(JSON.stringify(body)).not.toContain("secret-control-path");
    });
});
