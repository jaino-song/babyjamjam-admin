import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";
export declare class ListBankAccountInfoUsecase {
    private readonly bankAccountInfoRepository;
    constructor(bankAccountInfoRepository: IBankAccountInfoRepository);
    execute(): Promise<BankAccountInfoEntity[]>;
}
