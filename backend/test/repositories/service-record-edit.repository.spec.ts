import { ServiceRecordEditNotFoundError } from "domain/errors/service-record-edit.error";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";

const branchId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const draftId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";

function draftRow(overrides: Record<string, unknown> = {}) {
    return {
        id: draftId,
        branchId,
        serviceRecordCaseId: caseId,
        createdByUserId: actorId,
        updatedByUserId: actorId,
        discardedByUserId: null,
        sourceCaseVersion: 7,
        sourceFingerprint: "source-fingerprint",
        sourceSnapshot: { status: "IN_PROGRESS", submittedAt: null },
        changes: { header: { momName: "Before" } },
        draftVersion: 1,
        status: "ACTIVE",
        createdAt: new Date("2026-09-08T00:00:00.000Z"),
        updatedAt: new Date("2026-09-08T00:00:00.000Z"),
        discardedAt: null,
        ...overrides,
    };
}

function revisionRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "55555555-5555-4555-8555-555555555555",
        branchId,
        serviceRecordCaseId: caseId,
        revisionNumber: 1,
        confirmedByUserId: actorId,
        confirmedAt: new Date("2026-09-08T00:00:00.000Z"),
        payload: { sessions: [] },
        plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-08", assignmentId: "assignment-1" }],
        provenance: { sourceCaseVersion: 7, sourceFingerprint: "source-fingerprint" },
        formVersionAtConfirm: 1,
        snapshotReference: "snapshot-1",
        ...overrides,
    };
}

function uniqueError(): Error {
    return Object.assign(new Error("duplicate active draft"), { code: "P2002" });
}

function transactionalPrisma<T extends Record<string, unknown>>(transactionClient: T) {
    return {
        $transaction: jest.fn(async (callback: (client: T) => Promise<unknown>) => callback(transactionClient)),
    };
}

