import { ClientEntity } from "domain/entities/client.entity";

type ClientRow = {
    id: number;
    name: string;
    address: string | null;
    phone: string | null;
    type: string | null;
    duration: number | null;
    full_price: string | null;
    grant: string | null;
    actual_price: string | null;
    start_date: Date | null;
    end_date: Date | null;
    care_center: boolean;
    voucher_client: boolean;
    birthday: string | null;
    contract_status: string | null;
    breast_pump: boolean;
    e_doc_id: string | null;
};

export class ClientMapper {
    static toDomain(row: ClientRow): ClientEntity {
        return new ClientEntity(
            row.id,
            row.name,
            row.address,
            row.phone,
            row.type,
            row.duration,
            row.full_price,
            row.grant,
            row.actual_price,
            row.start_date,
            row.end_date,
            row.care_center,
            row.voucher_client,
            row.birthday,
            row.contract_status,
            row.breast_pump,
            row.e_doc_id,
        );
    }

    static toPrismaCreate(entity: ClientEntity) {
        return {
            name: entity.name,
            address: entity.address,
            phone: entity.phone,
            type: entity.type,
            duration: entity.duration,
            full_price: entity.fullPrice,
            grant: entity.grant,
            actual_price: entity.actualPrice,
            start_date: entity.startDate,
            end_date: entity.endDate,
            care_center: entity.careCenter,
            voucher_client: entity.voucherClient,
            birthday: entity.birthday,
            contract_status: entity.contractStatus,
            breast_pump: entity.breastPump,
            e_doc_id: entity.eDocId,
        };
    }

    static toPrismaUpdate(entity: ClientEntity) {
        return {
            name: entity.name,
            address: entity.address,
            phone: entity.phone,
            type: entity.type,
            duration: entity.duration,
            full_price: entity.fullPrice,
            grant: entity.grant,
            actual_price: entity.actualPrice,
            start_date: entity.startDate,
            end_date: entity.endDate,
            care_center: entity.careCenter,
            voucher_client: entity.voucherClient,
            birthday: entity.birthday,
            contract_status: entity.contractStatus,
            breast_pump: entity.breastPump,
            e_doc_id: entity.eDocId,
        };
    }
}
