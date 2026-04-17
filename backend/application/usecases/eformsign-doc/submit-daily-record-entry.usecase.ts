import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DailyRecordEntryEntity } from "domain/entities/daily-record-entry.entity";
import { DAILY_RECORD_ENTRY_REPOSITORY, IDailyRecordEntryRepository } from "domain/repositories/daily-record-entry.repository.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

export interface SubmitDailyRecordEntryParams {
    eformsignDocId: number;
    recordDate: Date;
    content?: string | null;
    submittedBy?: string | null;
}

@Injectable()
export class SubmitDailyRecordEntryUsecase {
    constructor(
        @Inject(DAILY_RECORD_ENTRY_REPOSITORY)
        private readonly entryRepository: IDailyRecordEntryRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    async execute(
        organizationid: string,
        params: SubmitDailyRecordEntryParams,
    ): Promise<DailyRecordEntryEntity> {
        const doc = await this.eformsignDocRepository.findById(organizationid, params.eformsignDocId);
        if (!doc) {
            throw new NotFoundException(
                `EformsignDoc with id ${params.eformsignDocId} not found`,
            );
        }

        if (doc.statusType !== "070") {
            throw new BadRequestException(
                `Cannot submit entries: document status is ${doc.statusType}, expected 070 (collecting)`,
            );
        }

        if (!doc.collectionStartDate || !doc.collectionEndDate) {
            throw new BadRequestException(
                "Collection window is not initialized on this document",
            );
        }

        const recordDateOnly = this.toDateOnly(params.recordDate);
        const startDateOnly = this.toDateOnly(doc.collectionStartDate);
        const endDateOnly = this.toDateOnly(doc.collectionEndDate);

        if (recordDateOnly < startDateOnly || recordDateOnly > endDateOnly) {
            throw new BadRequestException(
                `Record date ${this.formatDate(recordDateOnly)} is outside collection window [${this.formatDate(startDateOnly)}, ${this.formatDate(endDateOnly)}]`,
            );
        }

        const existing = await this.entryRepository.findByEformsignDocIdAndDate(
            organizationid,
            params.eformsignDocId,
            recordDateOnly,
        );
        if (existing) {
            throw new ConflictException(
                `Daily record entry for ${this.formatDate(recordDateOnly)} already exists on document ${params.eformsignDocId}`,
            );
        }

        const entry = DailyRecordEntryEntity.create({
            eformsignDocId: params.eformsignDocId,
            recordDate: recordDateOnly,
            content: params.content ?? null,
            submittedBy: params.submittedBy ?? null,
            organizationId: organizationid,
        });

        return this.entryRepository.create(organizationid, entry);
    }

    private toDateOnly(d: Date): Date {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    private formatDate(d: Date): string {
        return d.toISOString().slice(0, 10);
    }
}
