import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { IVoucherPriceInfoRepository } from "domain/repositories/voucher-price-info.repository.interface";
export type UpdateVoucherPriceInfoParams = {
    type?: string | null;
    duration?: bigint | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
};
export declare class UpdateVoucherPriceInfoUsecase {
    private readonly voucherPriceInfoRepository;
    constructor(voucherPriceInfoRepository: IVoucherPriceInfoRepository);
    execute(id: number, updates: UpdateVoucherPriceInfoParams): Promise<VoucherPriceInfoEntity>;
}
