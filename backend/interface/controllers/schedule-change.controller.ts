import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { RejectScheduleChangeDto } from "interface/dto/schedule-change.dto";

@Controller("schedule-change-requests")
@UseGuards(JwtGuard, TenantGuard)
export class ScheduleChangeController {
    constructor(private readonly service: ScheduleChangeService) {}

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
