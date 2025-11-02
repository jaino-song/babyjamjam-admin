"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeScheduleMapper = void 0;
const employee_schedule_entity_1 = require("../../../domain/entities/employee-schedule.entity");
class EmployeeScheduleMapper {
    static toDomain(row) {
        return new employee_schedule_entity_1.EmployeeScheduleEntity(row.id, row.employee_id, row.work_address, row.start_date, row.end_date, row.replaced);
    }
    static toPrismaCreate(entity) {
        return {
            employee_id: entity.employeeId,
            work_address: entity.workAddress,
            start_date: entity.startDate,
            end_date: entity.endDate,
            replaced: entity.replaced,
        };
    }
    static toPrismaUpdate(entity) {
        return {
            work_address: entity.workAddress,
            start_date: entity.startDate,
            end_date: entity.endDate,
            replaced: entity.replaced,
        };
    }
}
exports.EmployeeScheduleMapper = EmployeeScheduleMapper;
//# sourceMappingURL=employee-schedule.mapper.js.map