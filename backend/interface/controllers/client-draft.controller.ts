import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { CallInboxService } from "application/services/call-inbox.service";
import {
    ConfirmDraftDto,
    ConfirmNewClientDraftDto,
    DiscardClientDraftDto,
    PatchClientDraftDto,
} from "interface/dto/call-inbox.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { parseInteger } from "interface/parse-integer";

@Controller("client-drafts")
@UseGuards(JwtGuard, TenantGuard)
export class ClientDraftController {
    constructor(private readonly callInboxService: CallInboxService) {}

    @Get()
    list(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("status") status?: string,
        @Query("page") page?: string,
        @Query("limit") limit?: string,
    ) {
        return this.callInboxService.listDrafts(
            tenant.branchId ?? "",
            status ?? "PENDING",
            parseInteger(page, "page", { defaultValue: 1, min: 1 }),
            parseInteger(limit, "limit", { defaultValue: 20, min: 1, max: 100 }),
        );
    }

    @Get("count")
    count(@CurrentTenant() tenant: { branchId?: string }, @Query("status") status?: string) {
        return this.callInboxService.countDrafts(tenant.branchId ?? "", status ?? "PENDING");
    }

    @Get(":id")
    detail(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string) {
        return this.callInboxService.getDraft(tenant.branchId ?? "", id);
    }

    @Patch(":id")
    patch(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Body() dto: PatchClientDraftDto,
    ) {
        return this.callInboxService.patchDraft(tenant.branchId ?? "", id, dto);
    }

    @Post(":id/confirm")
    confirm(
        @CurrentTenant() tenant: { branchId?: string },
        @Req() request: Request & { user?: { userId?: string } },
        @Param("id") id: string,
        @Body() dto: ConfirmDraftDto,
    ) {
        return this.callInboxService.confirm(
            tenant.branchId ?? "",
            request.user?.userId ?? "",
            id,
            dto,
        );
    }

    @Post(":id/discard")
    discard(
        @CurrentTenant() tenant: { branchId?: string },
        @Req() request: Request & { user?: { userId?: string } },
        @Param("id") id: string,
        @Body() dto: DiscardClientDraftDto,
    ) {
        return this.callInboxService.discard(tenant.branchId ?? "", request.user?.userId ?? "", id, dto.reason);
    }
}
