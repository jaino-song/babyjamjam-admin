import { CreateBankAccountInfoUsecase, ListBankAccountInfoUsecase, FindBankAccountInfoByAreaUsecase, UpdateBankAccountInfoUsecase, DeleteBankAccountInfoUsecase } from "application/usecases/bank-account-info";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
export declare class BankAccountInfoService {
    private readonly listBankAccountInfoUsecase;
    private readonly createBankAccountInfoUsecase;
    private readonly findBankAccountInfoByAreaUsecase;
    private readonly updateBankAccountInfoUsecase;
    private readonly deleteBankAccountInfoUsecase;
    constructor(listBankAccountInfoUsecase: ListBankAccountInfoUsecase, createBankAccountInfoUsecase: CreateBankAccountInfoUsecase, findBankAccountInfoByAreaUsecase: FindBankAccountInfoByAreaUsecase, updateBankAccountInfoUsecase: UpdateBankAccountInfoUsecase, deleteBankAccountInfoUsecase: DeleteBankAccountInfoUsecase);
    create(params: {
        area: string;
        bankName: string;
        accNum: string;
    }): Promise<BankAccountInfoEntity>;
    findAll(): Promise<BankAccountInfoEntity[]>;
    findByArea(area: string): Promise<BankAccountInfoEntity | null>;
    update(area: string, params: {
        bankName?: string | null;
        accNum?: string | null;
    }): Promise<BankAccountInfoEntity>;
    delete(area: string): Promise<void>;
}
