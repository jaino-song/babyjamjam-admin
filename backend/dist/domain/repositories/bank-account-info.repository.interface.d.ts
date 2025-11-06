import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
export interface IBankAccountInfoRepository {
    findAll(): Promise<BankAccountInfoEntity[]>;
    findByArea(area: string): Promise<BankAccountInfoEntity | null>;
    create(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity>;
    update(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity>;
    delete(area: string): Promise<void>;
}
export declare const BANK_ACCOUNT_INFO_REPOSITORY = "BANK_ACCOUNT_INFO_REPOSITORY";
