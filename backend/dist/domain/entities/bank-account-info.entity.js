"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BankAccountInfoEntity = void 0;
class BankAccountInfoEntity {
    constructor(area, bankName, accNum) {
        this.area = area;
        this.bankName = bankName;
        this.accNum = accNum;
    }
    isComplete() {
        return !!this.bankName && !!this.accNum;
    }
    static create(area, bankName, accNum) {
        return new BankAccountInfoEntity(area, bankName, accNum);
    }
    static fromPrisma(prismaData) {
        return new BankAccountInfoEntity(prismaData.area, prismaData.bankName, prismaData.accNum);
    }
    toPersistence() {
        return {
            area: this.area,
            bankName: this.bankName,
            accNum: this.accNum,
        };
    }
}
exports.BankAccountInfoEntity = BankAccountInfoEntity;
//# sourceMappingURL=bank-account-info.entity.js.map