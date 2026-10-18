import {
    ArgumentsHost,
    Body,
    Catch,
    Controller,
    ExceptionFilter,
    Get,
    Headers,
    HttpCode,
    HttpException,
    HttpStatus,
    Logger,
    Param,
    Post,
    Query,
    Req,
    Res,
    UseFilters,
    UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";

import {
    EformsignBackupExportService,
    type CreateExportSnapshotBody,
} from "application/services/eformsign-backup-export.service";
import {
    EXPORT_ERRORS,
    ExportError,
    isValidIdempotencyKey,
    toExportErrorBody,
    type ExportPrincipal,
} from "domain/eformsign-backup/export";
import {
    EformsignBackupExportGuard,
    type EformsignBackupExportRequest,
} from "infrastructure/auth/eformsign-backup-export.guard";

const BODY_KEYS = ["companyId", "scopeRevision", "policyRevision"] as const;
const BODY_STRING_MAX = 256;
// Printable ASCII only: a stored content type with a control character would make setHeader throw.
const SAFE_CONTENT_TYPE = /^[\x20-\x7e]+$/;

/**
 * Turns every error thrown inside the export controller (the guard included) into the
 * contract 3.6 body. The body carries only the contract keys, never an error message or
 * stack, and because it answers every exception itself no global filter (Prisma, Sentry)
 * ever sees an export request.
 */
@Catch()
export class EformsignBackupExportExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(EformsignBackupExportExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const request = http.getRequest<EformsignBackupExportRequest>();
        const response = http.getResponse<Response>();
        const requestId = request.eformsignBackupExportRequestId ?? randomUUID();

        const error = this.toExportError(exception, requestId);
        if (response.headersSent) {
            response.end();
            return;
        }
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Request-Id", requestId);
        if (error.retryAfterSeconds !== undefined) response.setHeader("Retry-After", String(error.retryAfterSeconds));
        response.status(EXPORT_ERRORS[error.code].status).json(toExportErrorBody(error, requestId));
    }

    private toExportError(exception: unknown, requestId: string): ExportError {
        if (exception instanceof ExportError) return exception;
        // A Nest 400 here is a parsing/validation failure of the request itself.
        if (exception instanceof HttpException && exception.getStatus() === HttpStatus.BAD_REQUEST) {
            return new ExportError("INVALID_REQUEST");
        }
        // The request id only: an error message can echo request content.
        this.logger.error(`export request failed requestId=${requestId}`);
        return new ExportError("INTERNAL");
    }
}

function invalidRequest(reasonCode: string): ExportError {
    return new ExportError("INVALID_REQUEST", { reasonCode });
}

/** Contract 3.1: exactly the three known keys, each a non-empty string of at most 256 characters. */
function parseSnapshotBody(raw: unknown): CreateExportSnapshotBody {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalidRequest("body");
    const record = raw as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== BODY_KEYS.length || !BODY_KEYS.every(key => Object.prototype.hasOwnProperty.call(record, key))) {
        throw invalidRequest("body");
    }
    for (const key of BODY_KEYS) {
        const value = record[key];
        if (typeof value !== "string" || value.length === 0 || value.length > BODY_STRING_MAX) throw invalidRequest("body");
    }
    return {
        companyId: record["companyId"] as string,
        scopeRevision: record["scopeRevision"] as string,
        policyRevision: record["policyRevision"] as string,
    };
}

/** A repeated query key arrives as an array; the service only understands one string. */
function optionalQueryString(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw invalidRequest("query");
    return value;
}

function principalOf(request: EformsignBackupExportRequest): ExportPrincipal {
    const principal = request.eformsignBackupExportPrincipal;
    if (!principal) throw new ExportError("UNAUTHORIZED");
    return principal;
}

function requestIdOf(request: EformsignBackupExportRequest): string {
    return request.eformsignBackupExportRequestId ?? randomUUID();
}

/** Machine export API of the eformsign backup inventory (BJJ-454, contract 3). */
@Controller("internal/eformsign-backup/v1")
@UseGuards(EformsignBackupExportGuard)
@UseFilters(EformsignBackupExportExceptionFilter)
export class EformsignBackupExportController {
    constructor(private readonly service: EformsignBackupExportService) {}

    @Post("snapshots")
    @HttpCode(HttpStatus.ACCEPTED)
    async createSnapshot(
        @Req() request: EformsignBackupExportRequest,
        @Res({ passthrough: true }) response: Response,
        @Headers("idempotency-key") idempotencyKey: string | undefined,
        @Body() body: unknown,
    ) {
        this.stamp(request, response);
        const principal = principalOf(request);
        if (!isValidIdempotencyKey(idempotencyKey)) throw invalidRequest("idempotency-key");
        return this.service.createSnapshot(principal, parseSnapshotBody(body), idempotencyKey);
    }

    @Get("snapshots/:snapshotId")
    async getSnapshot(
        @Req() request: EformsignBackupExportRequest,
        @Res({ passthrough: true }) response: Response,
        @Param("snapshotId") snapshotId: string,
    ) {
        this.stamp(request, response);
        return this.service.getSnapshot(principalOf(request), snapshotId);
    }

    @Get("snapshots/:snapshotId/candidates")
    async listCandidates(
        @Req() request: EformsignBackupExportRequest,
        @Res({ passthrough: true }) response: Response,
        @Param("snapshotId") snapshotId: string,
        @Query("cursor") cursor: unknown,
        @Query("limit") limit: unknown,
    ) {
        this.stamp(request, response);
        const principal = principalOf(request);
        return this.service.listCandidates(principal, snapshotId, optionalQueryString(cursor), optionalQueryString(limit));
    }

    @Get("snapshots/:snapshotId/artifacts/:artifactIdentity")
    async readArtifact(
        @Req() request: EformsignBackupExportRequest,
        @Res() response: Response,
        @Param("snapshotId") snapshotId: string,
        @Param("artifactIdentity") artifactIdentity: string,
    ): Promise<void> {
        this.stamp(request, response);
        const artifact = await this.service.readArtifact(principalOf(request), snapshotId, artifactIdentity);
        // The slot is held until the response is over, not until the bytes are in memory (contract 3.5 #3b).
        // `close` fires after `finish` and also when the client aborts; the guard makes a second call harmless.
        let released = false;
        const release = (): void => {
            if (released) return;
            released = true;
            artifact.release();
        };
        try {
            response.once("close", release);
            // A client that left while the service was reading has already had its `close`; it will not come again.
            if (response.destroyed) release();
            const contentType = SAFE_CONTENT_TYPE.test(artifact.contentType) ? artifact.contentType : "application/pdf";
            response.status(HttpStatus.OK);
            response.setHeader("Content-Type", contentType);
            response.setHeader("Content-Length", String(artifact.bytes.length));
            response.setHeader("X-Artifact-Identity", artifact.artifactIdentity);
            response.setHeader("X-Content-Sha256", artifact.sha256);
            // The file name is the identity: a document title or customer name never reaches a header.
            response.setHeader("Content-Disposition", `attachment; filename="${artifact.artifactIdentity}.pdf"`);
            response.end(artifact.bytes);
        } catch (error) {
            release();
            throw error;
        }
    }

    private stamp(request: EformsignBackupExportRequest, response: Response): void {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Request-Id", requestIdOf(request));
    }
}
