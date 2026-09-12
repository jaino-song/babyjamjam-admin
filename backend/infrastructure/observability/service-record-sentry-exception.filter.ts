import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
} from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import type { Request } from "express";
import type { Response } from "express";

import { getProblemRequestId, mapHttpProblem, sendProblemResponse } from "../filters/problem-response";

import {
    captureBackendError,
    captureServiceRecordError,
    getServiceRecordOperation,
    isServiceRecordSignal,
} from "./service-record-sentry";

@Catch()
export class ServiceRecordSentryExceptionFilter
    extends BaseExceptionFilter
    implements ExceptionFilter
{
    constructor(httpAdapterHost: HttpAdapterHost) {
        super(httpAdapterHost.httpAdapter);
    }

    catch(exception: unknown, host: ArgumentsHost): void {
        if (host.getType() === "http") {
            const request = host.switchToHttp().getRequest<Request>();
            const path = request.originalUrl || request.url;
            const originalStatusCode = exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;

            const response = host.switchToHttp().getResponse<Response>();
            const requestId = getProblemRequestId(response);
            const problem = mapHttpProblem(exception, request, response);
            const statusCode = problem?.status ?? originalStatusCode;
            if (statusCode >= 500) {
                try {
                    if (isServiceRecordSignal(path)) {
                        captureServiceRecordError(exception, {
                            operation: getServiceRecordOperation(path),
                            handled: false,
                            statusCode,
                            requestId,
                            problemCode: problem?.code,
                            outcome: problem?.outcome,
                        });
                    } else {
                        captureBackendError(exception, {
                            operation: "http",
                            handled: false,
                            statusCode,
                            requestId,
                            problemCode: problem?.code,
                            outcome: problem?.outcome,
                        });
                    }
                } catch {
                    // 관측 도구의 실패가 원래 요청 오류를 덮지 않아요.
                }
            }

            if (problem) {
                sendProblemResponse(response, problem);
                return;
            }
        }

        super.catch(exception, host);
    }
}
