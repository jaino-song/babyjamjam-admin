import { Controller, ForbiddenException, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { HolidaySyncService, HolidaySyncYearResult } from "application/services/holiday-sync.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";

@Controller()
export class HolidaySyncController {
    constructor(
        private readonly holidaySyncService: HolidaySyncService,
        private readonly tenantContext: TenantContext,
    ) {}

    /**
     * Public KASI data is global; the branch path only authorizes the caller.
     * Responds 200 with per-year results even when every year failed.
     */
    @Post("branches/:branchId/holidays/sync")
    @HttpCode(200)
    @UseGuards(JwtGuard, TenantGuard, BranchManagerGuard)
    async sync(@Param("branchId") branchId: string): Promise<{ results: HolidaySyncYearResult[] }> {
        if (branchId !== this.tenantContext.branchId) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
        return { results: await this.holidaySyncService.syncManually() };
    }
}
