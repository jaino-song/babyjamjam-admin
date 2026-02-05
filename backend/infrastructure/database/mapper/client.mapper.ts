import { ClientEntity } from "domain/entities/client.entity";

type ClientRow = {
    id: number;
    name: string;
    address: string | null;
    phone: string | null;
    type: string | null;
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: Date | null;
    endDate: Date | null;
    careCenter: boolean;
    voucherClient: boolean;
    birthday: string | null;
    dueDate?: Date | null;
    serviceStatus: string | null;
    breastPump: boolean;
    eDocId: string | null;
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
            row.fullPrice,
            row.grant,
            row.actualPrice,
            row.startDate,
            row.endDate,
            row.careCenter,
            row.voucherClient,
            row.birthday,
            row.serviceStatus,
            row.breastPump,
            row.eDocId,
            row.dueDate ?? null,
        );
    }

    static toPrismaCreate(entity: ClientEntity) {
        return {
            name: entity.name,
            address: entity.address,
            phone: entity.phone,
            type: entity.type,
            duration: entity.duration,
            fullPrice: entity.fullPrice,
            grant: entity.grant,
            actualPrice: entity.actualPrice,
            startDate: entity.startDate,
            endDate: entity.endDate,
            careCenter: entity.careCenter,
            voucherClient: entity.voucherClient,
            birthday: entity.birthday,
            dueDate: entity.dueDate,
            serviceStatus: entity.serviceStatus,
            breastPump: entity.breastPump,
            eDocId: entity.eDocId,
        };
    }

    static toPrismaUpdate(entity: ClientEntity) {
        return {
            name: entity.name,
            address: entity.address,
            phone: entity.phone,
            type: entity.type,
            duration: entity.duration,
            fullPrice: entity.fullPrice,
            grant: entity.grant,
            actualPrice: entity.actualPrice,
            startDate: entity.startDate,
            endDate: entity.endDate,
            careCenter: entity.careCenter,
            voucherClient: entity.voucherClient,
            birthday: entity.birthday,
            dueDate: entity.dueDate,
            serviceStatus: entity.serviceStatus,
            breastPump: entity.breastPump,
            eDocId: entity.eDocId,
        };
    }
}
