import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
} from "./helpers/service-record-confirm.helper";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

describeE2E("provider authoritative date context (actual disposable PostgreSQL)", () => {
    let prisma: ReturnType<typeof createApprovedServiceRecordConfirmClient>;
    let provider: ServiceRecordEntryService;
    let admin: AdminServiceRecordEditService;
    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
        provider = new ServiceRecordEntryService(prisma as never, {} as never,
            new ServiceRecordLifecycleService(prisma as never, createHolidayCalendarStub()), createHolidayCalendarStub());
        admin = new AdminServiceRecordEditService(new ServiceRecordEditRepository(prisma as never), createHolidayCalendarStub());
    });
    afterAll(async () => { await prisma?.$disconnect(); });

    function context(fixture: Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>) {
        return { tokenId: randomUUID(), branchId: fixture.branch.id, scheduleId: fixture.schedule.id,
            employeeId: fixture.employee.id, serviceRecordCaseId: fixture.record.id };
    }
    async function revisedFixture() {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const started = await admin.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        const draft = started.draft!;
        const saved = await admin.updateDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: draft.draftVersion, changes: {},
            dateMove: { sessionIndex: 3, toDate: "2026-09-11" },
        });
        const preview = await admin.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: saved.draft!.draftVersion,
        });
        await admin.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: saved.draft!.draftVersion, previewId: preview.previewId,
            idempotencyKey: randomUUID(),
        });
        return fixture;
    }

    it.each<Prisma.InputJsonValue>([
        { invalid: true },
        [{ sessionIndex: 1, serviceDate: "2026-09-07" }],
        Array.from({ length: 13 }, () => ({ sessionIndex: 1, serviceDate: "2026-09-07" })),
    ])("omits supplied invalid persisted vector from context: %j", async (vector) => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        await prisma.service_record_case.update({ where: { id: fixture.record.id }, data: { plannedSessions: vector } });
        expect(await provider.getContext(context(fixture))).not.toHaveProperty("plannedSessionDates");
    });

    it("retains only genuine absent legacy-vector compatibility", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        await prisma.service_record_case.update({ where: { id: fixture.record.id }, data: { plannedSessions: Prisma.DbNull } });
        const result = await provider.getContext(context(fixture));
        expect(result).not.toHaveProperty("plannedSessionDates");
        expect(result.totalSessions).toBe(13);
    });

    it("omits planned dates for a valid canonical vector", async () => {
        const fixture = await revisedFixture();
        const result = await provider.getContext(context(fixture));
        expect(result).not.toHaveProperty("plannedSessionDates");
    });

    it("keeps a revised case viewable when its vector becomes absent", async () => {
        const fixture = await revisedFixture();
        await prisma.service_record_case.update({ where: { id: fixture.record.id }, data: { plannedSessions: Prisma.DbNull } });
        expect(await provider.getContext(context(fixture))).not.toHaveProperty("plannedSessionDates");
    });
});
