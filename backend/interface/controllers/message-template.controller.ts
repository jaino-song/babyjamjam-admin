import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { MessageTemplateService } from "application/services/message-template.service";
import { CreateMessageTemplateDto, UpdateMessageTemplateDto } from "interface/dto/message-template.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";

@Controller("message-templates")
@UseGuards(JwtGuard, TenantGuard)
export class MessageTemplateController {
    constructor(private readonly messageTemplateService: MessageTemplateService) {}

    @Post()
    create(@CurrentTenant() tenant: { branchId?: string }, @Body() dto: CreateMessageTemplateDto) {
        return this.messageTemplateService.create(tenant.branchId ?? "", {
            name: dto.name,
            content: dto.content,
            variables: dto.variables,
        });
    }

    @Get()
    findAll(@CurrentTenant() tenant: { branchId?: string }) {
        return this.messageTemplateService.findAll(tenant.branchId ?? "");
    }

    @Get(":id")
    findById(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string) {
        return this.messageTemplateService.findById(tenant.branchId ?? "", id);
    }

    @Patch(":id")
    update(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Body() dto: UpdateMessageTemplateDto
    ) {
        return this.messageTemplateService.update(tenant.branchId ?? "", id, {
            name: dto.name,
            content: dto.content,
            variables: dto.variables,
        });
    }

    @Delete(":id")
    delete(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string) {
        return this.messageTemplateService.delete(tenant.branchId ?? "", id);
    }
}
