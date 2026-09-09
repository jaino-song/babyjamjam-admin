import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import {
    EmployeeScheduleDateRangeError,
    EmployeeScheduleRoleError,
} from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { Prisma } from "@prisma/client";
import { assertEmployeeAssignmentEligibility, type EmployeeAssignmentCandidate } from "application/policies/employee-assignment-eligibility.policy";
import {
    assertEmployeeScheduleWriteIsAvailable,
} from "application/policies/employee-schedule-invariants.policy";
import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import { PrismaService } from "infrastructure/database/prisma.service";

type CreateEmployeeScheduleParams = {
    clientId: number;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
    workAddress: string;
    startDate: Date;
    endDate: Date;
    replaced?: boolean;
};

@Injectable()
export class CreateEmployeeScheduleUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
        private readonly prismaService: PrismaService,
    ) {}

    async execute(
        branchid: string,
        params: CreateEmployeeScheduleParams,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeScheduleEntity> {
        const persist = async (tx: Prisma.TransactionClient): Promise<EmployeeScheduleEntity> => {
            const client = await tx.client.findFirst({
                where: { id: params.clientId, branchId: branchid },
                select: { id: true },
            });
            if (!client) {
                throw new NotFoundException("Client not found for branch");
            }

            const employeeIds = [params.primaryEmployeeId, params.secondaryEmployeeId]
                .filter((employeeId): employeeId is number => employeeId !== null);
            const existingCase = tx.service_record_case?.findUnique
                ? await tx.service_record_case.findUnique({
                    where: { clientId: params.clientId },
                    select: { id: true },
                })
                : null;
            await lockServiceRecordWriteSet(tx, {
                branchId: branchid,
                clientId: params.clientId,
                caseId: existingCase?.id,
                employeeIds,
            });
            // The initial client lookup is discovery only. Revalidate branch
            // ownership after the stable-row lock before reading employees or
            // writing the new schedule.
            const lockedClient = await tx.client.findFirst({
                where: { id: params.clientId, branchId: branchid },
                select: { id: true },
            });
            if (!lockedClient) {
                throw new NotFoundException("Client not found for branch");
            }
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
            assertEmployeeAssignmentEligibility(
                branchid,
                params.primaryEmployeeId,
                params.secondaryEmployeeId,
                employees,
            );

            let schedule: EmployeeScheduleEntity;
            try {
                schedule = EmployeeScheduleEntity.create(
                    params.clientId,
                    params.primaryEmployeeId,
                    params.secondaryEmployeeId,
                    params.workAddress,
                    params.startDate,
                    params.endDate,
                    params.replaced ?? false,
                );
            } catch (error) {
                if (error instanceof EmployeeScheduleDateRangeError || error instanceof EmployeeScheduleRoleError) {
                    throw new BadRequestException(error.message);
                }
                throw error;
            }
            await assertEmployeeScheduleWriteIsAvailable(tx, schedule, branchid);
            return this.employeeScheduleRepository.create(branchid, schedule, tx);
        };

        return transaction ? persist(transaction) : this.prismaService.$transaction(persist);
    }
}
