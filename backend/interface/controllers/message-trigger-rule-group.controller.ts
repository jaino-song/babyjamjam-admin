import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
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
    list(@CurrentTenant() tenant: { branchId?: string }) { return this.groups.list(tenant.branchId ?? ""); }

    @Get(":id")
    get(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string) { return this.groups.get(tenant.branchId ?? "", id); }

    @Post("preview")
    preview(@CurrentTenant() tenant: { branchId?: string }, @Body() input: PreviewMessageTriggerRuleGroupDto) {
        return this.groups.preview(tenant.branchId ?? "", input);
    }

    @Post()
    @UseGuards(BranchManagerGuard)
    create(@CurrentTenant() tenant: { branchId?: string }, @Body() draft: CreateMessageTriggerRuleGroupDto) { return this.groups.create(tenant.branchId ?? "", draft); }

    @Put(":id")
    @UseGuards(BranchManagerGuard)
    update(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string, @Body() draft: UpdateMessageTriggerRuleGroupDto) { return this.groups.update(tenant.branchId ?? "", id, draft); }

    @Delete(":id")
    @UseGuards(BranchManagerGuard)
    delete(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string) { return this.groups.delete(tenant.branchId ?? "", id); }
}
