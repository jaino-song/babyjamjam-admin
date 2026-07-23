import { Module } from "@nestjs/common";

import { ListOutOfPocketPriceInfoUsecase } from "application/usecases/out-of-pocket-price-info/list-out-of-pocket-price-info.usecase";
import { OUT_OF_POCKET_PRICE_INFO_REPOSITORY } from "domain/repositories/out-of-pocket-price-info.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbOutOfPocketPriceInfoRepository } from "infrastructure/database/repositories/sb.out-of-pocket-price-info.repository";
import { OutOfPocketPriceInfoController } from "interface/controllers/out-of-pocket-price-info.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [OutOfPocketPriceInfoController],
    providers: [
        ListOutOfPocketPriceInfoUsecase,
        {
            provide: OUT_OF_POCKET_PRICE_INFO_REPOSITORY,
            useClass: SbOutOfPocketPriceInfoRepository,
        },
    ],
})
export class OutOfPocketPriceInfoModule {}
