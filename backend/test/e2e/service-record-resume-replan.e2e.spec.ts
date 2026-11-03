import { createHash, randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
} from "./helpers/service-record-confirm.helper";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

// The real incident, with synthetic rows: caregiver A served 2026-10-01, service paused
// 10-02..10-13 and resumed 10-14 with caregiver B. Written down by hand from the
// calendar (KR holidays in range: 10-03, 10-05, 10-09), never computed with production code.
const OLD_DATES = [
    "2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-12", "2026-10-13",
    "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
];
const NEW_DATES = [
    "2026-10-01", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21",
    "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02",
];

const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** 18:00 KST on the given date, so the fixture's submissions never precede their new date. */
const submittedAtFor = (date: string) => new Date(`${date}T09:00:00.000Z`);

/**
 * Synthetic fixture kept in the disposable database. Confirmed revisions are
 * append-only, so nothing is cleaned up afterwards.
 */
async function createResumeReplanFixture(prisma: PrismaClient, options: { resumeDay?: boolean } = {}) {
    // Resume day: only session 1 is written (by A) and the persisted vector still gives every
    // session to A, because the replacement flow never rewrites it.
    const resumeDay = options.resumeDay === true;
    assertApprovedServiceRecordConfirmDatabaseTarget();
    const fixtureId = randomUUID();
    const branch = await prisma.branch.create({
        data: { name: `Resume replan fixture ${fixtureId}`, slug: `resume-replan-${fixtureId}` },
    });
    const employeeData = (name: string) => ({
        branchId: branch.id,
        name,
        phone: `010${randomInt(10000000, 99999999)}`,
        workArea: ["resume-replan"],
        grade: "산모신생아 건강관리사",
    });
    const employeeA = await prisma.employee.create({ data: employeeData("Resume Caregiver A") });
    const employeeB = await prisma.employee.create({ data: employeeData("Resume Caregiver B") });
    const client = await prisma.client.create({
        data: {
            branchId: branch.id,
            name: "Resume Replan Client",
            bookingConfirmedAt: new Date("2026-01-01"),
            voucherClient: true,
            duration: 15,
            fullPrice: "1500000",
            grant: "900000",
            actualPrice: "600000",
            startDate: day("2026-10-01"),
            endDate: day("2026-10-23"),
            allowSaturdayService: false,
            allowSundayService: false,
            allowHolidayService: false,
        },
    });
    // A is created first, so its schedule id is the lower one (the successor order the editor relies on).
    const scheduleA = await prisma.employee_schedule.create({
        data: {
            branchId: branch.id,
            clientId: client.id,
            primaryEmployeeId: employeeA.id,
            workAddress: "Disposable resume-replan fixture",
            startDate: day("2026-10-01"),
            endDate: day("2026-10-14"),
            replaced: true,
        },
    });
    const scheduleB = await prisma.employee_schedule.create({
        data: {
            branchId: branch.id,
            clientId: client.id,
            primaryEmployeeId: employeeB.id,
            workAddress: "Disposable resume-replan fixture",
            startDate: day("2026-10-14"),
            endDate: day("2026-10-23"),
            replaced: false,
        },
    });
    const record = await prisma.service_record_case.create({
        data: {
            branchId: branch.id,
            clientId: client.id,
            startDate: day("2026-10-01"),
            endDate: day("2026-10-23"),
            requiredSessionCount: OLD_DATES.length,
            status: "IN_PROGRESS",
            momName: client.name,
            finalizationDueAt: new Date("2026-10-23T11:00:00.000Z"),
        },
    });
    const assignmentA = await prisma.service_record_assignment.create({
        data: {
            branchId: branch.id,
            serviceRecordCaseId: record.id,
            scheduleId: scheduleA.id,
            employeeId: employeeA.id,
            employeeNameSnapshot: employeeA.name,
            startDate: day("2026-10-01"),
            endDate: day("2026-10-14"),
        },
    });
    const assignmentB = await prisma.service_record_assignment.create({
        data: {
            branchId: branch.id,
            serviceRecordCaseId: record.id,
            scheduleId: scheduleB.id,
            employeeId: employeeB.id,
            employeeNameSnapshot: employeeB.name,
            startDate: day("2026-10-14"),
            endDate: day("2026-10-23"),
        },
    });
    const ownerOf = (index: number) => (index === 1 || resumeDay
        ? { assignment: assignmentA, schedule: scheduleA, employee: employeeA }
        : { assignment: assignmentB, schedule: scheduleB, employee: employeeB });
    await prisma.service_record_case.update({
        where: { id: record.id },
        data: {
            plannedSessions: OLD_DATES.map((serviceDate, offset) => ({
                sessionIndex: offset + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: ownerOf(offset + 1).assignment.id,
                scheduleId: ownerOf(offset + 1).schedule.id,
                employeeId: ownerOf(offset + 1).employee.id,
                provenanceVersion: "case-0",
            })),
        },
    });
    const days = [];
    for (const [offset, date] of OLD_DATES.entries()) {
        if (resumeDay && offset > 0) break;
        const owner = ownerOf(offset + 1);
        const newDate = NEW_DATES[offset]!;
        days.push(await prisma.service_record_day.create({
            data: {
                branchId: branch.id,
                serviceRecordCaseId: record.id,
                scheduleId: owner.schedule.id,
                employeeId: owner.employee.id,
                employeeNameSnapshot: owner.employee.name,
                caseSessionIndex: offset + 1,
                sessionIndex: offset + 1,
                serviceDate: day(date),
                locked: true,
                submittedAt: submittedAtFor(newDate),
                clientSignedAt: new Date(submittedAtFor(newDate).getTime() - 60_000),
                clientSignature: `fixture-signature-${fixtureId}-${offset}`,
                notes: `original-${offset + 1}`,
            },
        }));
    }
    const tokenData = (scheduleId: number, employeeId: number, label: string) => ({
        branchId: branch.id,
        scheduleId,
        employeeId,
        serviceRecordCaseId: record.id,
        linkTokenHash: createHash("sha256").update(`${fixtureId}:${label}`).digest("hex"),
        expectedPhoneHash: createHash("sha256").update(`${fixtureId}:phone:${label}`).digest("hex"),
    });
    // B's link expires 2026-10-24 00:00 KST; A's link was revoked at the replacement.
    const tokenB = await prisma.service_record_token.create({
        data: {
            ...tokenData(scheduleB.id, employeeB.id, "B"),
            active: true,
            expiresAt: new Date("2026-10-23T15:00:00.000Z"),
        },
    });
    const tokenA = await prisma.service_record_token.create({
        data: {
            ...tokenData(scheduleA.id, employeeA.id, "A"),
            active: false,
            revokedAt: new Date("2026-10-14T00:00:00.000Z"),
            expiresAt: new Date("2026-10-14T15:00:00.000Z"),
        },
    });
    const actor = await prisma.user.create({
        data: { name: "Resume Replan Test Admin", role: "admin", approvalStatus: "approved" },
    });
    await prisma.user_branch.create({ data: { userId: actor.id, branchId: branch.id, role: "admin" } });
    return {
        branch, client, record, days, tokenA, tokenB,
        assignmentA, assignmentB, scheduleA, scheduleB,
        actorUserId: actor.id,
    };
}

