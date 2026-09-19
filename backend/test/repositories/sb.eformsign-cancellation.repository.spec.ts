import { SbEformsignCancellationRepository } from "infrastructure/database/repositories/sb.eformsign-cancellation.repository";
import { EformsignDispatchIntentEntity } from "domain/entities/eformsign-dispatch-intent.entity";

const now = new Date("2026-09-18T00:00:00.000Z");

const intentRow = (overrides: Record<string, unknown> = {}) => ({
    id: "cancel-intent-1",
    branchId: "branch-1",
    clientId: 7,
    localDocumentId: 11,
    assignmentId: 13,
    providerDocumentId: "doc-1",
    templateId: "template-1",
    action: "cancel",
    generation: "cancel:doc-1:source-1",
    businessKey: "b".repeat(64),
    fingerprint: "f".repeat(64),
    status: "started",
    attemptCount: 1,
    startedAt: now,
    providerAcceptedAt: null,
    uncertainAt: null,
    uncertainReason: null,
    providerReceipt: null,
    reconciledAt: null,
    reconciledOutcome: null,
    reconciledByUserId: null,
    reconciliationReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const mirrorRow = (overrides: Record<string, unknown> = {}) => ({
    id: 11,
    documentId: "doc-1",
    branchId: "branch-1",
    clientId: 7,
    assignmentId: 13,
    templateId: "template-1",
    permanentPurgeRequestedAt: null,
    ...overrides,
});

describe("SbEformsignCancellationRepository", () => {
    it("locks branch-owned mirror and intent rows before claiming a cancellation fence", async () => {
        const tx = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([mirrorRow()])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ id: 11 }]),
            eformsign_dispatch_intent: {
                create: jest.fn().mockResolvedValue(intentRow()),
                updateMany: jest.fn(),
            },
            eformsign_doc: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const prisma = {
            $transaction: jest.fn(async (callback) => callback(tx)),
        };
        const repository = new SbEformsignCancellationRepository(prisma as never);

        const result = await repository.begin({
            branchId: "branch-1",
            documentIds: ["doc-1"],
            actorUserId: "operator-1",
            reason: "QA cancel",
        });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
        expect(tx.eformsign_dispatch_intent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                action: "cancel",
                status: "started",
                providerDocumentId: "doc-1",
                localDocumentId: 11,
                attemptCount: 1,
            }),
        }));
        expect(tx.eformsign_doc.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { permanentPurgeRequestedAt: expect.any(Date) },
        }));
        expect(result.targets[0]).toMatchObject({
            documentId: "doc-1",
            branchId: "branch-1",
            clientId: 7,
            assignmentId: 13,
            templateId: "template-1",
            cancellationIntent: expect.objectContaining({
                action: "cancel",
                status: "started",
            }),
        });
    });

    it("CASes an uncertain cancellation retry and preserves its provider id", async () => {
        const current = intentRow({ status: "uncertain", attemptCount: 1 });
        const claimed = intentRow({ status: "started", attemptCount: 2, startedAt: new Date() });
        const tx = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([mirrorRow()])
                .mockResolvedValueOnce([current])
                .mockResolvedValueOnce([{ id: 11 }])
                .mockResolvedValueOnce([claimed]),
            eformsign_dispatch_intent: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findFirst: jest.fn(),
            },
            eformsign_doc: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
        const repository = new SbEformsignCancellationRepository(prisma as never);

        const result = await repository.begin({
            branchId: "branch-1",
            documentIds: ["doc-1"],
            actorUserId: "operator-1",
            reason: "retry cancellation",
        });

        expect(tx.eformsign_dispatch_intent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: current.id,
                attemptCount: 1,
                status: { in: ["prepared", "uncertain"] },
            }),
            data: expect.objectContaining({
                status: "started",
                providerDocumentId: "doc-1",
            }),
        }));
        expect(tx.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
        expect(result.targets[0]).toMatchObject({
            cancellationIntent: expect.objectContaining({ status: "started", attemptCount: 2 }),
        });
    });

    it("refuses cancellation when any matching create or finalize attempt is in flight", async () => {
        const tx = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([mirrorRow()])
                .mockResolvedValueOnce([
                    intentRow({
                        id: "accepted-create",
                        action: "create",
                        status: "accepted",
                    }),
                    intentRow({
                        id: "uncertain-finalize",
                        action: "finalize",
                        status: "uncertain",
                    }),
                ]),
            eformsign_dispatch_intent: {
                create: jest.fn(),
                updateMany: jest.fn(),
            },
            eformsign_doc: { updateMany: jest.fn() },
        };
        const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
        const repository = new SbEformsignCancellationRepository(prisma as never);

        await expect(repository.begin({
            branchId: "branch-1",
            documentIds: ["doc-1"],
            actorUserId: "operator-1",
            reason: "QA cancel",
        })).rejects.toThrow("진행 중인 전자문서 작업이 있어 취소할 수 없습니다.");
        expect(tx.eformsign_dispatch_intent.create).not.toHaveBeenCalled();
        expect(tx.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    it("allows cancellation to recover an abandoned prepared create", async () => {
        const tx = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([mirrorRow()])
                .mockResolvedValueOnce([
                    intentRow({
                        id: "prepared-create",
                        action: "create",
                        status: "prepared",
                        providerDocumentId: "doc-1",
                    }),
                ]),
            eformsign_dispatch_intent: {
                create: jest.fn().mockResolvedValue(intentRow({
                    id: "cancel-intent-1",
                    action: "cancel",
                    status: "started",
                })),
                updateMany: jest.fn(),
            },
            eformsign_doc: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
        const repository = new SbEformsignCancellationRepository(prisma as never);

        const result = await repository.begin({
            branchId: "branch-1",
            documentIds: ["doc-1"],
            actorUserId: "operator-1",
            reason: "recover abandoned preparation",
        });

        expect(tx.eformsign_dispatch_intent.create).toHaveBeenCalled();
        expect(result.targets[0]).toMatchObject({
            sourceIntentStatus: "prepared",
            cancellationIntent: expect.objectContaining({ status: "started" }),
        });
    });

    it("drops a late acceptance when a newer purge generation owns the mirror fence", async () => {
        const current = intentRow({ status: "started", attemptCount: 1 });
        const newerGeneration = new Date("2026-09-18T01:00:00.000Z");
        const tx = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([mirrorRow({ permanentPurgeRequestedAt: newerGeneration })])
                .mockResolvedValueOnce([current]),
            eformsign_dispatch_intent: {
                updateMany: jest.fn(),
            },
            eformsign_doc: {
                updateMany: jest.fn(),
            },
        };
        const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
        const repository = new SbEformsignCancellationRepository(prisma as never);
        const target = {
            documentId: "doc-1",
            branchId: "branch-1",
            localDocumentId: 11,
            clientId: 7,
            assignmentId: 13,
            templateId: "template-1",
            providerDocumentId: "doc-1",
            sourceIntentId: "source-1",
            sourceIntentStatus: "accepted",
            purgeGeneration: new Date("2026-09-18T00:00:01.000Z"),
            cancellationIntent: new EformsignDispatchIntentEntity({
                ...current,
                action: "cancel",
                status: "started",
            } as never),
        };

        const result = await repository.completeAccepted({
            target,
            providerReceipt: { source: "test", documentId: "doc-1", decision: "accepted" },
        });

        expect(result.status).toBe("started");
        expect(tx.eformsign_dispatch_intent.updateMany).not.toHaveBeenCalled();
        expect(tx.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    it("reconciles an uncertain cancellation only after branch ownership and clears its matching fence", async () => {
        const current = intentRow({ status: "uncertain", attemptCount: 1 });
        const reconciled = intentRow({
            status: "reconciled_not_delivered",
            reconciledAt: new Date(),
            reconciledOutcome: "not_delivered",
            reconciledByUserId: "operator-1",
            reconciliationReason: "vendor absence verified",
        });
        const fence = new Date("2026-09-18T00:00:01.000Z");
        const tx = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([mirrorRow({ permanentPurgeRequestedAt: fence })])
                .mockResolvedValueOnce([current])
                .mockResolvedValueOnce([reconciled]),
            eformsign_dispatch_intent: {
                findFirst: jest.fn().mockResolvedValue(current),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            eformsign_doc: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
        const repository = new SbEformsignCancellationRepository(prisma as never);

        const result = await repository.reconcile({
            branchId: "branch-1",
            intentId: current.id,
            actorUserId: "operator-1",
            reason: "vendor absence verified",
            outcome: "not_delivered",
            providerDocumentId: "doc-1",
        });

        expect(result).toMatchObject({
            intent: { status: "reconciled_not_delivered", reconciledOutcome: "not_delivered" },
            clearedPurgeFence: true,
        });
        expect(tx.eformsign_doc.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ permanentPurgeRequestedAt: fence }),
            data: { permanentPurgeRequestedAt: null },
        }));
    });
});
