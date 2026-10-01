import { Module } from "@nestjs/common";

import { HolidayReviewProcessorService } from "application/services/holiday-review-processor.service";
import { HolidayReviewResolveService } from "application/services/holiday-review-resolve.service";
import { BRANCH_REPOSITORY } from "domain/repositories/branch.repository.interface";
import { HOLIDAY_REVIEW_REPOSITORY } from "domain/repositories/holiday-review.repository.interface";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { SbBranchRepository } from "infrastructure/database/repositories/sb.branch.repository";
import { SbHolidayReviewRepository } from "infrastructure/database/repositories/sb.holiday-review.repository";
import { HolidayReviewController } from "interface/controllers/holiday-review.controller";
import { ClientModule } from "module/client.module";
import { HolidayModule } from "module/holiday.module";

/**
 * Holiday-change impact detection: the 5-minute processor that turns holiday
 * changes into end-date review items, and the endpoints that list and resolve them.
 * ClientModule is imported one-way (it imports HolidayModule, never this module).
 * SchedulerLeaseModule and DatabaseModule are @Global().
 */
@Module({
    imports: [HolidayModule, ClientModule],
    controllers: [HolidayReviewController],
    providers: [
        BranchManagerGuard,
        { provide: HOLIDAY_REVIEW_REPOSITORY, useClass: SbHolidayReviewRepository },
        { provide: BRANCH_REPOSITORY, useClass: SbBranchRepository },
        HolidayReviewProcessorService,
        HolidayReviewResolveService,
    ],
    exports: [HolidayReviewProcessorService],
})
export class HolidayReviewModule {}