describe("ServiceRecordEditRepository", () => {
    it("creates one active draft and resumes it without rebasing its source snapshot", async () => {
        const service_record_edit_draft = {
            findFirst: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(draftRow()),
            create: jest.fn().mockResolvedValue(draftRow()),
        };
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: caseId }]),
            service_record_edit_draft,
        };
        const repository = new ServiceRecordEditRepository({
            ...transactionalPrisma(tx),
            service_record_edit_draft,
        } as never);

        const input = {
            branchId,
            serviceRecordCaseId: caseId,
            actorUserId: actorId,
            sourceCaseVersion: 7,
            sourceFingerprint: "source-fingerprint",
            sourceSnapshot: { status: "IN_PROGRESS", submittedAt: null },
            changes: { header: { momName: "Before" } },
        };

        await expect(repository.createOrResumeDraft(input)).resolves.toMatchObject({
            id: draftId,
            draftVersion: 1,
            sourceFingerprint: "source-fingerprint",
        });
        await expect(repository.createOrResumeDraft(input)).resolves.toMatchObject({ id: draftId });

        expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
        expect(service_record_edit_draft.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId,
                serviceRecordCaseId: caseId,
                sourceCaseVersion: 7,
                sourceFingerprint: "source-fingerprint",
                sourceSnapshot: input.sourceSnapshot,
                changes: input.changes,
                status: "ACTIVE",
                draftVersion: 1,
            }),
        });
        expect(service_record_edit_draft.create).toHaveBeenCalledTimes(1);
    });

    it("returns the winner after a concurrent active-draft unique-index race", async () => {
        const winner = draftRow({ changes: { header: { momName: "Winner" } } });
        const service_record_edit_draft = {
            findFirst: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(winner),
            create: jest.fn().mockRejectedValue(uniqueError()),
        };
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: caseId }]),
            service_record_edit_draft,
        };
        const repository = new ServiceRecordEditRepository({
            ...transactionalPrisma(tx),
            service_record_edit_draft,
        } as never);

        await expect(repository.createOrResumeDraft({
            branchId,
            serviceRecordCaseId: caseId,
            actorUserId: actorId,
            sourceCaseVersion: 9,
            sourceFingerprint: "loser-fingerprint",
            sourceSnapshot: { status: "IN_PROGRESS" },
        })).resolves.toMatchObject({ changes: { header: { momName: "Winner" } } });
        expect(service_record_edit_draft.findFirst).toHaveBeenCalledTimes(2);
    });

    it("does not probe or create a draft when the case is foreign to the requested branch", async () => {
        const service_record_edit_draft = {
            findFirst: jest.fn(),
            create: jest.fn(),
        };
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            service_record_edit_draft,
        };
        const repository = new ServiceRecordEditRepository(transactionalPrisma(tx) as never);

        await expect(repository.createOrResumeDraft({
            branchId,
            serviceRecordCaseId: caseId,
            actorUserId: actorId,
            sourceCaseVersion: 1,
            sourceFingerprint: "fingerprint",
            sourceSnapshot: {},
        })).rejects.toBeInstanceOf(ServiceRecordEditNotFoundError);
        expect(service_record_edit_draft.findFirst).not.toHaveBeenCalled();
        expect(service_record_edit_draft.create).not.toHaveBeenCalled();
    });

    it("compare-and-swaps changes while leaving source provenance untouched", async () => {
        const service_record_edit_draft = {
            findFirst: jest.fn()
                .mockResolvedValueOnce(draftRow())
                .mockResolvedValueOnce(draftRow({
                    changes: { sessions: [{ sessionIndex: 1, notes: "After" }] },
                    draftVersion: 2,
                    updatedByUserId: actorId,
                })),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        };
        const tx = { service_record_edit_draft };
        const repository = new ServiceRecordEditRepository(transactionalPrisma(tx) as never);

        await expect(repository.updateDraft({
            branchId,
            serviceRecordCaseId: caseId,
            draftId,
            expectedDraftVersion: 1,
            actorUserId: actorId,
            changes: { sessions: [{ sessionIndex: 1, notes: "After" }] },
        })).resolves.toMatchObject({ draftVersion: 2, sourceCaseVersion: 7 });

        expect(service_record_edit_draft.updateMany).toHaveBeenCalledWith({
            where: {
                id: draftId,
                branchId,
                serviceRecordCaseId: caseId,
                status: "ACTIVE",
                draftVersion: 1,
            },
            data: {
                changes: { sessions: [{ sessionIndex: 1, notes: "After" }] },
                draftVersion: { increment: 1 },
                updatedByUserId: actorId,
            },
        });
    });

    it("maps a lost compare-and-swap race to a domain 409", async () => {
        const service_record_edit_draft = {
            findFirst: jest.fn().mockResolvedValue(draftRow()),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        };
        const tx = { service_record_edit_draft };
        const repository = new ServiceRecordEditRepository(transactionalPrisma(tx) as never);

        await expect(repository.updateDraft({
            branchId,
            serviceRecordCaseId: caseId,
            draftId,
            expectedDraftVersion: 1,
            actorUserId: actorId,
            changes: {},
        })).rejects.toMatchObject({
            name: "ServiceRecordEditDraftConflictError",
            statusCode: 409,
        });
    });

    it("returns its own CAS row while a later writer is queued behind the transaction", async () => {
        const ownChanges = { header: { momName: "first response" } };
        const laterChanges = { header: { momName: "later writer" } };
        const service_record_edit_draft = {
            findFirst: jest.fn()
                .mockResolvedValueOnce(draftRow())
                .mockResolvedValueOnce(draftRow({ changes: ownChanges, draftVersion: 2 })),
            updateMany: jest.fn().mockImplementation(async () => {
                queuedWriter();
                return { count: 1 };
            }),
        };
        const queuedWriter = jest.fn();
        const rootDraftDelegate = {
            findFirst: jest.fn().mockResolvedValue(draftRow({ changes: laterChanges, draftVersion: 3 })),
        };
        const tx = { service_record_edit_draft };
        const repository = new ServiceRecordEditRepository({
            ...transactionalPrisma(tx),
            service_record_edit_draft: rootDraftDelegate,
        } as never);

        await expect(repository.updateDraft({
            branchId,
            serviceRecordCaseId: caseId,
            draftId,
            expectedDraftVersion: 1,
            actorUserId: actorId,
            changes: ownChanges,
        })).resolves.toMatchObject({ changes: ownChanges, draftVersion: 2 });
        expect(queuedWriter).toHaveBeenCalledTimes(1);
        expect(rootDraftDelegate.findFirst).not.toHaveBeenCalled();
    });

    it("discards only the active version and keeps the draft payload available for audit", async () => {
        const service_record_edit_draft = {
            findFirst: jest.fn()
                .mockResolvedValueOnce(draftRow())
                .mockResolvedValueOnce(draftRow({
                    status: "DISCARDED",
                    discardedByUserId: actorId,
                    discardedAt: new Date("2026-09-08T00:10:00.000Z"),
                    draftVersion: 2,
                })),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        };
        const tx = { service_record_edit_draft };
        const repository = new ServiceRecordEditRepository(transactionalPrisma(tx) as never);

        await expect(repository.discardDraft({
            branchId,
            serviceRecordCaseId: caseId,
            draftId,
            expectedDraftVersion: 1,
            actorUserId: actorId,
        })).resolves.toMatchObject({ status: "DISCARDED", draftVersion: 2 });
        expect(service_record_edit_draft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ branchId, serviceRecordCaseId: caseId, draftVersion: 1 }),
            data: expect.objectContaining({
                status: "DISCARDED",
                discardedByUserId: actorId,
                draftVersion: { increment: 1 },
            }),
        }));
    });

    it("allocates the next revision number under a case lock and never updates a prior revision", async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: caseId }]),
            service_record_revision: {
                findFirst: jest.fn().mockResolvedValue(revisionRow({ revisionNumber: 4 })),
                create: jest.fn().mockResolvedValue(revisionRow({ revisionNumber: 5, snapshotReference: "snapshot-5" })),
            },
        };
        const prisma = {
            $transaction: jest.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
        };
        const repository = new ServiceRecordEditRepository(prisma as never);

        await expect(repository.appendRevision({
            branchId,
            serviceRecordCaseId: caseId,
            actorUserId: actorId,
            payload: { header: { momName: "Confirmed" }, sessions: [] },
            plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-08", assignmentId: "assignment-1" }],
            provenance: { sourceCaseVersion: 7 },
            formVersionAtConfirm: 1,
            snapshotReference: "snapshot-5",
        })).resolves.toMatchObject({ revisionNumber: 5, snapshotReference: "snapshot-5" });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.service_record_revision.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId,
                serviceRecordCaseId: caseId,
                revisionNumber: 5,
                payload: { header: { momName: "Confirmed" }, sessions: [] },
                plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-08", assignmentId: "assignment-1" }],
                provenance: { sourceCaseVersion: 7 },
                formVersionAtConfirm: 1,
            }),
        });
    });

    it("rejects a foreign case before attempting to append a revision", async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            service_record_revision: {
                findFirst: jest.fn(),
                create: jest.fn(),
            },
        };
        const repository = new ServiceRecordEditRepository({
            $transaction: jest.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
        } as never);

        await expect(repository.appendRevision({
            branchId,
            serviceRecordCaseId: caseId,
            actorUserId: actorId,
            payload: {},
            plannedSessions: [],
            provenance: {},
            formVersionAtConfirm: 1,
        })).rejects.toBeInstanceOf(ServiceRecordEditNotFoundError);
        expect(tx.service_record_revision.create).not.toHaveBeenCalled();
    });

    it("allocates contiguous revision numbers without accepting caller overrides", async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: caseId }]),
            service_record_revision: {
                findFirst: jest.fn()
                    .mockResolvedValueOnce(null)
                    .mockResolvedValueOnce(revisionRow({ revisionNumber: 1 })),
                create: jest.fn()
                    .mockResolvedValueOnce(revisionRow({ revisionNumber: 1 }))
                    .mockResolvedValueOnce(revisionRow({ revisionNumber: 2 })),
            },
        };
        const prisma = {
            $transaction: jest.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
        };
        const repository = new ServiceRecordEditRepository(prisma as never);

        const input = {
            branchId,
            serviceRecordCaseId: caseId,
            actorUserId: actorId,
            payload: {},
            plannedSessions: [],
            provenance: {},
            formVersionAtConfirm: 1,
        };
        await expect(repository.appendRevision(input)).resolves.toMatchObject({ revisionNumber: 1 });
        await expect(repository.appendRevision(input)).resolves.toMatchObject({ revisionNumber: 2 });
        expect(tx.service_record_revision.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
            data: expect.objectContaining({ revisionNumber: 2 }),
        }));
    });
});
