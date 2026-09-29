import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { ApplyScheduleChangeDto, RejectScheduleChangeDto } from "interface/dto/schedule-change.dto";

@Controller("schedule-change-requests")
@UseGuards(JwtGuard, TenantGuard)
export class ScheduleChangeController {
    constructor(private readonly service: ScheduleChangeService) {}

    @Get("schedules/:scheduleId/preview")
    previewAdminChange(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
    ) {
        return this.service.previewAdminChange(tenant.branchId ?? "", scheduleId);
    }

    @Post("schedules/:scheduleId/apply")
    applyAdminChange(
        @CurrentTenant() tenant: { branchId?: string; userId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
        @Body() dto: ApplyScheduleChangeDto,
    ) {
        return this.service.applyAdminChange(scheduleId, dto.toDate, tenant);
    }

    @Post(":id/approve")
    approve(@CurrentTenant() tenant: { branchId?: string; userId?: string }, @Param("id") id: string) {
        return this.service.approve(id, tenant);
    }

    @Post(":id/reject")
    reject(
        @CurrentTenant() tenant: { branchId?: string; userId?: string },
        @Param("id") id: string,
        @Body() dto: RejectScheduleChangeDto,
    ) {
        return this.service.reject(id, tenant, dto.reason);
    }
}
