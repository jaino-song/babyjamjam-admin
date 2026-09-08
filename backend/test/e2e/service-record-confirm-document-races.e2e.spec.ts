import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { EformsignDocumentJobWorkerService } from "application/services/eformsign-document-job-worker.service";
import { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { clientLock, reached } from "./helpers/service-record-confirm-race.helper";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget, createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture, serviceRecordConfirmBarrier,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

function edit(prisma: unknown) {
    return new AdminServiceRecordEditService(new ServiceRecordEditRepository(prisma as never));
}

// Only the actual production pre-provider transaction is invoked. No worker
// interval, browser, reconciliation, headless service or vendor is started.
function authorize(prisma: unknown, job: EformsignDocumentJobEntity) {
    const forbidden = new Proxy({}, { get: () => { throw new Error("Unexpected external collaborator"); } });
    const worker = new EformsignDocumentJobWorkerService(forbidden as never,
        new SbEformsignDocumentJobRepository(prisma as never), forbidden as never, forbidden as never,
        forbidden as never, forbidden as never, forbidden as never, forbidden as never, forbidden as never,
        prisma as never);
    return (worker as unknown as {
        authorizeRevisionJob(job: EformsignDocumentJobEntity): Promise<{ kind: string }>;
    }).authorizeRevisionJob(job);
}

describeE2E("confirm versus existing electronic-document authorization (actual PostgreSQL)", () => {
    let prisma: ReturnType<typeof createApprovedServiceRecordConfirmClient>;
    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
    });
    afterAll(async () => { await prisma?.$disconnect(); });

    it.each([
        ["confirm", "create_document"], ["dispatch", "create_document"],
        ["confirm", "finalize_document"], ["dispatch", "finalize_document"],
    ] as const)("%s wins against %s", async (first, jobType) => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const documentId = jobType === "finalize_document" ? `synthetic-${randomUUID()}` : null;
        if (documentId) {
            await prisma.eformsign_doc.create({ data: {
                branchId: fixture.branch.id, clientId: fixture.client.id, documentId, documentKind: "contract",
                createdDate: new Date("2026-09-01T00:00:00Z"), updatedDate: new Date("2026-09-01T00:00:00Z"),
                expiredDate: new Date("2026-12-31T00:00:00Z"), statusType: "070", statusDetail: "070",
                stepType: "06", stepIndex: "3", stepName: "Synthetic provider review",
                stepRecipientType: "group", stepRecipientName: "Synthetic provider", stepRecipientSms: "",
            } });
            await prisma.client.update({ where: { id: fixture.client.id }, data: { eDocId: documentId } });
        }
        const service = edit(prisma);
        const started = await service.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        const draft = started.draft!;
        const changed = await service.updateDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: draft.draftVersion, changes: {},
            dateMove: { sessionIndex: 3, toDate: "2026-09-11" },
        });
        const preview = await service.previewDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: changed.draft!.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        const request = { expectedDraftVersion: changed.draft!.draftVersion,
            previewId: preview.previewId, idempotencyKey: randomUUID() };
        const payload = { clientId: fixture.client.id, ...(documentId ? { documentId } : {}) };
        const row = await prisma.eformsign_document_job.create({ data: {
            branchId: fixture.branch.id, clientId: fixture.client.id, jobType,
            documentId, source: "staff", status: "processing", requestKey: randomUUID(),
            activeKey: randomUUID(), leaseToken: randomUUID(), payload, createdByUserId: fixture.actorUserId,
        } });
        const job = new EformsignDocumentJobEntity({ ...row, jobType, source: "staff", status: "processing",
            payload, autoFinalizeOutcomeAttempts: null });
        const held = serviceRecordConfirmBarrier();
        const release = serviceRecordConfirmBarrier();
        const attempted = serviceRecordConfirmBarrier();
        const winningClient = clientLock(prisma, { acquired: held.release, hold: release.entered });
        const losingClient = clientLock(prisma, { attempted: attempted.release });
        const confirm = (client: unknown) => edit(client)
            .confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, request);
        const winner = (first === "confirm" ? confirm(winningClient) : authorize(winningClient, job))
            .then((value) => value, (error: unknown) => error);
        let loser: Promise<unknown> | undefined;
        let boundaryError: unknown;
        try {
            await reached(held.entered, winner);
            loser = (first === "confirm" ? authorize(losingClient, job) : confirm(losingClient))
                .then((value) => value, (error: unknown) => error);
            await reached(attempted.entered, loser);
        } catch (error) { boundaryError = error; } finally { release.release(); }
        const result = await winner;
        const other = await loser;
        if (boundaryError) throw boundaryError;
        const finalJob = await prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: job.id } });
        if (first === "confirm") {
            expect(result).toMatchObject({ status: "confirmed" });
            expect(other).toMatchObject({ kind: "lost" });
            expect(finalJob.status).not.toBe("processing");
            expect(finalJob.leaseToken).toBeNull();
            expect(finalJob.progressStep).not.toBe("creating");
        } else {
            expect(result).toMatchObject({ kind: "allow" });
            expect(other).toBeInstanceOf(ConflictException);
            expect(finalJob).toMatchObject({ status: "processing", progressStep: "creating", leaseToken: job.leaseToken });
            expect(await prisma.service_record_edit_draft.findUniqueOrThrow({ where: { id: draft.id } }))
                .toMatchObject({ status: "ACTIVE" });
            expect(await prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
                .toMatchObject({ endDate: fixture.client.endDate, duration: 15, actualPrice: "600000" });
            expect(await prisma.service_record_revision.count({ where: { serviceRecordCaseId: fixture.record.id } })).toBe(0);
        }
    });
});
