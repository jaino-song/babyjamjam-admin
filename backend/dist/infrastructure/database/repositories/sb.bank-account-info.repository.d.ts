import { IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";
import { PrismaService } from "../prisma.service";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
export declare class SbBankAccountInfoRepository implements IBankAccountInfoRepository {
    private prismaService;
    constructor(prismaService: PrismaService);
    findAll(): Promise<BankAccountInfoEntity[]>;
    findByArea(area: string): Promise<BankAccountInfoEntity | null>;
    create(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity>;
    update(bankAccountInfo: BankAccountInfoEntity): Promise<BankAccountInfoEntity>;
    delete(area: string): Promise<void>;
}
