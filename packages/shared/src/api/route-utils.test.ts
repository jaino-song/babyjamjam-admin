import { NextRequest } from "next/server";
import { z } from "zod";

import { createProblemDetails, normalizeApiError, PROBLEM_CATALOG } from "../errors/problem-details";
import {
    buildSystemTemplatePath,
    containsDiagnosticMarker,
    createRouteUtils,
    invalidSystemTemplateKeyResponse,
    logUpstreamError,
    messageTriggerUpstreamErrorResponse,
    parseBody,
    sanitizeUpstreamClientError,
    systemTemplateBackendJsonResponse,
    systemTemplateUpstreamErrorResponse,
} from "./route-utils";

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

describe("message-trigger upstream error boundary", () => {
    function upstreamError(status: number, data: unknown) {
        return { response: { status, data } };
    }

    beforeEach(() => {
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it.each([
        {
            label: "direct code",
            data: {
                code: "MESSAGE_AUTOMATION_PARENT_DISABLED",
                message: "internal branch identifier and database details",
            },
        },
        {
            label: "nested code",
            data: {
                error: {
                    code: "MESSAGE_AUTOMATION_PARENT_DISABLED",
                    message: "internal branch identifier and database details",
                },
            },
        },
    ])("forwards only the allowlisted parent-disabled code for a 409 ($label)", async ({ data }) => {
        const response = messageTriggerUpstreamErrorResponse(
            upstreamError(409, data),
            "update message trigger rule",
        );

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toEqual({
            error: "Failed to update message trigger rule",
            code: "MESSAGE_AUTOMATION_PARENT_DISABLED",
        });
        expect(JSON.stringify(body)).not.toContain("internal branch identifier");
    });

    it.each([
        { status: 409, data: { code: "OTHER_CONFLICT" } },
        { status: 422, data: { code: "MESSAGE_AUTOMATION_PARENT_DISABLED" } },
    ])("keeps the generic contract for status $status or an unknown code", async ({ status, data }) => {
        const response = messageTriggerUpstreamErrorResponse(
            upstreamError(status, data),
            "update message trigger rule",
        );

        expect(response.status).toBe(status);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to update message trigger rule",
            code: "UPSTREAM_ERROR",
        });
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
    it.each([
        ["enum", z.enum(["enabled", "disabled"])],
        ["literal", z.literal("enabled")],
        ["union", z.union([z.string(), z.number()])],
    ])("distinguishes missing %s fields from supplied invalid values", async (_name, fieldSchema) => {
        const schema = z.object({ field: fieldSchema });
        const missing = await parseBody(schema, createJsonRequest("{}"));
        const supplied = await parseBody(schema, createJsonRequest('{"field":false}'));
        expect(await missing.response?.json()).toMatchObject({
            outcome: "NOT_APPLIED",
            errors: [{ pointer: "/field", code: "REQUIRED" }],
        });
        expect(await supplied.response?.json()).toMatchObject({
            outcome: "NOT_APPLIED",
            errors: [{ pointer: "/field", code: "INVALID_VALUE" }],
        });
    });

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
        // The requestId is a random UUID that may itself contain "42"; exclude it
        // so the assertion checks only for a leak of the supplied value.
        expect(JSON.stringify({ ...body, requestId: undefined })).not.toContain("42");
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

describe("system-template route policy", () => {
    beforeEach(() => {
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("encodes valid keys and rejects unknown or multi-segment keys", () => {
        expect(buildSystemTemplatePath("GREETING", "/preview")).toBe("/system-templates/GREETING/preview");
        expect(buildSystemTemplatePath("SERVICE_END_NOTICE", "")).toBe("/system-templates/SERVICE_END_NOTICE");
        expect(buildSystemTemplatePath("GREETING/preview", "/preview")).toBeNull();
        expect(buildSystemTemplatePath("NOT_A_TEMPLATE", "/preview")).toBeNull();
    });

    it.each([400, 403, 409, 422, 500])("sanitizes upstream %i errors while preserving status", async (status) => {
        const response = systemTemplateUpstreamErrorResponse(
            { response: { status, data: { message: "Bearer secret-token", diagnostics: "SELECT * FROM templates" } } },
            "preview system template",
        );

        expect(response.status).toBe(status);
        const body = await response.json();
        expect(body).toEqual({ error: "Failed to preview system template", code: "UPSTREAM_ERROR" });
        expect(JSON.stringify(body)).not.toContain("secret-token");
        expect(JSON.stringify(body)).not.toContain("SELECT");
    });

    it("applies the same policy to resolved upstream responses", async () => {
        const response = systemTemplateBackendJsonResponse(
            { status: 422, data: { message: "unsafe" } },
            "validate system template",
        );

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to validate system template",
            code: "UPSTREAM_ERROR",
        });
    });

    it("returns a stable key validation error without reflecting input", async () => {
        const response = invalidSystemTemplateKeyResponse();
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "Invalid system template key" });
    });
});

describe("containsDiagnosticMarker", () => {
    it.each([
        ["file:line", "검증 중 verify.ts:88에서 오류가 발생했습니다."],
        ["source file", "main.js 로드에 실패했습니다."],
        ["absolute path", "/srv/auth/verify 확인 중 오류가 발생했습니다."],
        ["relative multi-segment path", "dist/auth/verify 에서 실패했습니다."],
        ["windows path", "C:\\app\\main 확인 실패입니다."],
        ["dotted internal host", "인증 서비스 analytics.internal 확인 중 오류가 발생했습니다."],
        ["URL", "https://api.internal/v1/verify 호출에 실패했습니다."],
        ["stack frame with parens", "처리 실패입니다. at verify (file:1:2)"],
        ["stack frame bare", "처리 실패입니다. at handler:42"],
        ["SQL select", "조회 실패: SELECT id FROM client"],
        ["SQL insert", "저장 실패: insert into client values"],
        ["SQL update", "저장 실패: UPDATE client SET name"],
        ["SQL delete", "삭제 실패: DELETE FROM client WHERE id"],
        ["Prisma code", "저장 실패 P2002 입니다."],
        ["SQLSTATE", "저장 실패 SQLSTATE 23505 입니다."],
        ["PrismaClient", "PrismaClientKnownRequestError 가 발생했습니다."],
        ["prisma invocation", "Invalid `prisma.client.create()` invocation 입니다."],
        ["Error class", "TypeError: 처리 실패입니다."],
        ["Exception class", "BadRequestException 이 발생했습니다."],
        ["UUID", "고객 1f0c2b7e-3a4d-4b8e-9c1d-0a1b2c3d4e5f 를 찾을 수 없습니다."],
        ["JSON dump", '실패: {"clientId":9137,"reason":"lock"}'],
        ["array of objects", "실패: [{ id 7 }]"],
    ])("flags %s", (_family, message) => {
        expect(containsDiagnosticMarker(message)).toBe(true);
    });

    it.each([
        "이메일 또는 비밀번호가 올바르지 않습니다.",
        "2026-10-08 이후에는 수정할 수 없습니다.",
        "2026.10.08 이후에는 수정할 수 없습니다.",
        "2026/10/08 이후에는 수정할 수 없습니다.",
        "서비스 기간은 15일 이상 3.5배 이내여야 합니다.",
        "승인/반려 상태에서는 변경할 수 없습니다.",
        "SMS/MMS 발송은 오전 9시부터 가능합니다.",
        "이미 발송되었거나 취소할 수 없는 상태입니다",
        "같은 전화번호의 고객이 이미 등록되어 있습니다.",
    ])("keeps plain business wording (%s)", (message) => {
        expect(containsDiagnosticMarker(message)).toBe(false);
    });
});

describe("sanitizeUpstreamClientError forwards business wording but never diagnostic fragments", () => {
    const G4_DIAGNOSTIC = "인증 서비스 analytics.internal 확인 중 /srv/auth/verify.ts:88에서 오류가 발생했습니다.";
    const STATUS_400 = "입력 정보가 요청 조건에 맞지 않아요. 입력 내용을 확인해 주세요.";

    it("replaces the reviewed 4xx/401/403 diagnostic message with the status-generic message", () => {
        expect(sanitizeUpstreamClientError({ message: G4_DIAGNOSTIC }, "Failed to x", 401))
            .toEqual({ error: "로그인 인증을 확인할 수 없어요. 다시 로그인해 주세요." });
        expect(sanitizeUpstreamClientError({ message: G4_DIAGNOSTIC, error: "Forbidden" }, "Failed to x", 403))
            .toEqual({ error: "이 작업을 할 권한이 없어요." });
        const payload = sanitizeUpstreamClientError({ message: G4_DIAGNOSTIC, error: "Bad Request" }, "Failed to x", 400);
        expect(payload).toEqual({ error: STATUS_400 });
        expect(JSON.stringify(payload)).not.toMatch(/analytics|\/srv|verify\.ts/);
    });

    it("strips the diagnostic message in the error field and in message arrays", () => {
        expect(sanitizeUpstreamClientError({ error: G4_DIAGNOSTIC }, "Failed to x", 409))
            .toEqual({ error: "현재 데이터 상태와 요청이 충돌해 처리할 수 없어요." });
        expect(sanitizeUpstreamClientError({ message: [G4_DIAGNOSTIC, "name must be a string"] }, "Failed to x", 400))
            .toEqual({ error: "이름 항목은 문자로 입력해 주세요." });
    });

    it.each([
        ["file:line", "검증 중 verify.ts:88에서 오류가 발생했습니다."],
        ["path", "/srv/auth/verify 확인 중 오류가 발생했습니다."],
        ["dotted host", "analytics.internal 확인 중 오류가 발생했습니다."],
        ["URL", "https://api.internal/v1 호출에 실패했습니다."],
        ["stack frame", "처리 실패입니다. at verify (file:1:2)"],
        ["SQL", "조회 실패: SELECT id FROM client"],
        ["Prisma code", "저장 실패 P2002 입니다."],
        ["Error class", "TypeError: 처리 실패입니다."],
        ["UUID", "고객 1f0c2b7e-3a4d-4b8e-9c1d-0a1b2c3d4e5f 를 찾을 수 없습니다."],
        ["JSON dump", '실패: {"clientId":9137}'],
    ])("answers a message carrying a %s marker with the status-generic message", (_family, message) => {
        expect(sanitizeUpstreamClientError({ message, error: "Bad Request" }, "Failed to x", 400))
            .toEqual({ error: STATUS_400 });
    });

    it("forwards the login credential message and a dated business message (converted to the app's copy style)", () => {
        expect(sanitizeUpstreamClientError({ message: "이메일 또는 비밀번호가 올바르지 않습니다." }, "Failed to login", 401))
            .toEqual({ error: "이메일 또는 비밀번호가 올바르지 않아요." });
        expect(sanitizeUpstreamClientError({ message: "2026-10-08 이후에는 수정할 수 없습니다." }, "Failed to x", 409))
            .toEqual({ error: "2026-10-08 이후에는 수정할 수 없어요." });
    });

    it("replaces a registered problem's detail with the catalog message, whatever the upstream detail says", () => {
        const problem = createProblemDetails({ code: "CLIENT_PHONE_ALREADY_REGISTERED", requestId: "req-1", outcome: "NOT_APPLIED" });
        const payload = sanitizeUpstreamClientError({ ...problem, detail: G4_DIAGNOSTIC, title: G4_DIAGNOSTIC }, "fallback", 409);

        expect(payload.code).toBe("CLIENT_PHONE_ALREADY_REGISTERED");
        expect(payload.error).toBe(PROBLEM_CATALOG.CLIENT_PHONE_ALREADY_REGISTERED.detail["ko-KR"]);
        expect(JSON.stringify(payload)).not.toContain("analytics");
    });

    it("keeps the catalog detail of every registered code verbatim", () => {
        for (const [code, entry] of Object.entries(PROBLEM_CATALOG)) {
            const problem = createProblemDetails({ code: code as keyof typeof PROBLEM_CATALOG, requestId: "req-all", status: entry.status });
            const payload = sanitizeUpstreamClientError({ ...problem, detail: G4_DIAGNOSTIC }, "fallback", entry.status);
            expect(payload.error).toBe(entry.detail["ko-KR"]);
            expect(payload.code).toBe(code);
        }
    });

    it("still translates registered validation text", () => {
        expect(sanitizeUpstreamClientError(
            { message: ["phone must be a valid Korean phone number"], error: "Bad Request" },
            "Failed to x",
            400,
        )).toEqual({ error: "연락처 항목에 올바른 국내 전화번호를 입력해 주세요." });
        expect(sanitizeUpstreamClientError({ message: "Client not found" }, "Failed to x", 404))
            .toEqual({ error: "해당 고객을 찾을 수 없어요." });
    });

    it("turns a raw string body and a non-JSON body into the generic status message", () => {
        expect(sanitizeUpstreamClientError(`<html>${G4_DIAGNOSTIC}</html>`, "Failed to x", 400)).toEqual({ error: STATUS_400 });
        expect(sanitizeUpstreamClientError(G4_DIAGNOSTIC, "Failed to x", 404)).toEqual({ error: "요청한 정보를 찾을 수 없어요." });
        expect(sanitizeUpstreamClientError(undefined, "Failed to x", 502))
            .toEqual({ error: "연결된 서버에서 정상적인 응답을 받지 못했어요." });
    });

    it("never reflects a 5xx body, a stack trace, SQL, or a Prisma message", () => {
        const body = {
            statusCode: 500,
            message: `${G4_DIAGNOSTIC}\n    at Object.<anonymous> (/app/dist/x.js:1:1) PrismaClientKnownRequestError SELECT * FROM "Client"`,
            stack: "Error: boom\n    at /app/dist/x.js",
            error: G4_DIAGNOSTIC,
        };
        const payload = sanitizeUpstreamClientError(body, "Failed to x", 500);

        expect(payload).toEqual({ error: "서버 내부 오류로 요청을 처리하지 못했어요." });
        expect(JSON.stringify(payload)).not.toMatch(/analytics|Prisma|SELECT|\/app\/|boom/);
        expect(sanitizeUpstreamClientError({ message: "이메일 또는 비밀번호가 올바르지 않습니다." }, "Failed to x", 500))
            .toEqual({ error: "서버 내부 오류로 요청을 처리하지 못했어요." });
    });

    it("forwards only identifier-shaped codes: no separators, paths or free text", () => {
        expect(sanitizeUpstreamClientError({ code: "EMAIL_EXISTS", message: G4_DIAGNOSTIC }, "Failed to x", 409))
            .toEqual({ error: "이미 등록된 이메일이에요.", code: "EMAIL_EXISTS" });
        expect(sanitizeUpstreamClientError({ code: "CLIENT:9137:LOCK_FAILED" }, "Failed to x", 409).code).toBeUndefined();
        expect(sanitizeUpstreamClientError({ code: "고객 9137 잠금 실패" }, "Failed to x", 409).code).toBeUndefined();
        expect(sanitizeUpstreamClientError({ code: "/app/dist/main.js" }, "Failed to x", 409).code).toBeUndefined();
    });
});
