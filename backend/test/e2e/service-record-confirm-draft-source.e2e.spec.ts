import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
    serviceRecordConfirmBarrier,
    ORIGINAL_THIRTEEN_DATES,
    SHIFTED_THIRTEEN_DATES,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

describeE2E("admin confirmation draft source (real disposable PostgreSQL)", () => {
    let prisma: ReturnType<typeof createApprovedServiceRecordConfirmClient>;

    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    it("previews all 13 dates without changing confirmed dates, signatures, or 15-day pricing", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        // Instantiate only the production repository/service. No application
        // module, scheduler, external provider, or default database client runs.
        const repository = new ServiceRecordEditRepository(prisma as PrismaService);
        const service = new AdminServiceRecordEditService(repository);
        const started = await service.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        expect(started.draft).not.toBeNull();
        const draft = started.draft!;
        const changed = await service.updateDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: draft.draftVersion,
            changes: {},
            dateMove: { sessionIndex: 3, toDate: "2026-09-11" },
        });
        const preview = await service.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: changed.draft!.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        expect(preview.requiredSessionCount).toBe(13);
        expect(preview.before.sessions.map((session) => session.serviceDate)).toEqual(ORIGINAL_THIRTEEN_DATES);
        expect(preview.after.sessions.map((session) => session.serviceDate)).toEqual(SHIFTED_THIRTEEN_DATES);
        expect(preview.after.sessions.map((session) => session.originalDate)).toEqual(ORIGINAL_THIRTEEN_DATES);
        const [client, record, days, revisionCount] = await Promise.all([
            prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }),
            prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } }),
            prisma.service_record_day.findMany({
                where: { serviceRecordCaseId: fixture.record.id }, orderBy: { caseSessionIndex: "asc" },
            }),
            prisma.service_record_revision.count({ where: { serviceRecordCaseId: fixture.record.id } }),
        ]);
        expect(client).toMatchObject({
            duration: 15, fullPrice: "1500000", grant: "900000", actualPrice: "600000",
            startDate: fixture.client.startDate, endDate: fixture.client.endDate,
        });
        expect(record).toMatchObject({ requiredSessionCount: 13, endDate: fixture.record.endDate });
        expect(days).toEqual(fixture.days);
        expect(revisionCount).toBe(0);
    });

    it("keeps draft and source in one snapshot when a concurrent transaction changes both", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const ordinaryRepository = new ServiceRecordEditRepository(prisma as PrismaService);
        const service = new AdminServiceRecordEditService(ordinaryRepository);
        const started = await service.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        const draft = started.draft!;
        const firstRead = serviceRecordConfirmBarrier();
        const resume = serviceRecordConfirmBarrier();
        let paused = false;
        const reader = prisma.$extends({
            query: {
                service_record_edit_draft: {
                    async findFirst({ args, query }) {
                        const result = await query(args);
                        if (!paused && result?.id === draft.id) {
                            paused = true;
                            firstRead.release();
                            await resume.entered;
                        }
                        return result;
                    },
                },
            },
        });
        const repository = new ServiceRecordEditRepository(reader as unknown as PrismaService);
        const snapshotPromise = repository.loadDraftWithSource(fixture.branch.id, draft.id);
        try {
            await Promise.race([
                firstRead.entered,
                snapshotPromise.then(() => { throw new Error("Snapshot reader did not reach its draft barrier"); }),
            ]);
            // This direct synthetic writer isolates PostgreSQL snapshot
            // semantics. Separate Phase4 tests exercise production writers.
            await prisma.$transaction([
                prisma.service_record_case.update({
                    where: { id: fixture.record.id },
                    data: { momName: "Concurrent source", version: { increment: 1 } },
                }),
                prisma.service_record_edit_draft.update({
                    where: { id: draft.id },
                    data: {
                        changes: { sessions: [{ sessionIndex: 1, notes: "Concurrent draft" }] },
                        draftVersion: { increment: 1 },
                        updatedByUserId: fixture.actorUserId,
                    },
                }),
            ]);
        } finally {
            resume.release();
        }
        const snapshot = await snapshotPromise;
        expect(snapshot?.draft.draftVersion).toBe(draft.draftVersion);
        expect(snapshot?.source.caseVersion).toBe(fixture.record.version);
        expect(snapshot?.source.header.momName).toBe(fixture.client.name);
        const latest = await ordinaryRepository.loadDraftWithSource(fixture.branch.id, draft.id);
        expect(latest?.draft.draftVersion).toBe(draft.draftVersion + 1);
        expect(latest?.source.caseVersion).toBe(fixture.record.version + 1);
        expect(latest?.source.header.momName).toBe("Concurrent source");
    });
});
