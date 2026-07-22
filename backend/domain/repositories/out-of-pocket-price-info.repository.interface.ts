import { OutOfPocketPriceInfoEntity } from "domain/entities/out-of-pocket-price-info.entity";

export interface IOutOfPocketPriceInfoRepository {
    findAll(): Promise<OutOfPocketPriceInfoEntity[]>;
}

export const OUT_OF_POCKET_PRICE_INFO_REPOSITORY = "OUT_OF_POCKET_PRICE_INFO_REPOSITORY";
