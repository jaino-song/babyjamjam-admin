import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

type EformsignDocRow = {
    id: number;
    documentId: string;
    createdDate: Date;
    updatedDate: Date;
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    stepRecipientType: string;
    stepRecipientName: string;
    stepRecipientSms: string;
    expiredDate: Date;
    expired: boolean;
    clientId: number;
    collectionStartDate?: Date | null;
    collectionEndDate?: Date | null;
    collectionPeriodDays?: number | null;
    finalizedAt?: Date | null;
    forceFinalize?: boolean;
};

export class EformsignDocMapper {
    static toDomain(row: EformsignDocRow): EformsignDocEntity {
        return EformsignDocEntity.reconstitute({
            id: row.id,
            documentId: row.documentId,
            createdDate: row.createdDate,
            updatedDate: row.updatedDate,
            statusType: row.statusType,
            statusDetail: row.statusDetail,
            stepType: row.stepType,
            stepIndex: row.stepIndex,
            stepName: row.stepName,
            stepRecipientType: row.stepRecipientType,
            stepRecipientName: row.stepRecipientName,
            stepRecipientSms: row.stepRecipientSms,
            expiredDate: row.expiredDate,
            expired: row.expired,
            clientId: row.clientId,
            collectionStartDate: row.collectionStartDate ?? null,
            collectionEndDate: row.collectionEndDate ?? null,
            collectionPeriodDays: row.collectionPeriodDays ?? null,
            finalizedAt: row.finalizedAt ?? null,
            forceFinalize: row.forceFinalize ?? false,
        });
    }

    static toPrismaCreate(entity: EformsignDocEntity) {
        return {
            documentId: entity.documentId,
            createdDate: entity.createdDate,
            updatedDate: entity.updatedDate,
            statusType: entity.statusType,
            statusDetail: entity.statusDetail,
            stepType: entity.stepType,
            stepIndex: entity.stepIndex,
            stepName: entity.stepName,
            stepRecipientType: entity.stepRecipientType,
            stepRecipientName: entity.stepRecipientName,
            stepRecipientSms: entity.stepRecipientSms,
            expiredDate: entity.expiredDate,
            expired: entity.expired,
            clientId: entity.clientId,
            collectionStartDate: entity.collectionStartDate,
            collectionEndDate: entity.collectionEndDate,
            collectionPeriodDays: entity.collectionPeriodDays,
            finalizedAt: entity.finalizedAt,
            forceFinalize: entity.forceFinalize,
        };
    }

    static toPrismaUpdate(entity: EformsignDocEntity) {
        return {
            documentId: entity.documentId,
            createdDate: entity.createdDate,
            updatedDate: entity.updatedDate,
            statusType: entity.statusType,
            statusDetail: entity.statusDetail,
            stepType: entity.stepType,
            stepIndex: entity.stepIndex,
            stepName: entity.stepName,
            stepRecipientType: entity.stepRecipientType,
            stepRecipientName: entity.stepRecipientName,
            stepRecipientSms: entity.stepRecipientSms,
            expiredDate: entity.expiredDate,
            expired: entity.expired,
            clientId: entity.clientId,
            collectionStartDate: entity.collectionStartDate,
            collectionEndDate: entity.collectionEndDate,
            collectionPeriodDays: entity.collectionPeriodDays,
            finalizedAt: entity.finalizedAt,
            forceFinalize: entity.forceFinalize,
        };
    }
}

