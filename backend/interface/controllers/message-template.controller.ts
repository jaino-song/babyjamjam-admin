import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { MessageTemplateService } from "application/services/message-template.service";
import { CreateMessageTemplateDto, UpdateMessageTemplateDto } from "interface/dto/message-template.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant } from "infrastructure/tenant";

@Controller("message-templates")
@UseGuards(JwtGuard)
export class MessageTemplateController {
    constructor(private readonly messageTemplateService: MessageTemplateService) {}

    @Post()
    create(@CurrentTenant() tenant: { organizationId?: string }, @Body() dto: CreateMessageTemplateDto) {
        return this.messageTemplateService.create(tenant.organizationId ?? "", {
            name: dto.name,
            content: dto.content,
            variables: dto.variables,
        });
    }

    @Get()
    findAll(@CurrentTenant() tenant: { organizationId?: string }) {
        return this.messageTemplateService.findAll(tenant.organizationId ?? "");
    }

    @Get(":id")
    findById(@CurrentTenant() tenant: { organizationId?: string }, @Param("id") id: string) {
        return this.messageTemplateService.findById(tenant.organizationId ?? "", id);
    }

    @Patch(":id")
    update(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("id") id: string,
        @Body() dto: UpdateMessageTemplateDto
    ) {
        return this.messageTemplateService.update(tenant.organizationId ?? "", id, {
            name: dto.name,
            content: dto.content,
            variables: dto.variables,
        });
    }

    @Delete(":id")
    delete(@CurrentTenant() tenant: { organizationId?: string }, @Param("id") id: string) {
        return this.messageTemplateService.delete(tenant.organizationId ?? "", id);
    }
}
