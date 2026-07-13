import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "application/services/service-record-lifecycle.service";
import { CreateAndSendFeedbackSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-feedback-snapshot.usecase";
import { PrismaService } from "infrastructure/database/prisma.service";

function setup(options: {
    claimCount?: number;
    snapshotError?: Error;
    staleCount?: number;
    includeCandidate?: boolean;
} = {}) {
    const candidate = {
        id: "case-1",
        branchId: "branch-1",
        finalizationAttempts: 0,
    };
    const prisma = {
        service_record_case: {
            findMany: jest.fn()
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(options.includeCandidate === false ? [] : [candidate]),
            updateMany: jest.fn().mockImplementation(({ where }) => {
                if (where.status === SERVICE_RECORD_CASE_STATUS.FINALIZING && where.finalizationStartedAt) {
                    return Promise.resolve({ count: options.staleCount ?? 0 });
                }
                if (where.id === candidate.id && where.OR) {
                    return Promise.resolve({ count: options.claimCount ?? 1 });
                }
                return Promise.resolve({ count: 1 });
            }),
        },
        service_record_snapshot_chunk: {
            count: jest.fn().mockResolvedValue(0),
        },
        employee_feedback_token: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    };
    const transaction = jest.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
    const prismaWithTransaction = Object.assign(prisma, { $transaction: transaction });
    const lifecycle = { recompute: jest.fn() };
    const snapshot = {
        executeCase: options.snapshotError
            ? jest.fn().mockRejectedValue(options.snapshotError)
            : jest.fn().mockResolvedValue({
                documentIds: ["doc-1", "doc-2"],
                documentId: "doc-1",
                chunkCount: 2,
            }),
    };
    const service = new ServiceRecordFinalizationService(
        prismaWithTransaction as unknown as PrismaService,
        lifecycle as unknown as ServiceRecordLifecycleService,
        snapshot as unknown as CreateAndSendFeedbackSnapshotUsecase,
    );
    return { service, prisma: prismaWithTransaction, lifecycle, snapshot };
}

describe("ServiceRecordFinalizationService", () => {
    it("claims a due case once, creates every chunk, and revokes remaining links", async () => {
        const { service, prisma, snapshot } = setup();

        await expect(service.processDueCases(new Date("2026-07-13T00:00:00.000Z"))).resolves.toBe(1);

        expect(snapshot.executeCase).toHaveBeenCalledWith("branch-1", "case-1");
        expect(prisma.service_record_case.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: "case-1" }),
                data: expect.objectContaining({ status: SERVICE_RECORD_CASE_STATUS.FINALIZING }),
            }),
        );
        expect(prisma.service_record_case.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "case-1", status: SERVICE_RECORD_CASE_STATUS.FINALIZING },
                data: expect.objectContaining({ status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED }),
            }),
        );
        expect(prisma.employee_feedback_token.updateMany).toHaveBeenCalledWith({
            where: { serviceRecordCaseId: "case-1", active: true },
            data: { active: false, revokedAt: expect.any(Date) },
        });
    });

    it("does not call eformsign when another instance already owns the DB claim", async () => {
        const { service, snapshot } = setup({ claimCount: 0 });

        await expect(service.processDueCases()).resolves.toBe(0);
        expect(snapshot.executeCase).not.toHaveBeenCalled();
    });

    it("records a retryable case failure when snapshot creation fails", async () => {
        const { service, prisma } = setup({ snapshotError: new Error("network failed") });

        await expect(service.processDueCases()).resolves.toBe(0);

        expect(prisma.service_record_case.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "case-1", status: SERVICE_RECORD_CASE_STATUS.FINALIZING },
                data: expect.objectContaining({
                    status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                    nextAttemptAt: expect.any(Date),
                    lastError: "network failed",
                }),
            }),
        );
    });

    it("recovers a stale FINALIZING claim for a later reconciliation run", async () => {
        const { service, prisma, snapshot } = setup({ staleCount: 1, includeCandidate: false });
        const referenceDate = new Date("2026-07-13T00:00:00.000Z");

        await expect(service.processDueCases(referenceDate)).resolves.toBe(0);

        expect(prisma.service_record_case.updateMany).toHaveBeenCalledWith({
            where: {
                status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
                finalizationStartedAt: { lte: new Date("2026-07-12T23:40:00.000Z") },
            },
            data: {
                status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                nextAttemptAt: referenceDate,
                lastError: "Recovered stale finalization claim",
                version: { increment: 1 },
            },
        });
        expect(snapshot.executeCase).not.toHaveBeenCalled();
    });
});
