import { IVoucherPriceInfoRepository } from "domain/repositories/voucher-price-info.repository.interface";
import { PrismaService } from "../prisma.service";
import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
export declare class SbVoucherPriceInfoRepository implements IVoucherPriceInfoRepository {
    private prismaService;
    constructor(prismaService: PrismaService);
    findById(id: number): Promise<VoucherPriceInfoEntity | null>;
    findByType(type: string): Promise<VoucherPriceInfoEntity[]>;
    create(voucherPriceInfo: VoucherPriceInfoEntity): Promise<VoucherPriceInfoEntity>;
    update(voucherPriceInfo: VoucherPriceInfoEntity): Promise<VoucherPriceInfoEntity>;
    delete(id: number): Promise<void>;
    findAll(): Promise<VoucherPriceInfoEntity[]>;
}
