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
        return EformsignDocEntity.fromPrisma(row);
    }

    // static toPrismaCreate(entity: EformsignDocEntity) {
    //     return {
    //         document_id: entity.documentId,
    //         created_date: entity.createdDate,
    //         updated_date: entity.updatedDate,
    //         status_type: entity.statusType,
    //         status_detail: entity.statusDetail,
    //         step_type: entity.stepType,
    //         step_index: entity.stepIndex,
    //         step_name: entity.stepName,
    //         step_recipient_type: entity.stepRecipientType,
    //         step_recipient_name: entity.stepRecipientName,
    //         step_recipient_sms: entity.stepRecipientSms,
    //         expired_date: entity.expiredDate,
    //         expired: entity.expired,
    //         client_id: entity.clientId,
    //     };
    // }

    // static toPrismaUpdate(entity: EformsignDocEntity) {
    //     return {
    //         document_id: entity.documentId,
    //         created_date: entity.createdDate,
    //         updated_date: entity.updatedDate,
    //         status_type: entity.statusType,
    //         status_detail: entity.statusDetail,
    //         step_type: entity.stepType,
    //         step_index: entity.stepIndex,
    //         step_name: entity.stepName,
    //         step_recipient_type: entity.stepRecipientType,
    //         step_recipient_name: entity.stepRecipientName,
    //         step_recipient_sms: entity.stepRecipientSms,
    //         expired_date: entity.expiredDate,
    //         expired: entity.expired,
    //         client_id: entity.clientId,
    //     };
    // }
}

