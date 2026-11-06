import { Body, Controller, HttpCode, Param, Post, Req, Res, UseFilters, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { EformsignManualBackupService } from "application/services/eformsign-manual-backup.service";
import { ExportError, type ExportPrincipal } from "domain/eformsign-backup/export";
import { EformsignBackupExportGuard, type EformsignBackupExportRequest } from "infrastructure/auth/eformsign-backup-export.guard";
import { EformsignManualBackupFilter, stampManualBackup } from "interface/filters/eformsign-manual-backup.filter";

function principal(request: EformsignBackupExportRequest, response: Response): ExportPrincipal {
    stampManualBackup(request, response);
    if (!request.eformsignBackupExportPrincipal) throw new ExportError("UNAUTHORIZED");
    return request.eformsignBackupExportPrincipal;
}

@Controller("internal/eformsign-backup/v1/manual-runs")
@UseGuards(EformsignBackupExportGuard)
@UseFilters(EformsignManualBackupFilter)
export class EformsignManualBackupWorkerController {
    constructor(private readonly service: EformsignManualBackupService) {}

    @Post("claim") @HttpCode(200)
    async claim(@Req() request: EformsignBackupExportRequest, @Res() response: Response, @Body() body: unknown): Promise<void> {
        response.status(200).json(await this.service.claim(principal(request, response), body));
    }
    @Post(":runId/renew") @HttpCode(200)
    renew(@Req() request: EformsignBackupExportRequest, @Res({ passthrough: true }) response: Response, @Param("runId") id: string, @Body() body: unknown) {
        return this.service.renew(principal(request, response), id, body);
    }
    @Post(":runId/candidates") @HttpCode(200)
    candidates(@Req() request: EformsignBackupExportRequest, @Res({ passthrough: true }) response: Response, @Param("runId") id: string, @Body() body: unknown) {
        return this.service.listCandidates(principal(request, response), id, body);
    }
    @Post(":runId/validate") @HttpCode(200)
    validate(@Req() request: EformsignBackupExportRequest, @Res({ passthrough: true }) response: Response, @Param("runId") id: string, @Body() body: unknown) {
        return this.service.validateSelectedDocument(principal(request, response), id, body);
    }
    @Post(":runId/document-results") @HttpCode(200)
    results(@Req() request: EformsignBackupExportRequest, @Res({ passthrough: true }) response: Response, @Param("runId") id: string, @Body() body: unknown) {
        return this.service.writeDocumentResults(principal(request, response), id, body);
    }
    @Post(":runId/finish") @HttpCode(200)
    finish(@Req() request: EformsignBackupExportRequest, @Res({ passthrough: true }) response: Response, @Param("runId") id: string, @Body() body: unknown) {
        return this.service.finish(principal(request, response), id, body);
    }
    @Post(":runId/artifact") @HttpCode(200)
    async artifact(@Req() request: EformsignBackupExportRequest, @Res() response: Response, @Param("runId") id: string, @Body() body: unknown): Promise<void> {
        const lease = await this.service.readArtifact(principal(request, response), id, body);
        let released = false;
        const release = () => { if (!released) { released = true; lease.release(); } };
        try {
            response.once("close", release);
            if (response.destroyed) { release(); return; }
            response.once("error", release);
            response.status(200);
            response.setHeader("Content-Type", /^[\x20-\x7e]+$/.test(lease.contentType) ? lease.contentType : "application/pdf");
            response.setHeader("Content-Length", String(lease.bytes.length));
            response.setHeader("X-Content-Sha256", lease.sha256);
            response.setHeader("X-Artifact-Identity", lease.artifactIdentity);
            response.setHeader("Content-Disposition", `attachment; filename="${lease.artifactIdentity}.pdf"`);
            response.end(lease.bytes);
        } catch (error) {
            release();
            if (response.headersSent) { response.destroy(); return; }
            throw error;
        }
    }
}
