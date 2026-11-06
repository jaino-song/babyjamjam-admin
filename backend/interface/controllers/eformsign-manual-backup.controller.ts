import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseFilters, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { EformsignManualBackupService } from "application/services/eformsign-manual-backup.service";
import type { ManualBackupStaffContext } from "domain/eformsign-backup/manual-backup-control";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import type { EformsignBackupExportRequest } from "infrastructure/auth/eformsign-backup-export.guard";
import { CurrentTenant } from "infrastructure/tenant/current-tenant.decorator";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { EformsignManualBackupFilter, stampManualBackup } from "interface/filters/eformsign-manual-backup.filter";

function staff(tenant: ManualBackupStaffContext): ManualBackupStaffContext {
    return { userId: tenant.userId, branchId: tenant.branchId };
}

@Controller("eformsign-backups/runs")
@UseGuards(JwtGuard, TenantGuard, BranchManagerGuard)
@UseFilters(EformsignManualBackupFilter)
export class EformsignManualBackupController {
    constructor(private readonly service: EformsignManualBackupService) {}

    @Post()
    @HttpCode(202)
    request(@CurrentTenant() tenant: ManualBackupStaffContext, @Body() body: unknown,
        @Req() request: EformsignBackupExportRequest, @Res({ passthrough: true }) response: Response) {
        stampManualBackup(request, response);
        return this.service.requestRun(staff(tenant), body);
    }

    @Get()
    list(@CurrentTenant() tenant: ManualBackupStaffContext, @Query() query: unknown,
        @Req() request: EformsignBackupExportRequest, @Res({ passthrough: true }) response: Response) {
        stampManualBackup(request, response);
        return this.service.listRuns(staff(tenant), query);
    }

    @Get(":runId")
    get(@CurrentTenant() tenant: ManualBackupStaffContext, @Param("runId") runId: string,
        @Req() request: EformsignBackupExportRequest, @Res({ passthrough: true }) response: Response) {
        stampManualBackup(request, response);
        return this.service.getRun(staff(tenant), runId);
    }

    @Get(":runId/documents")
    documents(@CurrentTenant() tenant: ManualBackupStaffContext, @Param("runId") runId: string, @Query() query: unknown,
        @Req() request: EformsignBackupExportRequest, @Res({ passthrough: true }) response: Response) {
        stampManualBackup(request, response);
        return this.service.listRunDocuments(staff(tenant), runId, query);
    }
}
