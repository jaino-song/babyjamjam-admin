import { IVoucherPriceInfoRepository } from "domain/repositories/voucher-price-info.repository.interface";
export declare class DeleteVoucherPriceInfoUsecase {
    private readonly voucherPriceInfoRepository;
    constructor(voucherPriceInfoRepository: IVoucherPriceInfoRepository);
    execute(id: number): Promise<void>;
}
