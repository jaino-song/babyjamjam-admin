import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    PipeTransform,
    Post,
    Query,
    UseGuards,
} from "@nestjs/common";
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
    ConfirmServiceRecordEditDraftDto,
    CreateServiceRecordEditDraftDto,
    DiscardServiceRecordEditDraftDto,
    PreviewServiceRecordEditDraftDto,
    RetryServiceRecordDocumentDto,
    UpdateServiceRecordEditDraftDto,
} from "interface/dto/admin-service-record-edit.dto";

/**
 * Admin service-record routes derive tenant and actor scope from the verified
 * request context. Reject every query key before a handler can observe it.
 */
export class AdminServiceRecordNoQueryPipe implements PipeTransform {
    transform(value: unknown): Record<string, never> {
        if (value === undefined) return {};
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new BadRequestException("관리자 서비스 기록 API는 query parameter를 지원하지 않습니다.");
        }
        if (Object.keys(value).length > 0) {
            throw new BadRequestException("관리자 서비스 기록 API는 query parameter를 지원하지 않습니다.");
        }
        return {};
    }
}

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
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordService.getClientOverview(tenant.branchId ?? "", clientId);
    }

    @Get("client/:clientId/editor")
    @UseGuards(OwnerOrAdminGuard)
    getClientEditor(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordService.getClientEditor(tenant.branchId, clientId);
    }

    @Get("clients/:clientId/revisions")
    @UseGuards(OwnerOrAdminGuard)
    getRevisionHistory(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordService.getRevisionHistory(tenant.branchId, clientId);
    }

    @Post("revisions/:revisionId/documents/:documentStateId/retry")
    @UseGuards(OwnerOrAdminGuard)
    retryRevisionDocument(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("revisionId") revisionId: string,
        @Param("documentStateId") documentStateId: string,
        @Body() body: RetryServiceRecordDocumentDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordService.retryRevisionDocument(
            tenant.branchId,
            revisionId,
            documentStateId,
            body.expectedGeneration,
            tenant.userId,
        );
    }

    @Post("client/:clientId/draft")
    @UseGuards(OwnerOrAdminGuard)
    startDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Body() body: CreateServiceRecordEditDraftDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordEditService.startDraft(tenant.branchId, clientId, tenant.userId, body);
    }

    @Get("client/:clientId/draft")
    @UseGuards(OwnerOrAdminGuard)
    getDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("clientId", ParseIntPipe) clientId: number,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordEditService.getDraft(tenant.branchId, clientId);
    }

    @Patch("drafts/:draftId")
    @UseGuards(OwnerOrAdminGuard)
    updateDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("draftId") draftId: string,
        @Body() body: UpdateServiceRecordEditDraftDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordEditService.updateDraft(tenant.branchId, draftId, tenant.userId, body);
    }

    @Post("drafts/:draftId/discard")
    @UseGuards(OwnerOrAdminGuard)
    discardDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("draftId") draftId: string,
        @Body() body: DiscardServiceRecordEditDraftDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordEditService.discardDraft(tenant.branchId, draftId, tenant.userId, body);
    }

    @Post("drafts/:draftId/preview")
    @UseGuards(OwnerOrAdminGuard)
    previewDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("draftId") draftId: string,
        @Body() body: PreviewServiceRecordEditDraftDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordEditService.previewDraft(tenant.branchId, draftId, tenant.userId, body);
    }

    @Post("drafts/:draftId/confirm")
    @UseGuards(OwnerOrAdminGuard)
    confirmDraft(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("draftId") draftId: string,
        @Body() body: ConfirmServiceRecordEditDraftDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        return this.adminServiceRecordEditService.confirmDraft(tenant.branchId, draftId, tenant.userId, body);
    }

    @Post("schedules/:scheduleId/prepare-link")
    prepareLink(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
        @Body() body: PrepareAdminServiceRecordLinkDto,
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
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
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
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
        @Query(new AdminServiceRecordNoQueryPipe()) _query?: Record<string, never>,
    ) {
        const actor: ServiceRecordAdminActor = {
            userId: tenant.userId,
            globalRole: tenant.globalRole,
            branchRole: tenant.branchRole,
        };
        return this.adminServiceRecordService.resetLink(tenant.branchId, scheduleId, actor);
    }
}
