import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";
export type UpdateBankAccountInfoParams = {
    bankName?: string | null;
    accNum?: string | null;
};
export declare class UpdateBankAccountInfoUsecase {
    private readonly bankAccountInfoRepository;
    constructor(bankAccountInfoRepository: IBankAccountInfoRepository);
    execute(area: string, updates: UpdateBankAccountInfoParams): Promise<BankAccountInfoEntity>;
}
