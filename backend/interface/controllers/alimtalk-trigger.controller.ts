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
import { parseInteger } from "interface/parse-integer";

@Controller()
@UseGuards(JwtGuard, TenantGuard)
export class AlimtalkTriggerController {
    constructor(private readonly triggerService: AlimtalkTriggerService) {}

    @Get("alimtalk-trigger-rules")
    listRules(@CurrentTenant() tenant: { branchId?: string }) {
        return this.triggerService.listRules(tenant.branchId ?? "");
    }

    @Get("alimtalk-trigger-jobs/upcoming")
    listUpcomingJobs(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("limit") limit?: string,
    ) {
        return this.triggerService.listUpcomingJobs(
            tenant.branchId ?? "",
            parseInteger(limit, "limit", { defaultValue: 200, min: 1, max: 500 }),
        );
    }

    @Get("alimtalk-logs")
    listHistory(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
    ) {
        return this.triggerService.listHistory(
            tenant.branchId ?? "",
            parseInteger(limit, "limit", { defaultValue: 200, min: 1, max: 500 }),
            parseInteger(skip, "skip", { defaultValue: 0, min: 0 }),
        );
    }

    @Post("alimtalk-trigger-rules")
    createRule(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() dto: CreateAlimtalkTriggerRuleDto,
    ) {
        return this.triggerService.createRule(tenant.branchId ?? "", dto);
    }

    @Get("alimtalk-trigger-rules/:id")
    getRule(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
    ) {
        return this.triggerService.getRule(tenant.branchId ?? "", id);
    }

    @Patch("alimtalk-trigger-rules/:id")
    updateRule(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Body() dto: UpdateAlimtalkTriggerRuleDto,
    ) {
        return this.triggerService.updateRule(tenant.branchId ?? "", id, dto);
    }

    @Delete("alimtalk-trigger-rules/:id")
    deleteRule(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
    ) {
        return this.triggerService.deleteRule(tenant.branchId ?? "", id);
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
