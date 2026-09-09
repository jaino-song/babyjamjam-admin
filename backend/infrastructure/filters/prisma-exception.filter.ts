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
import { createProblemDetails } from "@babyjamjam/shared/errors/problem-details";
import { getProblemLocale, getProblemRequestId, sendProblemResponse } from "./problem-response";

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

// Prisma 에러 코드별 HTTP 상태 매핑 (메시지는 프론트엔드에서 처리)
const PRISMA_ERROR_STATUS: Record<string, HttpStatus> = {
    P2002: HttpStatus.CONFLICT,
    P2003: HttpStatus.BAD_REQUEST,
    P2025: HttpStatus.NOT_FOUND,
    P2011: HttpStatus.BAD_REQUEST,
    P2006: HttpStatus.BAD_REQUEST,
    P1001: HttpStatus.SERVICE_UNAVAILABLE, // Database unreachable
    P1017: HttpStatus.SERVICE_UNAVAILABLE, // Connection closed by server
    P2024: HttpStatus.SERVICE_UNAVAILABLE, // Prisma pool exhausted
};

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
        const status = PRISMA_ERROR_STATUS[prismaCode] || HttpStatus.INTERNAL_SERVER_ERROR;
        const requestId = getProblemRequestId(response);
        const problem = status >= 500 ? createProblemDetails({
            code: status === HttpStatus.SERVICE_UNAVAILABLE ? "DEPENDENCY_UNAVAILABLE" : "INTERNAL_ERROR",
            requestId,
            locale: getProblemLocale(request, response),
            ...(["GET", "HEAD", "OPTIONS"].includes(request.method) ? {} : { outcome: "UNKNOWN" as const }),
        }) : undefined;
        this.logger.error({ code: prismaCode, requestId, status });
        try {
            capturePrismaError(exception, {
                code: prismaCode,
                requestId,
                problemCode: problem?.code,
                outcome: problem?.outcome,
                eligible: isPrismaFailoverEligible(exception),
                route: getDatabaseConnectionMode(),
            });
        } catch {
            // 진단 수집 실패는 원래 응답을 바꾸지 않아요.
        }
        // 기존 소비자가 의존하는 상태/코드만 유지하며 DB 필드와 제약 이름은 공개하지 않아요.
        if (status < 500) {
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("X-Request-Id", requestId);
            return response.status(status).json({
                statusCode: status,
                code: prismaCode,
                error: status === 409 ? "Conflict" : status === 404 ? "Not Found" : "Bad Request",
            });
        }
        if (problem) return sendProblemResponse(response, problem);
    }
}
