import { BadRequestException, ConflictException } from "@nestjs/common";
import { UpdateEmployeeScheduleUsecase } from "application/usecases/employee-schedule/update-employee-schedule.usecase";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

describe("UpdateEmployeeScheduleUsecase", () => {
    it("reads and persists the update through the supplied transaction", async () => {
        const transaction = {};
        const existing = new EmployeeScheduleEntity(
            72,
            31,
            30,
            null,
            "서울",
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-08-31T00:00:00.000Z"),
            false,
        );
        const updated = new EmployeeScheduleEntity(
            72,
            31,
            30,
            null,
            "부산",
            new Date("2026-08-02T00:00:00.000Z"),
            new Date("2026-09-01T00:00:00.000Z"),
            true,
        );
        const repository = {
            findById: jest.fn().mockResolvedValue(existing),
            update: jest.fn().mockResolvedValue(updated),
        };
        const usecase = new UpdateEmployeeScheduleUsecase(repository as never);

        await expect(usecase.execute("branch-1", 72, {
            workAddress: "부산",
            startDate: new Date("2026-08-02T00:00:00.000Z"),
            endDate: new Date("2026-09-01T00:00:00.000Z"),
            replaced: true,
        }, transaction as never)).resolves.toBe(updated);

        expect(repository.findById).toHaveBeenCalledWith("branch-1", 72, transaction);
        expect(repository.update).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                id: 72,
                clientId: 31,
                workAddress: "부산",
                startDate: new Date("2026-08-02T00:00:00.000Z"),
                endDate: new Date("2026-09-01T00:00:00.000Z"),
                replaced: true,
            }),
            transaction,
        );
    });

    const createInvariantHarness = (overlap: { id: number } | null = null) => {
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 31 }]),
            client: {},
            employee: {
                findMany: jest.fn().mockResolvedValue([{
                    id: 30,
                    branchId: "branch-1",
                    deletedAt: null,
                    openToNextWork: true,
                }]),
            },
            employee_schedule: {
                findFirst: jest.fn().mockResolvedValue(overlap),
            },
        };
        const existing = new EmployeeScheduleEntity(
            72,
            31,
            30,
            null,
            "서울",
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-08-31T00:00:00.000Z"),
            false,
        );
        const repository = {
            findById: jest.fn().mockResolvedValue(existing),
            update: jest.fn().mockResolvedValue(existing),
        };
        return {
            transaction,
            repository,
            usecase: new UpdateEmployeeScheduleUsecase(repository as never),
        };
    };

    it("refuses an inverted date range at the application boundary", async () => {
        const { usecase, transaction, repository } = createInvariantHarness();

        const error = await usecase.execute("branch-1", 72, {
            startDate: new Date("2026-09-01T00:00:00.000Z"),
            endDate: new Date("2026-08-31T00:00:00.000Z"),
        }, transaction as never).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getStatus()).toBe(400);
        expect((error as BadRequestException).getResponse()).toMatchObject({
            code: "VALIDATION_FAILED",
            params: {},
            outcome: "NOT_APPLIED",
            errors: [{
                pointer: "/endDate",
                code: "INVALID_VALUE",
                location: "body",
            }],
        });

        expect(repository.update).not.toHaveBeenCalled();
    });

    it("rejects an overlapping active schedule while excluding itself", async () => {
        const { usecase, transaction, repository } = createInvariantHarness({ id: 99 });

        const error = await usecase.execute("branch-1", 72, {}, transaction as never)
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getStatus()).toBe(409);
        expect((error as ConflictException).getResponse()).toMatchObject({
            code: "EMPLOYEE_SCHEDULE_OVERLAP",
            params: {},
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        });
        expect(repository.update).not.toHaveBeenCalled();

        const { usecase: selfUsecase, transaction: selfTransaction, repository: selfRepository } = createInvariantHarness({ id: 72 });
        await expect(selfUsecase.execute("branch-1", 72, {}, selfTransaction as never))
            .resolves.toBeDefined();
        expect(selfRepository.update).toHaveBeenCalledTimes(1);
        expect(selfTransaction.employee_schedule.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: { not: 72 } }),
        }));
    });

    it("rejects an unavailable newly assigned employee but preserves retained eligibility", async () => {
        const { usecase, transaction, repository } = createInvariantHarness();
        transaction.employee.findMany.mockResolvedValue([
            {
                id: 30,
                branchId: "branch-1",
                deletedAt: null,
                openToNextWork: true,
            },
            {
                id: 31,
                branchId: "branch-1",
                deletedAt: null,
                openToNextWork: false,
            },
        ]);

        const error = await usecase.execute("branch-1", 72, {
            primaryEmployeeId: 31,
        }, transaction as never).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
            code: "EMPLOYEE_ASSIGNMENT_UNAVAILABLE",
        });
        expect(repository.update).not.toHaveBeenCalled();
    });
});
