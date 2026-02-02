import { Body, Controller, Delete, Get, Query, Patch, Post, UseGuards } from "@nestjs/common";
import { MessageService } from "application/services/message.service";
import { CreateMessageDto, UpdateMessageDto } from "interface/dto/message.dto";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";

@Controller("messages")
@UseGuards(JwtGuard, TenantGuard)
export class MessageController {
    constructor(private readonly messageService: MessageService) {}

    @Post()
    create(@CurrentTenant() tenant: { organizationId?: string }, @Body() dto: CreateMessageDto) {
        return this.messageService.create(tenant.organizationId ?? "", dto.title, dto.text);
    }

    @Get("id")
    findById(@CurrentTenant() tenant: { organizationId?: string }, @Query("id") id: string) {
        return this.messageService.findById(tenant.organizationId ?? "", Number(id));
    }

    @Patch()
    update(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("id") id: string,
        @Body() dto: UpdateMessageDto
    ) {
        return this.messageService.update(tenant.organizationId ?? "", Number(id), dto.title, dto.text);
    }

    @Delete()
    delete(@CurrentTenant() tenant: { organizationId?: string }, @Query("id") id: string) {
        return this.messageService.delete(tenant.organizationId ?? "", Number(id));
    }
}
