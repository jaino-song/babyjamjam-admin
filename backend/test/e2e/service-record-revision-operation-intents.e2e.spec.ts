import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

describeE2E("revision operation intent readiness (disposable PostgreSQL)", () => {
    let prisma: PrismaClient;
    let editor: AdminServiceRecordEditService;
    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
        editor = new AdminServiceRecordEditService(new ServiceRecordEditRepository(prisma as unknown as PrismaService));
    });
    afterAll(async () => { await prisma?.$disconnect(); });

    async function prepare(fixture: Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>, move: boolean) {
        const started = await editor.startDraft(fixture.branch.id, fixture.client.id, fixture.actorUserId, {});
        if (!started.draft) throw new Error("Missing fixture draft");
        const saved = await editor.updateDraft(fixture.branch.id, started.draft.id, fixture.actorUserId, {
            expectedDraftVersion: started.draft.draftVersion,
            changes: { sessions: [{ sessionIndex: 3, notes: `synthetic revision ${randomUUID()}` }] },
            ...(move ? { dateMove: { sessionIndex: 3, toDate: "2026-09-11" } } : {}),
        });
        if (!saved.draft) throw new Error("Missing saved fixture draft");
        const preview = await editor.previewDraft(fixture.branch.id, saved.draft.id, fixture.actorUserId,
            { expectedDraftVersion: saved.draft.draftVersion });
        return { draft: saved.draft, preview };
    }

    async function confirm(fixture: Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>, move: boolean) {
        const { draft, preview } = await prepare(fixture, move);
        expect(preview.blockingReasons).toEqual([]);
        return editor.confirmDraft(fixture.branch.id, draft.id, fixture.actorUserId, {
            expectedDraftVersion: draft.draftVersion, previewId: preview.previewId, idempotencyKey: randomUUID(),
        });
    }

    async function linkIncompleteContract(fixture: Awaited<ReturnType<typeof createServiceRecordConfirmFixture>>) {
        const document = await prisma.eformsign_doc.create({ data: {
            documentId: `synthetic-contract:${randomUUID()}`, branchId: fixture.branch.id, clientId: fixture.client.id,
            documentKind: "contract", createdDate: new Date(), updatedDate: new Date(),
            expiredDate: new Date("2027-12-31T00:00:00Z"), statusType: "070", statusDetail: "synthetic",
            stepType: "06", stepIndex: "3", stepName: "synthetic review", stepRecipientType: "",
            stepRecipientName: "", stepRecipientSms: "", syncStatus: "synced",
        } });
        await prisma.client.update({ where: { id: fixture.client.id }, data: { eDocId: document.documentId } });
        return document;
    }

    async function states(revisionId: string | null) {
        if (revisionId === null) throw new Error("Missing confirmed revision identity");
        return prisma.service_record_revision_document_state.findMany({ where: { revisionId } });
    }

    it("persists independent no-op contract and receipt intents for a partial case without documents", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const result = await confirm(fixture, true);
        const rows = await states(result.revisionId);
        expect(rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ operation: "record_snapshot", status: "waiting_for_completion" }),
            expect.objectContaining({ operation: "contract_period", status: "not_required" }),
            expect.objectContaining({ operation: "receipt_refresh", status: "not_required" }),
        ]));
        expect(new Set(rows.map((row) => row.generation)).size).toBe(rows.length);
        expect((await prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } })).duration).toBe(15);
        expect((await prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } })).requiredSessionCount).toBe(13);
    });

    it("records missing contract facts independently of incomplete record readiness", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const document = await linkIncompleteContract(fixture);
        const result = await confirm(fixture, true);
        expect(await states(result.revisionId)).toEqual(expect.arrayContaining([
            expect.objectContaining({ operation: "record_snapshot", status: "waiting_for_completion" }),
            expect.objectContaining({ operation: "contract_period", status: "manual_review", sourceDocumentId: document.documentId }),
            expect.objectContaining({ operation: "receipt_refresh", status: "not_required" }),
        ]));
        expect((await prisma.client.findUniqueOrThrow({ where: { id: fixture.client.id } })).eDocId).toBe(document.documentId);
    });

    it("does not require contract metadata for a content-only revision with the same outer period", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        await linkIncompleteContract(fixture);
        const result = await confirm(fixture, false);
        expect(await states(result.revisionId)).toEqual(expect.arrayContaining([
            expect.objectContaining({ operation: "contract_period", status: "not_required" }),
            expect.objectContaining({ operation: "receipt_refresh", status: "not_required" }),
        ]));
    });

    it("queues a same-generation retry and reuses its durable operation job", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        await linkIncompleteContract(fixture);
        const result = await confirm(fixture, true);
        const operation = (await states(result.revisionId)).find((row) => row.operation === "contract_period");
        if (!operation) throw new Error("Missing contract operation");
        const repository = new ServiceRecordEditRepository(prisma as unknown as PrismaService);
        const retry = { branchId: fixture.branch.id, clientId: fixture.client.id,
            revisionId: operation.revisionId, stateId: operation.id, expectedGeneration: operation.generation };
        expect(await repository.retryRevisionDocumentState(retry)).toMatchObject({ status: "pending", generation: operation.generation });
        const jobs = await prisma.eformsign_document_job.findMany({ where: { branchId: fixture.branch.id,
            clientId: fixture.client.id, requestKey: { startsWith: "service-record-revision-operations:" } } });
        expect(jobs).toHaveLength(1);
        const job = jobs[0]!;
        expect(job.payload).toMatchObject({ kind: "service_record_revision_operations",
            context: { branchId: fixture.branch.id, clientId: fixture.client.id, revisionId: operation.revisionId },
            operations: { contract: { documentStateId: operation.id, generation: operation.generation } } });
        await prisma.eformsign_document_job.update({ where: { id: job.id }, data: { status: "requires_attention", activeKey: null } });
        await prisma.service_record_revision_document_state.update({ where: { id: operation.id },
            data: { status: "failed", step: "preparing" } });
        expect(await repository.retryRevisionDocumentState(retry)).toMatchObject({ status: "pending", generation: operation.generation });
        expect(await prisma.eformsign_document_job.count({ where: { requestKey: job.requestKey } })).toBe(1);
        expect(await prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: job.id } }))
            .toMatchObject({ status: "queued", payload: job.payload, payloadFingerprint: job.payloadFingerprint });
    });

    it("allows saved drafts but refuses the next confirmation while a contract operation is unresolved", async () => {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        await linkIncompleteContract(fixture);
        const first = await confirm(fixture, true);
        const next = await prepare(fixture, false);
        expect(next.draft.draftVersion).toBeGreaterThan(1);
        await expect(editor.confirmDraft(fixture.branch.id, next.draft.id, fixture.actorUserId, {
            expectedDraftVersion: next.draft.draftVersion, previewId: next.preview.previewId, idempotencyKey: randomUUID(),
        })).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_REVISION_OPERATION_UNRESOLVED" } });
        expect((await prisma.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } })).currentRevisionId)
            .toBe(first.revisionId);
        expect(await prisma.service_record_edit_draft.findUnique({ where: { id: next.draft.id } })).not.toBeNull();
    });
});
