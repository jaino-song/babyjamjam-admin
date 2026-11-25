import { Body, ConflictException, Controller, Get, Header, Param, Put, Query, UseGuards } from "@nestjs/common";
import type { CanceledAutomationRetrySettings } from "@babyjamjam/shared/types/message";
import { CanceledAutomationRetrySettingsService } from "application/services/canceled-automation-retry-settings.service";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import {
    CanceledAutomationRetryRoutineParamsDto,
    UpdateCanceledAutomationRetryDto,
} from "interface/dto/message-automation-policy.dto";

type RetrySettingsTenant = { branchId: string; globalRole?: string; branchRole?: string };

@Controller("settings/message-automation-policies/canceled-retry")
@UseGuards(JwtGuard, TenantGuard)
export class CanceledAutomationRetrySettingsController {
    constructor(private readonly settings: CanceledAutomationRetrySettingsService) {}

    @Get()
    @Header("Cache-Control", "private, no-store")
    async list(
        @CurrentTenant() tenant: RetrySettingsTenant,
        @Query("expectedBranchId") expectedBranchId?: string,
    ): Promise<CanceledAutomationRetrySettings> {
        const branchId = this.requireMatchingBranch(tenant, expectedBranchId);
        return {
            routines: await this.settings.list(branchId),
            canManageActivation: tenant.globalRole === "owner"
                || tenant.branchRole === "admin" || tenant.branchRole === "manager",
        };
    }

    @Put(":id")
    @Header("Cache-Control", "private, no-store")
    @UseGuards(BranchManagerGuard)
    update(
        @CurrentTenant() tenant: RetrySettingsTenant,
        @Param() { id }: CanceledAutomationRetryRoutineParamsDto,
        @Body() dto: UpdateCanceledAutomationRetryDto,
        @Query("expectedBranchId") expectedBranchId?: string,
    ) {
        return this.settings.update(this.requireMatchingBranch(tenant, expectedBranchId), id, dto.enabled);
    }

    private requireMatchingBranch(tenant: RetrySettingsTenant, expectedBranchId: string | undefined): string {
        // The request supplies a fence against a changed session. TenantGuard
        // alone resolves the membership and the branch used for the operation.
        if (!tenant.branchId || expectedBranchId !== tenant.branchId) {
            throw new ConflictException({
                code: "BRANCH_CONTEXT_CHANGED",
                message: "지점이 변경됐어요. 화면을 새로고침한 뒤 다시 시도해 주세요.",
            });
        }
        return tenant.branchId;
    }
}
