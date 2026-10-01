import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    HttpCode,
    NotFoundException,
    Param,
    Post,
    Query,
    UseGuards,
} from "@nestjs/common";

import {
    HolidayReviewResolveService,
    ReviewResolveResult,
} from "application/services/holiday-review-resolve.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantContext } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { ListHolidayReviewItemsQueryDto, ResolveHolidayReviewItemsDto } from "interface/dto/holiday-review.dto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** End-date review of holiday changes (설정 › 공휴일): manager-only, own branch only. */
@Controller()
export class HolidayReviewController {
    constructor(
        private readonly reviewService: HolidayReviewResolveService,
        private readonly tenantContext: TenantContext,
    ) {}

    @Get("branches/:branchId/holidays/review-events")
    @UseGuards(JwtGuard, TenantGuard, BranchManagerGuard)
    async listEvents(@Param("branchId") branchId: string) {
        this.assertOwnBranch(branchId);
        return this.reviewService.listEvents(branchId);
    }

    @Get("branches/:branchId/holidays/review-events/:id/items")
    @UseGuards(JwtGuard, TenantGuard, BranchManagerGuard)
    async listItems(
        @Param("branchId") branchId: string,
        @Param("id") id: string,
        @Query() query: ListHolidayReviewItemsQueryDto,
    ) {
        this.assertOwnBranch(branchId);
        this.assertEventId(id);
        return this.reviewService.listItems(branchId, id, {
            category: query.category,
            status: query.status,
            q: query.q?.trim() || undefined,
        });
    }

    @Post("branches/:branchId/holidays/review-events/:id/resolve")
    @HttpCode(200)
    @UseGuards(JwtGuard, TenantGuard, BranchManagerGuard)
    async resolve(
        @Param("branchId") branchId: string,
        @Param("id") id: string,
        @Body() dto: ResolveHolidayReviewItemsDto,
    ): Promise<ReviewResolveResult> {
        this.assertOwnBranch(branchId);
        this.assertEventId(id);
        return this.reviewService.resolve(branchId, id, this.tenantContext.userId ?? null, {
            itemIds: dto.itemIds,
            action: dto.action,
        });
    }

    /** A malformed id can never match a row; answer like any other missing event. */
    private assertEventId(id: string): void {
        if (!UUID_PATTERN.test(id)) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
    }

    private assertOwnBranch(branchId: string): void {
        if (branchId !== this.tenantContext.branchId) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
    }
}
