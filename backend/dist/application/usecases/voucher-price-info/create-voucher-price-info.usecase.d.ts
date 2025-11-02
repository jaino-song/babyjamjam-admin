import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { IVoucherPriceInfoRepository } from "domain/repositories/voucher-price-info.repository.interface";
export declare class CreateVoucherPriceInfoUsecase {
    private readonly voucherPriceInfoRepository;
    constructor(voucherPriceInfoRepository: IVoucherPriceInfoRepository);
    execute(type: string, duration: bigint, fullPrice: string, grant: string, actualPrice: string): Promise<VoucherPriceInfoEntity>;
}
