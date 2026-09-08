import { ConflictException, NotFoundException } from "@nestjs/common";

import { DeleteEmployeeScheduleUsecase } from "application/usecases/employee-schedule/delete-employee-schedule.usecase";
import {
    RetentionDeleteBlockedError,
    SCHEDULE_RETENTION_BLOCKED,
    SCHEDULE_RETENTION_BLOCKED_MESSAGE,
    ScopedDeleteNotFoundError,
} from "domain/errors/retention-delete-blocked.error";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

describe("DeleteEmployeeScheduleUsecase", () => {
    const branchId = "branch-a";
    const schedule = new EmployeeScheduleEntity(
        7,
        21,
        3,
        null,
        "Seoul",
        new Date("2099-01-02T00:00:00.000Z"),
        new Date("2099-01-08T00:00:00.000Z"),
    );

    it("deletes an existing schedule through the repository", async () => {
        const repository = {
            findById: jest.fn().mockResolvedValue(schedule),
            delete: jest.fn().mockResolvedValue(undefined),
        };
        const usecase = new DeleteEmployeeScheduleUsecase(repository as never);

        await usecase.execute(branchId, schedule.id);

        expect(repository.findById).toHaveBeenCalledWith(branchId, schedule.id);
        expect(repository.delete).toHaveBeenCalledWith(branchId, schedule.id);
    });

    it("locks the complete client-owned set and forwards the owning transaction", async () => {
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
            employee_schedule: {
                findMany: jest.fn().mockResolvedValue([{
                    id: schedule.id,
                    primaryEmployeeId: schedule.primaryEmployeeId,
                    secondaryEmployeeId: schedule.secondaryEmployeeId,
                }]),
            },
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    id: "case-1",
                    branchId,
                    clientId: schedule.clientId,
                }),
            },
        };
        const repository = {
            findById: jest.fn()
                .mockResolvedValueOnce(schedule)
                .mockResolvedValueOnce(schedule),
            delete: jest.fn().mockResolvedValue(undefined),
        };
        const usecase = new DeleteEmployeeScheduleUsecase(repository as never);

        await usecase.execute(branchId, schedule.id, transaction as never);

        const lockTables = transaction.$queryRaw.mock.calls
            .map(([query]) => (query as { strings?: string[] }).strings?.join(" ").toLowerCase() ?? "")
            .filter((query) => query.includes("for update"))
            .map((query) => query.match(/from\s+"?([a-z_]+)"?/)?.[1] ?? "unknown");
        expect(lockTables.slice(0, 6)).toEqual([
            "client",
            "employee",
            "service_record_case",
            "employee_schedule",
            "service_record_assignment",
            "service_record_day",
        ]);
        expect(repository.delete).toHaveBeenCalledWith(branchId, schedule.id, transaction);
    });

    it("rejects a changed owner after locks without deleting the stale target", async () => {
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
            employee_schedule: {
                findMany: jest.fn().mockResolvedValue([{
                    id: schedule.id,
                    primaryEmployeeId: schedule.primaryEmployeeId,
                    secondaryEmployeeId: schedule.secondaryEmployeeId,
                }]),
            },
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue(null),
            },
        };
        const changed = new EmployeeScheduleEntity(
            schedule.id,
            99,
            schedule.primaryEmployeeId,
            schedule.secondaryEmployeeId,
            schedule.workAddress,
            schedule.startDate,
            schedule.endDate,
        );
        const repository = {
            findById: jest.fn()
                .mockResolvedValueOnce(schedule)
                .mockResolvedValueOnce(changed),
            delete: jest.fn(),
        };
        const usecase = new DeleteEmployeeScheduleUsecase(repository as never);

        await expect(usecase.execute(branchId, schedule.id, transaction as never))
            .rejects.toBeInstanceOf(ConflictException);
        expect(repository.delete).not.toHaveBeenCalled();
    });

    it("returns a stable 409 when the repository reports retained data", async () => {
        const repository = {
            findById: jest.fn().mockResolvedValue(schedule),
            delete: jest.fn().mockRejectedValue(
                new RetentionDeleteBlockedError(SCHEDULE_RETENTION_BLOCKED, SCHEDULE_RETENTION_BLOCKED_MESSAGE),
            ),
        };
        const usecase = new DeleteEmployeeScheduleUsecase(repository as never);

        const error = await usecase.execute(branchId, schedule.id).catch((caught) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toEqual({
            code: SCHEDULE_RETENTION_BLOCKED,
            message: SCHEDULE_RETENTION_BLOCKED_MESSAGE,
        });
    });

    it("maps a race where the locked row disappears to 404", async () => {
        const repository = {
            findById: jest.fn().mockResolvedValue(schedule),
            delete: jest.fn().mockRejectedValue(new ScopedDeleteNotFoundError("schedule", schedule.id)),
        };
        const usecase = new DeleteEmployeeScheduleUsecase(repository as never);

        const error = await usecase.execute(branchId, schedule.id).catch((caught) => caught);

        expect(error).toMatchObject({
            status: 404,
            message: `Employee schedule with id ${schedule.id} not found`,
        });
        expect(error).toBeInstanceOf(NotFoundException);
    });

    it("does not call delete when the schedule is absent in the requested branch", async () => {
        const repository = {
            findById: jest.fn().mockResolvedValue(null),
            delete: jest.fn(),
        };
        const usecase = new DeleteEmployeeScheduleUsecase(repository as never);

        await expect(usecase.execute(branchId, schedule.id)).rejects.toBeInstanceOf(NotFoundException);
        expect(repository.delete).not.toHaveBeenCalled();
    });
});
