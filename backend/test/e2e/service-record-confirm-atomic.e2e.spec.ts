import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
    ORIGINAL_THIRTEEN_DATES,
    SHIFTED_THIRTEEN_DATES,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

describeE2E("atomic service-record confirmation (real disposable PostgreSQL)", () => {
    let prisma: ReturnType<typeof createApprovedServiceRecordConfirmClient>;
    let service: AdminServiceRecordEditService;

    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
        service = new AdminServiceRecordEditService(new ServiceRecordEditRepository(prisma as PrismaService));
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    async function prepare(move = true) {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const started = await service.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        let draft = started.draft!;
        if (move) {
            const saved = await service.updateDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
                expectedDraftVersion: draft.draftVersion,
                changes: { sessions: [{ sessionIndex: 3, notes: "Confirmed content" }] },
                dateMove: { sessionIndex: 3, toDate: "2026-09-11" },
            });
            draft = saved.draft!;
        }
        const preview = await service.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: draft.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        return {
            fixture, draft, preview,
            request: {
                expectedDraftVersion: draft.draftVersion,
                previewId: preview.previewId,
                idempotencyKey: randomUUID(),
            },
        };
    }

    it("commits dates/content once for concurrent retries and preserves signatures, N and prices", async () => {
        const { fixture, draft, request } = await prepare();
        const [first, concurrent] = await Promise.all([
            service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request),
            service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request),
        ]);
        expect(first).toEqual(concurrent);
        expect(first).toMatchObject({ status: "confirmed", caseId: fixture.record.id, clientId: fixture.client.id });
        expect(first.revisionId).toBeTruthy();
        expect(first.documentStatus).toBe("waiting_for_completion");
        const revision = await prisma.service_record_revision.findUniqueOrThrow({ where: { id: first.revisionId! } });
        expect(revision.payload).toMatchObject({ completeness: "partial", sessions: expect.arrayContaining([
            expect.objectContaining({ sessionIndex: 3, clientSignature: fixture.days[2]?.clientSignature,
                employeeNameSnapshot: fixture.days[2]?.employeeNameSnapshot, locked: true }),
        ]) });
        const [client, record, schedule, assignment, days, revisionCount, jobCount] = await Promise.all([
            prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }),
            prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }),
            prisma.employee_schedule.findUniqueOrThrow({ where: { id: fixture.schedule.id } }),
            prisma.service_record_assignment.findUniqueOrThrow({ where: { id: fixture.assignment.id } }),
            prisma.service_record_day.findMany({
                where: { serviceRecordCaseId: fixture.record.id }, orderBy: { caseSessionIndex: "asc" },
            }),
            prisma.service_record_revision.count({ where: { serviceRecordCaseId: fixture.record.id } }),
            prisma.eformsign_document_job.count({ where: { clientId: fixture.client.id } }),
        ]);
        expect(client).toMatchObject({
            duration: 15, fullPrice: "1500000", grant: "900000", actualPrice: "600000",
            startDate: fixture.client.startDate, endDate: new Date("2026-09-29T00:00:00.000Z"),
        });
        expect(record).toMatchObject({ requiredSessionCount: 13, currentRevisionId: first.revisionId, version: first.caseVersion });
        expect(schedule.endDate).toEqual(client.endDate);
        expect(assignment.endDate).toEqual(client.endDate);
        expect(revisionCount).toBe(1);
        expect(days).toHaveLength(3); // No fabricated future submission rows.
        expect(days.map((day) => day.serviceDate.toISOString().slice(0, 10))).toEqual(SHIFTED_THIRTEEN_DATES.slice(0, 3));
        for (const [index, day] of days.entries()) {
            const original = fixture.days[index];
            if (!original) throw new Error("Unexpected fabricated service record day");
            expect(day).toMatchObject({
                id: original.id,
                employeeId: original.employeeId,
                clientSignature: original.clientSignature,
                clientSignedAt: original.clientSignedAt,
                submittedAt: original.submittedAt,
                locked: true,
            });
        }
        expect(days[2]?.notes).toBe("Confirmed content");
        const source = await new ServiceRecordEditRepository(prisma as PrismaService)
            .loadSource(fixture.branch.id, { caseId: fixture.record.id });
        expect(source?.plannedSessions).toHaveLength(13);
        expect(source?.plannedSessions).toEqual(expect.arrayContaining(
            SHIFTED_THIRTEEN_DATES.map((serviceDate, index) => expect.objectContaining({
                sessionIndex: index + 1, serviceDate, originalDate: ORIGINAL_THIRTEEN_DATES[index],
            })),
        ));
        expect(await service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request)).toEqual(first);
        expect(await prisma.eformsign_document_job.count({ where: { clientId: fixture.client.id } })).toBe(jobCount);
        await expect(service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            ...request, expectedDraftVersion: request.expectedDraftVersion + 1,
        })).rejects.toBeInstanceOf(ConflictException);
    });

    it("allows a second revision while keeping first dates and earlier confirmation replay immutable", async () => {
        const { fixture, draft, request } = await prepare();
        const first = await service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request);
        const originalRevision = await prisma.service_record_revision.findUniqueOrThrow({
            where: { id: first.revisionId! },
        });
        const resumed = await service.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        expect(resumed.draft?.id).not.toBe(draft.id);
        const next = resumed.draft!;
        const changed = await service.updateDraft(fixture.branch.id, next.id, fixture.actorUserId, {
            expectedDraftVersion: next.draftVersion,
            changes: {},
            dateMove: { sessionIndex: 3, toDate: "2026-09-09" },
        });
        const preview = await service.previewDraft(fixture.branch.id, next.id, fixture.actorUserId, {
            expectedDraftVersion: changed.draft!.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        expect(preview.after.sessions.map((entry) => entry.originalDate)).toEqual(ORIGINAL_THIRTEEN_DATES);
        expect(preview.after.sessions.map((entry) => entry.serviceDate)).toEqual(ORIGINAL_THIRTEEN_DATES);
        const second = await service.confirmDraft(fixture.branch.id, next.id, fixture.actorUserId, {
            expectedDraftVersion: changed.draft!.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: randomUUID(),
        });
        expect(second.revisionNumber).toBe(first.revisionNumber! + 1);
        expect(second.revisionId).not.toBe(first.revisionId);
        expect(await prisma.service_record_revision.findUniqueOrThrow({ where: { id: first.revisionId! } }))
            .toEqual(originalRevision);
        expect(await service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request)).toEqual(first);
        expect(await prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .toMatchObject({ endDate: fixture.client.endDate, duration: 15, actualPrice: "600000" });
        const days = await prisma.service_record_day.findMany({
            where: { serviceRecordCaseId: fixture.record.id }, orderBy: { caseSessionIndex: "asc" },
        });
        expect(days).toHaveLength(3);
        expect(days.map((entry) => entry.serviceDate.toISOString().slice(0, 10)))
            .toEqual(ORIGINAL_THIRTEEN_DATES.slice(0, 3));
        expect(days[2]?.notes).toBe("Confirmed content");
    });

    it("persists explicitly edited future content without inventing a submission or signature", async () => {
        const { fixture, draft } = await prepare(false);
        const saved = await service.updateDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: draft.draftVersion,
            changes: { sessions: [{ sessionIndex: 4, notes: "Administrator future note" }] },
        });
        const preview = await service.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: saved.draft!.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        const result = await service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: saved.draft!.draftVersion, previewId: preview.previewId, idempotencyKey: randomUUID(),
        });
        expect(result.status).toBe("confirmed");
        const day = await prisma.service_record_day.findUnique({ where: {
            serviceRecordCaseId_caseSessionIndex: { serviceRecordCaseId: fixture.record.id, caseSessionIndex: 4 },
        } });
        expect(day).toMatchObject({ notes: "Administrator future note", locked: false,
            submittedAt: null, clientSignature: null, clientSignedAt: null,
            scheduleId: fixture.schedule.id, employeeId: fixture.employee.id,
            serviceDate: new Date("2026-09-10T00:00:00Z"),
        });
        expect(await prisma.service_record_day.count({ where: { serviceRecordCaseId: fixture.record.id } })).toBe(4);
        expect(await prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .toMatchObject({ endDate: fixture.client.endDate, duration: 15, actualPrice: "600000" });
    });

    it("persists a replayable no-change result without a revision or document job", async () => {
        const { fixture, draft, request } = await prepare(false);
        const first = await service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request);
        expect(first).toMatchObject({ status: "no_changes", revisionId: null, revisionNumber: null });
        expect(await service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request)).toEqual(first);
        expect(await prisma.service_record_revision.count({ where: { serviceRecordCaseId: fixture.record.id } })).toBe(0);
        expect(await prisma.eformsign_document_job.count({ where: { clientId: fixture.client.id } })).toBe(0);
        expect(await prisma.service_record_edit_draft.findUniqueOrThrow({ where: { id: draft.id } }))
            .toMatchObject({ status: "CONFIRMED", confirmationResponse: first });
    });

    it("rejects a foreign branch and a stale preview while preserving the active draft", async () => {
        const { fixture, draft, request } = await prepare();
        const otherBranch = await prisma.branch.create({ data: { name: "Other confirm branch", slug: randomUUID() } });
        await expect(service.confirmDraft(otherBranch.id, draft.id, fixture.actorUserId, request))
            .rejects.toBeInstanceOf(NotFoundException);
        await prisma.service_record_case.update({
            where: { id: fixture.record.id }, data: { version: { increment: 1 } },
        });
        await expect(service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request))
            .rejects.toBeInstanceOf(ConflictException);
        expect(await prisma.service_record_edit_draft.findUniqueOrThrow({ where: { id: draft.id } }))
            .toMatchObject({ status: "ACTIVE", draftVersion: draft.draftVersion });
        expect(await prisma.service_record_revision.count({ where: { serviceRecordCaseId: fixture.record.id } })).toBe(0);
        expect(await prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .toMatchObject({ endDate: fixture.client.endDate, duration: 15 });
    });
});
