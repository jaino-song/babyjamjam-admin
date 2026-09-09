import { ConflictException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { lockClientForScheduleWrite } from "application/policies/employee-schedule-invariants.policy";
import {
    lockServiceRecordCaseForWrite,
    lockServiceRecordWriteSet,
} from "application/policies/service-record-write-lock.policy";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { PrismaService } from "infrastructure/database/prisma.service";

import {
    assertApprovedServiceRecordWriteLockDatabaseTarget,
    createApprovedServiceRecordWriteLockClient,
} from "./helpers/service-record-write-lock-order.helper";

const E2E_ENABLED = process.env["SERVICE_RECORD_WRITE_LOCK_E2E"] === "1";
const describeE2E = E2E_ENABLED ? describe : describe.skip;

describe("service-record write-lock database target guard", () => {
    it("rejects non-task-3 targets before client construction", () => {
        expect(() => assertApprovedServiceRecordWriteLockDatabaseTarget(
            "postgresql://postgres@127.0.0.1:5432/production",
            "postgresql://postgres@127.0.0.1:5432/production",
        )).toThrow(/unsafe DATABASE_URL target/);
    });

    it("requires both URLs to be the exact same task-3 target", () => {
        expect(() => assertApprovedServiceRecordWriteLockDatabaseTarget(
            "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task3",
            "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task2_empty",
        )).toThrow(/unsafe DIRECT_URL target/);
        expect(() => createApprovedServiceRecordWriteLockClient(
            "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task3",
            "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task2_empty",
        )).toThrow(/unsafe DIRECT_URL target/);
        expect(() => createApprovedServiceRecordWriteLockClient(
            "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task3",
            "",
        )).toThrow(/DATABASE_URL and DIRECT_URL/);
        expect(() => createApprovedServiceRecordWriteLockClient(
            "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task3",
            "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task3?schema=public",
        )).toThrow(/unsafe DIRECT_URL target/);
    });
});

describeE2E("service-record write-lock order (real PostgreSQL)", () => {
    let prisma: PrismaClient;
    let branchId: string;
    let clientId: number;
    let employeeId: number;
    let scheduleId: number;
    let caseId: string;
    let mirrorDocumentRowId: number;
    let mirrorDocumentId: string;
    const mirrorDetailSourceUpdatedDate = new Date("2026-09-01T01:00:00.000Z");
    const mirrorDetailSyncedAt = new Date("2026-09-01T01:01:00.000Z");
    let changedScheduleId: number | undefined;

    beforeAll(async () => {
        // This guard intentionally runs before createApproved... constructs a client.
        assertApprovedServiceRecordWriteLockDatabaseTarget();
        prisma = createApprovedServiceRecordWriteLockClient();
        await prisma.$connect();

        const branch = await prisma.branch.create({
            data: {
                name: `task3-lock-${process.pid}-${Date.now()}`,
                slug: `task3-lock-${process.pid}-${Date.now()}`,
            },
            select: { id: true },
        });
        branchId = branch.id;
        const employee = await prisma.employee.create({
            data: {
                name: "Task 3 Lock Employee",
                phone: `010${String(Date.now()).slice(-8)}`,
                workArea: ["task3"],
                grade: "산모신생아 건강관리사",
                branchId,
            },
            select: { id: true },
        });
        employeeId = employee.id;
        const client = await prisma.client.create({
            data: {
                name: "Task 3 Lock Client",
                voucherClient: false,
                branchId,
                duration: 1,
                startDate: new Date("2026-09-01T00:00:00.000Z"),
                endDate: new Date("2026-09-02T00:00:00.000Z"),
            },
            select: { id: true },
        });
        clientId = client.id;
        const schedule = await prisma.employee_schedule.create({
            data: {
                branchId,
                clientId,
                primaryEmployeeId: employeeId,
                workAddress: "task3",
                startDate: new Date("2026-09-01T00:00:00.000Z"),
                endDate: new Date("2026-09-02T00:00:00.000Z"),
            },
            select: { id: true },
        });
        scheduleId = schedule.id;
        const record = await prisma.service_record_case.create({
            data: {
                branchId,
                clientId,
                startDate: new Date("2026-09-01T00:00:00.000Z"),
                endDate: new Date("2026-09-02T00:00:00.000Z"),
                requiredSessionCount: 1,
            },
            select: { id: true },
        });
        caseId = record.id;
        mirrorDocumentId = `task3-lock-mirror-${process.pid}-${Date.now()}`;
        const mirrorDocument = await prisma.eformsign_doc.create({
            data: {
                documentId: mirrorDocumentId,
                createdDate: new Date("2026-09-01T00:00:00.000Z"),
                updatedDate: new Date("2026-09-01T00:00:00.000Z"),
                statusType: "060",
                statusDetail: "task3",
                stepType: "05",
                stepIndex: "1",
                stepName: "task3",
                stepRecipientType: "01",
                stepRecipientName: "Task 3 Lock Client",
                stepRecipientSms: "01000000000",
                expiredDate: new Date("2026-10-01T00:00:00.000Z"),
                branchId,
                clientId,
                serviceRecordCaseId: caseId,
                documentKind: "contract",
                detailPayload: { task: "task3" },
                detailSourceUpdatedDate: mirrorDetailSourceUpdatedDate,
                detailSyncedAt: mirrorDetailSyncedAt,
                syncStatus: "ready",
            },
            select: { id: true },
        });
        mirrorDocumentRowId = mirrorDocument.id;
        await prisma.eformsign_doc_file.createMany({
            data: ["document", "audit_trail"].map((fileType) => ({
                eformsignDocId: mirrorDocumentRowId,
                fileType,
                content: Buffer.from(`task3-${fileType}`),
                contentType: "application/pdf",
                byteSize: `task3-${fileType}`.length,
                sha256: "c".repeat(64),
                sourceUpdatedDate: mirrorDetailSourceUpdatedDate,
            })),
        });
    });

    afterAll(async () => {
        if (!prisma) return;
        // The task database is disposable. Remove mutable fixtures in FK order;
        // no append-only revision rows are created by this lock proof.
        // Guard every id individually: if beforeAll fails part way through,
        // an undefined id must never become an unscoped delete predicate.
        if (mirrorDocumentRowId) {
            await prisma.eformsign_doc.deleteMany({ where: { id: mirrorDocumentRowId } });
        }
        if (caseId) {
            await prisma.service_record_day.deleteMany({ where: { serviceRecordCaseId: caseId } });
            await prisma.service_record_assignment.deleteMany({ where: { serviceRecordCaseId: caseId } });
            await prisma.service_record_case.deleteMany({ where: { id: caseId } });
        }
        if (changedScheduleId) {
            await prisma.employee_schedule.deleteMany({ where: { id: changedScheduleId } });
        }
        if (scheduleId) {
            await prisma.employee_schedule.deleteMany({ where: { id: scheduleId } });
        }
        if (clientId) {
            await prisma.client.deleteMany({ where: { id: clientId } });
        }
        if (employeeId) {
            await prisma.employee.deleteMany({ where: { id: employeeId } });
        }
        if (branchId) {
            await prisma.branch.deleteMany({ where: { id: branchId } });
        }
        await prisma.$disconnect();
    });

    it("reproduces the pre-fix opposite case/client order as a bounded lock conflict", async () => {
        const caseFirst = createApprovedServiceRecordWriteLockClient();
        const clientFirst = createApprovedServiceRecordWriteLockClient();
        await Promise.all([caseFirst.$connect(), clientFirst.$connect()]);
        let arrivals = 0;
        let release!: () => void;
        const bothArrived = new Promise<void>((resolve) => { release = resolve; });
        const arrive = async () => {
            arrivals += 1;
            if (arrivals === 2) release();
            await bothArrived;
        };

        // This is the dangerous sequence the shared policy removes: one
        // writer already owns the case and then asks for the client, while
        // another owns the client and then asks for the case. A short local
        // lock timeout proves the cycle without leaving a hanging test.
        const caseFirstResult = caseFirst.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '250ms'`);
            await lockServiceRecordCaseForWrite(tx, branchId, caseId, clientId);
            await arrive();
            await lockClientForScheduleWrite(tx, branchId, clientId);
        });
        const clientFirstResult = clientFirst.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '250ms'`);
            await lockClientForScheduleWrite(tx, branchId, clientId);
            await arrive();
            await lockServiceRecordCaseForWrite(tx, branchId, caseId, clientId);
        });
        const results = await Promise.allSettled([caseFirstResult, clientFirstResult]);
        await Promise.all([caseFirst.$disconnect(), clientFirst.$disconnect()]);

        expect(results.some((result) => result.status === "rejected")).toBe(true);
    });

    it("stops before dependent locks when the branch-scoped client lock is absent", async () => {
        const client = createApprovedServiceRecordWriteLockClient();
        await client.$connect();
        const missingBranchId = "00000000-0000-0000-0000-000000000000";

        await expect(client.$transaction((tx) => lockServiceRecordWriteSet(tx, {
            branchId: missingBranchId,
            clientId,
            caseId,
            scheduleIds: [scheduleId],
            employeeIds: [employeeId],
        }))).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
        });

        await client.$disconnect();
    });

    it("serializes two owning writers through the common lock order", async () => {
        const left = createApprovedServiceRecordWriteLockClient();
        const right = createApprovedServiceRecordWriteLockClient();
        await Promise.all([left.$connect(), right.$connect()]);
        let arrivals = 0;
        let release!: () => void;
        const bothArrived = new Promise<void>((resolve) => { release = resolve; });
        const arrive = async () => {
            arrivals += 1;
            if (arrivals === 2) release();
            await bothArrived;
        };
        const lockOwningWriteSet = (tx: Prisma.TransactionClient) => lockServiceRecordWriteSet(tx, {
            branchId,
            clientId,
            caseId,
            scheduleIds: [scheduleId],
            employeeIds: [employeeId],
            sessionIndexes: [1],
        });
        const leftResult = left.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '1000ms'`);
            await arrive();
            await lockOwningWriteSet(tx);
        });
        const rightResult = right.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '1000ms'`);
            await arrive();
            await lockOwningWriteSet(tx);
        });
        const results = await Promise.allSettled([leftResult, rightResult]);
        await Promise.all([left.$disconnect(), right.$disconnect()]);

        expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    });

    it("rejects a schedule target that changes after discovery and client-lock wait", async () => {
        const writer = createApprovedServiceRecordWriteLockClient();
        const mutator = createApprovedServiceRecordWriteLockClient();
        await Promise.all([writer.$connect(), mutator.$connect()]);

        const discovered = await prisma.employee_schedule.findMany({
            where: { branchId, clientId },
            select: { id: true },
            orderBy: { id: "asc" },
        });
        const discoveredScheduleIds = discovered.map((schedule) => schedule.id);
        let writerReady!: () => void;
        const writerStarted = new Promise<void>((resolve) => { writerReady = resolve; });
        let releaseWriter!: () => void;
        const release = new Promise<void>((resolve) => { releaseWriter = resolve; });

        const writerResult = writer.$transaction(async (tx) => {
            writerReady();
            await release;
            await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '1000ms'`);
            await lockServiceRecordWriteSet(tx, {
                branchId,
                clientId,
                caseId,
                expectedScheduleIds: discoveredScheduleIds,
                scheduleIds: discoveredScheduleIds,
                employeeIds: [employeeId],
            });
        });

        await writerStarted;
        const changed = await mutator.employee_schedule.create({
            data: {
                branchId,
                clientId,
                primaryEmployeeId: employeeId,
                workAddress: "task3-target-change",
                startDate: new Date("2026-09-03T00:00:00.000Z"),
                endDate: new Date("2026-09-04T00:00:00.000Z"),
            },
            select: { id: true },
        });
        changedScheduleId = changed.id;
        releaseWriter();

        await expect(writerResult).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
        });
        expect(new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" })).toBeInstanceOf(ConflictException);
        await Promise.all([writer.$disconnect(), mutator.$disconnect()]);
    });

    it("serializes mirrored end-date sync behind a common writer and rechecks document generation ownership", async () => {
        const mirror = createApprovedServiceRecordWriteLockClient();
        const commonWriter = createApprovedServiceRecordWriteLockClient();
        const observer = createApprovedServiceRecordWriteLockClient();
        await Promise.all([mirror.$connect(), commonWriter.$connect(), observer.$connect()]);

        let writerReady!: () => void;
        const writerLocked = new Promise<void>((resolve) => { writerReady = resolve; });
        let releaseWriter!: () => void;
        const writerRelease = new Promise<void>((resolve) => { releaseWriter = resolve; });
        const commonWriterResult = commonWriter.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '1000ms'`);
            await lockServiceRecordWriteSet(tx, {
                branchId,
                clientId,
                caseId,
                scheduleIds: [scheduleId],
                employeeIds: [employeeId],
            });
            writerReady();
            await writerRelease;
        });
        await writerLocked;

        const lifecycle = new ServiceRecordLifecycleService(mirror as unknown as PrismaService);
        const mirroredSync = lifecycle.syncEndDateFromMirroredContract({
            branchId,
            clientId,
            endDate: new Date("2026-09-05T00:00:00.000Z"),
            documentId: mirrorDocumentId,
            detailSourceUpdatedDate: mirrorDetailSourceUpdatedDate,
            detailSyncedAt: mirrorDetailSyncedAt,
        });

        let mirrorWaitingForClientLock = false;
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const waiting = await observer.$queryRaw<Array<{ count: number }>>(Prisma.sql`
                SELECT count(*)::int AS count
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND wait_event_type = 'Lock'
                  AND state = 'active'
            `);
            if ((waiting[0]?.count ?? 0) > 0) {
                mirrorWaitingForClientLock = true;
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(mirrorWaitingForClientLock).toBe(true);

        const changedSourceUpdatedDate = new Date("2026-09-01T02:00:00.000Z");
        const changedSyncedAt = new Date("2026-09-01T02:01:00.000Z");
        await observer.eformsign_doc.update({
            where: { id: mirrorDocumentRowId },
            data: {
                clientId: null,
                detailSourceUpdatedDate: changedSourceUpdatedDate,
                detailSyncedAt: changedSyncedAt,
            },
        });
        await observer.eformsign_doc_file.updateMany({
            where: { eformsignDocId: mirrorDocumentRowId },
            data: { sourceUpdatedDate: changedSourceUpdatedDate },
        });

        releaseWriter();
        await expect(mirroredSync).resolves.toBe(false);
        await expect(commonWriterResult).resolves.toBeUndefined();

        const [clientAfter, caseAfter, documentAfter] = await Promise.all([
            observer.client.findUnique({
                where: { id: clientId },
                select: { endDate: true },
            }),
            observer.service_record_case.findUnique({
                where: { id: caseId },
                select: { endDate: true },
            }),
            observer.eformsign_doc.findUnique({
                where: { id: mirrorDocumentRowId },
                select: {
                    branchId: true,
                    clientId: true,
                    serviceRecordCaseId: true,
                    detailSourceUpdatedDate: true,
                    detailSyncedAt: true,
                },
            }),
        ]);
        expect(clientAfter?.endDate).toEqual(new Date("2026-09-02T00:00:00.000Z"));
        expect(caseAfter?.endDate).toEqual(new Date("2026-09-02T00:00:00.000Z"));
        expect(documentAfter).toMatchObject({
            branchId,
            clientId: null,
            serviceRecordCaseId: caseId,
            detailSourceUpdatedDate: changedSourceUpdatedDate,
            detailSyncedAt: changedSyncedAt,
        });

        await Promise.all([
            mirror.$disconnect(),
            commonWriter.$disconnect(),
            observer.$disconnect(),
        ]);
    });
});