describeE2E("service-record resume replan (real disposable PostgreSQL)", () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
        // Guard before Prisma construction is mandatory: this suite may use only the
        // disposable task-4 loopback database.
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    it("re-plans sessions 2..15 from the resume date and writes the whole boundary in one confirm", async () => {
        const fixture = await createResumeReplanFixture(prisma);
        const editor = new AdminServiceRecordEditService(
            new ServiceRecordEditRepository(prisma as unknown as PrismaService),
            createHolidayCalendarStub(),
        );
        const started = await editor.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        const draft = started.draft;
        if (!draft) throw new Error("Resume replan fixture did not create an editor draft");

        const patched = await editor.updateDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: draft.draftVersion,
            changes: {},
            resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14" },
        });
        if (!patched.draft) throw new Error("Resume replan draft was not persisted");

        const preview = await editor.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: patched.draft.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        expect((preview as { warnings?: unknown[] }).warnings).toEqual([]);
        expect(preview.after.sessions.map(({ serviceDate }) => serviceDate)).toEqual(NEW_DATES);
        expect((preview as { assignmentPeriods?: unknown[] }).assignmentPeriods).toEqual([
            {
                assignmentId: fixture.assignmentA.id,
                employeeName: "Resume Caregiver A",
                before: { startDate: "2026-10-01", endDate: "2026-10-14" },
                after: { startDate: "2026-10-01", endDate: "2026-10-01" },
            },
            {
                assignmentId: fixture.assignmentB.id,
                employeeName: "Resume Caregiver B",
                before: { startDate: "2026-10-14", endDate: "2026-10-23" },
                after: { startDate: "2026-10-14", endDate: "2026-11-02" },
            },
        ]);

        const confirmed = await editor.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: patched.draft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: randomUUID(),
        });
        expect(confirmed.status).toBe("confirmed");

        // Day rows: only the date moved; content, submission and lock fields are as seeded.
        const rows = await prisma.service_record_day.findMany({
            where: { serviceRecordCaseId: fixture.record.id },
            orderBy: { sessionIndex: "asc" },
        });
        expect(rows.map((row) => row.serviceDate.toISOString().slice(0, 10))).toEqual(NEW_DATES);
        for (const [offset, row] of rows.entries()) {
            const seeded = fixture.days[offset]!;
            expect(row.notes).toBe(seeded.notes);
            expect(row.answers).toEqual(seeded.answers);
            expect(row.locked).toBe(true);
            expect(row.submittedAt?.toISOString()).toBe(seeded.submittedAt?.toISOString());
            expect(row.clientSignedAt?.toISOString()).toBe(seeded.clientSignedAt?.toISOString());
            expect(row.clientSignature).toBe(seeded.clientSignature);
        }

        // Case, client and the due time follow the new end date; originalDate survives in the vector.
        const record = await prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } });
        expect(record.endDate?.toISOString().slice(0, 10)).toBe("2026-11-02");
        expect(record.finalizationDueAt?.toISOString()).toBe("2026-11-02T11:00:00.000Z");
        const planned = record.plannedSessions as Array<{ serviceDate: string; originalDate: string }>;
        expect(planned.map((entry) => entry.serviceDate)).toEqual(NEW_DATES);
        expect(planned.map((entry) => entry.originalDate)).toEqual(OLD_DATES);
        const client = await prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } });
        expect(client.endDate?.toISOString().slice(0, 10)).toBe("2026-11-02");

        // Assignment boundary, in both the assignment and its schedule.
        const [assignmentA, assignmentB] = await Promise.all([
            prisma.service_record_assignment.findUniqueOrThrow({ where: { id: fixture.assignmentA.id } }),
            prisma.service_record_assignment.findUniqueOrThrow({ where: { id: fixture.assignmentB.id } }),
        ]);
        const [scheduleA, scheduleB] = await Promise.all([
            prisma.employee_schedule.findUniqueOrThrow({ where: { id: fixture.scheduleA.id } }),
            prisma.employee_schedule.findUniqueOrThrow({ where: { id: fixture.scheduleB.id } }),
        ]);
        const range = (row: { startDate: Date; endDate: Date }) => [
            row.startDate.toISOString().slice(0, 10),
            row.endDate.toISOString().slice(0, 10),
        ];
        expect(range(assignmentA)).toEqual(["2026-10-01", "2026-10-01"]);
        expect(range(scheduleA)).toEqual(["2026-10-01", "2026-10-01"]);
        expect(range(assignmentB)).toEqual(["2026-10-14", "2026-11-02"]);
        expect(range(scheduleB)).toEqual(["2026-10-14", "2026-11-02"]);

        // The active link is raised to midnight KST after the new end; the revoked one is untouched.
        const [tokenA, tokenB] = await Promise.all([
            prisma.service_record_token.findUniqueOrThrow({ where: { id: fixture.tokenA.id } }),
            prisma.service_record_token.findUniqueOrThrow({ where: { id: fixture.tokenB.id } }),
        ]);
        expect(tokenB.expiresAt.toISOString()).toBe("2026-11-02T15:00:00.000Z");
        expect(tokenA.expiresAt.toISOString()).toBe(fixture.tokenA.expiresAt.toISOString());
        expect(tokenA.revokedAt?.toISOString()).toBe(fixture.tokenA.revokedAt?.toISOString());
    });

    it("hands sessions 2..15 to B on resume day, before B has written a row, without extending A", async () => {
        const fixture = await createResumeReplanFixture(prisma, { resumeDay: true });
        const editor = new AdminServiceRecordEditService(
            new ServiceRecordEditRepository(prisma as unknown as PrismaService),
            createHolidayCalendarStub(),
        );
        const started = await editor.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        const draft = started.draft;
        if (!draft) throw new Error("Resume replan fixture did not create an editor draft");

        // No incomingAssignmentId: B is the one live caregiver that follows the replaced A.
        const patched = await editor.updateDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: draft.draftVersion,
            changes: {},
            resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14" },
        });
        if (!patched.draft) throw new Error("Resume replan draft was not persisted");

        const preview = await editor.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: patched.draft.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        expect((preview as { warnings?: unknown[] }).warnings).toEqual([]);
        expect(preview.after.sessions.map(({ serviceDate }) => serviceDate)).toEqual(NEW_DATES);
        expect(preview.after.sessions.map(({ assignmentId }) => assignmentId)).toEqual([
            fixture.assignmentA.id,
            ...Array<string>(14).fill(fixture.assignmentB.id),
        ]);

        const confirmed = await editor.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: patched.draft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: randomUUID(),
        });
        expect(confirmed.status).toBe("confirmed");

        // The vector hands 2..15 to B; the one written row is still A's, with only its content as seeded.
        const record = await prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } });
        const planned = record.plannedSessions as Array<{ serviceDate: string; originalDate: string; assignmentId: string }>;
        expect(planned.map((entry) => entry.serviceDate)).toEqual(NEW_DATES);
        expect(planned.map((entry) => entry.originalDate)).toEqual(OLD_DATES);
        expect(planned.map((entry) => entry.assignmentId)).toEqual([
            fixture.assignmentA.id,
            ...Array<string>(14).fill(fixture.assignmentB.id),
        ]);
        const rows = await prisma.service_record_day.findMany({ where: { serviceRecordCaseId: fixture.record.id } });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.scheduleId).toBe(fixture.scheduleA.id);
        expect(rows[0]?.notes).toBe(fixture.days[0]!.notes);
        expect(record.finalizationDueAt?.toISOString()).toBe("2026-11-02T11:00:00.000Z");

        const range = (row: { startDate: Date; endDate: Date }) => [
            row.startDate.toISOString().slice(0, 10),
            row.endDate.toISOString().slice(0, 10),
        ];
        const [assignmentA, assignmentB, scheduleA, scheduleB] = await Promise.all([
            prisma.service_record_assignment.findUniqueOrThrow({ where: { id: fixture.assignmentA.id } }),
            prisma.service_record_assignment.findUniqueOrThrow({ where: { id: fixture.assignmentB.id } }),
            prisma.employee_schedule.findUniqueOrThrow({ where: { id: fixture.scheduleA.id } }),
            prisma.employee_schedule.findUniqueOrThrow({ where: { id: fixture.scheduleB.id } }),
        ]);
        expect(range(assignmentA)).toEqual(["2026-10-01", "2026-10-01"]);
        expect(range(scheduleA)).toEqual(["2026-10-01", "2026-10-01"]);
        expect(range(assignmentB)).toEqual(["2026-10-14", "2026-11-02"]);
        expect(range(scheduleB)).toEqual(["2026-10-14", "2026-11-02"]);

        const [tokenA, tokenB] = await Promise.all([
            prisma.service_record_token.findUniqueOrThrow({ where: { id: fixture.tokenA.id } }),
            prisma.service_record_token.findUniqueOrThrow({ where: { id: fixture.tokenB.id } }),
        ]);
        expect(tokenB.expiresAt.toISOString()).toBe("2026-11-02T15:00:00.000Z");
        expect(tokenA.expiresAt.toISOString()).toBe(fixture.tokenA.expiresAt.toISOString());
    });

    it("continues the golden incident: a header-only confirm on the corrected record moves no boundary and the owners still match the writers", async () => {
        const fixture = await createResumeReplanFixture(prisma);
        const editor = new AdminServiceRecordEditService(
            new ServiceRecordEditRepository(prisma as unknown as PrismaService),
            createHolidayCalendarStub(),
        );
        const cycle = async (edit: { changes: Record<string, unknown>; resumeReplan?: Record<string, unknown> }) => {
            const started = await editor.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
            const draft = started.draft;
            if (!draft) throw new Error("Resume replan fixture did not create an editor draft");
            const patched = await editor.updateDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
                expectedDraftVersion: draft.draftVersion,
                ...edit,
            } as never);
            if (!patched.draft) throw new Error("Editor draft was not persisted");
            const preview = await editor.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
                expectedDraftVersion: patched.draft.draftVersion,
            });
            expect(preview.blockingReasons).toEqual([]);
            const confirmed = await editor.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
                expectedDraftVersion: patched.draft.draftVersion,
                previewId: preview.previewId,
                idempotencyKey: randomUUID(),
            });
            return { preview, confirmed };
        };
        const range = (row: { startDate: Date; endDate: Date }) => [
            row.startDate.toISOString().slice(0, 10),
            row.endDate.toISOString().slice(0, 10),
        ];
        const boundaries = async () => {
            const [assignmentA, assignmentB, scheduleA, scheduleB] = await Promise.all([
                prisma.service_record_assignment.findUniqueOrThrow({ where: { id: fixture.assignmentA.id } }),
                prisma.service_record_assignment.findUniqueOrThrow({ where: { id: fixture.assignmentB.id } }),
                prisma.employee_schedule.findUniqueOrThrow({ where: { id: fixture.scheduleA.id } }),
                prisma.employee_schedule.findUniqueOrThrow({ where: { id: fixture.scheduleB.id } }),
            ]);
            return [assignmentA, scheduleA, assignmentB, scheduleB].map(range);
        };

        // Step 1: the resume correction (asserted in full by the first test).
        const resumed = await cycle({ changes: {}, resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14" } });
        expect(resumed.confirmed.status).toBe("confirmed");
        const corrected = [
            ["2026-10-01", "2026-10-01"], ["2026-10-01", "2026-10-01"],
            ["2026-10-14", "2026-11-02"], ["2026-10-14", "2026-11-02"],
        ];
        expect(await boundaries()).toEqual(corrected);

        // Step 2: reload and edit only the header. It confirms as a new revision with no boundary change.
        const before = await prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } });
        const header = await cycle({ changes: { header: { momName: "Resume Replan Client (edited)" } } });
        expect(header.confirmed.status).toBe("confirmed");
        expect(header.confirmed.revisionNumber).toBe((resumed.confirmed.revisionNumber ?? 0) + 1);
        expect(await boundaries()).toEqual(corrected);
        const after = await prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } });
        expect(after.momName).toBe("Resume Replan Client (edited)");
        expect(after.version).toBe(before.version + 1);
        expect(after.endDate?.toISOString().slice(0, 10)).toBe("2026-11-02");
        expect(after.finalizationDueAt?.toISOString()).toBe("2026-11-02T11:00:00.000Z");
        expect(after.currentRevisionId).toBe(header.confirmed.revisionId);

        // Step 3: what finalization requires of a persisted record. Every day's date and writer equal the
        // stored vector's date and owner, and each owner's assignment carries that schedule and employee.
        const planned = after.plannedSessions as Array<{
            sessionIndex: number; serviceDate: string; assignmentId: string; scheduleId: number; employeeId: number;
        }>;
        const days = await prisma.service_record_day.findMany({
            where: { serviceRecordCaseId: fixture.record.id },
            orderBy: { caseSessionIndex: "asc" },
        });
        const assignments = await prisma.service_record_assignment.findMany({ where: { serviceRecordCaseId: fixture.record.id } });
        expect(days).toHaveLength(planned.length);
        for (const entry of planned) {
            const day = days.find((row) => row.caseSessionIndex === entry.sessionIndex)!;
            const assignment = assignments.find((row) => row.id === entry.assignmentId)!;
            expect(day.serviceDate.toISOString().slice(0, 10)).toBe(entry.serviceDate);
            expect(day.scheduleId).toBe(entry.scheduleId);
            expect(day.employeeId).toBe(entry.employeeId);
            expect(assignment.scheduleId).toBe(entry.scheduleId);
            expect(assignment.employeeId).toBe(entry.employeeId);
        }
    });
});
