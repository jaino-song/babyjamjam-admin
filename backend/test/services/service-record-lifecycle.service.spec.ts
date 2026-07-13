import { ConflictException } from "@nestjs/common";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "application/services/service-record-lifecycle.service";
import { PrismaService } from "infrastructure/database/prisma.service";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function conflictCode(error: unknown): unknown {
    return error instanceof ConflictException ? error.getResponse() : null;
}

async function expectConflict(promise: Promise<unknown>, code: string): Promise<void> {
    try {
        await promise;
        throw new Error("Expected ConflictException");
    } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect(conflictCode(error)).toEqual({ code });
    }
}

describe("ServiceRecordLifecycleService", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("locks the service start date once service has started", async () => {
        const prisma = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                    startDate: date("2026-07-01"),
                    endDate: date("2026-07-20"),
                    requiredSessionCount: 10,
                    days: [],
                }),
            },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expectConflict(service.validatePeriodChange({
            clientId: 1,
            startDate: date("2026-07-02"),
            now: new Date("2026-07-01T01:00:00.000Z"),
        }), "SERVICE_RECORD_START_DATE_LOCKED");
    });

    it("allows extending the end date without deleting existing sessions", async () => {
        const rows = [{ serviceDate: date("2026-07-08"), locked: true }];
        const prisma = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                    startDate: date("2026-07-01"),
                    endDate: date("2026-07-10"),
                    requiredSessionCount: 5,
                    days: rows,
                }),
            },
            service_record_day: { deleteMany: jest.fn() },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expect(service.validatePeriodChange({
            clientId: 1,
            endDate: date("2026-07-20"),
        })).resolves.toBeUndefined();
        expect(prisma.service_record_day.deleteMany).not.toHaveBeenCalled();
    });

    it("persists a contract end date and aggregate refresh in one transaction", async () => {
        const transactionClient = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                    startDate: date("2026-07-01"),
                    endDate: date("2026-07-10"),
                    requiredSessionCount: 5,
                    days: [{ serviceDate: date("2026-07-08"), locked: true }],
                }),
            },
            client: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);
        const ensureSpy = jest.spyOn(service, "ensureForClient").mockResolvedValue(null);

        await service.syncEndDateFromContract({
            branchId: "11111111-1111-1111-1111-111111111111",
            clientId: 1,
            endDate: date("2026-07-20"),
        });

        expect(transactionClient.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 1,
                OR: [
                    { branchId: "11111111-1111-1111-1111-111111111111" },
                    { branchId: null },
                ],
            },
            data: { endDate: date("2026-07-20") },
        });
        expect(ensureSpy).toHaveBeenCalledWith(1, transactionClient);
    });

    it("rejects an end date before any recorded row, including a draft", async () => {
        const prisma = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                    startDate: date("2026-07-01"),
                    endDate: date("2026-07-20"),
                    requiredSessionCount: 10,
                    days: [{ serviceDate: date("2026-07-12"), locked: false }],
                }),
            },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expectConflict(service.validatePeriodChange({
            clientId: 1,
            endDate: date("2026-07-11"),
        }), "END_DATE_BEFORE_LAST_SUBMITTED_SESSION");
    });

    it("does not allow clearing or reducing the contracted session count after recording starts", async () => {
        const prisma = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                    startDate: date("2026-07-01"),
                    endDate: date("2026-07-20"),
                    requiredSessionCount: 10,
                    days: [{ serviceDate: date("2026-07-02"), locked: true }],
                }),
            },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expectConflict(
            service.validatePeriodChange({ clientId: 1, duration: null }),
            "SERVICE_RECORD_DURATION_REQUIRED",
        );
        await expectConflict(
            service.validatePeriodChange({ clientId: 1, duration: 9 }),
            "SERVICE_RECORD_DURATION_CANNOT_DECREASE",
        );
    });

    it("moves a complete record to READY_TO_FINALIZE only after its due time", async () => {
        jest.useFakeTimers({ now: new Date("2026-07-13T00:00:00.000Z") });
        const record = {
            id: "case-1",
            status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
            startDate: date("2026-07-01"),
            endDate: date("2026-07-12"),
            requiredSessionCount: 2,
            finalizationDueAt: new Date("2026-07-12T11:00:00.000Z"),
            completedAt: null,
            momName: "산모",
            momBirth: "900101",
            babyName: "아기",
            babyBirth: "260701",
            deliveryType: "자연분만",
            babyWeight: "3.2",
            assignments: [{ schedule: { replaced: false } }],
            days: [
                { locked: true, momApproval: "approved" },
                { locked: true, momApproval: "approved" },
            ],
        };
        const prisma = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue(record),
                update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...record, ...data })),
            },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await service.recompute("case-1");

        expect(prisma.service_record_case.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE,
                completedAt: expect.any(Date),
            }),
        }));
    });
});
