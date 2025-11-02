"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeModule = void 0;
const common_1 = require("@nestjs/common");
const employee_1 = require("../application/usecases/employee");
const employee_service_1 = require("../application/services/employee.service");
const employee_repository_interface_1 = require("../domain/repositories/employee.repository.interface");
const prisma_service_1 = require("../infrastructure/database/prisma.service");
const sb_employee_repository_1 = require("../infrastructure/database/repositories/sb.employee.repository");
const employee_controller_1 = require("../interface/controllers/employee.controller");
let EmployeeModule = class EmployeeModule {
};
exports.EmployeeModule = EmployeeModule;
exports.EmployeeModule = EmployeeModule = __decorate([
    (0, common_1.Module)({
        controllers: [employee_controller_1.EmployeeController],
        providers: [
            employee_1.CreateEmployeeUsecase,
            employee_1.FindEmployeeByIdUsecase,
            employee_1.UpdateEmployeeUsecase,
            employee_1.DeleteEmployeeUsecase,
            employee_1.ListEmployeesUsecase,
            employee_1.ListEmployeesByWorkAreaUsecase,
            employee_1.ListEmployeesByGradeUsecase,
            employee_1.ListEmployeesByOpenStatusUsecase,
            employee_1.ListEmployeesByRegisteredDateUsecase,
            employee_1.ListEmployeesByRegisteredDateRangeUsecase,
            employee_1.ChangeEmployeeOpenStatusUsecase,
            employee_1.ListEmployeesOpenToNextWorkUsecase,
            employee_service_1.EmployeeService,
            prisma_service_1.PrismaService,
            {
                provide: employee_repository_interface_1.EMPLOYEE_REPOSITORY,
                useClass: sb_employee_repository_1.SbEmployeeRepository,
            },
        ],
        exports: [employee_service_1.EmployeeService],
    })
], EmployeeModule);
//# sourceMappingURL=employee.module.js.map