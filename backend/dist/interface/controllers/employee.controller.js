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
exports.EmployeeController = void 0;
const common_1 = require("@nestjs/common");
const employee_service_1 = require("../../application/services/employee.service");
const employee_dto_1 = require("../dto/employee.dto");
let EmployeeController = class EmployeeController {
    constructor(employeeService) {
        this.employeeService = employeeService;
    }
    create(dto) {
        return this.employeeService.create(dto);
    }
    findAll() {
        return this.employeeService.findAll();
    }
    findByWorkArea(workArea) {
        return this.employeeService.findByWorkArea(workArea);
    }
    findByGrade(grade) {
        return this.employeeService.findByGrade(grade);
    }
    findByOpenStatus(openToNextWork) {
        const flag = openToNextWork === undefined ? true : openToNextWork === "true";
        return this.employeeService.findByOpenStatus(flag);
    }
    findByRegisteredDate(date) {
        return this.employeeService.findByRegisteredDate(new Date(date));
    }
    findByRegisteredDateRange(query) {
        return this.employeeService.findByRegisteredDateRange(new Date(query.startDate), new Date(query.endDate));
    }
    findAllOpenToNextWork() {
        return this.employeeService.findAllOpenToNextWork();
    }
    findById(id) {
        return this.employeeService.findById(Number(id));
    }
    changeOpenStatus(id, dto) {
        return this.employeeService.changeOpenStatus(Number(id), dto.openToNextWork);
    }
    update(id, dto) {
        return this.employeeService.update(Number(id), dto);
    }
    delete(id) {
        return this.employeeService.delete(Number(id));
    }
};
exports.EmployeeController = EmployeeController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [employee_dto_1.CreateEmployeeDto]),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)("work-area"),
    __param(0, (0, common_1.Query)("workArea")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "findByWorkArea", null);
__decorate([
    (0, common_1.Get)("grade"),
    __param(0, (0, common_1.Query)("grade")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "findByGrade", null);
__decorate([
    (0, common_1.Get)("open-status"),
    __param(0, (0, common_1.Query)("openToNextWork")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "findByOpenStatus", null);
__decorate([
    (0, common_1.Get)("registered-date"),
    __param(0, (0, common_1.Query)("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "findByRegisteredDate", null);
__decorate([
    (0, common_1.Get)("registered-range"),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [employee_dto_1.EmployeesByRegisteredRangeDto]),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "findByRegisteredDateRange", null);
__decorate([
    (0, common_1.Get)("open-to-next-work"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "findAllOpenToNextWork", null);
__decorate([
    (0, common_1.Get)("id"),
    __param(0, (0, common_1.Query)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "findById", null);
__decorate([
    (0, common_1.Patch)("open-status"),
    __param(0, (0, common_1.Query)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, employee_dto_1.ChangeEmployeeOpenStatusDto]),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "changeOpenStatus", null);
__decorate([
    (0, common_1.Patch)(),
    __param(0, (0, common_1.Query)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, employee_dto_1.UpdateEmployeeDto]),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(),
    __param(0, (0, common_1.Query)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeeController.prototype, "delete", null);
exports.EmployeeController = EmployeeController = __decorate([
    (0, common_1.Controller)("employees"),
    __metadata("design:paramtypes", [employee_service_1.EmployeeService])
], EmployeeController);
//# sourceMappingURL=employee.controller.js.map