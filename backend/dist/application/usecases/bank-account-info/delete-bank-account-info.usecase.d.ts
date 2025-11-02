import { IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";
export declare class DeleteBankAccountInfoUsecase {
    private readonly bankAccountInfoRepository;
    constructor(bankAccountInfoRepository: IBankAccountInfoRepository);
    execute(area: string): Promise<void>;
}
