import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
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

/** 기존 업무 예외는 개별 전환 전까지 유지하고, 등록된 계약만 새 응답으로 변환해요. */
export function mapHttpProblem(
    exception: unknown,
    request: Request,
    response: Response,
): ProblemDetails | null {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    const record = body !== null && typeof body === "object" ? body as Record<string, unknown> : undefined;
    const code = typeof record?.["code"] === "string" && Object.hasOwn(PROBLEM_CATALOG, record["code"])
        ? record["code"] as ProblemCode : undefined;
    // 이전 4xx 업무 응답을 일반적인 오류로 덮어써 원인을 잃지 않아요.
    if (!code && status < 500) return null;
    const requestId = getProblemRequestId(response);
    const language = request.acceptsLanguages?.("ko-KR", "en-US", "ko", "en");
    const locale = language === "en-US" || language === "en" ? "en-US" : "ko-KR";
    response.locals["errorLocale"] = locale;
    const selectedCode: ProblemCode = code ?? ({ 502: "UPSTREAM_INVALID_RESPONSE", 503: "DEPENDENCY_UNAVAILABLE", 504: "UPSTREAM_TIMEOUT" } as const)[status as 502 | 503 | 504] ?? "INTERNAL_ERROR";
    const problem = createProblemDetails({ code: selectedCode, requestId, locale });
    if (code) {
        const candidate = {
            ...problem,
            status,
            ...(record?.["errors"] === undefined ? {} : { errors: record["errors"] }),
            ...(record?.["outcome"] === undefined ? {} : { outcome: record["outcome"] }),
            ...(record?.["operationId"] === undefined ? {} : { operationId: record["operationId"] }),
            ...(record?.["recovery"] === undefined ? {} : { recovery: record["recovery"] }),
        };
        const parsed = parseProblemDetails(candidate, status, locale);
        if (parsed) return parsed;
    }
    return createProblemDetails({
        code: selectedCode,
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
