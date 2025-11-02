export declare class BankAccountInfoEntity {
    readonly area: string;
    bankName: string | null;
    accNum: string | null;
    constructor(area: string, bankName: string | null, accNum: string | null);
    isComplete(): boolean;
    static create(area: string, bankName: string, accNum: string): BankAccountInfoEntity;
    static fromPrisma(prismaData: {
        area: string;
        bankName: string | null;
        accNum: string | null;
    }): BankAccountInfoEntity;
    toPersistence(): {
        area: string;
        bankName: string | null;
        accNum: string | null;
    };
}
