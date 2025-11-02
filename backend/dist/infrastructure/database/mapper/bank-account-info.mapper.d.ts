import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
type BankAccountInfoRow = {
    area: string;
    bankName: string | null;
    accNum: string | null;
};
export declare class BankAccountInfoMapper {
    static toDomain(row: BankAccountInfoRow): BankAccountInfoEntity;
    static toPrismaCreate(entity: BankAccountInfoEntity): {
        area: string;
        bankName: string;
        accNum: string;
    };
    static toPrismaUpdate(entity: BankAccountInfoEntity): {
        bankName: string;
        accNum: string;
    };
}
export {};
