import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { AlimtalkTriggerService } from "application/services/alimtalk-trigger.service";
import {
    AlimtalkTriggerEventType,
    AlimtalkTriggerRecipientType,
    type SupportedTriggerProvider,
} from "domain/constants/alimtalk-trigger-catalog";
import {
    CreateAlimtalkTriggerRuleDto,
    UpdateAlimtalkTriggerRuleDto,
} from "interface/dto/alimtalk-trigger.dto";

@Controller()
@UseGuards(JwtGuard, TenantGuard)
export class AlimtalkTriggerController {
    constructor(private readonly triggerService: AlimtalkTriggerService) {}

    @Get("alimtalk-trigger-rules")
    listRules(@CurrentTenant() tenant: { organizationId?: string }) {
        return this.triggerService.listRules(tenant.organizationId ?? "");
    }

    @Get("alimtalk-trigger-jobs/upcoming")
    listUpcomingJobs(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("limit") limit?: string,
    ) {
        const parsedLimit = Number(limit);
        const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
            ? Math.min(Math.floor(parsedLimit), 500)
            : 200;

        return this.triggerService.listUpcomingJobs(tenant.organizationId ?? "", safeLimit);
    }

    @Get("alimtalk-logs")
    listHistory(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("limit") limit?: string,
    ) {
        const parsedLimit = Number(limit);
        const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
            ? Math.min(Math.floor(parsedLimit), 500)
            : 200;

        return this.triggerService.listHistory(tenant.organizationId ?? "", safeLimit);
    }

    @Post("alimtalk-trigger-rules")
    createRule(
        @CurrentTenant() tenant: { organizationId?: string },
        @Body() dto: CreateAlimtalkTriggerRuleDto,
    ) {
        return this.triggerService.createRule(tenant.organizationId ?? "", dto);
    }

    @Get("alimtalk-trigger-rules/:id")
    getRule(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("id") id: string,
    ) {
        return this.triggerService.getRule(tenant.organizationId ?? "", id);
    }

    @Patch("alimtalk-trigger-rules/:id")
    updateRule(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("id") id: string,
        @Body() dto: UpdateAlimtalkTriggerRuleDto,
    ) {
        return this.triggerService.updateRule(tenant.organizationId ?? "", id, dto);
    }

    @Delete("alimtalk-trigger-rules/:id")
    deleteRule(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("id") id: string,
    ) {
        return this.triggerService.deleteRule(tenant.organizationId ?? "", id);
    }

    @Get("alimtalk-trigger-templates")
    listTemplates(
        @Query("provider") provider: SupportedTriggerProvider = "aligo",
        @Query("eventType") eventType?: AlimtalkTriggerEventType,
        @Query("recipientType") recipientType?: AlimtalkTriggerRecipientType,
    ) {
        return this.triggerService.listTemplates({ provider, eventType, recipientType });
    }
}
