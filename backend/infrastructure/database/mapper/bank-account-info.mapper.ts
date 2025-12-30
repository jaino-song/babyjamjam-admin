import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";

type BankAccountInfoRow = {
    area_id: string;
    bank_name: string | null;
    acc_num: string | null;
};

export class BankAccountInfoMapper {
    static toDomain(row: BankAccountInfoRow): BankAccountInfoEntity {
        return new BankAccountInfoEntity(row.area_id, row.bank_name, row.acc_num);
    }

    static toPrismaCreate(entity: BankAccountInfoEntity) {
        return {
            area_id: entity.area,
            bank_name: entity.bankName,
            acc_num: entity.accNum,
        };
    }

    static toPrismaUpdate(entity: BankAccountInfoEntity) {
        return {
            bank_name: entity.bankName,
            acc_num: entity.accNum,
        };
    }
}
