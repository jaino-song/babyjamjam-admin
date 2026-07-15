import { Inject, Injectable } from "@nestjs/common";
import { IVoucherPriceInfoRepository, VOUCHER_PRICE_INFO_REPOSITORY } from "domain/repositories/voucher-price-info.repository.interface";

@Injectable()
export class GetDistinctYearsUsecase {
    constructor(
        @Inject(VOUCHER_PRICE_INFO_REPOSITORY)
        private readonly voucherPriceInfoRepository: IVoucherPriceInfoRepository,
    ) {}

    execute(): Promise<number[]> {
        return this.voucherPriceInfoRepository.getDistinctYears();
    }
}
