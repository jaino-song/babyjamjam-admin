import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HolidaySyncService } from "application/services/holiday-sync.service";
import { HOLIDAY_SYNC_REPOSITORY } from "domain/repositories/holiday-sync.repository.interface";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { KasiHolidayClient } from "infrastructure/api/kasi-holiday.client";
import { SbHolidaySyncRepository } from "infrastructure/database/repositories/sb.holiday-sync.repository";
import { HolidaySyncController } from "interface/controllers/holiday-sync.controller";

/**
 * KASI public-holiday sync (nightly cron + manual trigger). SchedulerLeaseModule and
 * DatabaseModule are @Global(), so SchedulerLeaseService / PrismaService are injected without imports.
 */
@Module({
    imports: [ConfigModule],
    controllers: [HolidaySyncController],
    providers: [
        BranchManagerGuard,
        KasiHolidayClient,
        { provide: HOLIDAY_SYNC_REPOSITORY, useClass: SbHolidaySyncRepository },
        HolidaySyncService,
    ],
    exports: [HolidaySyncService],
})
export class HolidaySyncModule {}
