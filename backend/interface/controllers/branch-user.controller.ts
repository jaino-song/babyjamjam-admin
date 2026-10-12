import {
    Body,
    Controller,
    Delete,
    Get,
    NotFoundException,
    Param,
    Patch,
    UseGuards,
} from "@nestjs/common";

import { UserService } from "application/services/user.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import {
    CurrentTenant,
    TenantGuard,
    type VerifiedTenantPrincipal,
} from "infrastructure/tenant";
import { UpdateBranchUserDto } from "interface/dto/user.dto";
import { runWithAdminAuditActor } from "application/services/admin-audit-context";
import type { AdminAuditActor } from "application/services/admin-audit-event.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { toPublicUser } from "interface/dto/public-user.mapper";

@Controller("branches/:branchId/users")
@UseGuards(JwtGuard, TenantGuard)
export class BranchUserController {
    constructor(private readonly userService: UserService) {}

    @Get(":userId")
    @UseGuards(OwnerOrAdminGuard)
    async findById(
        @Param("branchId") branchId: string,
        @Param("userId") userId: string,
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
    ) {
        this.assertSelectedBranch(branchId, tenant);
        const user = await this.userService.findById(userId, branchId);
        if (!user || (user.role === "owner" && tenant.globalRole !== "owner")) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        return toPublicUser(user);
    }

    // 권한-04: the guard only admits owner / 지점장 / 매니저 of the selected branch; which
    // roles the caller may assign or remove is decided by the service, inside the write
    // transaction, from the caller's current rows.
    @Patch(":userId")
    @UseGuards(BranchManagerGuard)
    async update(
        @Param("branchId") branchId: string,
        @Param("userId") userId: string,
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Body() dto: UpdateBranchUserDto,
    ) {
        this.assertSelectedBranch(branchId, tenant);
        const actor = this.auditActor(tenant);
        return toPublicUser(await runWithAdminAuditActor(actor, () => this.userService.update(userId, {
            branchRole: dto.branchRole,
            branchId,
            actor,
        })));
    }

    @Delete(":userId")
    @UseGuards(BranchManagerGuard)
    async delete(
        @Param("branchId") branchId: string,
        @Param("userId") userId: string,
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
    ) {
        this.assertSelectedBranch(branchId, tenant);
        const target = await this.userService.findById(userId, branchId);
        if (!target || (target.role === "owner" && tenant.globalRole !== "owner")) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        const actor = this.auditActor(tenant);
        await runWithAdminAuditActor(actor, () => this.userService.delete(userId, branchId, actor));
        return { success: true };
    }

    private auditActor(tenant: VerifiedTenantPrincipal): AdminAuditActor {
        return {
            userId: tenant.userId,
            globalRole: tenant.globalRole,
            branchRole: tenant.branchRole,
        };
    }

    private assertSelectedBranch(
        branchId: string,
        tenant: VerifiedTenantPrincipal,
    ): void {
        if (!tenant || branchId !== tenant.branchId) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
    }
}
