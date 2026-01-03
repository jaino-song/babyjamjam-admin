export class BankAccountInfoEntity {
    constructor(
        public readonly area: string,
        public bankName: string | null,
        public accNum: string | null,
    ) {}

    isComplete(): boolean {
        return !!this.bankName && !!this.accNum;
    }

    static create(area: string, bankName: string, accNum: string): BankAccountInfoEntity {
        return new BankAccountInfoEntity(area, bankName, accNum);
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     * This method is infrastructure-agnostic - it only knows domain types.
     */
    static reconstitute(
        area: string,
        bankName: string | null,
        accNum: string | null,
    ): BankAccountInfoEntity {
        return new BankAccountInfoEntity(area, bankName, accNum);
    }
}
