import { Module } from "@nestjs/common";
import { DailyRecordController } from "interface/controllers/daily-record.controller";
import { DailyRecordService } from "application/services/daily-record.service";
import {
    SubmitDailyRecordEntryUsecase,
    ListDailyRecordEntriesUsecase,
    FinalizeServiceRecordUsecase,
} from "application/usecases/eformsign-doc";
import { DAILY_RECORD_ENTRY_REPOSITORY } from "domain/repositories/daily-record-entry.repository.interface";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { SbDailyRecordEntryRepository } from "infrastructure/database/repositories/sb.daily-record-entry.repository";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { DatabaseModule } from "infrastructure/database/database.module";

@Module({
    imports: [DatabaseModule],
    controllers: [DailyRecordController],
    providers: [
        DailyRecordService,
        SubmitDailyRecordEntryUsecase,
        ListDailyRecordEntriesUsecase,
        FinalizeServiceRecordUsecase,
        {
            provide: DAILY_RECORD_ENTRY_REPOSITORY,
            useClass: SbDailyRecordEntryRepository,
        },
        {
            provide: EFORMSIGN_DOC_REPOSITORY,
            useClass: SbEformsignDocRepository,
        },
    ],
})
export class DailyRecordModule {}
