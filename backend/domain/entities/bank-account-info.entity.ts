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

    static fromPrisma(prismaData: { area_id: string, bank_name: string | null, acc_num: string | null }): BankAccountInfoEntity {
        return new BankAccountInfoEntity(prismaData.area_id, prismaData.bank_name, prismaData.acc_num);
    }

    toPersistence(): { area_id: string, bank_name: string | null, acc_num: string | null } {
        return {
            area_id: this.area,
            bank_name: this.bankName,
            acc_num: this.accNum,
        };
    }
}
