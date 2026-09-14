import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { CreateEmployeeScheduleUsecase } from "application/usecases/employee-schedule/create-employee-schedule.usecase";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

type EmployeeCandidate = {
    id: number;
    branchId: string;
    deletedAt: Date | null;
    openToNextWork: boolean;
};

describe("CreateEmployeeScheduleUsecase assignment eligibility", () => {
    const branchId = "branch-a";
    const baseParams = {
        clientId: 100,
        primaryEmployeeId: 2,
        secondaryEmployeeId: null as number | null,
        workAddress: "서울",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-08-31T00:00:00.000Z"),
    };

    const eligible = (id = 2): EmployeeCandidate => ({
        id,
        branchId,
        deletedAt: null,
        openToNextWork: true,
    });

    const createHarness = (employees: EmployeeCandidate[]) => {
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: baseParams.clientId }]),
            client: {
                findFirst: jest.fn().mockResolvedValue({ id: baseParams.clientId }),
            },
            employee: {
                findMany: jest.fn().mockResolvedValue(employees),
            },
            employee_schedule: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
        };
        const prisma = {
            employee: transaction.employee,
            $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
        };
        const schedule = new EmployeeScheduleEntity(
            10,
            baseParams.clientId,
            baseParams.primaryEmployeeId,
            baseParams.secondaryEmployeeId,
            baseParams.workAddress,
            baseParams.startDate,
            baseParams.endDate,
            false,
        );
        const employeeScheduleRepository = {
            create: jest.fn().mockResolvedValue(schedule),
        };

        const usecase = new CreateEmployeeScheduleUsecase(
            employeeScheduleRepository as never,
            prisma as never,
        );

        return { usecase, transaction, employeeScheduleRepository };
    };

    const invalidCases: Array<[
        string,
        EmployeeCandidate[],
        Partial<typeof baseParams>,
        string,
    ]> = [
        ["wrong branch", [{ ...eligible(), branchId: "branch-b" }], {}, "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE"],
        ["soft deleted", [{ ...eligible(), deletedAt: new Date("2026-01-01T00:00:00.000Z") }], {}, "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE"],
        ["unavailable", [{ ...eligible(), openToNextWork: false }], {}, "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE"],
        ["missing", [], {}, "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE"],
        ["wrong branch secondary", [eligible(), { ...eligible(3), branchId: "branch-b" }], { secondaryEmployeeId: 3 }, "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE"],
        ["soft deleted secondary", [eligible(), { ...eligible(3), deletedAt: new Date("2026-01-01T00:00:00.000Z") }], { secondaryEmployeeId: 3 }, "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE"],
        ["unavailable secondary", [eligible(), { ...eligible(3), openToNextWork: false }], { secondaryEmployeeId: 3 }, "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE"],
        ["missing secondary", [eligible()], { secondaryEmployeeId: 999 }, "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE"],
        ["same employee in both roles", [eligible()], { secondaryEmployeeId: 2 }, "VALIDATION_FAILED"],
    ];

    it.each(invalidCases)(
        "refuses %s before creating a schedule",
        async (_label, employees, overrides, expectedCode) => {
            const { usecase, transaction, employeeScheduleRepository } = createHarness(employees);

            const error = await usecase.execute(branchId, {
                ...baseParams,
                ...overrides,
            }, transaction as never).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(BadRequestException);
            expect((error as BadRequestException).getResponse()).toMatchObject({ code: expectedCode });

            expect(transaction.employee.findMany).toHaveBeenCalled();
            expect(employeeScheduleRepository.create).not.toHaveBeenCalled();
        },
    );

    it("creates a schedule for eligible employees in the supplied transaction", async () => {
        const { usecase, transaction, employeeScheduleRepository } = createHarness([eligible()]);

        await expect(usecase.execute(branchId, baseParams, transaction as never)).resolves.toBeDefined();

        expect(employeeScheduleRepository.create).toHaveBeenCalledWith(
            branchId,
            expect.any(EmployeeScheduleEntity),
            transaction,
        );
    });

    it("refuses a client outside the authenticated branch before locking employees or creating a schedule", async () => {
        const { usecase, transaction, employeeScheduleRepository } = createHarness([eligible()]);
        transaction.client.findFirst.mockResolvedValue(null);

        const error = await usecase.execute(branchId, baseParams, transaction as never)
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getStatus()).toBe(404);
        expect((error as NotFoundException).getResponse()).toMatchObject({
            code: "RESOURCE_NOT_FOUND",
            params: {},
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        });
        expect((error as NotFoundException).message).not.toContain(String(baseParams.clientId));

        expect(transaction.client.findFirst).toHaveBeenCalledWith({
            where: { id: baseParams.clientId, branchId },
            select: { id: true },
        });
        expect(transaction.$queryRaw).not.toHaveBeenCalled();
        expect(transaction.employee.findMany).not.toHaveBeenCalled();
        expect(employeeScheduleRepository.create).not.toHaveBeenCalled();
    });

    it("creates a schedule when both eligible employees are assigned", async () => {
        const { usecase, transaction, employeeScheduleRepository } = createHarness([eligible(), eligible(3)]);

        await expect(usecase.execute(branchId, {
            ...baseParams,
            secondaryEmployeeId: 3,
        }, transaction as never)).resolves.toBeDefined();

        expect(employeeScheduleRepository.create).toHaveBeenCalledTimes(1);
    });

    it("refuses an inverted date range before creating a schedule", async () => {
        const { usecase, employeeScheduleRepository } = createHarness([eligible()]);

        const error = await usecase.execute(branchId, {
            ...baseParams,
            startDate: new Date("2026-09-01T00:00:00.000Z"),
            endDate: new Date("2026-08-31T00:00:00.000Z"),
        }).catch((caught: unknown) => caught);

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

        expect(employeeScheduleRepository.create).not.toHaveBeenCalled();
    });

    it("refuses an active overlapping schedule for the same client", async () => {
        const { usecase, transaction, employeeScheduleRepository } = createHarness([eligible()]);
        transaction.employee_schedule.findFirst.mockResolvedValue({ id: 77 });

        const error = await usecase.execute(branchId, baseParams, transaction as never)
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getStatus()).toBe(409);
        expect((error as ConflictException).getResponse()).toMatchObject({
            code: "EMPLOYEE_SCHEDULE_OVERLAP",
            params: {},
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        });

        expect(transaction.employee_schedule.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                branchId,
                replaced: false,
                startDate: { lte: baseParams.endDate },
                endDate: { gte: baseParams.startDate },
                clientId: baseParams.clientId,
            }),
        }));
        expect(employeeScheduleRepository.create).not.toHaveBeenCalled();
    });

    it("allows a replaced schedule even when its dates overlap", async () => {
        const { usecase, transaction, employeeScheduleRepository } = createHarness([eligible()]);
        transaction.employee_schedule.findFirst.mockResolvedValue({ id: 77 });

        await expect(usecase.execute(branchId, {
            ...baseParams,
            replaced: true,
        }, transaction as never)).resolves.toBeDefined();

        expect(transaction.employee_schedule.findFirst).not.toHaveBeenCalled();
        expect(employeeScheduleRepository.create).toHaveBeenCalledTimes(1);
    });
});
