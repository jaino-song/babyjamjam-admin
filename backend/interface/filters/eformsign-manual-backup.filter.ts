import { randomUUID } from "node:crypto";
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { ErrorRequestHandler, Response } from "express";
import { ManualBackupControlError } from "domain/eformsign-backup/manual-backup-control";
import { EXPORT_ERRORS, ExportError } from "domain/eformsign-backup/export";
import type { EformsignBackupExportRequest } from "infrastructure/auth/eformsign-backup-export.guard";

export function stampManualBackup(request: EformsignBackupExportRequest, response: Response): void {
    request.eformsignBackupExportRequestId ??= randomUUID();
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Request-Id", request.eformsignBackupExportRequestId);
}

@Catch()
export class EformsignManualBackupFilter implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        this.respond(error, http.getRequest<EformsignBackupExportRequest>(), http.getResponse<Response>());
    }

    respond(error: unknown, request: EformsignBackupExportRequest, response: Response): void {
        if (response.headersSent || response.destroyed) {
            if (!response.destroyed) response.destroy();
            return;
        }
        stampManualBackup(request, response);
        let code = "SERVICE_UNAVAILABLE";
        let status = 503;
        if (error instanceof ManualBackupControlError) {
            code = error.code;
            status = code === "INVALID_REQUEST" || code === "EMPTY_SELECTION" ? 400
                : code === "NOT_FOUND" ? 404 : code === "SERVICE_UNAVAILABLE" ? 503 : 409;
        } else if (error instanceof ExportError) {
            code = error.code;
            status = EXPORT_ERRORS[error.code].status;
        } else if (error instanceof SyntaxError && "type" in error && error.type === "entity.parse.failed"
            && "status" in error && error.status === 400) {
            code = "INVALID_REQUEST";
            status = 400;
        } else if (error instanceof HttpException) {
            const mapped: Record<number, string> = { 400: "INVALID_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND" };
            const known = mapped[error.getStatus()];
            if (known) { code = known; status = error.getStatus(); }
        }
        response.status(status).json({ code, requestId: request.eformsignBackupExportRequestId });
    }
}

// Register directly on the adapter: NestMiddleware proxies have three arguments
// and cannot receive Express parser errors. Keep exact path-segment boundaries.
export const manualBackupErrorBoundary: ErrorRequestHandler = (error: unknown, request, response, next): void => {
    const manual = ["/eformsign-backups/runs", "/internal/eformsign-backup/v1/manual-runs"]
        .some(prefix => request.path === prefix || request.path.startsWith(prefix + "/"));
    if (!manual) {
        next(error);
        return;
    }
    new EformsignManualBackupFilter().respond(error, request, response);
};
