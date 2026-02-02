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
            where: { id, organization_id: organizationid },
        });
        return employee ? EmployeeMapper.toDomain(employee) : null;
    }

    async create(organizationid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        const data = EmployeeMapper.toPrismaCreate(employee);
        const id = data.id > 0 ? data.id : await this.getNextEmployeeId();
        const created = await this.prismaService.employee.create({
            data: { ...data, id, organization_id: organizationid },
        });
        return EmployeeMapper.toDomain(created);
    }

    async update(organizationid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        const updated = await this.prismaService.employee.update({
            where: { id: employee.id, organization_id: organizationid },
            data: EmployeeMapper.toPrismaUpdate(employee),
        });
        return EmployeeMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: number): Promise<void> {
        await this.prismaService.employee.delete({
            where: { id, organization_id: organizationid },
        });
    }

    async findAll(organizationid: string): Promise<EmployeeEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const employees = await this.prismaService.employee.findMany({
            where: { organization_id: organizationid },
            include: {
                employee_schedule_employee_schedule_primary_employee_idToemployee: {
                    where: {
                        start_date: { lte: today },
                        end_date: { gte: today },
                        replaced: false,
                    },
                    take: 1,
                },
                employee_schedule_employee_schedule_secondary_employee_idToemployee: {
                    where: {
                        start_date: { lte: today },
                        end_date: { gte: today },
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
                    emp.employee_schedule_employee_schedule_primary_employee_idToemployee.length > 0;
                const hasSecondarySchedule =
                    emp.employee_schedule_employee_schedule_secondary_employee_idToemployee.length > 0;
                entity.status = hasPrimarySchedule || hasSecondarySchedule ? "working" : "available";
            }

            return entity;
        });
    }

    async findByWorkArea(organizationid: string, workArea: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { work_area: { has: workArea }, organization_id: organizationid },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByGrade(organizationid: string, grade: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { grade, organization_id: organizationid },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByOpenToNextWork(organizationid: string, openToNextWork: boolean): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { open_to_next_work: openToNextWork, organization_id: organizationid },
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
                organization_id: organizationid,
                company_registered_date: {
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
                organization_id: organizationid,
                company_registered_date: {
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
            where: { id, organization_id: organizationid },
            data: { open_to_next_work: openToNextWork },
        });
    }

    async findAllOpenToNextWork(organizationid: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { open_to_next_work: true, organization_id: organizationid },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }
}
