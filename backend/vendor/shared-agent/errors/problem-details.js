"use strict";
/**
 * Public problem-details contract shared by browser and server code.
 *
 * This module deliberately has no runtime dependencies.  In particular, the
 * parser is a small allow-list validator instead of a Zod schema so the
 * backend can vendor the file without pulling the shared package's UI
 * dependencies into its runtime bundle.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFE_MUTATION_FAILURE_MESSAGES = exports.SAFE_READ_FAILURE_MESSAGES = exports.SAFE_UNKNOWN_PROBLEM_MESSAGES = exports.catalog = exports.problemCatalog = exports.PROBLEM_CATALOG = exports.PROBLEM_TYPE_BASE_URI = void 0;
exports.parseProblemDetails = parseProblemDetails;
exports.createProblemDetails = createProblemDetails;
exports.normalizeApiError = normalizeApiError;
exports.resolveProblemMessage = resolveProblemMessage;
exports.PROBLEM_TYPE_BASE_URI = "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#";
const DEFAULT_LOCALE = "ko-KR";
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_POINTER_LENGTH = 512;
const MAX_ORIGINAL_TEXT_LENGTH = 512;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const RFC6901_POINTER_PATTERN = /^(?:\/(?:[^~/]|~[01])*)*$/;
const PROBLEM_CODES = [
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
];
const PROBLEM_ERROR_CODES = [
    "REQUIRED",
    "INVALID_FORMAT",
    "OUT_OF_RANGE",
    "INVALID_VALUE",
    "UNEXPECTED_FIELD",
];
const PROBLEM_OUTCOMES = [
    "NOT_APPLIED",
    "FAILED",
    "PARTIALLY_APPLIED",
    "UNKNOWN",
];
const PROBLEM_ERROR_LOCATIONS = [
    "body",
    "query",
    "path",
    "custom",
];
const FIELD_ERROR_DETAILS = Object.freeze({
    "ko-KR": Object.freeze({
        REQUIRED: "필수 항목이에요.",
        INVALID_FORMAT: "입력 형식이 올바르지 않아요.",
        OUT_OF_RANGE: "허용 범위를 벗어난 값이에요.",
        INVALID_VALUE: "허용되지 않는 값이에요.",
        UNEXPECTED_FIELD: "허용되지 않는 항목이에요.",
    }),
    "en-US": Object.freeze({
        REQUIRED: "This field is required.",
        INVALID_FORMAT: "This field has an invalid format.",
        OUT_OF_RANGE: "This value is outside the allowed range.",
        INVALID_VALUE: "This value is not allowed.",
        UNEXPECTED_FIELD: "This field is not expected.",
    }),
});
const UNKNOWN_MESSAGES = Object.freeze({
    "ko-KR": "요청 처리 결과를 확인할 수 없어요.",
    "en-US": "We can’t confirm the result of this request.",
});
const READ_FAILURE_MESSAGES = Object.freeze({
    "ko-KR": "요청한 정보를 불러오지 못했어요.",
    "en-US": "We couldn’t load the requested information.",
});
const MUTATION_FAILURE_MESSAGES = Object.freeze({
    "ko-KR": "변경 결과를 확인할 수 없으니 다시 실행하기 전에 작업 상태를 확인해 주세요.",
    "en-US": "We can’t confirm whether the changes were applied, so check the operation status before trying again.",
});
const READ_CANCELED_MESSAGES = Object.freeze({
    "ko-KR": "조회 요청을 취소했어요.",
    "en-US": "The read request was canceled.",
});
const PROBLEM_DEFINITIONS = {
    REQUEST_INVALID: {
        status: 400,
        title: {
            "ko-KR": "요청이 올바르지 않아요",
            "en-US": "Invalid request",
        },
        detail: {
            "ko-KR": "요청 형식이 올바르지 않아요.",
            "en-US": "The request format is invalid.",
        },
    },
    VALIDATION_FAILED: {
        status: 400,
        statuses: [400, 422],
        title: {
            "ko-KR": "입력값을 확인해 주세요",
            "en-US": "Validation failed",
        },
        detail: {
            "ko-KR": "입력 내용을 확인해 주세요.",
            "en-US": "Check the input values.",
        },
    },
    AUTH_REQUIRED: {
        status: 401,
        title: {
            "ko-KR": "로그인이 필요해요",
            "en-US": "Authentication required",
        },
        detail: {
            "ko-KR": "로그인한 뒤 다시 요청해 주세요.",
            "en-US": "Sign in before sending the request.",
        },
    },
    ACCESS_DENIED: {
        status: 403,
        title: {
            "ko-KR": "접근 권한이 없어요",
            "en-US": "Access denied",
        },
        detail: {
            "ko-KR": "이 작업을 할 권한이 없어요.",
            "en-US": "You don’t have permission to perform this operation.",
        },
    },
    RESOURCE_NOT_FOUND: {
        status: 404,
        title: {
            "ko-KR": "요청한 항목을 찾을 수 없어요",
            "en-US": "Resource not found",
        },
        detail: {
            "ko-KR": "요청한 정보를 찾을 수 없어요.",
            "en-US": "The requested resource could not be found.",
        },
    },
    REQUEST_CONFLICT: {
        status: 409,
        title: {
            "ko-KR": "요청을 완료할 수 없어요",
            "en-US": "Request conflict",
        },
        detail: {
            "ko-KR": "현재 데이터 상태와 요청이 충돌해 처리할 수 없어요.",
            "en-US": "This request conflicts with the current data state.",
        },
    },
    METHOD_NOT_ALLOWED: {
        status: 405,
        title: {
            "ko-KR": "지원하지 않는 요청 방식이에요",
            "en-US": "Method not allowed",
        },
        detail: {
            "ko-KR": "요청 방식을 확인해 주세요.",
            "en-US": "Check the method used for this request.",
        },
    },
    REQUEST_EXPIRED: {
        status: 410,
        title: {
            "ko-KR": "요청이 만료됐어요",
            "en-US": "Request expired",
        },
        detail: {
            "ko-KR": "요청한 정보의 이용 기간이 끝났어요.",
            "en-US": "The requested information is no longer available.",
        },
    },
    PAYLOAD_TOO_LARGE: {
        status: 413,
        title: {
            "ko-KR": "요청 데이터가 너무 커요",
            "en-US": "Payload too large",
        },
        detail: {
            "ko-KR": "데이터 크기를 줄인 뒤 다시 보내 주세요.",
            "en-US": "Reduce the payload size and send it again.",
        },
    },
    MEDIA_TYPE_UNSUPPORTED: {
        status: 415,
        title: {
            "ko-KR": "지원하지 않는 형식이에요",
            "en-US": "Media type unsupported",
        },
        detail: {
            "ko-KR": "지원되는 형식으로 다시 보내 주세요.",
            "en-US": "Send the request using a supported media type.",
        },
    },
    REQUEST_RATE_LIMITED: {
        status: 429,
        title: {
            "ko-KR": "요청이 너무 많아요",
            "en-US": "Too many requests",
        },
        detail: {
            "ko-KR": "잠시 기다린 뒤 요청 상태를 확인해 주세요.",
            "en-US": "Wait briefly and check the request status before continuing.",
        },
    },
    INTERNAL_ERROR: {
        status: 500,
        title: {
            "ko-KR": "서버 오류가 발생했어요",
            "en-US": "Internal server error",
        },
        detail: {
            "ko-KR": "요청을 처리하는 중 예상하지 못한 문제가 발생했어요.",
            "en-US": "Something unexpected happened while processing your request.",
        },
    },
    DEPENDENCY_UNAVAILABLE: {
        status: 503,
        title: {
            "ko-KR": "연결된 서비스를 이용할 수 없어요",
            "en-US": "Dependency unavailable",
        },
        detail: {
            "ko-KR": "연결된 서비스를 현재 이용할 수 없어요.",
            "en-US": "The connected service is currently unavailable.",
        },
    },
    UPSTREAM_INVALID_RESPONSE: {
        status: 502,
        title: {
            "ko-KR": "연결된 서비스 응답을 확인할 수 없어요",
            "en-US": "Invalid upstream response",
        },
        detail: {
            "ko-KR": "연결된 서비스의 응답이 올바르지 않아 결과를 확인할 수 없어요.",
            "en-US": "The connected service returned an invalid response, so the result cannot be confirmed.",
        },
    },
    UPSTREAM_TIMEOUT: {
        status: 504,
        title: {
            "ko-KR": "연결된 서비스 응답이 늦어요",
            "en-US": "Upstream timeout",
        },
        detail: {
            "ko-KR": "연결된 서비스의 응답을 기다리는 시간이 초과됐어요.",
            "en-US": "The connected service did not respond within the time limit.",
        },
    },
    CONTRACT_ALREADY_SIGNED: {
        status: 409,
        title: {
            "ko-KR": "이미 서명된 계약이에요",
            "en-US": "Contract already signed",
        },
        detail: {
            "ko-KR": "이미 서명된 계약은 다시 변경할 수 없어요.",
            "en-US": "A signed contract cannot be changed again.",
        },
    },
};
function typeUriFor(code) {
    return `${exports.PROBLEM_TYPE_BASE_URI}${code.toLowerCase().replaceAll("_", "-")}`;
}
function freezeCatalog() {
    const entries = {};
    for (const code of PROBLEM_CODES) {
        const definition = PROBLEM_DEFINITIONS[code];
        const statuses = Object.freeze([...(definition.statuses ?? [definition.status])]);
        const title = Object.freeze({ ...definition.title });
        const detail = Object.freeze({ ...definition.detail });
        const fieldErrors = Object.freeze({
            "ko-KR": FIELD_ERROR_DETAILS["ko-KR"],
            "en-US": FIELD_ERROR_DETAILS["en-US"],
        });
        entries[code] = Object.freeze({
            code,
            type: typeUriFor(code),
            status: definition.status,
            statuses,
            allowedStatuses: statuses,
            title,
            detail,
            fieldErrors,
        });
    }
    return Object.freeze(entries);
}
exports.PROBLEM_CATALOG = freezeCatalog();
/** Lower-case alias for consumers that prefer a value-style catalog name. */
exports.problemCatalog = exports.PROBLEM_CATALOG;
/** Generic alias kept for callers that import the contract's “catalog”. */
exports.catalog = exports.PROBLEM_CATALOG;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function readOwn(value, key) {
    if (!hasOwn(value, key)) {
        return { present: false };
    }
    try {
        return { present: true, value: value[key] };
    }
    catch {
        return { present: true, value: undefined };
    }
}
function isProblemCode(value) {
    return typeof value === "string" && PROBLEM_CODES.includes(value);
}
function isProblemErrorCode(value) {
    return typeof value === "string" && PROBLEM_ERROR_CODES.includes(value);
}
function isProblemOutcome(value) {
    return typeof value === "string" && PROBLEM_OUTCOMES.includes(value);
}
function isProblemErrorLocation(value) {
    return typeof value === "string" && PROBLEM_ERROR_LOCATIONS.includes(value);
}
function isErrorLocale(value) {
    return value === "ko-KR" || value === "en-US";
}
function localeOrDefault(value) {
    return isErrorLocale(value) ? value : DEFAULT_LOCALE;
}
function isSafeIdentifier(value) {
    return typeof value === "string"
        && value.length > 0
        && value.length <= MAX_IDENTIFIER_LENGTH
        && !CONTROL_CHARACTER_PATTERN.test(value)
        && SAFE_IDENTIFIER_PATTERN.test(value);
}
function isSafeText(value) {
    return typeof value === "string"
        && value.length > 0
        && !CONTROL_CHARACTER_PATTERN.test(value);
}
function isValidPointer(value) {
    return typeof value === "string"
        && value.length <= MAX_POINTER_LENGTH
        && !CONTROL_CHARACTER_PATTERN.test(value)
        && RFC6901_POINTER_PATTERN.test(value);
}
function hasOnlyEmptyParams(value) {
    if (value === undefined) {
        return true;
    }
    if (!isRecord(value)) {
        return false;
    }
    try {
        return Reflect.ownKeys(value).length === 0;
    }
    catch {
        return false;
    }
}
function statusIsAllowed(code, status) {
    return typeof status === "number"
        && Number.isInteger(status)
        && exports.PROBLEM_CATALOG[code].allowedStatuses.includes(status);
}
function cloneParams() {
    return {};
}
function sanitizedFieldError(value, locale) {
    if (!isRecord(value)) {
        return null;
    }
    const pointer = readOwn(value, "pointer");
    const code = readOwn(value, "code");
    const detail = readOwn(value, "detail");
    const location = readOwn(value, "location");
    if (!pointer.present || !isValidPointer(pointer.value)
        || !code.present || !isProblemErrorCode(code.value)
        || !detail.present || !isSafeText(detail.value)) {
        return null;
    }
    if (location.present && !isProblemErrorLocation(location.value)) {
        return null;
    }
    const sanitized = {
        pointer: pointer.value,
        code: code.value,
        detail: FIELD_ERROR_DETAILS[locale][code.value],
    };
    if (location.present) {
        sanitized.location = location.value;
    }
    return sanitized;
}
function sanitizedErrors(value, locale) {
    if (value === undefined) {
        return null;
    }
    if (!Array.isArray(value)) {
        return null;
    }
    const errors = [];
    for (const item of value) {
        const sanitized = sanitizedFieldError(item, locale);
        if (!sanitized) {
            return null;
        }
        errors.push(sanitized);
    }
    return errors;
}
function sanitizedRecovery(value) {
    if (value === undefined) {
        return null;
    }
    if (!isRecord(value)) {
        return null;
    }
    const action = readOwn(value, "action");
    const retry = readOwn(value, "retry");
    if (!action.present || (action.value !== "CHECK_STATUS" && action.value !== "NONE")
        || !retry.present || !isRecord(retry.value)) {
        return null;
    }
    const mode = readOwn(retry.value, "mode");
    if (!mode.present || mode.value !== "NEVER") {
        return null;
    }
    return {
        action: action.value,
        retry: { mode: "NEVER" },
    };
}
function parseProblemDetailsInternal(value, httpStatus, locale) {
    if (!isRecord(value)) {
        return null;
    }
    const type = readOwn(value, "type");
    const title = readOwn(value, "title");
    const status = readOwn(value, "status");
    const detail = readOwn(value, "detail");
    const code = readOwn(value, "code");
    const requestId = readOwn(value, "requestId");
    const params = readOwn(value, "params");
    const errors = readOwn(value, "errors");
    const outcome = readOwn(value, "outcome");
    const operationId = readOwn(value, "operationId");
    const recovery = readOwn(value, "recovery");
    if (!type.present || typeof type.value !== "string"
        || !title.present || !isSafeText(title.value)
        || !status.present || typeof status.value !== "number" || !Number.isInteger(status.value)
        || !detail.present || !isSafeText(detail.value)
        || !code.present || !isProblemCode(code.value)
        || !requestId.present || !isSafeIdentifier(requestId.value)
        || type.value !== exports.PROBLEM_CATALOG[code.value].type
        || !statusIsAllowed(code.value, status.value)
        || (httpStatus !== undefined && (!Number.isInteger(httpStatus) || httpStatus !== status.value))
        || (params.present && !hasOnlyEmptyParams(params.value))) {
        return null;
    }
    const parsed = {
        type: exports.PROBLEM_CATALOG[code.value].type,
        title: exports.PROBLEM_CATALOG[code.value].title[locale],
        status: status.value,
        detail: exports.PROBLEM_CATALOG[code.value].detail[locale],
        code: code.value,
        requestId: requestId.value,
        params: cloneParams(),
    };
    if (errors.present) {
        const sanitized = sanitizedErrors(errors.value, locale);
        if (!sanitized) {
            return null;
        }
        parsed.errors = sanitized;
    }
    if (outcome.present) {
        if (!isProblemOutcome(outcome.value)) {
            return null;
        }
        parsed.outcome = outcome.value;
    }
    if (operationId.present) {
        if (!isSafeIdentifier(operationId.value)) {
            return null;
        }
        parsed.operationId = operationId.value;
    }
    if (recovery.present) {
        const sanitized = sanitizedRecovery(recovery.value);
        if (!sanitized) {
            return null;
        }
        parsed.recovery = sanitized;
    }
    return parsed;
}
/**
 * Validate and sanitize a server-supplied problem-details payload.
 * Unknown extension members are ignored.  Known text fields are always
 * replaced by the catalog copy, so server internals cannot reach a UI.
 */
