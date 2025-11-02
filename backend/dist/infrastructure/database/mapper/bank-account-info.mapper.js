"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BankAccountInfoMapper = void 0;
const bank_account_info_entity_1 = require("../../../domain/entities/bank-account-info.entity");
class BankAccountInfoMapper {
    static toDomain(row) {
        return new bank_account_info_entity_1.BankAccountInfoEntity(row.area, row.bankName, row.accNum);
    }
    static toPrismaCreate(entity) {
        return {
            area: entity.area,
            bankName: entity.bankName,
            accNum: entity.accNum,
        };
    }
    static toPrismaUpdate(entity) {
        return {
            bankName: entity.bankName,
            accNum: entity.accNum,
        };
    }
}
exports.BankAccountInfoMapper = BankAccountInfoMapper;
//# sourceMappingURL=bank-account-info.mapper.js.map