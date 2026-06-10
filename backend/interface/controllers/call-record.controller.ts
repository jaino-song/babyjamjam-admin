import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { CallInboxService } from "application/services/call-inbox.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { parseInteger } from "interface/parse-integer";

@Controller("call-records")
@UseGuards(JwtGuard, TenantGuard)
export class CallRecordController {
    constructor(private readonly callInboxService: CallInboxService) {}

    @Get()
    list(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("page") page?: string,
        @Query("limit") limit?: string,
        @Query("category") category?: string,
        @Query("search") search?: string,
    ) {
        return this.callInboxService.listCallRecords(
            tenant.branchId ?? "",
            parseInteger(page, "page", { defaultValue: 1, min: 1 }),
            parseInteger(limit, "limit", { defaultValue: 20, min: 1, max: 100 }),
            category,
            search,
        );
    }

    @Get(":id")
    detail(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string) {
        return this.callInboxService.getCallRecord(tenant.branchId ?? "", id);
    }
}
