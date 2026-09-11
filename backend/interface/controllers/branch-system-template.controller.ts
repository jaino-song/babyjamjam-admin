import {
    Body,
    ConflictException,
    Controller,
    ForbiddenException,
    Get,
    Param,
    Put,
    Query,
    UseGuards,
} from "@nestjs/common";
import { SystemTemplateService } from "application/services/system-template.service";
import { SystemTemplateWithRegistryDto } from "application/dto/system-template-with-registry.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard, type VerifiedTenantPrincipal } from "infrastructure/tenant";
import { UpdateSystemTemplateDto } from "interface/dto/system-template.dto";

@Controller("branch-system-templates")
@UseGuards(JwtGuard, TenantGuard)
export class BranchSystemTemplateController {
    constructor(private readonly service: SystemTemplateService) {}

    @Get()
    getAll(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Query("expectedBranchId") expectedBranchId?: string,
    ): Promise<SystemTemplateWithRegistryDto[]> {
        return this.service.getAllForBranch(this.requireExpectedBranch(tenant, expectedBranchId));
    }

    @Get(":key")
    getByKey(
        @Param("key") key: string,
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Query("expectedBranchId") expectedBranchId?: string,
    ): Promise<SystemTemplateWithRegistryDto> {
        return this.service.getByKeyForBranch(this.requireExpectedBranch(tenant, expectedBranchId), key);
    }

    @Put(":key")
    update(
        @Param("key") key: string,
        @Body() dto: UpdateSystemTemplateDto,
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Query("expectedBranchId") expectedBranchId?: string,
    ) {
        return this.service.updateForBranch(
            this.requireExpectedBranch(tenant, expectedBranchId),
            key,
            dto.content,
            this.requireUser(tenant),
            dto.customVariables,
        );
    }

    private requireBranch(tenant: VerifiedTenantPrincipal | undefined): string {
        if (!tenant?.branchId) {
            throw new ForbiddenException("지점 선택이 필요해요.");
        }
        return tenant.branchId;
    }

    private requireExpectedBranch(
        tenant: VerifiedTenantPrincipal | undefined,
        expectedBranchId: string | undefined,
    ): string {
        const branchId = this.requireBranch(tenant);
        if (expectedBranchId !== undefined && expectedBranchId !== branchId) {
            throw new ConflictException({
                code: "BRANCH_CONTEXT_CHANGED",
                message: "지점이 변경됐어요. 화면을 새로고침한 뒤 다시 시도해 주세요.",
            });
        }
        return branchId;
    }

    private requireUser(tenant: VerifiedTenantPrincipal | undefined): string {
        if (!tenant?.userId) {
            throw new ForbiddenException("로그인한 사용자가 필요해요.");
        }
        return tenant.userId;
    }
}
