import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { IVoucherPriceInfoRepository } from "domain/repositories/voucher-price-info.repository.interface";
export declare class FindVoucherPriceInfoByTypeUsecase {
    private readonly voucherPriceInfoRepository;
    constructor(voucherPriceInfoRepository: IVoucherPriceInfoRepository);
    execute(type: string): Promise<VoucherPriceInfoEntity[]>;
}
