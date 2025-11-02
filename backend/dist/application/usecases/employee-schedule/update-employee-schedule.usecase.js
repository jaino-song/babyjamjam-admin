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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateEmployeeScheduleUsecase = void 0;
const common_1 = require("@nestjs/common");
const employee_schedule_entity_1 = require("../../../domain/entities/employee-schedule.entity");
const employee_schedule_repository_interface_1 = require("../../../domain/repositories/employee-schedule.repository.interface");
let UpdateEmployeeScheduleUsecase = class UpdateEmployeeScheduleUsecase {
    constructor(employeeScheduleRepository) {
        this.employeeScheduleRepository = employeeScheduleRepository;
    }
    async execute(id, updates) {
        const schedule = await this.employeeScheduleRepository.findById(id);
        if (!schedule) {
            throw new common_1.NotFoundException(`Employee schedule with id ${id} not found`);
        }
        const updated = new employee_schedule_entity_1.EmployeeScheduleEntity(schedule.id, schedule.employeeId, updates.workAddress ?? schedule.workAddress, updates.startDate ?? schedule.startDate, updates.endDate ?? schedule.endDate, updates.replaced ?? schedule.replaced);
        return this.employeeScheduleRepository.update(updated);
    }
};
exports.UpdateEmployeeScheduleUsecase = UpdateEmployeeScheduleUsecase;
exports.UpdateEmployeeScheduleUsecase = UpdateEmployeeScheduleUsecase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(employee_schedule_repository_interface_1.EMPLOYEE_SCHEDULE_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], UpdateEmployeeScheduleUsecase);
//# sourceMappingURL=update-employee-schedule.usecase.js.map