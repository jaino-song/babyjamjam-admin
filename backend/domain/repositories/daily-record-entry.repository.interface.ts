import { DailyRecordEntryEntity } from "domain/entities/daily-record-entry.entity";

export interface IDailyRecordEntryRepository {
    findById(organizationid: string, id: string): Promise<DailyRecordEntryEntity | null>;
    findByEformsignDocId(organizationid: string, eformsignDocId: number): Promise<DailyRecordEntryEntity[]>;
    findByEformsignDocIdAndDate(
        organizationid: string,
        eformsignDocId: number,
        recordDate: Date,
    ): Promise<DailyRecordEntryEntity | null>;
    create(organizationid: string, entry: DailyRecordEntryEntity): Promise<DailyRecordEntryEntity>;
    delete(organizationid: string, id: string): Promise<void>;
}

export const DAILY_RECORD_ENTRY_REPOSITORY = "DAILY_RECORD_ENTRY_REPOSITORY";
