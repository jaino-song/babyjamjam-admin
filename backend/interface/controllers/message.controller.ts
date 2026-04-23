import { Body, Controller, Delete, Get, Query, Patch, Post, UseGuards } from "@nestjs/common";
import { MessageService } from "application/services/message.service";
import { CreateMessageDto, UpdateMessageDto } from "interface/dto/message.dto";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";

@Controller("messages")
@UseGuards(JwtGuard, TenantGuard)
export class MessageController {
    constructor(private readonly messageService: MessageService) {}

    @Get()
    findAll(@CurrentTenant() tenant: { branchId?: string }) {
        return this.messageService.findAll(tenant.branchId ?? "");
    }

    @Post()
    create(@CurrentTenant() tenant: { branchId?: string }, @Body() dto: CreateMessageDto) {
        return this.messageService.create(tenant.branchId ?? "", dto.title, dto.text);
    }

    @Get("id")
    findById(@CurrentTenant() tenant: { branchId?: string }, @Query("id") id: string) {
        return this.messageService.findById(tenant.branchId ?? "", Number(id));
    }

    @Patch()
    update(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("id") id: string,
        @Body() dto: UpdateMessageDto
    ) {
        return this.messageService.update(tenant.branchId ?? "", Number(id), dto.title, dto.text);
    }

    @Delete()
    delete(@CurrentTenant() tenant: { branchId?: string }, @Query("id") id: string) {
        return this.messageService.delete(tenant.branchId ?? "", Number(id));
    }
}
