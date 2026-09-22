import { randomUUID } from "node:crypto";
import { HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import {
    createProblemDetails,
    parseProblemDetails,
    PROBLEM_CATALOG,
    type ProblemCode,
    type ProblemDetails,
} from "@babyjamjam/shared/errors/problem-details";

/** 요청 참조는 서버에서 만들고 응답과 내부 진단이 같은 값을 사용해요. */
export function getProblemRequestId(response: Response): string {
    const existing: unknown = response.locals["errorRequestId"];
    if (typeof existing === "string") return existing;
    const requestId = randomUUID();
    response.locals["errorRequestId"] = requestId;
    return requestId;
}

/**
 * 경계가 소유한 멤버 목록이에요. 문제 멤버는 항상 카탈로그 문안과 파싱 결과로
 * 다시 만들고, 레거시 별칭(statusCode·message·error)은 `sendProblemResponse`가
 * 책임져요. `message`는 problem-bodies.ts의 프로세스 내 호환 별칭으로, 생산자
 * message 텍스트(진단 유출)가 클라이언트에 닿지 않는 기존 불변식을 유지하기 위해
 * 의도적으로 제외해요. 그 외의 호환 확장 키만 던진 본문에서 다시 붙여요.
 */
const BOUNDARY_OWNED_MEMBERS = new Set([
    "type", "title", "status", "detail", "code", "requestId", "instance",
    "params", "errors", "outcome", "operationId", "recovery",
    "statusCode", "message", "error",
]);

/** 프로토타입 오염에 쓸 수 있는 위험한 키는 확장 전달에서 제외해요. */
const UNSAFE_EXTRA_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * 등록된 문제 본문 옆의 호환 확장 키(임시 저장 복구 상태, 미리보기 식별자,
 * 차단 사유, 회차 인덱스 등)를 파싱된 문제 응답에 되살려요(EM-CAT-02: 레거시
 * 필드 유지 + 문제 멤버 추가). 경계가 소유한 멤버는 절대 던진 본문 값으로
 * 바꾸지 않으므로 확장 전달이 카탈로그 사본을 덮을 수 없어요.
 */
function withCompatExtras(problem: ProblemDetails, record: Record<string, unknown>): ProblemDetails {
    const extras: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
        if (BOUNDARY_OWNED_MEMBERS.has(key) || UNSAFE_EXTRA_KEYS.has(key)) continue;
        if (record[key] === undefined) continue;
        extras[key] = record[key];
    }
    return Object.keys(extras).length === 0 ? problem : { ...problem, ...extras };
}

export function getProblemLocale(request: Request, response: Response): "ko-KR" | "en-US" {
    const language = request.acceptsLanguages?.("ko-KR", "en-US", "ko", "en");
    const locale = language === "en-US" || language === "en" ? "en-US" : "ko-KR";
    response.locals["errorLocale"] = locale;
    return locale;
}

/** 기존 업무 예외는 개별 전환 전까지 유지하고, 등록된 계약만 새 응답으로 변환해요. */
export function mapHttpProblem(
    exception: unknown,
    request: Request,
    response: Response,
): ProblemDetails | null {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    const record = body !== null && typeof body === "object" ? body as Record<string, unknown> : undefined;
    const code = typeof record?.["code"] === "string" && Object.prototype.hasOwnProperty.call(PROBLEM_CATALOG, record["code"])
        ? record["code"] as ProblemCode : undefined;
    // 이전 4xx 업무 응답을 일반적인 오류로 덮어써 원인을 잃지 않아요.
    if (!code && status < 500) return null;
    const requestId = getProblemRequestId(response);
    const locale = getProblemLocale(request, response);
    const selectedCode: ProblemCode = code ?? ({ 502: "UPSTREAM_INVALID_RESPONSE", 503: "DEPENDENCY_UNAVAILABLE", 504: "UPSTREAM_TIMEOUT" } as const)[status as 502 | 503 | 504] ?? "INTERNAL_ERROR";
    const problem = createProblemDetails({ code: selectedCode, requestId, locale });
    if (code) {
        const candidate = {
            ...problem,
            status,
            ...(record?.["type"] === undefined ? {} : { type: record["type"] }),
            ...(record?.["params"] === undefined ? {} : { params: record["params"] }),
            ...(record?.["errors"] === undefined ? {} : { errors: record["errors"] }),
            ...(record?.["outcome"] === undefined ? {} : { outcome: record["outcome"] }),
            ...(record?.["operationId"] === undefined ? {} : { operationId: record["operationId"] }),
            ...(record?.["recovery"] === undefined ? {} : { recovery: record["recovery"] }),
        };
        const parsed = parseProblemDetails(candidate, status, locale);
        if (parsed && record) return withCompatExtras(parsed, record);
        new Logger("ProblemResponse").error({ code: "ERROR_CONTRACT_INVALID", requestId, status });
    }
    return createProblemDetails({
        code: code ? "INTERNAL_ERROR" : selectedCode,
        requestId,
        locale,
        ...(["GET", "HEAD", "OPTIONS"].includes(request.method) ? {} : { outcome: "UNKNOWN" as const }),
    });
}

export function sendProblemResponse(response: Response, problem: ProblemDetails): void {
    response.setHeader("Content-Type", "application/problem+json");
    response.setHeader("Content-Language", response.locals["errorLocale"] === "en-US" ? "en-US" : "ko-KR");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Request-Id", problem.requestId);
    if (problem.status === 401) response.setHeader("WWW-Authenticate", "Bearer");
    // 구버전 화면은 message/error를 읽으며 새 화면은 공개 계약을 검증해요.
    response.status(problem.status).json({
        ...problem,
        statusCode: problem.status,
        message: problem.detail,
        error: problem.detail,
    });
}
