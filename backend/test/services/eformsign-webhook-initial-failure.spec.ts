import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

const branchId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const caseId = "33333333-3333-4333-8333-333333333333";
const documentId = "initial-document";

function fixture(options: {
    voided?: boolean; status?: string; step?: string; linked?: boolean;
    currentRevisionId?: string; usableVersion?: number; initial?: boolean;
} = {}) {
    let row = EformsignDocEntity.reconstitute({
        id: 1, documentId, documentName: "QA-snapshot", templateName: "snapshot",
        customerName: "QA-client", creatorName: "QA", lastEditorName: "QA",
        createdDate: new Date("2026-11-01T00:00:00Z"), updatedDate: new Date("2026-11-02T00:00:00Z"),
        statusType: "060", statusDetail: "서명 대기", stepType: "05", stepIndex: "2", stepName: "이용자",
        stepRecipientType: "01", stepRecipientName: "QA", stepRecipientSms: "00000000000",
        expiredDate: new Date("2026-12-01T00:00:00Z"), expired: false, clientId: 17, documentKind: "service_record_snapshot",
        voidedAt: options.voided ? new Date("2026-11-02T00:00:00Z") : null,
    });
    const state = {
        id: "44444444-4444-4444-8444-444444444444", clientId: 17, revisionId,
        operation: "record_snapshot", generation: "generation-1", documentVersion: 3,
        workflowScope: options.initial === false ? {} : {
            generationKind: "INITIAL_FINALIZATION", requestKey: `service-record-initial-finalization:${revisionId}`,
        },
        version: 2, status: options.status ?? "processing", step: options.step ?? "documents_created",
        lastErrorCode: null as string | null,
    };
    const owner = {
        id: caseId, clientId: 17, version: 4, currentRevisionId: options.currentRevisionId ?? revisionId,
        currentUsableRevisionId: options.status === "completed" || options.usableVersion ? revisionId : null,
        currentUsableDocumentVersion: options.usableVersion ?? (options.status === "completed" ? 3 : null),
        status: options.status === "completed" ? "COMPLETED" : "DOCUMENTS_CREATED",
    };
    const tx = {
        eformsign_doc: { findFirst: jest.fn().mockResolvedValue({ serviceRecordCaseId: caseId, revisionId, snapshotVersion: 3 }) },
        $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
            const text = sql.text;
            if (text.includes("FROM service_record_case")) {
                return owner.status === "FINALIZATION_FAILED" ? [] : [owner];
            }
            if (text.includes("FROM service_record_revision_document_state")) return [state];
            if (text.includes("FROM service_record_snapshot_chunk")) {
                return options.linked === false ? [] : [{ statusType: row.statusType, voidedAt: row.voidedAt }];
            }
            throw new Error(`Unexpected query: ${text}`);
        }),
        $executeRaw: jest.fn(async (sql: Prisma.Sql) => {
            if (sql.text.includes("UPDATE service_record_revision_document_state")) {
                state.status = "failed";
                state.step = "failed";
                state.lastErrorCode = sql.values[0] as string;
                state.version += 1;
            } else if (sql.text.includes("UPDATE service_record_case")) {
                owner.status = "FINALIZATION_FAILED";
                owner.currentUsableRevisionId = null;
                owner.currentUsableDocumentVersion = null;
            }
            return 1;
        }),
    };
    const prisma = { $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    const lifecycle = new ServiceRecordLifecycleService(prisma as never, createHolidayCalendarStub());
    const persist = jest.fn(async (_branchId: string, updated: EformsignDocEntity) => {
        if (updated.updatedDate.getTime() <= row.updatedDate.getTime()) return { document: row, applied: false };
        row = EformsignDocEntity.reconstitute({ ...updated.toJSON(), voidedAt: row.voidedAt });
        return { document: row, applied: true };
    });
    const repository = {
        findByDocumentIdUnscoped: jest.fn(async () => ({ document: row, branchId })),
        findByDocumentId: jest.fn(async () => row),
        updateIfSourceNewer: persist,
        updateWithOutcome: persist,
    };
    const eventBus = { emit: jest.fn() };
    const webhook = new EformsignWebhookService(
        new UpdateEformsignDocStatusUsecase(repository as never),
        { execute: jest.fn() } as never, {} as never, eventBus as never,
        { sendToBranchUsers: jest.fn() } as never, {} as never, {} as never, {} as never,
        repository as never, {} as never, {} as never, {} as never,
        prisma as never, lifecycle,
    );
    const deliver = (event = "doc_reject_participant") => webhook.processWebhook({
        webhook_id: "initial-reject", webhook_name: "test", company_id: "test", event_type: "document",
        document: {
            id: documentId, status: event, document_title: "QA-snapshot",
            template_id: "snapshot", template_name: "snapshot", workflow_seq: 2, workflow_name: "이용자",
            updated_date: Date.parse("2026-11-03T00:00:00Z"),
        },
    } as EformsignWebhookPayloadDto);
    const retry = jest.fn();
    const admin = new AdminServiceRecordService(
        {} as never, {} as never, {} as never, createHolidayCalendarStub(), undefined,
        { findRevisionDocumentStateForBranch: jest.fn(async () => state), retryRevisionDocumentState: retry } as never,
    );
    return { state, owner, tx, prisma, lifecycle, deliver, admin, retry, eventBus };
}

