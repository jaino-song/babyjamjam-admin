import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";

type BankAccountInfoRow = {
    areaId: string;
    bankName: string | null;
    accNum: string | null;
};

export class BankAccountInfoMapper {
    static toDomain(row: BankAccountInfoRow): BankAccountInfoEntity {
        return new BankAccountInfoEntity(row.areaId, row.bankName, row.accNum);
    }

    static toPrismaCreate(entity: BankAccountInfoEntity) {
        return {
            areaId: entity.area,
            bankName: entity.bankName,
            accNum: entity.accNum,
        };
    }

    static toPrismaUpdate(entity: BankAccountInfoEntity) {
        return {
            bankName: entity.bankName,
            accNum: entity.accNum,
        };
    }
}
