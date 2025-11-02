"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeScheduleService = void 0;
const common_1 = require("@nestjs/common");
const employee_schedule_1 = require("../usecases/employee-schedule");
let EmployeeScheduleService = class EmployeeScheduleService {
    constructor(createEmployeeScheduleUsecase, findEmployeeScheduleByIdUsecase, listEmployeeSchedulesUsecase, listEmployeeSchedulesByEmployeeIdUsecase, updateEmployeeScheduleUsecase, deleteEmployeeScheduleUsecase) {
        this.createEmployeeScheduleUsecase = createEmployeeScheduleUsecase;
        this.findEmployeeScheduleByIdUsecase = findEmployeeScheduleByIdUsecase;
        this.listEmployeeSchedulesUsecase = listEmployeeSchedulesUsecase;
        this.listEmployeeSchedulesByEmployeeIdUsecase = listEmployeeSchedulesByEmployeeIdUsecase;
        this.updateEmployeeScheduleUsecase = updateEmployeeScheduleUsecase;
        this.deleteEmployeeScheduleUsecase = deleteEmployeeScheduleUsecase;
    }
    create(params) {
        return this.createEmployeeScheduleUsecase.execute({
            employeeId: params.employeeId,
            workAddress: params.workAddress,
            startDate: new Date(params.startDate),
            endDate: new Date(params.endDate),
            replaced: params.replaced,
        });
    }
    findAll() {
        return this.listEmployeeSchedulesUsecase.execute();
    }
    findById(id) {
        return this.findEmployeeScheduleByIdUsecase.execute(id);
    }
    findByEmployeeId(employeeId) {
        return this.listEmployeeSchedulesByEmployeeIdUsecase.execute(employeeId);
    }
    update(id, params) {
        return this.updateEmployeeScheduleUsecase.execute(id, {
            workAddress: params.workAddress,
            startDate: params.startDate ? new Date(params.startDate) : undefined,
            endDate: params.endDate ? new Date(params.endDate) : undefined,
            replaced: params.replaced,
        });
    }
    delete(id) {
        return this.deleteEmployeeScheduleUsecase.execute(id);
    }
};
exports.EmployeeScheduleService = EmployeeScheduleService;
exports.EmployeeScheduleService = EmployeeScheduleService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [employee_schedule_1.CreateEmployeeScheduleUsecase,
        employee_schedule_1.FindEmployeeScheduleByIdUsecase,
        employee_schedule_1.ListEmployeeSchedulesUsecase,
        employee_schedule_1.ListEmployeeSchedulesByEmployeeIdUsecase,
        employee_schedule_1.UpdateEmployeeScheduleUsecase,
        employee_schedule_1.DeleteEmployeeScheduleUsecase])
], EmployeeScheduleService);
//# sourceMappingURL=employee-schedule.service.js.map