import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

type EformsignDocRow = {
    id: number;
    document_id: string;
    created_date: Date;
    updated_date: Date;
    status_type: string;
    status_detail: string;
    step_type: string;
    step_index: string;
    step_name: string;
    step_recipient_type: string;
    step_recipient_name: string;
    step_recipient_sms: string;
    expired_date: Date;
    expired: boolean;
    client_id: number;
};

export class EformsignDocMapper {
    static toDomain(row: EformsignDocRow): EformsignDocEntity {
        return EformsignDocEntity.reconstitute({
            id: row.id,
            documentId: row.document_id,
            createdDate: row.created_date,
            updatedDate: row.updated_date,
            statusType: row.status_type,
            statusDetail: row.status_detail,
            stepType: row.step_type,
            stepIndex: row.step_index,
            stepName: row.step_name,
            stepRecipientType: row.step_recipient_type,
            stepRecipientName: row.step_recipient_name,
            stepRecipientSms: row.step_recipient_sms,
            expiredDate: row.expired_date,
            expired: row.expired,
            clientId: row.client_id,
        });
    }

    static toPrismaCreate(entity: EformsignDocEntity) {
        return {
            document_id: entity.documentId,
            created_date: entity.createdDate,
            updated_date: entity.updatedDate,
            status_type: entity.statusType,
            status_detail: entity.statusDetail,
            step_type: entity.stepType,
            step_index: entity.stepIndex,
            step_name: entity.stepName,
            step_recipient_type: entity.stepRecipientType,
            step_recipient_name: entity.stepRecipientName,
            step_recipient_sms: entity.stepRecipientSms,
            expired_date: entity.expiredDate,
            expired: entity.expired,
            client_id: entity.clientId,
        };
    }

    static toPrismaUpdate(entity: EformsignDocEntity) {
        return {
            document_id: entity.documentId,
            created_date: entity.createdDate,
            updated_date: entity.updatedDate,
            status_type: entity.statusType,
            status_detail: entity.statusDetail,
            step_type: entity.stepType,
            step_index: entity.stepIndex,
            step_name: entity.stepName,
            step_recipient_type: entity.stepRecipientType,
            step_recipient_name: entity.stepRecipientName,
            step_recipient_sms: entity.stepRecipientSms,
            expired_date: entity.expiredDate,
            expired: entity.expired,
            client_id: entity.clientId,
        };
    }
}

