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
exports.ChangeEmployeeOpenStatusUsecase = void 0;
const common_1 = require("@nestjs/common");
const employee_repository_interface_1 = require("../../../domain/repositories/employee.repository.interface");
let ChangeEmployeeOpenStatusUsecase = class ChangeEmployeeOpenStatusUsecase {
    constructor(employeeRepository) {
        this.employeeRepository = employeeRepository;
    }
    async execute(id, openToNextWork) {
        const employee = await this.employeeRepository.findById(id);
        if (!employee) {
            throw new common_1.NotFoundException(`Employee with id ${id} not found`);
        }
        employee.updateOpenToNextWork(openToNextWork);
        return this.employeeRepository.update(employee);
    }
};
exports.ChangeEmployeeOpenStatusUsecase = ChangeEmployeeOpenStatusUsecase;
exports.ChangeEmployeeOpenStatusUsecase = ChangeEmployeeOpenStatusUsecase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(employee_repository_interface_1.EMPLOYEE_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], ChangeEmployeeOpenStatusUsecase);
//# sourceMappingURL=change-employee-open-status.usecase.js.map