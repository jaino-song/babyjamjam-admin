import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import {
    RetentionDeleteBlockedError,
    SCHEDULE_RETENTION_BLOCKED,
    SCHEDULE_RETENTION_BLOCKED_MESSAGE,
    ScopedDeleteNotFoundError,
} from "domain/errors/retention-delete-blocked.error";

@Injectable()
export class DeleteEmployeeScheduleUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
    ) {}

    async execute(
        branchid: string,
        id: number,
        transaction?: Prisma.TransactionClient,
    ): Promise<void> {
        const persist = async (tx?: Prisma.TransactionClient): Promise<void> => {
            const schedule = tx
                ? await this.employeeScheduleRepository.findById(branchid, id, tx)
                : await this.employeeScheduleRepository.findById(branchid, id);
            if (!schedule) {
                throw new NotFoundException(`Employee schedule with id ${id} not found`);
            }

            if (tx && tx.employee_schedule?.findMany) {
                const schedules = await tx.employee_schedule.findMany({
                    where: { branchId: branchid, clientId: schedule.clientId },
                    select: {
                        id: true,
                        primaryEmployeeId: true,
                        secondaryEmployeeId: true,
                    },
                    orderBy: { id: "asc" },
                });
                const existingCase = tx.service_record_case?.findUnique
                    ? await tx.service_record_case.findUnique({
                        where: { clientId: schedule.clientId },
                        select: { id: true, branchId: true, clientId: true },
                    })
                    : null;
                await lockServiceRecordWriteSet(tx, {
                    branchId: branchid,
                    clientId: schedule.clientId,
                    caseId: existingCase?.id,
                    expectedScheduleIds: schedules.map((row) => row.id),
                    scheduleIds: schedules.map((row) => row.id),
                    employeeIds: schedules.flatMap((row) => [
                        row.primaryEmployeeId,
                        row.secondaryEmployeeId,
                    ]),
                });
                // The read before locking is discovery only. Re-read the
                // branch-scoped schedule after all owner rows are locked so a
                // stale request cannot delete a reassigned row.
                const lockedSchedule = await this.employeeScheduleRepository.findById(
                    branchid,
                    id,
                    tx,
                );
                if (
                    !lockedSchedule
                    || lockedSchedule.clientId !== schedule.clientId
                    || lockedSchedule.primaryEmployeeId !== schedule.primaryEmployeeId
                    || lockedSchedule.secondaryEmployeeId !== schedule.secondaryEmployeeId
                ) {
                    throw new ConflictException("Employee schedule changed while acquiring write locks");
                }
            }

            try {
                if (tx) {
                    await this.employeeScheduleRepository.delete(branchid, id, tx);
                } else {
                    await this.employeeScheduleRepository.delete(branchid, id);
                }
            } catch (error) {
                if (error instanceof ScopedDeleteNotFoundError) {
                    throw new NotFoundException(`Employee schedule with id ${id} not found`);
                }
                if (error instanceof RetentionDeleteBlockedError) {
                    throw new ConflictException({
                        code: SCHEDULE_RETENTION_BLOCKED,
                        message: SCHEDULE_RETENTION_BLOCKED_MESSAGE,
                    });
                }
                throw error;
            }
        };

        if (transaction) return persist(transaction);
        return persist();
    }
}
