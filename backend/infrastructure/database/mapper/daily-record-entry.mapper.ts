import { DailyRecordEntryEntity } from "domain/entities/daily-record-entry.entity";

type DailyRecordEntryRow = {
    id: string;
    eformsignDocId: number;
    recordDate: Date;
    content: string | null;
    submittedBy: string | null;
    submittedAt: Date;
    organizationId: string | null;
    createdAt: Date;
};

export class DailyRecordEntryMapper {
    static toDomain(row: DailyRecordEntryRow): DailyRecordEntryEntity {
        return DailyRecordEntryEntity.reconstitute({
            id: row.id,
            eformsignDocId: row.eformsignDocId,
            recordDate: row.recordDate,
            content: row.content,
            submittedBy: row.submittedBy,
            submittedAt: row.submittedAt,
            organizationId: row.organizationId,
            createdAt: row.createdAt,
        });
    }

    static toPrismaCreate(entity: DailyRecordEntryEntity) {
        return {
            eformsignDocId: entity.eformsignDocId,
            recordDate: entity.recordDate,
            content: entity.content,
            submittedBy: entity.submittedBy,
            submittedAt: entity.submittedAt,
        };
    }
}
