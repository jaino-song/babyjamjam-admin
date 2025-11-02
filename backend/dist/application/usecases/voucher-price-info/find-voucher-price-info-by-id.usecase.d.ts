import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { IVoucherPriceInfoRepository } from "domain/repositories/voucher-price-info.repository.interface";
export declare class FindVoucherPriceInfoByIdUsecase {
    private readonly voucherPriceInfoRepository;
    constructor(voucherPriceInfoRepository: IVoucherPriceInfoRepository);
    execute(id: number): Promise<VoucherPriceInfoEntity | null>;
}