function parseProblemDetails(value, httpStatus, locale = DEFAULT_LOCALE) {
    return parseProblemDetailsInternal(value, httpStatus, localeOrDefault(locale));
}
function assertCreateInput(value) {
    if (!isRecord(value)) {
        throw new TypeError("Problem details input must be an object");
    }
    const code = readOwn(value, "code");
    const requestId = readOwn(value, "requestId");
    if (!code.present || !isProblemCode(code.value)) {
        throw new TypeError("Problem details code must be registered");
    }
    if (!requestId.present || !isSafeIdentifier(requestId.value)) {
        throw new TypeError("Problem details requestId must be a safe identifier");
    }
}
function createProblemDetailsFromInput(input) {
    assertCreateInput(input);
    const locale = localeOrDefault(input.locale);
    const code = input.code;
    const status = input.status ?? exports.PROBLEM_CATALOG[code].status;
    if (!statusIsAllowed(code, status)) {
        throw new TypeError("Problem details status does not match its code");
    }
    if (!hasOnlyEmptyParams(input.params)) {
        throw new TypeError("Problem details params must be empty");
    }
    const result = {
        type: exports.PROBLEM_CATALOG[code].type,
        title: exports.PROBLEM_CATALOG[code].title[locale],
        status,
        detail: exports.PROBLEM_CATALOG[code].detail[locale],
        code,
        requestId: input.requestId,
        params: cloneParams(),
    };
    if (input.errors !== undefined) {
        const errors = sanitizedErrors(input.errors, locale);
        if (!errors) {
            throw new TypeError("Problem details errors are invalid");
        }
        result.errors = errors;
    }
    if (input.outcome !== undefined) {
        if (!isProblemOutcome(input.outcome)) {
            throw new TypeError("Problem details outcome is invalid");
        }
        result.outcome = input.outcome;
    }
    if (input.operationId !== undefined) {
        if (!isSafeIdentifier(input.operationId)) {
            throw new TypeError("Problem details operationId must be a safe identifier");
        }
        result.operationId = input.operationId;
    }
    if (input.recovery !== undefined) {
        const recovery = sanitizedRecovery(input.recovery);
        if (!recovery) {
            throw new TypeError("Problem details recovery is invalid");
        }
        result.recovery = recovery;
    }
    return result;
}
function createProblemDetails(inputOrCode, requestId, options = {}) {
    if (typeof inputOrCode === "string") {
        return createProblemDetailsFromInput({ ...options, code: inputOrCode, requestId: requestId });
    }
    return createProblemDetailsFromInput(inputOrCode);
}
function isCancellationError(error) {
    if (!isRecord(error)) {
        return false;
    }
    const code = readOwn(error, "code");
    const name = readOwn(error, "name");
    let inheritedCode;
    let inheritedName;
    try {
        inheritedCode = error.code;
        inheritedName = error.name;
    }
    catch {
        inheritedCode = undefined;
        inheritedName = undefined;
    }
    return code.value === "ERR_CANCELED"
        || code.value === "ABORT_ERR"
        || name.value === "AbortError"
        || inheritedCode === "ERR_CANCELED"
        || inheritedCode === "ABORT_ERR"
        || inheritedName === "AbortError";
}
function isTransportError(error) {
    if (!isRecord(error)) {
        return false;
    }
    if (isCancellationError(error)) {
        return true;
    }
    const code = readOwn(error, "code");
    const request = readOwn(error, "request");
    const isAxiosError = readOwn(error, "isAxiosError");
    const transportCodes = new Set([
        "ERR_NETWORK",
        "ECONNABORTED",
        "ECONNRESET",
        "ECONNREFUSED",
        "ENOTFOUND",
        "ETIMEDOUT",
        "EAI_AGAIN",
        "ECONNTERMINATED",
        "ERR_SOCKET_CLOSED",
        "ERR_INTERNET_DISCONNECTED",
        "NETWORK_ERR",
        "ABORT_ERR",
    ]);
    return (typeof code.value === "string" && transportCodes.has(code.value))
        || request.present
        || isAxiosError.value === true;
}
function responseStatus(value) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 599) {
        return undefined;
    }
    return value;
}
function responseEnvelope(error) {
    if (!isRecord(error)) {
        return { hasResponse: false, statusPresent: false };
    }
    const response = readOwn(error, "response");
    if (response.present && isRecord(response.value)) {
        const nestedStatus = readOwn(response.value, "status");
        const nestedData = readOwn(response.value, "data");
        return {
            hasResponse: nestedStatus.present || nestedData.present,
            statusPresent: nestedStatus.present,
            status: responseStatus(nestedStatus.value),
            data: nestedData.value,
        };
    }
    const directProblem = hasOwn(error, "type")
        || hasOwn(error, "requestId")
        || (hasOwn(error, "status")
            && hasOwn(error, "code")
            && hasOwn(error, "title")
            && hasOwn(error, "detail"));
    if (directProblem) {
        const directStatus = readOwn(error, "status");
        return {
            hasResponse: true,
            statusPresent: directStatus.present,
            status: responseStatus(directStatus.value),
            data: error,
        };
    }
    const status = readOwn(error, "status");
    const data = readOwn(error, "data");
    if (status.present || data.present) {
        return {
            hasResponse: true,
            statusPresent: status.present,
            status: responseStatus(status.value),
            data: data.value,
        };
    }
    return { hasResponse: false, statusPresent: false };
}
function parseJsonObject(value) {
    if (typeof value !== "string") {
        return value;
    }
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        return value;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return value;
    }
}
function originalString(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_ORIGINAL_TEXT_LENGTH || CONTROL_CHARACTER_PATTERN.test(value)) {
        return undefined;
    }
    return value;
}
function originalCodeAndType(value) {
    if (!isRecord(value)) {
        return {};
    }
    return {
        code: originalString(readOwn(value, "code").value),
        type: originalString(readOwn(value, "type").value),
    };
}
function resultWithAliases(result) {
    // Keep the wire-facing result small while allowing UI code to use the
    // common `isCanceled`/`shouldSuppress` spellings without a second policy.
    Object.defineProperties(result, {
        isCanceled: { value: result.canceled, enumerable: false },
        shouldSuppress: { value: result.suppress, enumerable: false },
    });
    return result;
}
/**
 * Normalize server, transport, and local errors into one safe result.  A
 * malformed response is never promoted to a fabricated ProblemDetails object.
 */
