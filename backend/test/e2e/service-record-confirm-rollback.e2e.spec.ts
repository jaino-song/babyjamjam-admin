import { PrismaClient } from "@prisma/client";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
    ORIGINAL_THIRTEEN_DATES,
} from "./helpers/service-record-confirm.helper";

const E2E_ENABLED = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1";
const describeE2E = E2E_ENABLED ? describe : describe.skip;

/**
 * Materialize the complete persisted vector required by the confirm policy.
 * The helper deliberately creates only three signed rows; the remaining ten
 * rows represent future/unwritten sessions and must still survive a rollback.
 */
async function completeFixture(prisma: PrismaClient) {
    const fixture = await createServiceRecordConfirmFixture(prisma);
    const plannedSessions = ORIGINAL_THIRTEEN_DATES.map((serviceDate, offset) => ({
        sessionIndex: offset + 1,
        serviceDate,
        originalDate: serviceDate,
        assignmentId: fixture.assignment.id,
        scheduleId: fixture.schedule.id,
        employeeId: fixture.employee.id,
        provenanceVersion: `case-${fixture.record.version}`,
    }));
    await prisma.service_record_case.update({
        where: { id: fixture.record.id },
        data: { plannedSessions },
    });

    const extraDays = [];
    for (const [offset, serviceDate] of ORIGINAL_THIRTEEN_DATES.slice(3).entries()) {
        const sessionIndex = offset + 4;
        extraDays.push(await prisma.service_record_day.create({
            data: {
                branchId: fixture.branch.id,
                serviceRecordCaseId: fixture.record.id,
                scheduleId: fixture.schedule.id,
                employeeId: fixture.employee.id,
                employeeNameSnapshot: fixture.employee.name,
                caseSessionIndex: sessionIndex,
                sessionIndex,
                serviceDate: new Date(`${serviceDate}T00:00:00.000Z`),
                locked: false,
            },
        }));
    }
    return { ...fixture, extraDays };
}

