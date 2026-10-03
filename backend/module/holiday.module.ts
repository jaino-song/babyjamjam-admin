import { Module } from "@nestjs/common";

import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { HolidayOverrideService } from "application/services/holiday-override.service";
import { HOLIDAY_CALENDAR_REPOSITORY } from "domain/repositories/holiday-calendar.repository.interface";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbHolidayCalendarRepository } from "infrastructure/database/repositories/sb.holiday-calendar.repository";
import { HolidayController } from "interface/controllers/holiday.controller";

/**
 * Branch holiday calendar: effective-year GET, branch overrides, and the
 * `HolidayCalendarService` that business-day callers inject.
 */
@Module({
    imports: [DatabaseModule],
    controllers: [HolidayController],
    providers: [
        BranchManagerGuard,
        { provide: HOLIDAY_CALENDAR_REPOSITORY, useClass: SbHolidayCalendarRepository },
        HolidayCalendarService,
        HolidayOverrideService,
    ],
    exports: [HolidayCalendarService],
})
export class HolidayModule {}
