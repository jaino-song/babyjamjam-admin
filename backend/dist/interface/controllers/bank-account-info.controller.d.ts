import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { CreateBankAccountInfoDto, UpdateBankAccountInfoDto } from "../dto/bank-account-info.dto";
export declare class BankAccountInfoController {
    private readonly bankAccountInfoService;
    constructor(bankAccountInfoService: BankAccountInfoService);
    create(createBankAccountInfoDto: CreateBankAccountInfoDto): Promise<import("../../domain/entities/bank-account-info.entity").BankAccountInfoEntity>;
    findByArea(area: string): Promise<import("../../domain/entities/bank-account-info.entity").BankAccountInfoEntity>;
    findAll(): Promise<import("../../domain/entities/bank-account-info.entity").BankAccountInfoEntity[]>;
    update(area: string, updateBankAccountInfoDto: UpdateBankAccountInfoDto): Promise<import("../../domain/entities/bank-account-info.entity").BankAccountInfoEntity>;
    delete(area: string): Promise<void>;
}
