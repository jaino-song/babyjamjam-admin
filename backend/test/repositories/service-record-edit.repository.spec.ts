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

    it("captures a normalized source snapshot and preserves duplicate session provenance", async () => {
        const sourceDay = {
            id: "day-1",
            branchId,
            scheduleId: 55,
            caseSessionIndex: 1,
            sessionIndex: 1,
            employeeNameSnapshot: "제공자",
            formVersion: 3,
            serviceDate: new Date("2026-09-08T00:00:00.000Z"),
            answers: { perineum: ["이상없음"] },
            etcService: null,
            notes: null,
            paymentConfirmed: false,
            momApproval: "approved",
            clientSignature: "signature",
            clientSignedAt: new Date("2026-09-08T03:00:00.000Z"),
            locked: true,
            submittedAt: new Date("2026-09-08T04:00:00.000Z"),
            employeeId: 9,
        };
        const legacyDay = {
            ...sourceDay,
            id: "day-legacy",
            caseSessionIndex: null,
            serviceDate: new Date("2026-09-09T00:00:00.000Z"),
            answers: { breast: ["울혈"] },
        };
        const client = {
            findFirst: jest.fn()
                .mockResolvedValueOnce({ id: 101 })
                .mockResolvedValueOnce({
                    id: 101,
                    branchId,
                    name: "산모",
                    duration: 10,
                    startDate: new Date("2026-09-08T00:00:00.000Z"),
                    endDate: new Date("2026-09-22T00:00:00.000Z"),
                    serviceStatus: "in_progress",
                }),
        };
        const service_record_case = {
            findFirst: jest.fn().mockResolvedValue({
                id: caseId,
                clientId: 101,
                version: 4,
                formVersion: 3,
                requiredSessionCount: 2,
                startDate: new Date("2026-09-08T00:00:00.000Z"),
                endDate: new Date("2026-09-09T00:00:00.000Z"),
                momName: "산모",
                momBirth: "900101",
                babyName: "아기",
                babyBirth: "260901",
                deliveryType: "자연분만",
                babyWeight: "3.2",
                plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-08" }],
                days: [sourceDay, legacyDay],
            }),
        };
        const employee_schedule = {
            findMany: jest.fn().mockResolvedValue([{
                id: 55,
                branchId,
                startDate: new Date("2026-09-08T00:00:00.000Z"),
                endDate: new Date("2026-09-22T00:00:00.000Z"),
                replaced: false,
                terminatedAt: null,
                primaryEmployeeId: 9,
                secondaryEmployeeId: null,
                primaryEmployee: { name: "제공자" },
                serviceRecordAssignment: null,
            }]),
        };
        const tx = { client, service_record_case, employee_schedule };
        const prisma = transactionalPrisma(tx);
        const repository = new ServiceRecordEditRepository(prisma as never);

        const snapshot = await repository.loadSource(branchId, { clientId: 101 });
        expect(snapshot).toMatchObject({
            caseId: caseId,
            client: { id: 101, duration: 10, startDate: "2026-09-08", endDate: "2026-09-22" },
            sessions: [
                expect.objectContaining({
                    sourceRowId: "day-1",
                    rawCaseSessionIndex: 1,
                    rawSessionIndex: 1,
                    serviceDate: "2026-09-08",
                }),
                expect.objectContaining({
                    sourceRowId: "day-legacy",
                    rawCaseSessionIndex: null,
                    rawSessionIndex: 1,
                    serviceDate: "2026-09-09",
                }),
            ],
        });
        expect(snapshot?.sessions.every((session) => session.ambiguous)).toBe(true);
        expect(snapshot?.sessions[0]?.clientSignedAt).toBe("2026-09-08T03:00:00.000Z");
        expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("loads the draft and branch-owned source from one repeatable-read snapshot", async () => {
        const currentRevisionId = "66666666-6666-4666-8666-666666666666";
        const service_record_edit_draft = {
            findFirst: jest.fn().mockResolvedValue(draftRow()),
        };
        const service_record_case = {
            findFirst: jest.fn().mockResolvedValue({
                id: caseId,
                clientId: 101,
                version: 8,
                formVersion: 4,
                currentRevisionId,
                currentUsableRevisionId: currentRevisionId,
                currentUsableDocumentVersion: 2,
                requiredSessionCount: 1,
                startDate: new Date("2026-09-08T00:00:00.000Z"),
                endDate: new Date("2026-09-08T00:00:00.000Z"),
                momName: "산모",
                momBirth: null,
                babyName: null,
                babyBirth: null,
                deliveryType: null,
                babyWeight: null,
                plannedSessions: [{
                    sessionIndex: 1,
                    serviceDate: "2026-09-08",
                    originalDate: "2026-09-08",
                    assignmentId: "assignment-1",
                    scheduleId: 55,
                    employeeId: 9,
                    provenanceVersion: "case-8",
                }],
                days: [],
            }),
        };
        const client = {
            findFirst: jest.fn().mockResolvedValue({
                id: 101,
                branchId,
                name: "산모",
                duration: 1,
                startDate: new Date("2026-09-08T00:00:00.000Z"),
                endDate: new Date("2026-09-08T00:00:00.000Z"),
                serviceStatus: "in_progress",
                eDocId: "contract-1",
            }),
        };
        const employee_schedule = { findMany: jest.fn().mockResolvedValue([]) };
        const eformsign_doc = {
            findMany: jest.fn().mockResolvedValue([
                {
                    documentId: "snapshot-1",
                    documentKind: "service_record_snapshot",
                    statusType: "050",
                    clientId: 101,
                    serviceRecordCaseId: caseId,
                    employeeScheduleId: null,
                    snapshotVersion: 2,
                    snapshotChunkIndex: 0,
                    stepName: "서비스 기록",
                    updatedDate: new Date("2026-09-08T05:00:00.000Z"),
                    createdDate: new Date("2026-09-08T04:00:00.000Z"),
                },
                {
                    documentId: "contract-1",
                    documentKind: "contract",
                    statusType: "060",
                    clientId: 101,
                    serviceRecordCaseId: null,
                    employeeScheduleId: null,
                    snapshotVersion: null,
                    snapshotChunkIndex: null,
                    stepName: "이용자 서명",
                    updatedDate: new Date("2026-09-08T03:00:00.000Z"),
                    createdDate: new Date("2026-09-08T02:00:00.000Z"),
                },
            ]),
        };
        const service_record_revision = {
            findMany: jest.fn().mockResolvedValue([{
                id: currentRevisionId,
                revisionNumber: 3,
                formVersionAtConfirm: 4,
            }]),
        };
        const tx = {
            service_record_edit_draft,
            service_record_case,
            client,
            employee_schedule,
            eformsign_doc,
            service_record_revision,
        };
        const prisma = transactionalPrisma(tx);
        const repository = new ServiceRecordEditRepository(prisma as never);

        await expect(repository.loadDraftWithSource(branchId, draftId)).resolves.toMatchObject({
            draft: { id: draftId, draftVersion: 1 },
            source: {
                caseId,
                documentScope: {
                    evidence: "observed",
                    serviceRecordSnapshot: {
                        documentIds: ["snapshot-1"],
                        snapshotVersion: 2,
                        chunks: [{ documentId: "snapshot-1", snapshotVersion: 2, snapshotChunkIndex: 0 }],
                    },
                    currentRevision: { id: currentRevisionId, revisionNumber: 3, formVersion: 4 },
                    form: { version: 4 },
                    contract: { currentDocumentId: "contract-1", stage: "in_progress" },
                },
            },
        });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.$transaction).toHaveBeenCalledWith(
            expect.any(Function),
            { isolationLevel: "RepeatableRead" },
        );
        expect(service_record_edit_draft.findFirst).toHaveBeenCalledTimes(1);
        expect(service_record_case.findFirst).toHaveBeenCalledTimes(1);
        expect(eformsign_doc.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ branchId }),
        }));
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
