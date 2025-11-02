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
exports.SbEmployeeScheduleRepository = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
const employee_schedule_mapper_1 = require("../mapper/employee-schedule.mapper");
let SbEmployeeScheduleRepository = class SbEmployeeScheduleRepository {
    constructor(prismaService) {
        this.prismaService = prismaService;
    }
    async findById(id) {
        const schedule = await this.prismaService.employee_schedule.findUnique({
            where: { id },
        });
        return schedule ? employee_schedule_mapper_1.EmployeeScheduleMapper.toDomain(schedule) : null;
    }
    async findByEmployeeId(employeeId) {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { employee_id: employeeId },
        });
        return schedules.map(employee_schedule_mapper_1.EmployeeScheduleMapper.toDomain);
    }
    async findAll() {
        const schedules = await this.prismaService.employee_schedule.findMany();
        return schedules.map(employee_schedule_mapper_1.EmployeeScheduleMapper.toDomain);
    }
    async create(schedule) {
        const created = await this.prismaService.employee_schedule.create({
            data: employee_schedule_mapper_1.EmployeeScheduleMapper.toPrismaCreate(schedule),
        });
        return employee_schedule_mapper_1.EmployeeScheduleMapper.toDomain(created);
    }
    async update(schedule) {
        const updated = await this.prismaService.employee_schedule.update({
            where: { id: schedule.id },
            data: employee_schedule_mapper_1.EmployeeScheduleMapper.toPrismaUpdate(schedule),
        });
        return employee_schedule_mapper_1.EmployeeScheduleMapper.toDomain(updated);
    }
    async delete(id) {
        await this.prismaService.employee_schedule.delete({
            where: { id },
        });
    }
};
exports.SbEmployeeScheduleRepository = SbEmployeeScheduleRepository;
exports.SbEmployeeScheduleRepository = SbEmployeeScheduleRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SbEmployeeScheduleRepository);
//# sourceMappingURL=sb.employee-schedule.repository.js.map