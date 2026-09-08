import { PrismaClient } from "@prisma/client";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
} from "./helpers/service-record-confirm.helper";

const E2E_ENABLED = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1";
const describeE2E = E2E_ENABLED ? describe : describe.skip;

type FaultBoundary =
    | "client"
    | "case"
    | "day"
    | "future_day"
    | "assignment"
    | "schedule"
    | "revision"
    | "draft"
    | "job"
    | "intent";

function rawSqlContains(args: unknown, needle: string): boolean {
    if (!args || typeof args !== "object" || !("strings" in args)) return false;
    const strings = (args as { strings?: unknown })["strings"];
    return Array.isArray(strings) && strings.join("").includes(needle);
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

    it.each<FaultBoundary>([
        "client",
        "case",
        "day",
        "future_day",
        "assignment",
        "schedule",
        "revision",
        "draft",
        "job",
        "intent",
    ])("rolls back every owning write when the %s boundary fails", async (boundary) => {
        // Fixtures intentionally remain in the disposable task database. The
        // helper's signed rows and any revision history are part of the
        // append-only acceptance evidence and are not broad-deleted here.
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const ordinaryService = new AdminServiceRecordEditService(new ServiceRecordEditRepository(prisma as never));
        const started = await ordinaryService.startDraft(
            fixture.branch.id,
            fixture.client.id,
            fixture.actorUserId,
            {},
        );
        const draft = started.draft;
        if (!draft) throw new Error("confirm rollback fixture did not create a draft");
        const changed = await ordinaryService.updateDraft(
            fixture.branch.id,
            draft.id,
            fixture.actorUserId,
            {
                expectedDraftVersion: draft.draftVersion,
                changes: { sessions: [{ sessionIndex: boundary === "future_day" ? 4 : 3, notes: "rollback content" }] },
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

        let injectFailure = false;
        let faultReached = false;
        const faultedClient = prisma.$extends({
            query: {
                $allOperations: async ({ model, operation, args, query }) => {
                    const result = await query(args);
                    const modelOperation = `${model ?? ""}:${operation}`;
                    const hit = boundary === "job"
                        ? operation === "$queryRaw" && rawSqlContains(args, 'INSERT INTO "eformsign_document_job"')
                        : modelOperation === {
                            client: "client:updateMany",
                            case: "service_record_case:update",
                            day: "service_record_day:updateMany",
                            future_day: "service_record_day:create",
                            assignment: "service_record_assignment:updateMany",
                            schedule: "employee_schedule:updateMany",
                            revision: "service_record_revision:create",
                            draft: "service_record_edit_draft:updateMany",
                            job: "never:never",
                            intent: "message_trigger_job:upsert",
                        }[boundary];
                    if (injectFailure && hit) {
                        faultReached = true;
                        throw new Error(`ROLLBACK_AFTER_${boundary.toUpperCase()}_WRITE`);
                    }
                    return result;
                },
            },
        });
        injectFailure = true;
        const faultedService = new AdminServiceRecordEditService(
            new ServiceRecordEditRepository(faultedClient as never),
        );

        await expect(faultedService.confirmDraft(
            fixture.branch.id,
            draft.id,
            fixture.actorUserId,
            {
                expectedDraftVersion: changed.draft!.draftVersion,
                previewId: preview.previewId,
                idempotencyKey: "11111111-1111-4111-8111-111111111111",
            },
        )).rejects.toThrow(`ROLLBACK_AFTER_${boundary.toUpperCase()}_WRITE`);
        expect(faultReached).toBe(true);

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
    });
});
