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
import { getProblemRequestId, sendProblemResponse } from "./problem-response";

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
        this.logger.error({ code: prismaCode, requestId, status });
        try {
            capturePrismaError(exception, {
                code: prismaCode,
                requestId,
                eligible: isPrismaFailoverEligible(exception),
                route: getDatabaseConnectionMode(),
            });
        } catch {
            // 진단 수집 실패는 원래 응답을 바꾸지 않아요.
        }
        // DB 제약만으로 고객 중복이나 삭제 제한을 추측하지 않아요.
        const problem = createProblemDetails({
            code: status === HttpStatus.SERVICE_UNAVAILABLE ? "DEPENDENCY_UNAVAILABLE" : "INTERNAL_ERROR",
            requestId,
            ...(["GET", "HEAD", "OPTIONS"].includes(request.method) ? {} : { outcome: "UNKNOWN" as const }),
        });
        return sendProblemResponse(response, problem);
    }
}
