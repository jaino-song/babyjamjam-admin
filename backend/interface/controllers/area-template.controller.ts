import { Controller, Post, Body, Get, Query, Patch, Delete, UseGuards } from "@nestjs/common";
import { AreaTemplateService } from "application/services/area-template.service";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";

interface CreateAreaTemplateDto {
    area: string;
    templateId: string;
    templateName?: string | null;
}

interface UpdateAreaTemplateDto {
    templateId?: string;
    templateName?: string | null;
}

@Controller("area-templates")
@UseGuards(JwtGuard, TenantGuard)
export class AreaTemplateController {
    constructor(private readonly areaTemplateService: AreaTemplateService) {}

    @Post()
    create(@CurrentTenant() tenant: { organizationId?: string }, @Body() dto: CreateAreaTemplateDto) {
        return this.areaTemplateService.create(tenant.organizationId ?? "", dto);
    }

    @Get("area")
    findByArea(@CurrentTenant() tenant: { organizationId?: string }, @Query("area") area: string) {
        return this.areaTemplateService.findByArea(tenant.organizationId ?? "", area);
    }

    @Get()
    findAll(@CurrentTenant() tenant: { organizationId?: string }) {
        return this.areaTemplateService.findAll(tenant.organizationId ?? "");
    }

    @Patch()
    update(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("area") area: string,
        @Body() dto: UpdateAreaTemplateDto
    ) {
        return this.areaTemplateService.update(tenant.organizationId ?? "", area, dto);
    }

    @Delete()
    delete(@CurrentTenant() tenant: { organizationId?: string }, @Query("area") area: string) {
        return this.areaTemplateService.delete(tenant.organizationId ?? "", area);
    }
}
