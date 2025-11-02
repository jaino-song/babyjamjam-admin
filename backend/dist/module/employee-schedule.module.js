"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeScheduleModule = void 0;
const common_1 = require("@nestjs/common");
const employee_schedule_1 = require("../application/usecases/employee-schedule");
const employee_schedule_repository_interface_1 = require("../domain/repositories/employee-schedule.repository.interface");
const sb_employee_schedule_repository_1 = require("../infrastructure/database/repositories/sb.employee-schedule.repository");
const prisma_service_1 = require("../infrastructure/database/prisma.service");
const employee_schedule_service_1 = require("../application/services/employee-schedule.service");
const employee_schedule_controller_1 = require("../interface/controllers/employee-schedule.controller");
let EmployeeScheduleModule = class EmployeeScheduleModule {
};
exports.EmployeeScheduleModule = EmployeeScheduleModule;
exports.EmployeeScheduleModule = EmployeeScheduleModule = __decorate([
    (0, common_1.Module)({
        controllers: [employee_schedule_controller_1.EmployeeScheduleController],
        providers: [
            employee_schedule_1.CreateEmployeeScheduleUsecase,
            employee_schedule_1.DeleteEmployeeScheduleUsecase,
            employee_schedule_1.FindEmployeeScheduleByIdUsecase,
            employee_schedule_1.ListEmployeeSchedulesByEmployeeIdUsecase,
            employee_schedule_1.ListEmployeeSchedulesUsecase,
            employee_schedule_1.UpdateEmployeeScheduleUsecase,
            employee_schedule_service_1.EmployeeScheduleService,
            prisma_service_1.PrismaService,
            {
                provide: employee_schedule_repository_interface_1.EMPLOYEE_SCHEDULE_REPOSITORY,
                useClass: sb_employee_schedule_repository_1.SbEmployeeScheduleRepository,
            },
        ],
        exports: [employee_schedule_service_1.EmployeeScheduleService],
    })
], EmployeeScheduleModule);
//# sourceMappingURL=employee-schedule.module.js.map