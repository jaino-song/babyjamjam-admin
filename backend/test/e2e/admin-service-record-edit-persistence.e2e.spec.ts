import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
    ServiceRecordEditConflictError,
    ServiceRecordEditDraftConflictError,
    ServiceRecordEditNotFoundError,
} from "domain/errors/service-record-edit.error";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordEditDatabaseTarget,
    createApprovedServiceRecordEditClient,
} from "./helpers/service-record-edit-persistence.helper";

/**
 * Real PostgreSQL proof for the additive persistence foundation. The suite is
 * opt-in and refuses every database target except the two disposable loopback
 * databases created for this task.
 */
const E2E_ENABLED = process.env["SERVICE_RECORD_EDIT_PERSISTENCE_E2E"] === "1";
const describeE2E = E2E_ENABLED ? describe : describe.skip;

describe("service-record persistence database target guard", () => {
    it("rejects an unapproved target before any client is constructed", () => {
        expect(() => assertApprovedServiceRecordEditDatabaseTarget(
            "postgresql://postgres@localhost:5432/production",
            "postgresql://postgres@localhost:5432/production",
        )).toThrow(/unsafe DATABASE_URL target/);
    });
});

describeE2E("service-record edit persistence (real PostgreSQL)", () => {
    let prisma: PrismaClient;
    let repository: ServiceRecordEditRepository;
    let branchId: string;
    let foreignBranchId: string;
    let sequence = 0;

    const unique = (prefix: string): string => `${prefix}-${process.pid}-${Date.now()}-${sequence++}`;
    const actorId = (): string => randomUUID();

    beforeAll(async () => {
        assertApprovedServiceRecordEditDatabaseTarget();
        prisma = createApprovedServiceRecordEditClient();
        await prisma.$connect();
        repository = new ServiceRecordEditRepository(prisma as never);

        const [branch, foreignBranch] = await Promise.all([
            prisma.branch.create({
                data: { name: unique("revision-branch"), slug: unique("revision-branch") },
                select: { id: true },
            }),
            prisma.branch.create({
                data: { name: unique("revision-foreign-branch"), slug: unique("revision-foreign-branch") },
                select: { id: true },
            }),
        ]);
        branchId = branch.id;
        foreignBranchId = foreignBranch.id;
    });

    afterEach(async () => {
        await prisma.service_record_day.deleteMany({ where: { branchId: { in: [branchId, foreignBranchId] } } });
        await prisma.service_record_edit_draft.deleteMany({ where: { branchId: { in: [branchId, foreignBranchId] } } });
        await prisma.service_record_case.deleteMany({ where: { branchId: { in: [branchId, foreignBranchId] } } });
    });

    afterAll(async () => {
        if (!prisma) return;
        await prisma.service_record_day.deleteMany({ where: { branchId: { in: [branchId, foreignBranchId] } } });
        await prisma.service_record_edit_draft.deleteMany({ where: { branchId: { in: [branchId, foreignBranchId] } } });
        await prisma.service_record_case.deleteMany({ where: { branchId: { in: [branchId, foreignBranchId] } } });
        await prisma.branch.deleteMany({ where: { id: { in: [branchId, foreignBranchId] } } });
        await prisma.$disconnect();
    });

    it("keeps legacy nullable pointers and business rows unchanged while saving a draft", async () => {
        const legacyCase = await prisma.service_record_case.create({ data: { branchId } });
        expect(legacyCase.plannedSessions).toBeNull();
        expect(legacyCase.currentContent).toBeNull();
        expect(legacyCase.currentUsableDocumentPointer).toBeNull();

        const serviceCase = await prisma.service_record_case.create({
            data: {
                branchId,
                status: "IN_PROGRESS",
                formVersion: 3,
                version: 12,
                requiredSessionCount: 3,
                startDate: new Date("2026-09-01T00:00:00.000Z"),
                endDate: new Date("2026-09-15T00:00:00.000Z"),
                plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-01" }],
                currentContent: { canonical: "before" },
                currentUsableDocumentPointer: "legacy-document-pointer",
            },
        });
        const serviceDay = await prisma.service_record_day.create({
            data: {
                branchId,
                serviceRecordCaseId: serviceCase.id,
                caseSessionIndex: 1,
                sessionIndex: 1,
                serviceDate: new Date("2026-09-01T00:00:00.000Z"),
                answers: { daily: "before" },
                notes: "legacy note",
                momApproval: "approved",
                clientSignature: "signature",
                clientSignedAt: new Date("2026-09-01T03:00:00.000Z"),
                submittedAt: new Date("2026-09-01T04:00:00.000Z"),
                locked: true,
            },
        });
        const beforeCase = await prisma.service_record_case.findUniqueOrThrow({ where: { id: serviceCase.id } });
        const beforeDay = await prisma.service_record_day.findUniqueOrThrow({ where: { id: serviceDay.id } });

        const draft = await repository.createOrResumeDraft({
            branchId,
            serviceRecordCaseId: serviceCase.id,
            actorUserId: actorId(),
            sourceCaseVersion: beforeCase.version,
            sourceFingerprint: "fingerprint-before",
            sourceSnapshot: { version: beforeCase.version, status: beforeCase.status },
            changes: { header: { momName: "Draft" } },
        });
        const updated = await repository.updateDraft({
            branchId,
            serviceRecordCaseId: serviceCase.id,
            draftId: draft.id,
            expectedDraftVersion: draft.draftVersion,
            actorUserId: actorId(),
            changes: { sessions: [{ sessionIndex: 1, notes: "Draft only" }] },
        });

        expect(updated.sourceCaseVersion).toBe(beforeCase.version);
        expect(updated.sourceFingerprint).toBe("fingerprint-before");
        expect(updated.draftVersion).toBe(2);
        expect(await prisma.service_record_case.findUniqueOrThrow({ where: { id: serviceCase.id } })).toEqual(beforeCase);
        expect(await prisma.service_record_day.findUniqueOrThrow({ where: { id: serviceDay.id } })).toEqual(beforeDay);
    });

    it("serializes concurrent create-or-resume calls to one active draft", async () => {
        const serviceCase = await prisma.service_record_case.create({ data: { branchId, version: 4 } });
        const results = await Promise.all([
            repository.createOrResumeDraft({
                branchId,
                serviceRecordCaseId: serviceCase.id,
                actorUserId: actorId(),
                sourceCaseVersion: 4,
                sourceFingerprint: "concurrent-a",
                sourceSnapshot: { source: "a" },
                changes: { header: { momName: "A" } },
            }),
            repository.createOrResumeDraft({
                branchId,
                serviceRecordCaseId: serviceCase.id,
                actorUserId: actorId(),
                sourceCaseVersion: 9,
                sourceFingerprint: "concurrent-b",
                sourceSnapshot: { source: "b" },
                changes: { header: { momName: "B" } },
            }),
        ]);

        expect(new Set(results.map(({ id }) => id)).size).toBe(1);
        const persisted = await repository.findActiveDraft(branchId, serviceCase.id);
        expect(persisted).toMatchObject({ id: results[0].id, draftVersion: 1 });
        expect(["concurrent-a", "concurrent-b"]).toContain(persisted?.sourceFingerprint);
    });

    it("blocks direct source provenance mutation at the database boundary", async () => {
        const serviceCase = await prisma.service_record_case.create({ data: { branchId, version: 5 } });
        const draft = await repository.createOrResumeDraft({
            branchId,
            serviceRecordCaseId: serviceCase.id,
            actorUserId: actorId(),
            sourceCaseVersion: 5,
            sourceFingerprint: "immutable-source",
            sourceSnapshot: { source: "immutable" },
        });
        const rollback = new Error("rollback source-immutability assertion");

        await expect(prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SAVEPOINT source_mutation`);
            await expect(tx.$executeRaw(Prisma.sql`
                UPDATE service_record_edit_draft
                SET source_fingerprint = 'tampered'
                WHERE id = ${draft.id}::uuid
            `)).rejects.toThrow(/source provenance is immutable/);
            await tx.$executeRaw(Prisma.sql`ROLLBACK TO SAVEPOINT source_mutation`);
            throw rollback;
        })).rejects.toBe(rollback);

        await expect(repository.findDraft(branchId, serviceCase.id, draft.id)).resolves.toMatchObject({
            sourceFingerprint: "immutable-source",
            draftVersion: 1,
        });
    });

    it("allows one CAS writer, rejects the stale writer, and preserves discard CAS", async () => {
        const serviceCase = await prisma.service_record_case.create({ data: { branchId, version: 2 } });
        const draft = await repository.createOrResumeDraft({
            branchId,
            serviceRecordCaseId: serviceCase.id,
            actorUserId: actorId(),
            sourceCaseVersion: 2,
            sourceFingerprint: "cas-source",
            sourceSnapshot: { source: "immutable" },
            changes: { header: { momName: "Initial" } },
        });

        const writes = await Promise.allSettled([
            repository.updateDraft({
                branchId,
                serviceRecordCaseId: serviceCase.id,
                draftId: draft.id,
                expectedDraftVersion: 1,
                actorUserId: actorId(),
                changes: { header: { momName: "Writer A" } },
            }),
            repository.updateDraft({
                branchId,
                serviceRecordCaseId: serviceCase.id,
                draftId: draft.id,
                expectedDraftVersion: 1,
                actorUserId: actorId(),
                changes: { header: { momName: "Writer B" } },
            }),
        ]);
        const fulfilled = writes.filter((result): result is PromiseFulfilledResult<typeof draft> => result.status === "fulfilled");
        const rejected = writes.filter((result) => result.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]).toMatchObject({ reason: expect.any(ServiceRecordEditDraftConflictError) });
        const winner = fulfilled[0];
        if (!winner) throw new Error("CAS test expected one winning writer");

        const afterWrite = await repository.findActiveDraft(branchId, serviceCase.id);
        expect(afterWrite).toMatchObject({
            id: draft.id,
            draftVersion: 2,
            changes: winner.value.changes,
            sourceFingerprint: "cas-source",
        });

        await expect(repository.updateDraft({
            branchId,
            serviceRecordCaseId: serviceCase.id,
            draftId: draft.id,
            expectedDraftVersion: 1,
            actorUserId: actorId(),
            changes: { header: { momName: "stale" } },
        })).rejects.toBeInstanceOf(ServiceRecordEditDraftConflictError);

        const discarded = await repository.discardDraft({
            branchId,
            serviceRecordCaseId: serviceCase.id,
            draftId: draft.id,
            expectedDraftVersion: 2,
            actorUserId: actorId(),
        });
        expect(discarded).toMatchObject({ status: "DISCARDED", draftVersion: 3, changes: winner.value.changes });
        await expect(repository.discardDraft({
            branchId,
            serviceRecordCaseId: serviceCase.id,
            draftId: draft.id,
            expectedDraftVersion: 2,
            actorUserId: actorId(),
        })).rejects.toBeInstanceOf(ServiceRecordEditDraftConflictError);
    });

    it("denies foreign branch access without probing or creating rows", async () => {
        const serviceCase = await prisma.service_record_case.create({ data: { branchId } });
        await expect(repository.createOrResumeDraft({
            branchId: foreignBranchId,
            serviceRecordCaseId: serviceCase.id,
            actorUserId: actorId(),
            sourceCaseVersion: 1,
            sourceFingerprint: "foreign",
            sourceSnapshot: {},
        })).rejects.toBeInstanceOf(ServiceRecordEditNotFoundError);
        await expect(repository.appendRevision({
            branchId: foreignBranchId,
            serviceRecordCaseId: serviceCase.id,
            actorUserId: actorId(),
            payload: {},
            plannedSessions: [],
            provenance: {},
            formVersionAtConfirm: 1,
        })).rejects.toBeInstanceOf(ServiceRecordEditNotFoundError);
        await expect(prisma.service_record_edit_draft.count({ where: { serviceRecordCaseId: serviceCase.id } })).resolves.toBe(0);
        await expect(prisma.service_record_revision.count({ where: { serviceRecordCaseId: serviceCase.id } })).resolves.toBe(0);
    });

    it("appends an immutable revision under a parent lock", async () => {
        const serviceCase = await prisma.service_record_case.create({ data: { branchId, version: 8 } });
        const rollback = new Error("rollback append-only assertion");

        await expect(prisma.$transaction(async (tx) => {
            const appended = await repository.appendRevision({
                branchId,
                serviceRecordCaseId: serviceCase.id,
                actorUserId: actorId(),
                payload: { header: { momName: "Confirmed" } },
                plannedSessions: [{ sessionIndex: 1, assignmentId: "assignment-real" }],
                provenance: { sourceCaseVersion: 8, sourceFingerprint: "revision-source" },
                formVersionAtConfirm: 3,
                snapshotReference: "snapshot-real",
            }, tx);
            expect(appended).toMatchObject({ revisionNumber: 1, snapshotReference: "snapshot-real" });

            await tx.$executeRaw(Prisma.sql`SAVEPOINT revision_mutation_update`);
            await expect(tx.$executeRaw(Prisma.sql`
                UPDATE service_record_revision
                SET payload = '{"tampered": true}'::jsonb
                WHERE id = ${appended.id}::uuid
            `)).rejects.toThrow(/append-only/);
            await tx.$executeRaw(Prisma.sql`ROLLBACK TO SAVEPOINT revision_mutation_update`);

            await tx.$executeRaw(Prisma.sql`SAVEPOINT revision_mutation_delete`);
            await expect(tx.$executeRaw(Prisma.sql`
                DELETE FROM service_record_revision
                WHERE id = ${appended.id}::uuid
            `)).rejects.toThrow(/append-only/);
            await tx.$executeRaw(Prisma.sql`ROLLBACK TO SAVEPOINT revision_mutation_delete`);

            const persisted = await tx.service_record_revision.findUniqueOrThrow({ where: { id: appended.id } });
            expect(persisted.payload).toEqual({ header: { momName: "Confirmed" } });
            throw rollback;
        })).rejects.toBe(rollback);

        await expect(prisma.service_record_revision.count({ where: { serviceRecordCaseId: serviceCase.id } })).resolves.toBe(0);
        await expect(prisma.service_record_case.findUnique({ where: { id: serviceCase.id } })).resolves.not.toBeNull();
    });

    it("maps an explicit duplicate revision number to a domain conflict", async () => {
        const serviceCase = await prisma.service_record_case.create({ data: { branchId } });
        const input = {
            branchId,
            serviceRecordCaseId: serviceCase.id,
            actorUserId: actorId(),
            payload: {},
            plannedSessions: [],
            provenance: {},
            formVersionAtConfirm: 1,
            revisionNumber: 1,
        };
        const rollback = new Error("rollback duplicate-revision assertion");
        await expect(prisma.$transaction(async (tx) => {
            await repository.appendRevision(input, tx);
            await expect(repository.appendRevision({ ...input, actorUserId: actorId() }, tx))
                .rejects.toBeInstanceOf(ServiceRecordEditConflictError);
            throw rollback;
        })).rejects.toBe(rollback);
    });
});
