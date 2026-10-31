import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import { deriveEmployeeStatus, EmployeeEntity } from "domain/entities/employee.entity";
import { isoDateInKorea } from "domain/utils/business-days";
import {
    ActiveClientByEmployee,
    EmployeeWorkHistoryByEmployee,
    EmployeeRestoreProfile,
    IEmployeeRepository,
    PaginatedEmployeeWorkHistory,
} from "domain/repositories/employee.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeMapper } from "infrastructure/database/mapper/employee.mapper";
import type { Prisma } from "@prisma/client";
import { employeeAgentTargetVersion } from "domain/entities/employee-agent-target";

@Injectable()
export class SbEmployeeRepository implements IEmployeeRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(branchid: string, id: number): Promise<EmployeeEntity | null> {
        const employee = await this.prismaService.employee.findFirst({
            where: { id, branchId: branchid, deletedAt: null },
        });
        return employee ? EmployeeMapper.toDomain(employee) : null;
    }

    async findByIdForUpdate(
        branchid: string,
        id: number,
        transaction: Prisma.TransactionClient,
    ): Promise<EmployeeEntity | null> {
        await transaction.$queryRaw`
            SELECT "id"
            FROM "employee"
            WHERE "id" = ${id} AND "branch_id" = ${branchid}::uuid
            FOR UPDATE
        `;
        const employee = await transaction.employee.findFirst({
            where: { id, branchId: branchid },
        });
        return employee ? EmployeeMapper.toDomain(employee) : null;
    }

    async findByPhone(branchid: string, normalizedPhone: string): Promise<EmployeeEntity | null> {
        const employee = await this.prismaService.employee.findFirst({
            where: { branchId: branchid, phoneNormalized: normalizedPhone },
        });
        return employee ? EmployeeMapper.toDomain(employee) : null;
    }

    async create(branchid: string, employee: EmployeeEntity, transaction?: Prisma.TransactionClient): Promise<EmployeeEntity> {
        const data = EmployeeMapper.toPrismaCreate(employee);
        const created = await (transaction ?? this.prismaService).employee.create({
            data: { ...data, branchId: branchid },
        });
        return EmployeeMapper.toDomain(created);
    }

    async createOrRestore(
        branchid: string,
        employee: EmployeeEntity,
        suppliedProfile: EmployeeRestoreProfile,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeEntity & { restored: boolean }> {
        const apply = async (tx: Prisma.TransactionClient): Promise<EmployeeEntity & { restored: boolean }> => {
            // Lock by identity, not deletedAt: a waiter must re-read the winner's live row.
            await tx.$queryRaw`
                SELECT "id" FROM "employee"
                WHERE "branch_id" = ${branchid}::uuid AND "phone_normalized" = ${employee.phoneNormalized}
                FOR UPDATE
            `;
            const existing = await tx.employee.findFirst({
                where: { branchId: branchid, phoneNormalized: employee.phoneNormalized },
            });
            if (existing && !existing.deletedAt) {
                throw new ConflictException(problemBody("EMPLOYEE_PHONE_ALREADY_REGISTERED", {
                    pointer: "/phone",
                    code: "INVALID_VALUE",
                    detail: "같은 전화번호의 관리사가 이미 등록되어 있습니다.",
                    location: "body",
                }));
            }
            if (!existing) return Object.assign(await this.create(branchid, employee, tx), { restored: false });

            const restored = await tx.employee.update({
                where: { id: existing.id, branchId: branchid, deletedAt: { not: null } },
                // 복원에는 생성 기본값이 아닌 요청에서 제출한 필드만 적용한다.
                data: {
                    name: suppliedProfile.name,
                    phone: suppliedProfile.phone,
                    phoneNormalized: employee.phoneNormalized,
                    workArea: suppliedProfile.workArea,
                    grade: suppliedProfile.grade === undefined ? undefined : employee.grade,
                    openToNextWork: suppliedProfile.openToNextWork,
                    companyRegisteredDate: suppliedProfile.registeredDate,
                    birthday: suppliedProfile.birthday,
                    smsAutomationEnabled: suppliedProfile.smsAutomationEnabled,
                    deletedAt: null,
                },
            });
            return Object.assign(EmployeeMapper.toDomain(restored), { restored: true });
        };
        return transaction ? apply(transaction) : this.prismaService.$transaction(apply);
    }

    async update(branchid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        const result = await this.prismaService.employee.updateMany({
            where: { id: employee.id, branchId: branchid, deletedAt: null },
            data: EmployeeMapper.toPrismaUpdate(employee),
        });
        if (result.count === 0) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        const updated = await this.prismaService.employee.findFirst({
            where: { id: employee.id, branchId: branchid, deletedAt: null },
        });
        if (!updated) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        return EmployeeMapper.toDomain(updated);
    }

    async updateIfTargetVersion(
        branchid: string,
        id: number,
        expectedTargetVersion: string,
        updates: Parameters<IEmployeeRepository["updateIfTargetVersion"]>[3],
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeEntity | null> {
        const apply = async (tx: Prisma.TransactionClient): Promise<EmployeeEntity | null> => {
            const current = await this.findByIdForUpdate(branchid, id, tx);
            if (!current || current.deletedAt || employeeAgentTargetVersion(current) !== expectedTargetVersion) {
                return null;
            }

            current.updateProfile(
                updates.name,
                updates.workArea,
                updates.phone,
                updates.grade,
                updates.openToNextWork,
                updates.birthday,
                updates.smsAutomationEnabled,
            );
            const updated = await tx.employee.updateMany({
                where: { id, branchId: branchid, deletedAt: null },
                data: EmployeeMapper.toPrismaUpdate(current),
            });
            if (updated.count !== 1) return null;

            const row = await tx.employee.findFirst({
                where: { id, branchId: branchid, deletedAt: null },
            });
            return row ? EmployeeMapper.toDomain(row) : null;
        };

        return transaction ? apply(transaction) : this.prismaService.$transaction(apply);
    }

    async delete(branchid: string, id: number): Promise<void> {
        const result = await this.prismaService.employee.updateMany({
            where: { id, branchId: branchid, deletedAt: null },
            data: { deletedAt: new Date() },
        });
        if (result.count === 0) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
    }

    async hasActiveAssignments(branchid: string, id: number): Promise<boolean> {
        const today = new Date(`${isoDateInKorea()}T00:00:00.000Z`);
        const count = await this.prismaService.employee_schedule.count({
            where: {
                branchId: branchid,
                replaced: false,
                terminatedAt: null,
                endDate: { gte: today },
                OR: [
                    { primaryEmployeeId: id },
                    { secondaryEmployeeId: id },
                ],
            },
        });
        return count > 0;
    }

    async findActiveClientsByEmployee(branchid: string, id: number): Promise<ActiveClientByEmployee[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: {
                branchId: branchid,
                replaced: false,
                terminatedAt: null,
                endDate: { gte: today },
                OR: [
                    { primaryEmployeeId: id },
                    { secondaryEmployeeId: id },
                ],
            },
            select: {
                primaryEmployeeId: true,
                secondaryEmployeeId: true,
                client: {
                    select: {
                        id: true,
                        name: true,
                        serviceStatus: true,
                        startDate: true,
                        endDate: true,
                    },
                },
            },
            orderBy: { startDate: "asc" },
        });

        return schedules.map((schedule) => ({
            clientId: schedule.client.id,
            clientName: schedule.client.name,
            role: schedule.primaryEmployeeId === id ? "primary" : "secondary",
            startDate: schedule.client.startDate,
            endDate: schedule.client.endDate,
            serviceStatus: schedule.client.serviceStatus,
        }));
    }

    async findWorkHistoryByEmployee(
        branchid: string,
        id: number,
        page: number,
        limit: number,
    ): Promise<PaginatedEmployeeWorkHistory> {
        // employee_schedule.endDate is a PostgreSQL DATE represented at UTC midnight by Prisma.
        const today = new Date(`${isoDateInKorea()}T00:00:00.000Z`);
        const where: Prisma.employee_scheduleWhereInput = {
            branchId: branchid,
            client: { branchId: branchid },
            OR: [
                { primaryEmployeeId: id },
                { secondaryEmployeeId: id },
            ],
            // A terminated assignment is finished work even when its contracted
            // end date is still in the future, so it belongs in work history.
            AND: [{ OR: [{ replaced: true }, { terminatedAt: { not: null } }, { endDate: { lt: today } }] }],
        };
        const [schedules, total] = await Promise.all([
            this.prismaService.employee_schedule.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    primaryEmployeeId: true,
                    secondaryEmployeeId: true,
                    startDate: true,
                    endDate: true,
                    replaced: true,
                    client: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
                orderBy: [{ startDate: "desc" }, { id: "desc" }],
            }),
            this.prismaService.employee_schedule.count({ where }),
        ]);

        return {
            data: schedules.map((schedule): EmployeeWorkHistoryByEmployee => ({
                scheduleId: schedule.id,
                clientId: schedule.client.id,
                clientName: schedule.client.name,
                role: schedule.primaryEmployeeId === id ? "primary" : "secondary",
                startDate: schedule.startDate,
                endDate: schedule.endDate,
                status: schedule.replaced ? "replaced" : "completed",
            })),
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async findAll(branchid: string): Promise<EmployeeEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const employees = await this.prismaService.employee.findMany({
            where: { branchId: branchid, deletedAt: null },
            include: {
                primaryEmployeeSchedules: {
                    where: {
                        startDate: { lte: today },
                        endDate: { gte: today },
                        replaced: false,
                        terminatedAt: null,
                    },
                    take: 1,
                },
                secondaryEmployeeSchedules: {
                    where: {
                        startDate: { lte: today },
                        endDate: { gte: today },
                        replaced: false,
                        terminatedAt: null,
                    },
                    take: 1,
                },
            },
        });

        return employees.map((emp) => {
            const entity = EmployeeMapper.toDomain(emp);

            const hasActiveAssignment =
                emp.primaryEmployeeSchedules.length > 0 ||
                emp.secondaryEmployeeSchedules.length > 0;
            entity.status = deriveEmployeeStatus(
                hasActiveAssignment,
                entity.openToNextWork,
            );

            return entity;
        });
    }

    async findAllForDate(branchid: string, date: Date): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { branchId: branchid, deletedAt: null },
            include: {
                primaryEmployeeSchedules: {
                    where: {
                        startDate: { lte: date },
                        endDate: { gte: date },
                        replaced: false,
                        terminatedAt: null,
                    },
                    take: 1,
                },
                secondaryEmployeeSchedules: {
                    where: {
                        startDate: { lte: date },
                        endDate: { gte: date },
                        replaced: false,
                        terminatedAt: null,
                    },
                    take: 1,
                },
            },
        });

        return employees.map((emp) => {
            const entity = EmployeeMapper.toDomain(emp);

            const hasActiveAssignment =
                emp.primaryEmployeeSchedules.length > 0 ||
                emp.secondaryEmployeeSchedules.length > 0;
            entity.status = deriveEmployeeStatus(
                hasActiveAssignment,
                entity.openToNextWork,
            );

            return entity;
        });
    }

    async findByIdForDate(branchid: string, id: number, date: Date): Promise<EmployeeEntity | null> {
        const employee = await this.prismaService.employee.findFirst({
            where: { id, branchId: branchid, deletedAt: null },
            include: {
                primaryEmployeeSchedules: {
                    where: {
                        startDate: { lte: date },
                        endDate: { gte: date },
                        replaced: false,
                        terminatedAt: null,
                    },
                    take: 1,
                },
                secondaryEmployeeSchedules: {
                    where: {
                        startDate: { lte: date },
                        endDate: { gte: date },
                        replaced: false,
                        terminatedAt: null,
                    },
                    take: 1,
                },
            },
        });
        if (!employee) return null;

        const entity = EmployeeMapper.toDomain(employee);
        const hasActiveAssignment =
            employee.primaryEmployeeSchedules.length > 0 ||
            employee.secondaryEmployeeSchedules.length > 0;
        entity.status = deriveEmployeeStatus(hasActiveAssignment, entity.openToNextWork);
        return entity;
    }

    async findNamesByIds(branchid: string, ids: number[]): Promise<Array<{ id: number; name: string }>> {
        if (ids.length === 0) return [];
        return this.prismaService.employee.findMany({
            where: { branchId: branchid, id: { in: ids } },
            select: { id: true, name: true },
        });
    }

    async findByWorkArea(branchid: string, workArea: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { workArea: { has: workArea }, branchId: branchid, deletedAt: null },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByGrade(branchid: string, grade: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: {
                grade,
                branchId: branchid,
                deletedAt: null,
            },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByOpenToNextWork(branchid: string, openToNextWork: boolean): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { openToNextWork: openToNextWork, branchId: branchid, deletedAt: null },
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
                deletedAt: null,
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
                deletedAt: null,
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
            where: { id, branchId: branchid, deletedAt: null },
            data: { openToNextWork: openToNextWork },
        });
        if (result.count === 0) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
    }

    async findAllOpenToNextWork(branchid: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { openToNextWork: true, branchId: branchid, deletedAt: null },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }
}
