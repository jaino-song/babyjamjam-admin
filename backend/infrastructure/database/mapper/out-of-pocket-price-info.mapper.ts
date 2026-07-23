import type { out_of_pocket_price_info } from "@prisma/client";

import { OutOfPocketPriceInfoEntity } from "domain/entities/out-of-pocket-price-info.entity";

export class OutOfPocketPriceInfoMapper {
    static toDomain(row: out_of_pocket_price_info): OutOfPocketPriceInfoEntity {
        return new OutOfPocketPriceInfoEntity(
            row.id,
            row.duration,
            row.fullPrice.toString(),
        );
    }
}
