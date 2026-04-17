import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DailyRecordEntryEntity } from "domain/entities/daily-record-entry.entity";
import { DAILY_RECORD_ENTRY_REPOSITORY, IDailyRecordEntryRepository } from "domain/repositories/daily-record-entry.repository.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

export interface ListDailyRecordEntriesResult {
    entries: DailyRecordEntryEntity[];
    missingDates: string[]; // ISO YYYY-MM-DD
    collectionStartDate: string | null;
    collectionEndDate: string | null;
    collectionPeriodDays: number | null;
}

@Injectable()
export class ListDailyRecordEntriesUsecase {
    constructor(
        @Inject(DAILY_RECORD_ENTRY_REPOSITORY)
        private readonly entryRepository: IDailyRecordEntryRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    async execute(
        organizationid: string,
        eformsignDocId: number,
    ): Promise<ListDailyRecordEntriesResult> {
        const doc = await this.eformsignDocRepository.findById(organizationid, eformsignDocId);
        if (!doc) {
            throw new NotFoundException(
                `EformsignDoc with id ${eformsignDocId} not found`,
            );
        }

        const entries = await this.entryRepository.findByEformsignDocId(
            organizationid,
            eformsignDocId,
        );

        const missingDates = this.computeMissingDates(
            doc.collectionStartDate,
            doc.collectionEndDate,
            entries.map(e => this.toDateOnly(e.recordDate)),
        );

        return {
            entries,
            missingDates,
            collectionStartDate: doc.collectionStartDate
                ? this.formatDate(doc.collectionStartDate)
                : null,
            collectionEndDate: doc.collectionEndDate
                ? this.formatDate(doc.collectionEndDate)
                : null,
            collectionPeriodDays: doc.collectionPeriodDays,
        };
    }

    private computeMissingDates(
        startDate: Date | null,
        endDate: Date | null,
        submittedDates: Date[],
    ): string[] {
        if (!startDate || !endDate) return [];

        const submitted = new Set(submittedDates.map(d => this.formatDate(d)));
        const missing: string[] = [];

        const cursor = this.toDateOnly(startDate);
        const end = this.toDateOnly(endDate);

        while (cursor <= end) {
            const key = this.formatDate(cursor);
            if (!submitted.has(key)) {
                missing.push(key);
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        return missing;
    }

    private toDateOnly(d: Date): Date {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    private formatDate(d: Date): string {
        return d.toISOString().slice(0, 10);
    }
}
