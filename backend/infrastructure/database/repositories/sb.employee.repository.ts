import { Injectable } from "@nestjs/common";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeMapper } from "infrastructure/database/mapper/employee.mapper";

@Injectable()
export class SbEmployeeRepository implements IEmployeeRepository {
    constructor(private readonly prismaService: PrismaService) {}

    private async getNextEmployeeId(): Promise<number> {
        const lastEmployee = await this.prismaService.employee.findFirst({
            orderBy: { id: "desc" },
            select: { id: true },
        });
        return lastEmployee ? lastEmployee.id + 1 : 1;
    }

    async findById(organizationid: string, id: number): Promise<EmployeeEntity | null> {
        const employee = await this.prismaService.employee.findFirst({
            where: { id, organizationId: organizationid },
        });
        return employee ? EmployeeMapper.toDomain(employee) : null;
    }

    async create(organizationid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        const data = EmployeeMapper.toPrismaCreate(employee);
        const id = data.id > 0 ? data.id : await this.getNextEmployeeId();
        const created = await this.prismaService.employee.create({
            data: { ...data, id, organizationId: organizationid },
        });
        return EmployeeMapper.toDomain(created);
    }

    async update(organizationid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        const updated = await this.prismaService.employee.update({
            where: { id: employee.id, organizationId: organizationid },
            data: EmployeeMapper.toPrismaUpdate(employee),
        });
        return EmployeeMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: number): Promise<void> {
        await this.prismaService.employee.delete({
            where: { id, organizationId: organizationid },
        });
    }

    async findAll(organizationid: string): Promise<EmployeeEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const employees = await this.prismaService.employee.findMany({
            where: { organizationId: organizationid },
            include: {
                primaryEmployeeSchedules: {
                    where: {
                        startDate: { lte: today },
                        endDate: { gte: today },
                        replaced: false,
                    },
                    take: 1,
                },
                secondaryEmployeeSchedules: {
                    where: {
                        startDate: { lte: today },
                        endDate: { gte: today },
                        replaced: false,
                    },
                    take: 1,
                },
            },
        });

        return employees.map((emp) => {
            const entity = EmployeeMapper.toDomain(emp);

            if (!entity.openToNextWork) {
                entity.status = "unavailable";
            } else {
                const hasPrimarySchedule =
                    emp.primaryEmployeeSchedules.length > 0;
                const hasSecondarySchedule =
                    emp.secondaryEmployeeSchedules.length > 0;
                entity.status = hasPrimarySchedule || hasSecondarySchedule ? "working" : "available";
            }

            return entity;
        });
    }

    async findByWorkArea(organizationid: string, workArea: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { workArea: { has: workArea }, organizationId: organizationid },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByGrade(organizationid: string, grade: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: {
                grade,
                organizationId: organizationid,
            },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByOpenToNextWork(organizationid: string, openToNextWork: boolean): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { openToNextWork: openToNextWork, organizationId: organizationid },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByRegisteredDate(organizationid: string, registeredDate: Date): Promise<EmployeeEntity[]> {
        const start = new Date(registeredDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(registeredDate);
        end.setHours(23, 59, 59, 999);

        const employees = await this.prismaService.employee.findMany({
            where: {
                organizationId: organizationid,
                companyRegisteredDate: {
                    gte: start,
                    lte: end,
                },
            },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByRegisteredDateRange(
        organizationid: string,
        startDate: Date,
        endDate: Date
    ): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: {
                organizationId: organizationid,
                companyRegisteredDate: {
                    gte: startDate,
                    lte: endDate,
                },
            },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async changeOpenToNextWork(
        organizationid: string,
        id: number,
        openToNextWork: boolean
    ): Promise<void> {
        await this.prismaService.employee.update({
            where: { id, organizationId: organizationid },
            data: { openToNextWork: openToNextWork },
        });
    }

    async findAllOpenToNextWork(organizationid: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { openToNextWork: true, organizationId: organizationid },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }
}
