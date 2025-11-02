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
exports.EmployeeService = void 0;
const common_1 = require("@nestjs/common");
const employee_1 = require("../usecases/employee");
let EmployeeService = class EmployeeService {
    constructor(createEmployeeUsecase, findEmployeeByIdUsecase, updateEmployeeUsecase, deleteEmployeeUsecase, listEmployeesUsecase, listEmployeesByWorkAreaUsecase, listEmployeesByGradeUsecase, listEmployeesByOpenStatusUsecase, listEmployeesByRegisteredDateUsecase, listEmployeesByRegisteredDateRangeUsecase, changeEmployeeOpenStatusUsecase, listEmployeesOpenToNextWorkUsecase) {
        this.createEmployeeUsecase = createEmployeeUsecase;
        this.findEmployeeByIdUsecase = findEmployeeByIdUsecase;
        this.updateEmployeeUsecase = updateEmployeeUsecase;
        this.deleteEmployeeUsecase = deleteEmployeeUsecase;
        this.listEmployeesUsecase = listEmployeesUsecase;
        this.listEmployeesByWorkAreaUsecase = listEmployeesByWorkAreaUsecase;
        this.listEmployeesByGradeUsecase = listEmployeesByGradeUsecase;
        this.listEmployeesByOpenStatusUsecase = listEmployeesByOpenStatusUsecase;
        this.listEmployeesByRegisteredDateUsecase = listEmployeesByRegisteredDateUsecase;
        this.listEmployeesByRegisteredDateRangeUsecase = listEmployeesByRegisteredDateRangeUsecase;
        this.changeEmployeeOpenStatusUsecase = changeEmployeeOpenStatusUsecase;
        this.listEmployeesOpenToNextWorkUsecase = listEmployeesOpenToNextWorkUsecase;
    }
    create(params) {
        return this.createEmployeeUsecase.execute(params.name, params.workArea, params.phone, params.grade, params.openToNextWork, params.registeredDate ? new Date(params.registeredDate) : undefined);
    }
    findById(id) {
        return this.findEmployeeByIdUsecase.execute(id);
    }
    update(id, params) {
        return this.updateEmployeeUsecase.execute(id, params);
    }
    delete(id) {
        return this.deleteEmployeeUsecase.execute(id);
    }
    findAll() {
        return this.listEmployeesUsecase.execute();
    }
    findByWorkArea(workArea) {
        return this.listEmployeesByWorkAreaUsecase.execute(workArea);
    }
    findByGrade(grade) {
        return this.listEmployeesByGradeUsecase.execute(grade);
    }
    findByOpenStatus(openToNextWork) {
        return this.listEmployeesByOpenStatusUsecase.execute(openToNextWork);
    }
    findByRegisteredDate(date) {
        return this.listEmployeesByRegisteredDateUsecase.execute(date);
    }
    findByRegisteredDateRange(start, end) {
        return this.listEmployeesByRegisteredDateRangeUsecase.execute(start, end);
    }
    changeOpenStatus(id, open) {
        return this.changeEmployeeOpenStatusUsecase.execute(id, open);
    }
    findAllOpenToNextWork() {
        return this.listEmployeesOpenToNextWorkUsecase.execute();
    }
};
exports.EmployeeService = EmployeeService;
exports.EmployeeService = EmployeeService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [employee_1.CreateEmployeeUsecase,
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
        employee_1.ListEmployeesOpenToNextWorkUsecase])
], EmployeeService);
//# sourceMappingURL=employee.service.js.map