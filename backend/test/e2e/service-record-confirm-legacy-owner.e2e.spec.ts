import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget, createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

describeE2E("confirmation and historically unbound contract jobs (actual PostgreSQL)", () => {
    let prisma: ReturnType<typeof createApprovedServiceRecordConfirmClient>;
    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
    });
    afterAll(async () => { await prisma?.$disconnect(); });

    async function prepare() {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const documentId = `legacy-owner-${randomUUID()}`;
        await prisma.eformsign_doc.create({ data: {
            branchId: fixture.branch.id, clientId: fixture.client.id, documentId, documentKind: "contract",
            createdDate: new Date("2026-09-01T00:00:00Z"), updatedDate: new Date("2026-09-01T00:00:00Z"),
            expiredDate: new Date("2026-12-31T00:00:00Z"), statusType: "070", statusDetail: "070",
            stepType: "06", stepIndex: "3", stepName: "Synthetic provider review",
            stepRecipientType: "group", stepRecipientName: "Synthetic provider", stepRecipientSms: "",
        } });
        await prisma.client.update({ where: { id: fixture.client.id }, data: { eDocId: documentId } });
        const service = new AdminServiceRecordEditService(new ServiceRecordEditRepository(prisma as never));
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
        return { fixture, documentId, service, draft, changed, preview };
    }

    it.each(["processing", "reconciling"] as const)("refuses a %s irreversible job whose document proves ownership", async (status) => {
        const { fixture, documentId, service, draft, changed, preview } = await prepare();
        // Historical enqueueFinalizeDocument omitted clientId. The real owned
        // document proves which client's irreversible/uncertain job this is.
        const job = await prisma.eformsign_document_job.create({ data: {
            branchId: fixture.branch.id, clientId: null, documentId, jobType: "finalize_document",
            source: "staff", status, requestKey: randomUUID(), activeKey: randomUUID(),
            leaseToken: randomUUID(), progressStep: "creating", payload: { documentId },
        } });
        await expect(service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: changed.draft!.draftVersion, previewId: preview.previewId, idempotencyKey: randomUUID(),
        })).rejects.toBeInstanceOf(ConflictException);
        expect(await prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: job.id } })).toEqual(job);
        expect(await prisma.service_record_edit_draft.findUniqueOrThrow({ where: { id: draft.id } }))
            .toMatchObject({ status: "ACTIVE" });
        expect(await prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } }))
            .toMatchObject({ endDate: fixture.client.endDate, duration: 15 });
        expect(await prisma.service_record_revision.count({ where: { serviceRecordCaseId: fixture.record.id } })).toBe(0);
    });

    it.each(["own", "other_client", "other_branch"] as const)("cancels only reversible document-owned jobs: %s", async (scope) => {
        const { fixture, documentId, service, draft, changed, preview } = await prepare();
        let jobDocumentId = documentId;
        let jobBranchId = fixture.branch.id;
        if (scope !== "own") {
            if (scope === "other_branch") jobBranchId = (await prisma.branch.create({
                data: { name: "Other legacy branch", slug: randomUUID() },
            })).id;
            const other = await prisma.client.create({ data: { name: "Other synthetic client", branchId: jobBranchId, voucherClient: true } });
            jobDocumentId = `unrelated-${randomUUID()}`;
            await prisma.eformsign_doc.create({ data: {
                branchId: jobBranchId, clientId: other.id, documentId: jobDocumentId, documentKind: "contract",
                createdDate: new Date("2026-09-01T00:00:00Z"), updatedDate: new Date("2026-09-01T00:00:00Z"),
                expiredDate: new Date("2026-12-31T00:00:00Z"), statusType: "070", statusDetail: "070",
                stepType: "06", stepIndex: "3", stepName: "Synthetic provider review",
                stepRecipientType: "group", stepRecipientName: "Synthetic provider", stepRecipientSms: "",
            } });
        }
        const job = await prisma.eformsign_document_job.create({ data: {
            branchId: jobBranchId, clientId: null, documentId: jobDocumentId, jobType: "finalize_document",
            source: "staff", status: "processing", requestKey: randomUUID(), activeKey: randomUUID(),
            leaseToken: randomUUID(), payload: { documentId: jobDocumentId },
        } });
        expect(await service.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: changed.draft!.draftVersion, previewId: preview.previewId, idempotencyKey: randomUUID(),
        })).toMatchObject({ status: "confirmed" });
        const current = await prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: job.id } });
        if (scope === "own") {
            expect(current).toMatchObject({ status: "failed", leaseToken: null, lastErrorCode: "SERVICE_RECORD_REVISION_SUPERSEDED" });
        } else expect(current).toEqual(job);
    });

});
