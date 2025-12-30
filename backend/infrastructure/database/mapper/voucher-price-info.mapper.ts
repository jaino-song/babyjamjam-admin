import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";

type VoucherPriceInfoRow = {
    id: number;
    type: string | null;
    duration: bigint | null;
    full_price: string | null;
    grant: string | null;
    actual_price: string | null;
};

export class VoucherPriceInfoMapper {
    static toDomain(row: VoucherPriceInfoRow): VoucherPriceInfoEntity {
        return new VoucherPriceInfoEntity(
            row.id,
            row.type,
            row.duration,
            row.full_price,
            row.grant,
            row.actual_price,
        );
    }

    static toPrismaCreate(entity: VoucherPriceInfoEntity) {
        return {
            id: entity.id,
            type: entity.type,
            duration: entity.duration,
            full_price: entity.fullPrice,
            grant: entity.grant,
            actual_price: entity.actualPrice,
        };
    }

    static toPrismaUpdate(entity: VoucherPriceInfoEntity) {
        return {
            type: entity.type,
            duration: entity.duration,
            full_price: entity.fullPrice,
            grant: entity.grant,
            actual_price: entity.actualPrice,
        };
    }
}
