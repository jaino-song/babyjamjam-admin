import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import {
    assertEmployeeAssignmentEligibility,
    assertEmployeeAssignmentShape,
    type EmployeeAssignmentCandidate,
} from "application/policies/employee-assignment-eligibility.policy";
import {
    assertEmployeeScheduleWriteIsAvailable,
} from "application/policies/employee-schedule-invariants.policy";
import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import {
    EmployeeScheduleDateRangeError,
    EmployeeScheduleEntity,
    EmployeeScheduleRoleError,
} from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

type UpdateEmployeeScheduleParams = {
    primaryEmployeeId?: number;
    secondaryEmployeeId?: number | null;
    workAddress?: string;
    startDate?: Date;
    endDate?: Date;
    replaced?: boolean;
};

@Injectable()
export class UpdateEmployeeScheduleUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
        @Optional()
        private readonly prismaService?: PrismaService,
    ) {}

    async execute(
        branchid: string,
        id: number,
        updates: UpdateEmployeeScheduleParams,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeScheduleEntity> {
        const persist = async (tx?: Prisma.TransactionClient): Promise<EmployeeScheduleEntity> => {
            const schedule = await this.employeeScheduleRepository.findById(branchid, id, tx);
            if (!schedule) {
                throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            }

            const primaryEmployeeId = updates.primaryEmployeeId ?? schedule.primaryEmployeeId;
            const secondaryEmployeeId = updates.secondaryEmployeeId !== undefined
                ? updates.secondaryEmployeeId
                : schedule.secondaryEmployeeId;
            assertEmployeeAssignmentShape(primaryEmployeeId, secondaryEmployeeId);

            let updated: EmployeeScheduleEntity;
            try {
                updated = new EmployeeScheduleEntity(
                    schedule.id,
                    schedule.clientId, // Client cannot be changed
                    primaryEmployeeId,
                    secondaryEmployeeId,
                    updates.workAddress ?? schedule.workAddress,
                    updates.startDate ?? schedule.startDate,
                    updates.endDate ?? schedule.endDate,
                    updates.replaced ?? schedule.replaced,
                );
            } catch (error) {
                if (error instanceof EmployeeScheduleDateRangeError) {
                    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                        pointer: "/endDate",
                        code: "INVALID_VALUE",
                        detail: "시작일은 종료일보다 늦을 수 없어요.",
                        location: "body",
                    }));
                }
                if (error instanceof EmployeeScheduleRoleError) {
                    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                        pointer: "/secondaryEmployeeId",
                        code: "INVALID_FORMAT",
                        detail: "주담당과 부담당은 같은 직원일 수 없어요.",
                        location: "body",
                    }));
                }
                throw error;
            }

            // The transaction seam is optional only for legacy unit callers.
            // The application module always supplies Prisma, so production
            // updates lock the client/employees and validate eligibility and
            // overlap before the repository write.
            if (tx && tx.employee?.findMany) {
                const existingCase = tx.service_record_case?.findUnique
                    ? await tx.service_record_case.findUnique({
                        where: { clientId: updated.clientId },
                        select: { id: true },
                    })
                    : null;
                await lockServiceRecordWriteSet(tx, {
                    branchId: branchid,
                    clientId: updated.clientId,
                    caseId: existingCase?.id,
                    scheduleIds: [schedule.id],
                    employeeIds: [
                        schedule.primaryEmployeeId,
                        schedule.secondaryEmployeeId,
                        updated.primaryEmployeeId,
                        updated.secondaryEmployeeId,
                    ],
                });
                // Re-read the row after client/employee locks. If another
                // writer changed the owner or assignment target between the
                // discovery read and lock acquisition, abort instead of
                // applying this stale update to a different target set.
                const lockedSchedule = await this.employeeScheduleRepository.findById(branchid, id, tx);
                if (!lockedSchedule) {
                    throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                }
                if (
                    lockedSchedule.clientId !== schedule.clientId
                    || lockedSchedule.primaryEmployeeId !== schedule.primaryEmployeeId
                    || lockedSchedule.secondaryEmployeeId !== schedule.secondaryEmployeeId
                ) {
                    throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
                }
                const employeeIds = [...new Set(
                    [updated.primaryEmployeeId, updated.secondaryEmployeeId]
                        .filter((employeeId): employeeId is number => employeeId !== null),
                )];
                const employees: EmployeeAssignmentCandidate[] = await tx.employee.findMany({
                    where: {
                        id: { in: employeeIds },
                        branchId: branchid,
                    },
                    select: {
                        id: true,
                        branchId: true,
                        deletedAt: true,
                        openToNextWork: true,
                    },
                });
                const retainedEmployeeIds = new Set(
                    [schedule.primaryEmployeeId, schedule.secondaryEmployeeId]
                        .filter((employeeId): employeeId is number => employeeId !== null),
                );
                assertEmployeeAssignmentEligibility(
                    branchid,
                    updated.primaryEmployeeId,
                    updated.secondaryEmployeeId,
                    employees,
                    retainedEmployeeIds,
                );
                await assertEmployeeScheduleWriteIsAvailable(tx, updated, branchid, updated.id);
            }

            return this.employeeScheduleRepository.update(branchid, updated, tx);
        };

        if (transaction) return persist(transaction);
        if (this.prismaService) {
            return this.prismaService.$transaction((tx) => persist(tx));
        }
        return persist();
    }
}