describe("INITIAL snapshot reject/void recovery boundaries", () => {
    it.each([
        [false, "processing", "documents_created", "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED"],
        [false, "completed", "completed", "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED"],
        [true, "processing", "documents_created", "SERVICE_RECORD_REVISION_DOCUMENT_VOIDED"],
        [true, "completed", "completed", "SERVICE_RECORD_REVISION_DOCUMENT_VOIDED"],
    ])("marks the linked INITIAL failed (voided=%s, status=%s), then refuses admin retry", async (voided, status, step, code) => {
        const f = fixture({ voided, status, step });
        await f.deliver();
        expect(f.state).toMatchObject({ status: "failed", step: "failed", lastErrorCode: code, version: 3 });
        expect(f.owner).toMatchObject({ status: "FINALIZATION_FAILED", currentUsableRevisionId: null });
        expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(f.eventBus.emit).toHaveBeenLastCalledWith({ branchId, documentId, reason: "mirror:changed" });
        // A same-timestamp delivery repairs nothing twice and never queues a new document.
        await f.deliver();
        expect(f.state.version).toBe(3);
        expect(f.tx.$executeRaw).toHaveBeenCalledTimes(2);
        await expect(f.admin.retryRevisionDocument(branchId, revisionId, f.state.id, f.state.generation, "admin"))
            .rejects.toMatchObject({ status: 409, response: { code: "REQUEST_CONFLICT" } });
        expect(f.retry).not.toHaveBeenCalled();
    });

    it.each([
        { linked: false }, { currentRevisionId: "later-revision" }, { usableVersion: 4 },
        { status: "superseded" }, { initial: false },
    ])("ignores an unrelated, later or superseded state: %j", async (options) => {
        const f = fixture(options);
        await f.deliver();
        expect(f.tx.$executeRaw).not.toHaveBeenCalled();
        expect(f.state.version).toBe(2);
    });

    it("marks a voided INITIAL failed even when its vendor status remains live", async () => {
        const f = fixture({ voided: true });
        await f.deliver("doc_refuse_revoke");
        expect(f.state).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_VOIDED" });
        expect(f.owner.status).toBe("FINALIZATION_FAILED");
    });

    it("pins the exact chunk/document and all ownership/version fields under locks", async () => {
        const f = fixture();
        await f.deliver();
        const queries = f.tx.$queryRaw.mock.calls.map(([sql]) => sql.text);
        expect(queries[0]).toContain("FOR UPDATE");
        expect(queries[1]).toContain("operation = 'record_snapshot'");
        expect(queries[2]).toContain("doc.snapshot_version = chunk.snapshot_version");
        expect(queries[2]).toContain("doc.snapshot_chunk_index = chunk.chunk_index");
        expect(queries[2]).toContain("doc.service_record_case_id = chunk.service_record_case_id");
        expect(queries[2]).toContain("FOR UPDATE OF chunk, doc");
        expect(f.tx.$queryRaw.mock.calls[2]?.[0].values).toContain(documentId);
        const caseWrite = f.tx.$executeRaw.mock.calls[1]?.[0].text;
        expect(caseWrite).toContain("documents_completed_at = NULL");
        expect(caseWrite).toContain("next_attempt_at = NULL");
    });

    it("propagates a lifecycle CAS failure for transaction rollback and delivery retry", async () => {
        const f = fixture();
        f.tx.$executeRaw.mockResolvedValueOnce(0);
        await expect(f.deliver()).rejects.toBeInstanceOf(ConflictException);
        expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
        await f.deliver();
        expect(f.state).toMatchObject({ status: "failed", lastErrorCode: "SERVICE_RECORD_REVISION_DOCUMENT_REJECTED" });
    });
});
