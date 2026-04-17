import { Injectable } from "@nestjs/common";
import { DailyRecordEntryEntity } from "domain/entities/daily-record-entry.entity";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    SubmitDailyRecordEntryUsecase,
    SubmitDailyRecordEntryParams,
} from "application/usecases/eformsign-doc/submit-daily-record-entry.usecase";
import {
    ListDailyRecordEntriesUsecase,
    ListDailyRecordEntriesResult,
} from "application/usecases/eformsign-doc/list-daily-record-entries.usecase";
import {
    FinalizeServiceRecordUsecase,
    FinalizeServiceRecordParams,
    FinalizeServiceRecordResult,
} from "application/usecases/eformsign-doc/finalize-service-record.usecase";

@Injectable()
export class DailyRecordService {
    constructor(
        private readonly submitEntryUsecase: SubmitDailyRecordEntryUsecase,
        private readonly listEntriesUsecase: ListDailyRecordEntriesUsecase,
        private readonly finalizeUsecase: FinalizeServiceRecordUsecase,
    ) {}

    submitEntry(
        organizationid: string,
        params: SubmitDailyRecordEntryParams,
    ): Promise<DailyRecordEntryEntity> {
        return this.submitEntryUsecase.execute(organizationid, params);
    }

    listEntries(
        organizationid: string,
        eformsignDocId: number,
    ): Promise<ListDailyRecordEntriesResult> {
        return this.listEntriesUsecase.execute(organizationid, eformsignDocId);
    }

    finalize(
        organizationid: string,
        params: FinalizeServiceRecordParams,
    ): Promise<FinalizeServiceRecordResult> {
        return this.finalizeUsecase.execute(organizationid, params);
    }
}
