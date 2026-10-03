import {
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    NotFoundException,
    Param,
    Post,
    Query,
    UseGuards,
} from "@nestjs/common";

import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { HolidayOverrideService } from "application/services/holiday-override.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { isoDateInKorea } from "domain/utils/business-days";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { CreateHolidayOverrideDto, GetHolidaysQueryDto } from "interface/dto/holiday.dto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller()
export class HolidayController {
    constructor(
        private readonly calendarService: HolidayCalendarService,
        private readonly overrideService: HolidayOverrideService,
        private readonly tenantContext: TenantContext,
    ) {}

    @Get("branches/:branchId/holidays")
    @UseGuards(JwtGuard, TenantGuard)
    async list(@Param("branchId") branchId: string, @Query() query: GetHolidaysQueryDto) {
        this.assertOwnBranch(branchId);
        const year = query.year ?? Number(isoDateInKorea().slice(0, 4));
        // A settings screen must show what it just wrote, so skip the 30s revision cache.
        return this.calendarService.getEffectiveYear(branchId, year, { fresh: true });
    }

    @Post("branches/:branchId/holidays/overrides")
    @UseGuards(JwtGuard, TenantGuard, BranchManagerGuard)
    async createOverride(@Param("branchId") branchId: string, @Body() dto: CreateHolidayOverrideDto) {
        this.assertOwnBranch(branchId);
        return this.overrideService.createOverride(branchId, this.tenantContext.userId ?? null, {
            date: dto.date,
            kind: dto.kind,
            name: dto.name,
        });
    }

    @Delete("branches/:branchId/holidays/overrides/:id")
    @UseGuards(JwtGuard, TenantGuard, BranchManagerGuard)
    async deleteOverride(@Param("branchId") branchId: string, @Param("id") id: string) {
        this.assertOwnBranch(branchId);
        // A malformed id can never match a row; answer like any other missing override.
        if (!UUID_PATTERN.test(id)) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        await this.overrideService.deleteOverride(branchId, id);
        return { success: true };
    }

    private assertOwnBranch(branchId: string): void {
        if (branchId !== this.tenantContext.branchId) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
    }
}
