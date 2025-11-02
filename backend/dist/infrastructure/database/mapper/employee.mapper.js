"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeMapper = void 0;
const employee_entity_1 = require("../../../domain/entities/employee.entity");
class EmployeeMapper {
    static toDomain(row) {
        return new employee_entity_1.EmployeeEntity(row.id, row.name, row.work_area, row.phone, row.grade, row.open_to_next_work, row.company_registered_date ?? new Date());
    }
    static toPrismaCreate(entity) {
        return {
            id: entity.id,
            name: entity.name,
            work_area: entity.workArea,
            phone: entity.phone,
            grade: entity.grade,
            open_to_next_work: entity.openToNextWork,
            company_registered_date: entity.registeredDate,
        };
    }
    static toPrismaUpdate(entity) {
        return {
            name: entity.name,
            work_area: entity.workArea,
            phone: entity.phone,
            grade: entity.grade,
            open_to_next_work: entity.openToNextWork,
        };
    }
}
exports.EmployeeMapper = EmployeeMapper;
//# sourceMappingURL=employee.mapper.js.map