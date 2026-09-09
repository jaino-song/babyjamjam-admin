import {
    PROBLEM_CATALOG,
    ProblemCode,
    ProblemDetails,
    createProblemDetails,
    normalizeApiError,
    parseProblemDetails,
    resolveProblemMessage,
} from "./problem-details";

const REQUEST_ID = "req-bjj-319-001";

describe("problem details public contract", () => {
    it("creates a localized, catalog-backed problem with empty params", () => {
        const problem = createProblemDetails({
            code: "AUTH_REQUIRED",
            requestId: REQUEST_ID,
            locale: "en-US",
        });

        expect(problem).toEqual({
            type: PROBLEM_CATALOG.AUTH_REQUIRED.type,
            title: "Authentication required",
            status: 401,
            detail: "Sign in before sending the request.",
            code: "AUTH_REQUIRED",
            requestId: REQUEST_ID,
            params: {},
        });
    });

    it("validates status and identifiers when creating a problem", () => {
        expect(() => createProblemDetails({ code: "REQUEST_INVALID", requestId: "" })).toThrow(TypeError);
        expect(() => createProblemDetails({ code: "REQUEST_INVALID", requestId: "req with spaces" })).toThrow(TypeError);
        expect(() => createProblemDetails({ code: "REQUEST_INVALID", requestId: REQUEST_ID, status: 422 })).toThrow(TypeError);
        expect(() => createProblemDetails({ code: "VALIDATION_FAILED", requestId: REQUEST_ID, status: 422 })).not.toThrow();
    });

    it("preserves and sanitizes every field error without exposing raw values", () => {
        const problem = createProblemDetails({
            code: "VALIDATION_FAILED",
            requestId: REQUEST_ID,
            errors: [
                { pointer: "/email", code: "INVALID_FORMAT", detail: "email=alice@example.com" },
                { pointer: "/name~1display", code: "REQUIRED", detail: "password=secret" },
            ],
        });

        expect(problem.errors).toEqual([
            { pointer: "/email", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요." },
            { pointer: "/name~1display", code: "REQUIRED", detail: "필수 항목이에요." },
        ]);
        expect(JSON.stringify(problem)).not.toContain("alice@example.com");
        expect(JSON.stringify(problem)).not.toContain("secret");
    });

    it("parses only a validated catalog problem and strips extensions", () => {
        const parsed = parseProblemDetails({
            type: PROBLEM_CATALOG.REQUEST_CONFLICT.type,
            title: "attacker title",
            status: 409,
            detail: "stack trace and token=secret",
            code: "REQUEST_CONFLICT",
            requestId: REQUEST_ID,
            operationId: "contracts.dispatch",
            errors: [
                { pointer: "/contract", code: "INVALID_VALUE", detail: "raw value", location: "body", value: "secret" },
            ],
            params: {},
            debug: "do not keep",
        }, 409);

        expect(parsed).toEqual({
            type: PROBLEM_CATALOG.REQUEST_CONFLICT.type,
            title: "요청을 완료할 수 없어요",
            status: 409,
            detail: "현재 데이터 상태와 요청이 충돌해 처리할 수 없어요.",
            code: "REQUEST_CONFLICT",
            requestId: REQUEST_ID,
            operationId: "contracts.dispatch",
            errors: [
                { pointer: "/contract", code: "INVALID_VALUE", detail: "허용되지 않는 값이에요.", location: "body" },
            ],
            params: {},
        });
    });

    it("supports validation status 422 and rejects mismatched or unknown values", () => {
        const valid = createProblemDetails({ code: "VALIDATION_FAILED", requestId: REQUEST_ID, status: 422, locale: "en-US" });
        expect(parseProblemDetails(valid, 422, "en-US")).toEqual(valid);
        expect(parseProblemDetails({ ...valid, code: "UNKNOWN_CODE" }, 422)).toBeNull();
        expect(parseProblemDetails({ ...valid, type: `${valid.type}-wrong` }, 422)).toBeNull();
        expect(parseProblemDetails({ ...valid, status: 400 }, 422)).toBeNull();
        expect(parseProblemDetails({ ...valid, params: { leaked: true } }, 422)).toBeNull();
    });

    it("rejects malformed pointers, field codes, locations, actions, and retry modes", () => {
        const base = createProblemDetails({ code: "VALIDATION_FAILED", requestId: REQUEST_ID });
        expect(parseProblemDetails({ ...base, errors: [{ pointer: "not-a-pointer", code: "REQUIRED", detail: "x" }] }, 400)).toBeNull();
        expect(parseProblemDetails({ ...base, errors: [{ pointer: "/field~2", code: "REQUIRED", detail: "x" }] }, 400)).toBeNull();
        expect(parseProblemDetails({ ...base, errors: [{ pointer: "/field", code: "SECRET", detail: "x" }] }, 400)).toBeNull();
        expect(parseProblemDetails({ ...base, errors: [{ pointer: "/field", code: "REQUIRED", detail: "x", location: "header" }] }, 400)).toBeNull();
        expect(parseProblemDetails({ ...base, recovery: { action: "RETRY", retry: { mode: "ALWAYS" } } }, 400)).toBeNull();
        expect(parseProblemDetails({ ...base, recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" }, endpoint: "/unsafe" } }, 400)).toEqual({
            ...base,
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
        });
    });

    it("normalizes valid server responses and keeps invalid code/type separate", () => {
        const valid = createProblemDetails({
            code: "RESOURCE_NOT_FOUND",
            requestId: REQUEST_ID,
            locale: "en-US",
        });
        const normalized = normalizeApiError({ response: { status: 404, data: { ...valid, title: "fake", detail: "secret" } } }, { locale: "en-US", operation: "read" });

        expect(normalized.origin).toBe("server");
        expect(normalized.verified).toBe(true);
        expect(normalized.problem).toEqual(valid);
        expect(normalized.message).toBe("The requested resource could not be found.");
        expect(normalized.outcome).toBeUndefined();

        const invalid = normalizeApiError({ status: 400, data: { code: "MADE_UP", type: "https://attacker.invalid", status: 400, requestId: REQUEST_ID, title: "x", detail: "x" } });
        expect(invalid.verified).toBe(false);
        expect(invalid.origin).toBe("server");
        expect(invalid.originalCode).toBe("MADE_UP");
        expect(invalid.originalType).toBe("https://attacker.invalid");
        expect(invalid.problem).toBeUndefined();
    });

    it("keeps mutation outcomes conservative and never fabricates status or request id", () => {
        const normalized = normalizeApiError(new Error("database failed"), { operation: "mutation" });

        expect(normalized.origin).toBe("client");
        expect(normalized.verified).toBe(false);
        expect(normalized.outcome).toBe("UNKNOWN");
        expect(normalized.recovery).toEqual({ action: "CHECK_STATUS", retry: { mode: "NEVER" } });
        expect(normalized.status).toBeUndefined();
        expect(normalized.problem).toBeUndefined();
        expect("requestId" in normalized).toBe(false);
        expect(normalized.message).toBe("변경 결과를 확인할 수 없으니 다시 실행하기 전에 작업 상태를 확인해 주세요.");
    });

    it("uses safe read messages for empty, HTML, and transport responses", () => {
        expect(normalizeApiError({ response: { status: 502, data: "<html>bad gateway</html>" } }, { operation: "read" }).message)
            .toBe("요청한 정보를 불러오지 못했어요.");
        expect(normalizeApiError({ response: { status: 503, data: "" } }, { operation: "read", locale: "en-US" }).message)
            .toBe("We couldn’t load the requested information.");
        expect(normalizeApiError({ code: "ECONNRESET" }, { operation: "read" }).origin).toBe("transport");
    });

    it("marks cancellation and suppresses it only for reads", () => {
        const read = normalizeApiError({ code: "ERR_CANCELED", message: "cancelled" }, { operation: "read" });
        expect(read.canceled).toBe(true);
        expect(read.suppress).toBe(true);
        expect(read.outcome).toBeUndefined();

        const mutation = normalizeApiError(Object.assign(new Error("aborted"), { name: "AbortError" }), { operation: "mutation" });
        expect(mutation.canceled).toBe(true);
        expect(mutation.suppress).toBe(false);
        expect(mutation.outcome).toBe("UNKNOWN");
    });

    it("resolves only catalog messages and does not perform legacy translation", () => {
        expect(resolveProblemMessage("INTERNAL_ERROR", "en-US")).toBe("Something unexpected happened while processing your request.");
        expect(resolveProblemMessage({ code: "INTERNAL_ERROR", detail: "PrismaClientKnownRequestError" }, "ko-KR")).toBe("요청 처리 결과를 확인할 수 없어요.");
        expect(resolveProblemMessage("legacy message", { locale: "en-US", operation: "read" })).toBe("We couldn’t load the requested information.");
    });

    it("contains safe bilingual SMS outcome entries with empty params", () => {
        const smsCodes: ProblemCode[] = [
            "MESSAGE_SEND_NOT_STARTED",
            "MESSAGE_SEND_UNCONFIRMED",
            "MESSAGE_SEND_PARTIAL",
            "MESSAGE_SEND_REJECTED",
            "MESSAGE_SEND_ALREADY_REQUESTED",
            "MESSAGE_REQUEST_KEY_CONFLICT",
        ];
        for (const code of smsCodes) {
            const problem = createProblemDetails({ code, requestId: REQUEST_ID });
            expect(problem.params).toEqual({});
            expect(problem.detail).not.toMatch(/Aligo|error|provider|token|stack/i);
            expect(PROBLEM_CATALOG[code].title["ko-KR"]).toEqual(expect.any(String));
            expect(PROBLEM_CATALOG[code].title["en-US"]).toEqual(expect.any(String));
        }
    });
});

describe("catalog coverage", () => {
    const codes: ProblemCode[] = [
        "REQUEST_INVALID",
        "VALIDATION_FAILED",
        "AUTH_REQUIRED",
        "ACCESS_DENIED",
        "RESOURCE_NOT_FOUND",
        "REQUEST_CONFLICT",
        "METHOD_NOT_ALLOWED",
        "REQUEST_EXPIRED",
        "PAYLOAD_TOO_LARGE",
        "MEDIA_TYPE_UNSUPPORTED",
        "REQUEST_RATE_LIMITED",
        "INTERNAL_ERROR",
        "DEPENDENCY_UNAVAILABLE",
        "UPSTREAM_INVALID_RESPONSE",
        "UPSTREAM_TIMEOUT",
        "CONTRACT_ALREADY_SIGNED",
        "MESSAGE_SEND_NOT_STARTED",
        "MESSAGE_SEND_UNCONFIRMED",
        "MESSAGE_SEND_PARTIAL",
        "MESSAGE_SEND_REJECTED",
        "MESSAGE_SEND_ALREADY_REQUESTED",
        "MESSAGE_REQUEST_KEY_CONFLICT",
    ];

    it.each(codes)("contains a complete bilingual entry for %s", (code) => {
        const entry = PROBLEM_CATALOG[code];
        expect(entry.type).toBe(`https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#${code.toLowerCase().replaceAll("_", "-")}`);
        expect(entry.title["ko-KR"]).toEqual(expect.any(String));
        expect(entry.title["en-US"]).toEqual(expect.any(String));
        expect(entry.detail["ko-KR"]).toMatch(/요\.$/);
        expect(entry.detail["en-US"]).toEqual(expect.any(String));
    });
});


describe("uncertain outcome recovery invariant", () => {
    it("defaults and conservatively normalizes UNKNOWN recovery in every entry point", () => {
        const expected = { action: "CHECK_STATUS", retry: { mode: "NEVER" } };
        const problem = createProblemDetails({ code: "INTERNAL_ERROR", requestId: "request-unknown", outcome: "UNKNOWN" });
        expect(problem.recovery).toEqual(expected);
        const missing = { ...problem, recovery: undefined };
        delete missing.recovery;
        expect(parseProblemDetails(missing)?.recovery).toEqual(expected);
        expect(parseProblemDetails({
            ...problem,
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        })?.recovery).toEqual(expected);
        expect(normalizeApiError(missing).recovery).toEqual(expected);
    });
});
