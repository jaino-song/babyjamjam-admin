export class VoucherPriceInfoEntity {
    constructor(
        public readonly id: number,
        public type: string | null,
        public duration: bigint | null,
        public fullPrice: string | null,
        public grant: string | null,
        public actualPrice: string | null,
        public year: number,
    ) {}

    static create(
        type: string,
        duration: bigint,
        fullPrice: string,
        grant: string,
        actualPrice: string,
        year: number,
    ): VoucherPriceInfoEntity {
        return new VoucherPriceInfoEntity(
            0,
            type,
            duration,
            fullPrice,
            grant,
            actualPrice,
            year,
        );
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     * This method is infrastructure-agnostic - it only knows domain types.
     */
    static reconstitute(
        id: number,
        type: string | null,
        duration: bigint | null,
        fullPrice: string | null,
        grant: string | null,
        actualPrice: string | null,
        year: number,
    ): VoucherPriceInfoEntity {
        return new VoucherPriceInfoEntity(
            id,
            type,
            duration,
            fullPrice,
            grant,
            actualPrice,
            year,
        );
    }
}
