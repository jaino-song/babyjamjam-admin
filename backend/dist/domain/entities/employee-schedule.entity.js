"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeScheduleEntity = void 0;
class EmployeeScheduleEntity {
    constructor(id, employeeId, workAddress, startDate, endDate, replaced = false) {
        this.id = id;
        this.employeeId = employeeId;
        this.workAddress = workAddress;
        this.startDate = startDate;
        this.endDate = endDate;
        this.replaced = replaced;
    }
    static create(employeeId, workAddress, startDate, endDate, replaced = false) {
        return new EmployeeScheduleEntity(0, employeeId, workAddress, startDate, endDate, replaced);
    }
}
exports.EmployeeScheduleEntity = EmployeeScheduleEntity;
//# sourceMappingURL=employee-schedule.entity.js.map