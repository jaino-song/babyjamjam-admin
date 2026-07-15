import { Injectable } from "@nestjs/common";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeMapper } from "infrastructure/database/mapper/employee.mapper";
import { normalizePhone } from "application/utils/normalize-phone";

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

    async findById(branchid: string, id: number): Promise<EmployeeEntity | null> {
        const employee = await this.prismaService.employee.findFirst({
            where: { id, branchId: branchid },
        });
        return employee ? EmployeeMapper.toDomain(employee) : null;
    }

    async findByPhone(branchid: string, normalizedPhone: string): Promise<EmployeeEntity | null> {
        const candidates = await this.prismaService.employee.findMany({
            where: { branchId: branchid },
            select: { id: true, phone: true },
        });
        const matched = candidates.find(
            (row) => normalizePhone(row.phone) === normalizedPhone,
        );
        if (!matched) return null;
        return this.findById(branchid, matched.id);
    }

    async create(branchid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        const data = EmployeeMapper.toPrismaCreate(employee);
        const id = data.id > 0 ? data.id : await this.getNextEmployeeId();
        const created = await this.prismaService.employee.create({
            data: { ...data, id, branchId: branchid },
        });
        return EmployeeMapper.toDomain(created);
    }

    async update(branchid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        const result = await this.prismaService.employee.updateMany({
            where: { id: employee.id, branchId: branchid },
            data: EmployeeMapper.toPrismaUpdate(employee),
        });
        if (result.count === 0) {
            throw new Error("Employee not found for branch");
        }
        const updated = await this.prismaService.employee.findFirst({
            where: { id: employee.id, branchId: branchid },
        });
        if (!updated) {
            throw new Error("Employee not found after update");
        }
        return EmployeeMapper.toDomain(updated);
    }

    async delete(branchid: string, id: number): Promise<void> {
        const result = await this.prismaService.employee.deleteMany({
            where: { id, branchId: branchid },
        });
        if (result.count === 0) {
            throw new Error("Employee not found for branch");
        }
    }

    async findAll(branchid: string): Promise<EmployeeEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const employees = await this.prismaService.employee.findMany({
            where: { branchId: branchid },
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

    async findByWorkArea(branchid: string, workArea: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { workArea: { has: workArea }, branchId: branchid },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByGrade(branchid: string, grade: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: {
                grade,
                branchId: branchid,
            },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByOpenToNextWork(branchid: string, openToNextWork: boolean): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { openToNextWork: openToNextWork, branchId: branchid },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByRegisteredDate(branchid: string, registeredDate: Date): Promise<EmployeeEntity[]> {
        const start = new Date(registeredDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(registeredDate);
        end.setHours(23, 59, 59, 999);

        const employees = await this.prismaService.employee.findMany({
            where: {
                branchId: branchid,
                companyRegisteredDate: {
                    gte: start,
                    lte: end,
                },
            },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByRegisteredDateRange(
        branchid: string,
        startDate: Date,
        endDate: Date
    ): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: {
                branchId: branchid,
                companyRegisteredDate: {
                    gte: startDate,
                    lte: endDate,
                },
            },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async changeOpenToNextWork(
        branchid: string,
        id: number,
        openToNextWork: boolean
    ): Promise<void> {
        const result = await this.prismaService.employee.updateMany({
            where: { id, branchId: branchid },
            data: { openToNextWork: openToNextWork },
        });
        if (result.count === 0) {
            throw new Error("Employee not found for branch");
        }
    }

    async findAllOpenToNextWork(branchid: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { openToNextWork: true, branchId: branchid },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }
}