function normalizeApiError(error, options = {}) {
    const operation = options.operation === "read" ? "read" : "mutation";
    const locale = localeOrDefault(options.locale);
    const canceled = isCancellationError(error);
    const envelope = responseEnvelope(error);
    const body = parseJsonObject(envelope.data);
    const parsed = envelope.hasResponse && (!envelope.statusPresent || envelope.status !== undefined)
        ? parseProblemDetails(body, envelope.status, locale)
        : null;
    const aliases = originalCodeAndType(body);
    const origin = envelope.hasResponse
        ? "server"
        : isTransportError(error)
            ? "transport"
            : "client";
    const result = {
        origin,
        verified: parsed !== null,
        message: parsed
            ? resolveProblemMessage(parsed.code, locale)
            : canceled
                ? operation === "read"
                    ? READ_CANCELED_MESSAGES[locale]
                    : MUTATION_FAILURE_MESSAGES[locale]
                : resolveProblemMessage(undefined, { locale, operation }),
        canceled,
        suppress: canceled && operation === "read",
    };
    if (parsed) {
        result.problem = parsed;
        result.status = parsed.status;
        if (parsed.outcome !== undefined) {
            result.outcome = parsed.outcome;
        }
        if (parsed.recovery !== undefined) {
            result.recovery = parsed.recovery;
        }
    }
    else {
        if (envelope.status !== undefined) {
            result.status = envelope.status;
        }
        if (aliases.code !== undefined) {
            result.originalCode = aliases.code;
        }
        if (aliases.type !== undefined) {
            result.originalType = aliases.type;
        }
        if (operation === "mutation") {
            result.outcome = "UNKNOWN";
            result.recovery = { action: "CHECK_STATUS", retry: { mode: "NEVER" } };
        }
    }
    return resultWithAliases(result);
}
function problemCodeFromUnknown(value) {
    if (isProblemCode(value)) {
        return value;
    }
    if (!isRecord(value)) {
        return undefined;
    }
    const directProblem = parseProblemDetails(value);
    if (directProblem)
        return directProblem.code;
    const nestedProblem = parseProblemDetails(readOwn(value, "problem").value);
    if (nestedProblem)
        return nestedProblem.code;
    return undefined;
}
/**
 * Resolve a message solely from the registered catalog or a centralized safe
 * fallback.  Incoming title/detail strings and legacy message translations
 * are intentionally ignored.
 */
function resolveProblemMessage(value, localeOrOptions = DEFAULT_LOCALE) {
    const options = typeof localeOrOptions === "string"
        ? { locale: localeOrOptions }
        : isRecord(localeOrOptions)
            ? localeOrOptions
            : {};
    const locale = localeOrDefault(options.locale);
    const code = problemCodeFromUnknown(value);
    if (code) {
        return exports.PROBLEM_CATALOG[code].detail[locale];
    }
    if (options.operation === "read") {
        return READ_FAILURE_MESSAGES[locale];
    }
    if (options.operation === "mutation") {
        return MUTATION_FAILURE_MESSAGES[locale];
    }
    return UNKNOWN_MESSAGES[locale];
}
exports.SAFE_UNKNOWN_PROBLEM_MESSAGES = UNKNOWN_MESSAGES;
exports.SAFE_READ_FAILURE_MESSAGES = READ_FAILURE_MESSAGES;
exports.SAFE_MUTATION_FAILURE_MESSAGES = MUTATION_FAILURE_MESSAGES;
