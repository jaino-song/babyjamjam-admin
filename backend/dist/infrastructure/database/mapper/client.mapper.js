"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientMapper = void 0;
const client_entity_1 = require("../../../domain/entities/client.entity");
class ClientMapper {
    static toDomain(row) {
        return new client_entity_1.ClientEntity(row.id, row.name, row.primary_employee_id, row.secondary_employee_id, row.address, row.phone, row.type, row.duration, row.full_price, row.grant, row.actual_price, row.start_date, row.end_date, row.care_center, row.voucher_client);
    }
    static toPrismaCreate(entity) {
        return {
            name: entity.name,
            primary_employee_id: entity.primaryEmployeeId,
            secondary_employee_id: entity.secondaryEmployeeId,
            address: entity.address,
            phone: entity.phone,
            type: entity.type,
            duration: entity.duration,
            full_price: entity.fullPrice,
            grant: entity.grant,
            actual_price: entity.actualPrice,
            start_date: entity.startDate,
            end_date: entity.endDate,
            care_center: entity.careCenter,
            voucher_client: entity.voucherClient,
        };
    }
    static toPrismaUpdate(entity) {
        return {
            name: entity.name,
            primary_employee_id: entity.primaryEmployeeId,
            secondary_employee_id: entity.secondaryEmployeeId,
            address: entity.address,
            phone: entity.phone,
            type: entity.type,
            duration: entity.duration,
            full_price: entity.fullPrice,
            grant: entity.grant,
            actual_price: entity.actualPrice,
            start_date: entity.startDate,
            end_date: entity.endDate,
            care_center: entity.careCenter,
            voucher_client: entity.voucherClient,
        };
    }
}
exports.ClientMapper = ClientMapper;
//# sourceMappingURL=client.mapper.js.map