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
exports.EmployeeScheduleController = void 0;
const common_1 = require("@nestjs/common");
const employee_schedule_service_1 = require("../../application/services/employee-schedule.service");
const employee_schedule_dto_1 = require("../dto/employee-schedule.dto");
let EmployeeScheduleController = class EmployeeScheduleController {
    constructor(employeeScheduleService) {
        this.employeeScheduleService = employeeScheduleService;
    }
    create(dto) {
        return this.employeeScheduleService.create({
            employeeId: dto.employeeId,
            workAddress: dto.workAddress,
            startDate: dto.startDate,
            endDate: dto.endDate,
            replaced: dto.replaced,
        });
    }
    findAll() {
        return this.employeeScheduleService.findAll();
    }
    findByEmployee(employeeId) {
        return this.employeeScheduleService.findByEmployeeId(Number(employeeId));
    }
    findById(id) {
        return this.employeeScheduleService.findById(Number(id));
    }
    update(id, dto) {
        return this.employeeScheduleService.update(Number(id), {
            workAddress: dto.workAddress,
            startDate: dto.startDate,
            endDate: dto.endDate,
            replaced: dto.replaced,
        });
    }
    delete(id) {
        return this.employeeScheduleService.delete(Number(id));
    }
};
exports.EmployeeScheduleController = EmployeeScheduleController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [employee_schedule_dto_1.CreateEmployeeScheduleDto]),
    __metadata("design:returntype", void 0)
], EmployeeScheduleController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], EmployeeScheduleController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)("employee"),
    __param(0, (0, common_1.Query)("employeeId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeeScheduleController.prototype, "findByEmployee", null);
__decorate([
    (0, common_1.Get)("id"),
    __param(0, (0, common_1.Query)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeeScheduleController.prototype, "findById", null);
__decorate([
    (0, common_1.Patch)(),
    __param(0, (0, common_1.Query)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, employee_schedule_dto_1.UpdateEmployeeScheduleDto]),
    __metadata("design:returntype", void 0)
], EmployeeScheduleController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(),
    __param(0, (0, common_1.Query)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeeScheduleController.prototype, "delete", null);
exports.EmployeeScheduleController = EmployeeScheduleController = __decorate([
    (0, common_1.Controller)("employee-schedules"),
    __metadata("design:paramtypes", [employee_schedule_service_1.EmployeeScheduleService])
], EmployeeScheduleController);
//# sourceMappingURL=employee-schedule.controller.js.map