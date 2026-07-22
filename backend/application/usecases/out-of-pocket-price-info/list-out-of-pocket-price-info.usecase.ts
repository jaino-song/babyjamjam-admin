import { Inject, Injectable } from "@nestjs/common";

import { OutOfPocketPriceInfoEntity } from "domain/entities/out-of-pocket-price-info.entity";
import {
    IOutOfPocketPriceInfoRepository,
    OUT_OF_POCKET_PRICE_INFO_REPOSITORY,
} from "domain/repositories/out-of-pocket-price-info.repository.interface";

@Injectable()
export class ListOutOfPocketPriceInfoUsecase {
    constructor(
        @Inject(OUT_OF_POCKET_PRICE_INFO_REPOSITORY)
        private readonly repository: IOutOfPocketPriceInfoRepository,
    ) {}

    execute(): Promise<OutOfPocketPriceInfoEntity[]> {
        return this.repository.findAll();
    }
}
