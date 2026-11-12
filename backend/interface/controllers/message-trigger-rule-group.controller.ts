import { Body, ConflictException, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { MessageTriggerRuleGroupService } from "application/services/message-trigger-rule-group.service";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { CreateMessageTriggerRuleGroupDto, PreviewMessageTriggerRuleGroupDto, UpdateMessageTriggerRuleGroupDto } from "interface/dto/message-trigger-rule-group.dto";

@Controller("message-trigger-rule-groups")
@UseGuards(JwtGuard, TenantGuard)
export class MessageTriggerRuleGroupController {
    constructor(private readonly groups: MessageTriggerRuleGroupService) {}

    @Get()
    list(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("expectedBranchId") expectedBranchId?: string,
    ) {
        return this.groups.list(this.requireExpectedBranch(tenant, expectedBranchId));
    }

    @Get(":id")
    get(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Query("expectedBranchId") expectedBranchId?: string,
    ) {
        return this.groups.get(this.requireExpectedBranch(tenant, expectedBranchId), id);
    }

    @Post("preview")
    preview(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() input: PreviewMessageTriggerRuleGroupDto,
        @Query("expectedBranchId") expectedBranchId?: string,
    ) {
        return this.groups.preview(this.requireExpectedBranch(tenant, expectedBranchId), input);
    }

    @Post()
    @UseGuards(BranchManagerGuard)
    create(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() draft: CreateMessageTriggerRuleGroupDto,
        @Query("expectedBranchId") expectedBranchId?: string,
    ) {
        return this.groups.create(this.requireExpectedBranch(tenant, expectedBranchId), draft);
    }

    @Put(":id")
    @UseGuards(BranchManagerGuard)
    update(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Body() draft: UpdateMessageTriggerRuleGroupDto,
        @Query("expectedBranchId") expectedBranchId?: string,
    ) {
        return this.groups.update(this.requireExpectedBranch(tenant, expectedBranchId), id, draft);
    }

    @Delete(":id")
    @UseGuards(BranchManagerGuard)
    delete(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Query("expectedBranchId") expectedBranchId?: string,
    ) {
        return this.groups.delete(this.requireExpectedBranch(tenant, expectedBranchId), id);
    }

    private requireExpectedBranch(tenant: { branchId?: string }, expectedBranchId: string | undefined): string {
        const branchId = tenant.branchId ?? "";
        if (expectedBranchId !== undefined && expectedBranchId !== branchId) {
            throw new ConflictException({
                code: "BRANCH_CONTEXT_CHANGED",
                message: "지점이 변경됐어요. 화면을 새로고침한 뒤 다시 시도해 주세요.",
            });
        }
        return branchId;
    }
}
