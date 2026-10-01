import { Module } from "@nestjs/common";

import { HolidayReviewProcessorService } from "application/services/holiday-review-processor.service";
import { BRANCH_REPOSITORY } from "domain/repositories/branch.repository.interface";
import { HOLIDAY_REVIEW_REPOSITORY } from "domain/repositories/holiday-review.repository.interface";
import { SbBranchRepository } from "infrastructure/database/repositories/sb.branch.repository";
import { SbHolidayReviewRepository } from "infrastructure/database/repositories/sb.holiday-review.repository";
import { HolidayModule } from "module/holiday.module";

/**
 * Holiday-change impact detection: the 5-minute processor that turns holiday
 * changes into end-date review items. (The review endpoints join this module later.)
 * SchedulerLeaseModule and DatabaseModule are @Global().
 */
@Module({
    imports: [HolidayModule],
    providers: [
        { provide: HOLIDAY_REVIEW_REPOSITORY, useClass: SbHolidayReviewRepository },
        { provide: BRANCH_REPOSITORY, useClass: SbBranchRepository },
        HolidayReviewProcessorService,
    ],
    exports: [HolidayReviewProcessorService],
})
export class HolidayReviewModule {}
