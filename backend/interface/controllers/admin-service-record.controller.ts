import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { SendAdminServiceRecordLinkDto } from "interface/dto/admin-service-record.dto";

@Controller("admin/service-records")
@UseGuards(JwtGuard, TenantGuard)
export class AdminServiceRecordController {
    constructor(private readonly adminServiceRecordService: AdminServiceRecordService) {}

    @Get("client/:clientId")
    getClientOverview(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("clientId", ParseIntPipe) clientId: number,
    ) {
        return this.adminServiceRecordService.getClientOverview(tenant.branchId ?? "", clientId);
    }

    @Post("schedules/:scheduleId/prepare-link")
    prepareLink(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
    ) {
        return this.adminServiceRecordService.prepareLink(tenant.branchId ?? "", scheduleId);
    }

    @Post("schedules/:scheduleId/send-link")
    async sendLinkNow(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
        @Body() body: SendAdminServiceRecordLinkDto,
    ) {
        const { scheduledFor } = await this.adminServiceRecordService.sendLinkNow(
            tenant.branchId ?? "",
            scheduleId,
            body?.preparedLinkToken,
        );
        return { ok: true, scheduledFor };
    }
}
