export declare class VoucherPriceInfoEntity {
    readonly id: number;
    type: string | null;
    duration: bigint | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    constructor(id: number, type: string | null, duration: bigint | null, fullPrice: string | null, grant: string | null, actualPrice: string | null);
    static create(type: string, duration: bigint, fullPrice: string, grant: string, actualPrice: string): VoucherPriceInfoEntity;
    static fromPrisma(prismaData: {
        id: number;
        type: string | null;
        duration: bigint | null;
        fullPrice: string | null;
        grant: string | null;
        actualPrice: string | null;
    }): VoucherPriceInfoEntity;
    toPersistence(): {
        id: number;
        type: string | null;
        duration: bigint | null;
        fullPrice: string | null;
        grant: string | null;
        actualPrice: string | null;
    };
}
