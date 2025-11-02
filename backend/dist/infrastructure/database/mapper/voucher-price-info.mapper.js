"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoucherPriceInfoMapper = void 0;
const voucher_price_info_entity_1 = require("../../../domain/entities/voucher-price-info.entity");
class VoucherPriceInfoMapper {
    static toDomain(row) {
        return new voucher_price_info_entity_1.VoucherPriceInfoEntity(row.id, row.type, row.duration, row.fullPrice, row.grant, row.actualPrice);
    }
    static toPrismaCreate(entity) {
        return {
            id: entity.id,
            type: entity.type,
            duration: entity.duration,
            fullPrice: entity.fullPrice,
            grant: entity.grant,
            actualPrice: entity.actualPrice,
        };
    }
    static toPrismaUpdate(entity) {
        return {
            type: entity.type,
            duration: entity.duration,
            fullPrice: entity.fullPrice,
            grant: entity.grant,
            actualPrice: entity.actualPrice,
        };
    }
}
exports.VoucherPriceInfoMapper = VoucherPriceInfoMapper;
//# sourceMappingURL=voucher-price-info.mapper.js.map