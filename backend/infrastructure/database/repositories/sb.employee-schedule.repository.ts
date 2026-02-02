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
            where: { id, organization_id: organizationid },
        });
        return schedule ? EmployeeScheduleMapper.toDomain(schedule) : null;
    }

    async findByClientId(organizationid: string, clientId: number): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { client_id: clientId, organization_id: organizationid },
            orderBy: { id: 'desc' },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async findByPrimaryEmployeeId(
        organizationid: string,
        primaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { primary_employee_id: primaryEmployeeId, organization_id: organizationid },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async findBySecondaryEmployeeId(
        organizationid: string,
        secondaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { secondary_employee_id: secondaryEmployeeId, organization_id: organizationid },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async findAll(organizationid: string): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { organization_id: organizationid },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async create(organizationid: string, schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity> {
        const created = await this.prismaService.employee_schedule.create({
            data: {
                ...EmployeeScheduleMapper.toPrismaCreate(schedule),
                organization_id: organizationid,
            },
        });
        return EmployeeScheduleMapper.toDomain(created);
    }

    async update(organizationid: string, schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity> {
        const updated = await this.prismaService.employee_schedule.update({
            where: { id: schedule.id, organization_id: organizationid },
            data: EmployeeScheduleMapper.toPrismaUpdate(schedule),
        });
        return EmployeeScheduleMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: number): Promise<void> {
        await this.prismaService.employee_schedule.delete({
            where: { id, organization_id: organizationid },
        });
    }
}
