import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
type VoucherPriceInfoRow = {
    id: number;
    type: string | null;
    duration: bigint | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
};
export declare class VoucherPriceInfoMapper {
    static toDomain(row: VoucherPriceInfoRow): VoucherPriceInfoEntity;
    static toPrismaCreate(entity: VoucherPriceInfoEntity): {
        id: number;
        type: string;
        duration: bigint;
        fullPrice: string;
        grant: string;
        actualPrice: string;
    };
    static toPrismaUpdate(entity: VoucherPriceInfoEntity): {
        type: string;
        duration: bigint;
        fullPrice: string;
        grant: string;
        actualPrice: string;
    };
}
export {};
