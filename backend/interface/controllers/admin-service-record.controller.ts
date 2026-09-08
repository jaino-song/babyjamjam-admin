import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from "@nestjs/common";
import {
    AdminServiceRecordService,
    ServiceRecordAdminActor,
} from "application/services/admin-service-record.service";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { CurrentTenant, TenantGuard, VerifiedTenantPrincipal } from "infrastructure/tenant";
import {
    PrepareAdminServiceRecordLinkDto,
    SendAdminServiceRecordLinkDto,
} from "interface/dto/admin-service-record.dto";
import {
    CreateServiceRecordEditDraftDto,
    DiscardServiceRecordEditDraftDto,
    UpdateServiceRecordEditDraftDto,
} from "interface/dto/admin-service-record-edit.dto";

@Controller("admin/service-records")
@UseGuards(JwtGuard, TenantGuard)
export class AdminServiceRecordController {
    constructor(
        private readonly adminServiceRecordService: AdminServiceRecordService,
        private readonly adminServiceRecordEditService: AdminServiceRecordEditService,
    ) {}

    @Get("client/:clientId")
    getClientOverview(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("clientId", ParseIntPipe) clientId: number,
    ) {
        return this.adminServiceRecordService.getClientOverview(tenant.branchId ?? "", clientId);
    }

    @Get("client/:clientId/editor")
    @UseGuards(OwnerOrAdminGuard)
    getClientEditor(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
    ) {
        return this.adminServiceRecordService.getClientEditor(tenant.branchId, clientId);
    }

    @Post("client/:clientId/draft")
    @UseGuards(OwnerOrAdminGuard)
    startDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Body() body: CreateServiceRecordEditDraftDto,
    ) {
        return this.adminServiceRecordEditService.startDraft(tenant.branchId, clientId, tenant.userId, body);
    }

    @Get("client/:clientId/draft")
    @UseGuards(OwnerOrAdminGuard)
    getDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
    ) {
        return this.adminServiceRecordEditService.getDraft(tenant.branchId, clientId);
    }

    @Patch("drafts/:draftId")
    @UseGuards(OwnerOrAdminGuard)
    updateDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("draftId") draftId: string,
        @Body() body: UpdateServiceRecordEditDraftDto,
    ) {
        return this.adminServiceRecordEditService.updateDraft(tenant.branchId, draftId, tenant.userId, body);
    }

    @Post("drafts/:draftId/discard")
    @UseGuards(OwnerOrAdminGuard)
    discardDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("draftId") draftId: string,
        @Body() body: DiscardServiceRecordEditDraftDto,
    ) {
        return this.adminServiceRecordEditService.discardDraft(tenant.branchId, draftId, tenant.userId, body);
    }

    @Post("schedules/:scheduleId/prepare-link")
    prepareLink(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
        @Body() body: PrepareAdminServiceRecordLinkDto,
    ) {
        return this.adminServiceRecordService.prepareLink(
            tenant.branchId ?? "",
            scheduleId,
            body?.recipientPhone,
        );
    }

    @Post("schedules/:scheduleId/send-link")
    async sendLinkNow(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
        @Body() body: SendAdminServiceRecordLinkDto,
    ) {
        return this.adminServiceRecordService.sendLinkNow(
            tenant.branchId ?? "",
            scheduleId,
            body?.preparedLinkToken,
            body?.recipientPhone,
        );
    }

    @Post("schedules/:scheduleId/reset-link")
    @UseGuards(OwnerOrAdminGuard)
    resetLink(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
    ) {
        const actor: ServiceRecordAdminActor = {
            userId: tenant.userId,
            globalRole: tenant.globalRole,
            branchRole: tenant.branchRole,
        };
        return this.adminServiceRecordService.resetLink(tenant.branchId, scheduleId, actor);
    }
}
