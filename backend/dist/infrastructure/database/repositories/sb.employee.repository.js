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
exports.SbEmployeeRepository = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
const employee_mapper_1 = require("../mapper/employee.mapper");
let SbEmployeeRepository = class SbEmployeeRepository {
    constructor(prismaService) {
        this.prismaService = prismaService;
    }
    async findById(id) {
        const employee = await this.prismaService.employee.findUnique({
            where: { id },
        });
        return employee ? employee_mapper_1.EmployeeMapper.toDomain(employee) : null;
    }
    async create(employee) {
        const created = await this.prismaService.employee.create({
            data: employee_mapper_1.EmployeeMapper.toPrismaCreate(employee),
        });
        return employee_mapper_1.EmployeeMapper.toDomain(created);
    }
    async update(employee) {
        const updated = await this.prismaService.employee.update({
            where: { id: employee.id },
            data: employee_mapper_1.EmployeeMapper.toPrismaUpdate(employee),
        });
        return employee_mapper_1.EmployeeMapper.toDomain(updated);
    }
    async delete(id) {
        await this.prismaService.employee.delete({
            where: { id },
        });
    }
    async findAll() {
        const employees = await this.prismaService.employee.findMany();
        return employees.map((employee) => employee_mapper_1.EmployeeMapper.toDomain(employee));
    }
    async findByWorkArea(workArea) {
        const employees = await this.prismaService.employee.findMany({
            where: { work_area: workArea },
        });
        return employees.map((employee) => employee_mapper_1.EmployeeMapper.toDomain(employee));
    }
    async findByGrade(grade) {
        const employees = await this.prismaService.employee.findMany({
            where: { grade },
        });
        return employees.map((employee) => employee_mapper_1.EmployeeMapper.toDomain(employee));
    }
    async findByOpenToNextWork(openToNextWork) {
        const employees = await this.prismaService.employee.findMany({
            where: { open_to_next_work: openToNextWork },
        });
        return employees.map((employee) => employee_mapper_1.EmployeeMapper.toDomain(employee));
    }
    async findByRegisteredDate(registeredDate) {
        const start = new Date(registeredDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(registeredDate);
        end.setHours(23, 59, 59, 999);
        const employees = await this.prismaService.employee.findMany({
            where: {
                company_registered_date: {
                    gte: start,
                    lte: end,
                },
            },
        });
        return employees.map((employee) => employee_mapper_1.EmployeeMapper.toDomain(employee));
    }
    async findByRegisteredDateRange(startDate, endDate) {
        const employees = await this.prismaService.employee.findMany({
            where: {
                company_registered_date: {
                    gte: startDate,
                    lte: endDate,
                },
            },
        });
        return employees.map((employee) => employee_mapper_1.EmployeeMapper.toDomain(employee));
    }
    async changeOpenToNextWork(id, openToNextWork) {
        await this.prismaService.employee.update({
            where: { id },
            data: { open_to_next_work: openToNextWork },
        });
    }
    async findAllOpenToNextWork() {
        const employees = await this.prismaService.employee.findMany({
            where: { open_to_next_work: true },
        });
        return employees.map((employee) => employee_mapper_1.EmployeeMapper.toDomain(employee));
    }
};
exports.SbEmployeeRepository = SbEmployeeRepository;
exports.SbEmployeeRepository = SbEmployeeRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SbEmployeeRepository);
//# sourceMappingURL=sb.employee.repository.js.map