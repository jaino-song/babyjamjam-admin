import { Injectable } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeScheduleMapper } from "infrastructure/database/mapper/employee-schedule.mapper";

@Injectable()
export class SbEmployeeScheduleRepository implements IEmployeeScheduleRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(organizationid: string, id: number): Promise<EmployeeScheduleEntity | null> {
        const schedule = await this.prismaService.employee_schedule.findFirst({
            where: { id, organizationId: organizationid },
        });
        return schedule ? EmployeeScheduleMapper.toDomain(schedule) : null;
    }

    async findByClientId(organizationid: string, clientId: number): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { clientId: clientId, organizationId: organizationid },
            orderBy: { id: 'desc' },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async findByPrimaryEmployeeId(
        organizationid: string,
        primaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { primaryEmployeeId: primaryEmployeeId, organizationId: organizationid },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async findBySecondaryEmployeeId(
        organizationid: string,
        secondaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { secondaryEmployeeId: secondaryEmployeeId, organizationId: organizationid },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async findAll(organizationid: string): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { organizationId: organizationid },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async create(organizationid: string, schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity> {
        const created = await this.prismaService.employee_schedule.create({
            data: {
                ...EmployeeScheduleMapper.toPrismaCreate(schedule),
                organizationId: organizationid,
            },
        });
        return EmployeeScheduleMapper.toDomain(created);
    }

    async update(organizationid: string, schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity> {
        const result = await this.prismaService.employee_schedule.updateMany({
            where: { id: schedule.id, organizationId: organizationid },
            data: EmployeeScheduleMapper.toPrismaUpdate(schedule),
        });
        if (result.count === 0) {
            throw new Error("Employee schedule not found for organization");
        }
        const updated = await this.prismaService.employee_schedule.findFirst({
            where: { id: schedule.id, organizationId: organizationid },
        });
        if (!updated) {
            throw new Error("Employee schedule not found after update");
        }
        return EmployeeScheduleMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: number): Promise<void> {
        const result = await this.prismaService.employee_schedule.deleteMany({
            where: { id, organizationId: organizationid },
        });
        if (result.count === 0) {
            throw new Error("Employee schedule not found for organization");
        }
    }
}
