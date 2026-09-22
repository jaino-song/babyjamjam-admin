import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpStatus,
    Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { Request } from "express";
import {
    createProblemDetails,
    PROBLEM_CATALOG,
    type ProblemCode,
} from "@babyjamjam/shared/errors/problem-details";
import { getProblemLocale, getProblemRequestId, sendProblemResponse } from "./problem-response";
import { captureHttpAdvisory } from "../observability/http-advisory";

import { getDatabaseConnectionMode } from "infrastructure/database/prisma-url.utils";
import {
    getPrismaErrorCode,
    isPrismaFailoverEligible,
} from "infrastructure/database/prisma-error.utils";
import {
    capturePrismaError,
} from "infrastructure/observability/service-record-sentry";

type PrismaException =
    | Prisma.PrismaClientKnownRequestError
    | Prisma.PrismaClientUnknownRequestError
    | Prisma.PrismaClientInitializationError
    | Prisma.PrismaClientRustPanicError
    | Prisma.PrismaClientValidationError;

// Prisma 에러 코드를 공개 문제 코드로 사상해요(EM-CAT-01). HTTP 상태는 각 코드의
// 카탈로그 상태라서 기존 응답 상태(P2002 409, P2003 400, P2025 404)를 그대로 유지해요.
// 메시지는 카탈로그 문구로 응답하며 프론트엔드 호환 별칭은 problem-response가 유지해요.
const PRISMA_PROBLEM_CODES: Record<string, ProblemCode> = {
    P2002: "REQUEST_CONFLICT",
    P2003: "REQUEST_INVALID",
    P2000: "VALIDATION_FAILED",
    P2011: "REQUEST_INVALID",
    P2006: "REQUEST_INVALID",
    P2025: "RESOURCE_NOT_FOUND",
};

// 연결·풀 장애는 문장이 반영됐는지 알 수 없으므로 코드의 상태만 바꾸지 않고
// 기존 UNKNOWN·CHECK_STATUS 의미를 유지해요(EM-STATE-01).
const PRISMA_UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

@Catch(
    Prisma.PrismaClientKnownRequestError,
    Prisma.PrismaClientUnknownRequestError,
    Prisma.PrismaClientInitializationError,
    Prisma.PrismaClientRustPanicError,
    Prisma.PrismaClientValidationError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(PrismaExceptionFilter.name);
    catch(exception: PrismaException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();
        const code = getPrismaErrorCode(exception);
        const prismaCode = code ?? "unknown";
        const unavailable = code !== null && PRISMA_UNAVAILABLE_CODES.has(code);
        const problemCode = unavailable
            ? "DEPENDENCY_UNAVAILABLE" as const
            : code ? PRISMA_PROBLEM_CODES[code] : undefined;
        const status = problemCode
            ? PROBLEM_CATALOG[problemCode].status
            : HttpStatus.INTERNAL_SERVER_ERROR;
        const requestId = getProblemRequestId(response);
        const locale = getProblemLocale(request, response);
        // 등록된 문장 거절(4xx)은 해당 변경이 적용되지 않았음을 선언해요. 연결 장애와
        // 미등록 코드는 상태가 불명확하므로 쓰기 요청에서 UNKNOWN으로 응답해요(EM-STATE-01).
        const problem = problemCode === "DEPENDENCY_UNAVAILABLE" || problemCode === undefined
            ? createProblemDetails({
                code: problemCode ?? "INTERNAL_ERROR",
                requestId,
                locale,
                ...(["GET", "HEAD", "OPTIONS"].includes(request.method) ? {} : { outcome: "UNKNOWN" as const }),
            })
            : createProblemDetails({
                code: problemCode,
                requestId,
                locale,
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
            });
        this.logger.error({ code: prismaCode, requestId, status });
        try {
            if (status === HttpStatus.BAD_REQUEST) {
                captureHttpAdvisory(request, requestId, undefined, prismaCode);
            } else {
                capturePrismaError(exception, {
                    code: prismaCode,
                    requestId,
                    problemCode: problem?.code,
                    outcome: problem?.outcome,
                    eligible: isPrismaFailoverEligible(exception),
                    route: getDatabaseConnectionMode(),
                });
            }
        } catch {
            // 진단 수집 실패는 원래 응답을 바꾸지 않아요.
        }
        // 등록 코드·호환 별칭(statusCode/message/error)만 응답하고 DB 필드와 제약 이름은 공개하지 않아요.
        sendProblemResponse(response, problem);
    }
}
