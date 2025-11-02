"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoucherPriceInfoEntity = void 0;
class VoucherPriceInfoEntity {
    constructor(id, type, duration, fullPrice, grant, actualPrice) {
        this.id = id;
        this.type = type;
        this.duration = duration;
        this.fullPrice = fullPrice;
        this.grant = grant;
        this.actualPrice = actualPrice;
    }
    static create(type, duration, fullPrice, grant, actualPrice) {
        return new VoucherPriceInfoEntity(0, type, duration, fullPrice, grant, actualPrice);
    }
    static fromPrisma(prismaData) {
        return new VoucherPriceInfoEntity(prismaData.id, prismaData.type, prismaData.duration, prismaData.fullPrice, prismaData.grant, prismaData.actualPrice);
    }
    toPersistence() {
        return {
            id: this.id,
            type: this.type,
            duration: this.duration,
            fullPrice: this.fullPrice,
            grant: this.grant,
            actualPrice: this.actualPrice,
        };
    }
}
exports.VoucherPriceInfoEntity = VoucherPriceInfoEntity;
//# sourceMappingURL=voucher-price-info.entity.js.map