async function removeFixture(
    prisma: PrismaClient,
    fixture: Awaited<ReturnType<typeof completeFixture>> | undefined,
    draftId: string | undefined,
) {
    if (!fixture) return;
    const dayIds = [...fixture.days, ...fixture.extraDays]
        .map((day) => day.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (dayIds.length > 0) {
        await prisma.service_record_day.deleteMany({ where: { id: { in: dayIds } } });
    }

    // Confirmed revisions are append-only. A passing rollback leaves none;
    // this exact-ID cleanup intentionally does not issue a broad revision
    // delete that could weaken that retention contract.
    if (draftId) {
        await prisma.service_record_edit_draft.deleteMany({ where: { id: draftId } });
    }
    await prisma.service_record_assignment.deleteMany({ where: { id: fixture.assignment.id } });
    await prisma.employee_schedule.deleteMany({ where: { id: fixture.schedule.id } });
    await prisma.service_record_case.deleteMany({ where: { id: fixture.record.id } });
    await prisma.client.deleteMany({ where: { id: fixture.client.id } });
    await prisma.employee.deleteMany({ where: { id: fixture.employee.id } });
    await prisma.user_branch.deleteMany({ where: { userId: fixture.actorUserId, branchId: fixture.branch.id } });
    await prisma.user.deleteMany({ where: { id: fixture.actorUserId } });
    await prisma.branch.deleteMany({ where: { id: fixture.branch.id } });
}

describeE2E("service-record confirmation rollback (real disposable PostgreSQL)", () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    it("rolls back revision, case/client/day/schedule writes and draft finalization", async () => {
        let fixture: Awaited<ReturnType<typeof completeFixture>> | undefined;
        let draftId: string | undefined;
        try {
            fixture = await completeFixture(prisma);
            const ordinaryRepository = new ServiceRecordEditRepository(prisma as never);
            const ordinaryService = new AdminServiceRecordEditService(ordinaryRepository);
            const started = await ordinaryService.startDraft(
                fixture.branch.id,
                fixture.client.id,
                fixture.actorUserId,
                {},
            );
            const draft = started.draft;
            if (!draft) throw new Error("confirm rollback fixture did not create a draft");
            draftId = draft.id;
            const changed = await ordinaryService.updateDraft(
                fixture.branch.id,
                draft.id,
                fixture.actorUserId,
                {
                    expectedDraftVersion: draft.draftVersion,
                    changes: {},
                    dateMove: { sessionIndex: 3, toDate: "2026-09-11" },
                },
            );
            const preview = await ordinaryService.previewDraft(
                fixture.branch.id,
                draft.id,
                fixture.actorUserId,
                { expectedDraftVersion: changed.draft!.draftVersion },
            );
            expect(preview.blockingReasons).toEqual([]);

            const [beforeClient, beforeCase, beforeDays, beforeAssignment, beforeSchedule, beforeDraft, beforeRevisions, beforeDocumentJobs] = await Promise.all([
                prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }),
                prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }),
                prisma.service_record_day.findMany({
                    where: { serviceRecordCaseId: fixture.record.id },
                    orderBy: { caseSessionIndex: "asc" },
                }),
                prisma.service_record_assignment.findUniqueOrThrow({ where: { id: fixture.assignment.id } }),
                prisma.employee_schedule.findUniqueOrThrow({ where: { id: fixture.schedule.id } }),
                prisma.service_record_edit_draft.findUniqueOrThrow({ where: { id: draft.id } }),
                prisma.service_record_revision.count({ where: { serviceRecordCaseId: fixture.record.id } }),
                prisma.eformsign_document_job.findMany({ where: { clientId: fixture.client.id }, select: { id: true } }),
            ]);

            const writes = {
                client: 0,
                case: 0,
                day: 0,
                revision: 0,
            };
            let injectFailure = false;
            const faultedClient = prisma.$extends({
                query: {
                    $allOperations: async ({ model, operation, args, query }) => {
                        if (injectFailure && model === "service_record_edit_draft" && operation === "updateMany") {
                            const data = (args as { data?: Record<string, unknown> }).data;
                            if (data?.["status"] === "CONFIRMED") {
                                expect(writes.client).toBeGreaterThan(0);
                                expect(writes.case).toBeGreaterThan(0);
                                expect(writes.day).toBeGreaterThan(0);
                                expect(writes.revision).toBeGreaterThan(0);
                                throw new Error("ROLLBACK_AFTER_CONFIRM_WRITES");
                            }
                        }
                        const result = await query(args);
                        if (injectFailure && model === "client" && operation === "updateMany") writes.client += 1;
                        if (injectFailure && model === "service_record_case" && operation === "update") writes.case += 1;
                        if (injectFailure && model === "service_record_day" && operation === "updateMany") writes.day += 1;
                        if (injectFailure && model === "service_record_revision" && operation === "create") writes.revision += 1;
                        return result;
                    },
                },
            });
            injectFailure = true;
            const faultedRepository = new ServiceRecordEditRepository(faultedClient as never);
            const faultedService = new AdminServiceRecordEditService(faultedRepository);

            await expect(faultedService.confirmDraft(
                fixture.branch.id,
                draft.id,
                fixture.actorUserId,
                {
                    expectedDraftVersion: changed.draft!.draftVersion,
                    previewId: preview.previewId,
                    idempotencyKey: "11111111-1111-4111-8111-111111111111",
                },
            )).rejects.toThrow("ROLLBACK_AFTER_CONFIRM_WRITES");

            expect(writes.client).toBeGreaterThan(0);
            expect(writes.case).toBeGreaterThan(0);
            expect(writes.day).toBeGreaterThan(0);
            expect(writes.revision).toBeGreaterThan(0);

            const [afterClient, afterCase, afterDays, afterAssignment, afterSchedule, afterDraft, afterRevisions, afterDocumentJobs] = await Promise.all([
                prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }),
                prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }),
                prisma.service_record_day.findMany({
                    where: { serviceRecordCaseId: fixture.record.id },
                    orderBy: { caseSessionIndex: "asc" },
                }),
                prisma.service_record_assignment.findUniqueOrThrow({ where: { id: fixture.assignment.id } }),
                prisma.employee_schedule.findUniqueOrThrow({ where: { id: fixture.schedule.id } }),
                prisma.service_record_edit_draft.findUniqueOrThrow({ where: { id: draft.id } }),
                prisma.service_record_revision.count({ where: { serviceRecordCaseId: fixture.record.id } }),
                prisma.eformsign_document_job.findMany({ where: { clientId: fixture.client.id }, select: { id: true } }),
            ]);

            expect(afterClient).toEqual(beforeClient);
            expect(afterCase).toEqual(beforeCase);
            expect(afterDays).toEqual(beforeDays);
            expect(afterAssignment).toEqual(beforeAssignment);
            expect(afterSchedule).toEqual(beforeSchedule);
            expect(afterDraft).toEqual(beforeDraft);
            expect(afterRevisions).toBe(beforeRevisions);
            expect(afterDocumentJobs).toEqual(beforeDocumentJobs);
        } finally {
            await removeFixture(prisma, fixture, draftId);
        }
    });
});
