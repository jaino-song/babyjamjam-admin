import { Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

import { initialRegenerationReadiness } from "application/policies/service-record-initial-finalization.policy";
import { SERVICE_RECORD_INITIAL_NO_DOC_REASONS as REASON } from "domain/constants/service-record-initial-no-provider-document";
import { noProviderDocumentConfirmable } from "infrastructure/database/utils/service-record-initial-no-provider-document-projection";
import { ServiceRecordInitialNoProviderDocumentService } from "infrastructure/eformsign/service-record-initial-no-provider-document.service";
import { mapHttpProblem } from "infrastructure/filters/problem-response";
import { initialProviderRecoveryInput } from "../utils/service-record-initial-provider-recovery.fixture";

const scope = {
    branchId: "10000000-0000-4000-8000-000000000001", clientId: 10, caseId: "20000000-0000-4000-8000-000000000001",
    revisionId: "30000000-0000-4000-8000-000000000001", stateId: "40000000-0000-4000-8000-000000000001",
    generation: "generation-1",
};
const request = { branchId: scope.branchId, revisionId: scope.revisionId, documentStateId: scope.stateId,
    expectedGeneration: scope.generation, actorUserId: "staff-user" };
const suffix = "[SR-20000000-r1-v3]";
const cancelled = "JOB_CANCELLED_AFTER_DISPATCH";
const none = "SERVICE_RECORD_INITIAL_NO_PROVIDER_DOCUMENT";
const partial = "SERVICE_RECORD_INITIAL_PARTIAL_DISPATCH";
const deleted = "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN";

function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

function fixture() {
    const input = initialProviderRecoveryInput(scope);
    const state = { id: scope.stateId, branchId: scope.branchId, clientId: scope.clientId,
        serviceRecordCaseId: scope.caseId, revisionId: scope.revisionId, operation: "record_snapshot",
        generation: scope.generation, documentVersion: 3, status: "manual_review", lastErrorCode: cancelled, version: 1,
        outputProof: null as Prisma.JsonValue };
    const record = { id: scope.caseId, branchId: scope.branchId, clientId: scope.clientId,
        currentRevisionId: scope.revisionId, status: "READY_TO_FINALIZE", version: 1 };
    const job = { id: "job", branchId: scope.branchId, clientId: scope.clientId, status: "failed",
        lastErrorCode: cancelled, leaseToken: null, activeKey: `service-record-initial-finalization:${scope.caseId}` as string | null,
        documentId: null, attempts: 0, requestKey: input.snapshotReference, payloadFingerprint: input.payloadFingerprint,
        payload: { ...input, kind: "service_record_revision", context: { ...input } }, settled: true };
    const chunk = (index: number, link: string | null = null, status = link ? "CREATED" : "CREATE_REQUESTED") => ({
        id: `chunk-${index}`, rowVersion: "1",
        data: { document_id: link, chunk_index: index, chunk_count: 2, status,
            create_attempted_at: status === "CREATE_REQUESTED" ? "2026-11-23T00:00:00.000321Z" : null },
    });
    const chunks: Array<ReturnType<typeof chunk>> = [];
    const doc = (id: string, status: string) => ({ id, rowVersion: "1",
        data: { document_id: id, status_type: status, voided_at: null } });
    const documents: Array<ReturnType<typeof doc>> = [];
    const mirror = jest.fn(() => []);
    const flags = { eligible: true, busySibling: false, stateCasLost: false, caseCasLost: false };
    function isEligible() {
        return flags.eligible && state.status === "manual_review" && record.currentRevisionId === scope.revisionId
            && job.activeKey !== null;
    }

    const raw = jest.fn(async (sql: Prisma.Sql | TemplateStringsArray) => {
        const statement = "sql" in sql ? sql.sql : sql.join("?");
        if (statement.includes("jsonb_agg")) {
            if (!isEligible() || !job.settled) return [];
            return [{ stateId: state.id, revisionId: state.revisionId, generation: state.generation, caseId: scope.caseId,
                documentVersion: 3, revisionNumber: 1, chunks: chunks.map(({ data }) => ({
                    index: data.chunk_index, count: data.chunk_count, linked: data.document_id !== null,
                })) }];
        }
        if (statement.includes('AS "stateVersion"')) return isEligible() ? [{ ...job, stateVersion: state.version }] : [];
        if (statement.includes("eformsign_doc") && statement.includes("document_name LIKE")) return mirror();
        if (statement.includes("chunk.xmin")) return structuredClone(chunks);
        if (statement.includes("doc.xmin")) return structuredClone(documents);
        if (statement.includes('FROM "service_record_case"')) return [{ id: scope.caseId, branchId: scope.branchId, clientId: scope.clientId }];
        if (statement.includes('FROM "client"')) return [{ id: scope.clientId }];
        if (statement.includes('FROM "service_record_revision_document_state" AS state')) return [{ ...state }];
        if (statement.includes('SELECT document_id AS "documentId"')) return chunks.map(({ data }) => ({
            documentId: data.document_id, chunkIndex: data.chunk_index, chunkCount: data.chunk_count,
        }));
        if (statement.includes('doc.status_type AS "statusType"')) return documents.map(({ data }) => ({
            documentId: data.document_id, statusType: data.status_type, voided: data.voided_at !== null,
            purgePending: false, tombstoneEvaluated: false,
        }));
        if (statement.includes('FROM "eformsign_document_job"')) return [job, ...(flags.busySibling ? [{ status: "processing", leaseToken: null }] : [])];
        return [];
    });
    const db = {
        $queryRaw: raw,
        $executeRaw: jest.fn(async () => { job.activeKey = null; return 1; }),
        service_record_revision_document_state: {
            findFirst: jest.fn(async ({ where }: { where: { id: string; branchId: string; revisionId: string } }) =>
                where.id === state.id && where.branchId === state.branchId && where.revisionId === state.revisionId
                    ? structuredClone(state) : null),
            updateMany: jest.fn(async ({ data }: { data: { lastErrorCode: string; outputProof: Prisma.JsonValue } }) => {
                if (state.outputProof !== null || flags.stateCasLost) return { count: 0 };
                Object.assign(state, { status: "failed", version: state.version + 1, lastErrorCode: data.lastErrorCode, outputProof: data.outputProof });
                return { count: 1 };
            }),
        },
        service_record_case: {
            findUnique: jest.fn(async () => ({ ...record })),
            updateMany: jest.fn(async ({ data }: { data: { status: string; lastError: string } }) => {
                if (flags.caseCasLost) return { count: 0 };
                Object.assign(record, { status: data.status, lastError: data.lastError, version: record.version + 1 });
                return { count: 1 };
            }),
        },
        employee_schedule: { findMany: jest.fn(async () => []) },
    };
    const prisma = { ...db, $transaction: jest.fn(async (run: (tx: typeof db) => Promise<unknown>) => {
        const before = structuredClone({ state, record, job });
        try { return await run(db); }
        catch (error) {
            for (const key of Object.keys(record)) Reflect.deleteProperty(record, key);
            Object.assign(state, before.state); Object.assign(record, before.record); Object.assign(job, before.job);
            throw error;
        }
    }) };
    const page = () => jest.fn().mockResolvedValue({ documents: [], total_rows: 0 });
    const vendor = {
        getInProgressDocumentsPage: page(), getCompletedDocumentsPage: page(), getRejectedDocumentsPage: page(),
        createDocument: jest.fn(), getDocument: jest.fn(),
    };
    const remote = (index = 1, id = "remote-only") => ({ id, document_name: `QA-customer (${index}/2) ${suffix}` });
    const list = (...documents: Array<ReturnType<typeof remote>>) => vendor.getInProgressDocumentsPage.mockResolvedValue({
        documents, total_rows: documents.length,
    });
    const credentials = { withCredentials: jest.fn(async (_principal, _capability, run) => run({ accessToken: "synthetic" })) };
    const service = () => new ServiceRecordInitialNoProviderDocumentService(prisma as never, vendor as never, credentials as never);
    const attestation = service();
    return { state, record, job, db, prisma, chunk, chunks, doc, documents, mirror, flags, vendor, remote, list, service,
        confirm: (override: Partial<typeof request> = {}) => attestation.confirmInitialNoProviderDocument({ ...request, ...override }),
        project: () => noProviderDocumentConfirmable(prisma as never, scope.branchId, scope.caseId),
        readiness: () => initialRegenerationReadiness(db as never, scope.caseId, scope.revisionId) };
}

describe("INITIAL no-provider-document attestation", () => {
    beforeEach(() => { jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined); });
    afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

    it("keeps the machine reason at the top level through the HTTP problem boundary", async () => {
        const error: unknown = await fixture().confirm({ expectedGeneration: "old" }).catch((rejection: unknown) => rejection);
        expect(error).toEqual(expect.objectContaining({
            status: 409,
            response: {
                code: "REQUEST_CONFLICT", reason: REASON.GENERATION_CHANGED, params: {},
                outcome: "NOT_APPLIED", recovery: { action: "NONE", retry: { mode: "NEVER" } },
            },
        }));
        const problem = mapHttpProblem(error, { method: "POST" } as Request, { locals: {} } as Response);
        expect(problem).toMatchObject({ status: 409, code: "REQUEST_CONFLICT", reason: REASON.GENERATION_CHANGED });
    });

    it("projects zero rows, scans 01/03/04, records the proof, and makes U3b ready", async () => {
        const f = fixture();
        expect(await f.project()).toEqual([{ stateId: scope.stateId, revisionId: scope.revisionId,
            generation: scope.generation, suffix, unlinkedChunkOrdinals: [] }]);
        const result = await f.confirm();
        expect(result).toMatchObject({ id: scope.stateId, status: "failed", reasonCode: none,
            outputProof: { kind: "INITIAL_NO_PROVIDER_DOCUMENT_ATTESTATION", actorUserId: request.actorUserId,
                attestedAt: expect.any(String), outcome: none, unlinkedChunkIndexes: [],
                vendorCheck: { listTypes: ["01", "03", "04"], totals: { "01": 0, "03": 0, "04": 0 }, checkedAt: expect.any(String) } } });
        expect(f.state.version).toBe(2);
        expect(f.record).toMatchObject({ status: "FINALIZATION_FAILED", lastError: none, version: 2 });
        expect(f.job.activeKey).toBeNull();
        expect(await f.readiness()).toMatchObject({ ready: true });
        expect(await f.project()).toEqual([]);
        expect(f.vendor.createDocument).not.toHaveBeenCalled();
        expect(f.vendor.getDocument).not.toHaveBeenCalled();
    });

    it("treats both attempted and never-attempted unlinked chunks as absent after the clean scan", async () => {
        const f = fixture();
        f.chunks.push(f.chunk(1, null, "CLAIMED"), f.chunk(2));
        expect(await f.project()).toEqual([{ stateId: scope.stateId, revisionId: scope.revisionId,
            generation: scope.generation, suffix, unlinkedChunkOrdinals: ["(1/2)", "(2/2)"] }]);
        expect(await f.confirm()).toMatchObject({ reasonCode: none, outputProof: { unlinkedChunkIndexes: [1, 2] } });
        expect(f.job.activeKey).toBeNull();
    });

    it.each([
        ["070", partial, "SERVICE_RECORD_INITIAL_SIBLING_IN_PROGRESS"],
        ["003", partial, "SERVICE_RECORD_INITIAL_SIBLING_COMPLETED"],
        ["031", partial, null],
        ["049", deleted, deleted],
    ])("applies sibling rules to local status %s", async (status, outcome, readinessReason) => {
        const f = fixture();
        f.chunks.push(f.chunk(1, "linked"), f.chunk(2));
        f.documents.push(f.doc("linked", status));
        f.list(f.remote(1, "linked"));
        expect(await f.project()).toEqual([{ stateId: scope.stateId, revisionId: scope.revisionId,
            generation: scope.generation, suffix, unlinkedChunkOrdinals: ["(2/2)"] }]);
        expect(await f.confirm()).toMatchObject({ reasonCode: outcome,
            outputProof: { unlinkedChunkIndexes: [2], vendorCheck: { totals: { "01": 1, "03": 0, "04": 0 } } } });
        expect(await f.readiness()).toMatchObject(readinessReason ? { ready: false, reason: readinessReason } : { ready: true });
        expect(f.job.activeKey === null).toBe(readinessReason === null);
    });

    it.each([
        ["eligibility", REASON.NOT_ELIGIBLE], ["generation", REASON.GENERATION_CHANGED], ["settle", REASON.SETTLING],
        ["listed suffix without chunks", REASON.PROVIDER_DOCUMENT_FOUND], ["single ordinal match", REASON.PROVIDER_DOCUMENT_FOUND],
        ["found before ambiguous", REASON.PROVIDER_DOCUMENT_FOUND], ["ambiguous", REASON.VENDOR_CHECK_INCOMPLETE],
        ["unassignable", REASON.VENDOR_CHECK_INCOMPLETE], ["lookup error", REASON.VENDOR_CHECK_INCOMPLETE],
        ["missing title", REASON.VENDOR_CHECK_INCOMPLETE],
        ["all linked", REASON.LEFT_TO_PROVIDER_RECOVERY], ["mirror hit", REASON.PROVIDER_DOCUMENT_FOUND],
    ])("returns the correct conflict for %s without changing rows", async (scenario, reason) => {
        const f = fixture();
        const override = scenario === "generation" ? { expectedGeneration: "old" } : {};
        if (scenario === "eligibility") f.flags.eligible = false;
        if (scenario === "settle") f.job.settled = false;
        if (scenario === "listed suffix without chunks") f.list({ id: "provider", document_name: `QA-customer ${suffix}` });
        if (["single ordinal match", "found before ambiguous", "ambiguous", "unassignable"].includes(scenario)) {
            f.chunks.push(f.chunk(1), f.chunk(2));
            if (scenario === "single ordinal match") f.list(f.remote());
            if (scenario === "found before ambiguous") f.list(f.remote(1), f.remote(2, "doc-a"), f.remote(2, "doc-b"));
            if (scenario === "ambiguous") f.list(f.remote(1), f.remote(1, "other"));
            if (scenario === "unassignable") f.list(f.remote(3));
        }
        if (scenario === "missing title") f.list({ id: "provider", document_name: "" });
        if (scenario === "lookup error") f.vendor.getRejectedDocumentsPage.mockRejectedValue(new Error("private vendor details"));
        if (scenario === "all linked") {
            f.chunks.push(f.chunk(1, "a"), f.chunk(2, "b"));
            f.documents.push(f.doc("a", "049"), f.doc("b", "070"));
            f.list(f.remote(1, "a"), f.remote(2, "b"));
            expect(await f.project()).toEqual([]);
        }
        if (scenario === "mirror hit") f.mirror.mockReturnValueOnce([{ id: 1 }] as never);
        const before = structuredClone({ state: f.state, record: f.record, job: f.job });
        await expect(f.confirm(override)).rejects.toMatchObject({ status: 409, response: { reason } });
        expect({ state: f.state, record: f.record, job: f.job }).toEqual(before);
        if (scenario === "mirror hit") expect(f.vendor.getInProgressDocumentsPage).not.toHaveBeenCalled();
    });

    it.each([
        ["new document for the unlinked chunk", 2, ["new"], REASON.PROVIDER_DOCUMENT_FOUND],
        ["ambiguous documents for the unlinked chunk", 2, ["new", "other"], REASON.VENDOR_CHECK_INCOMPLETE],
        ["linked document with the unlinked ordinal", 1, [], REASON.VENDOR_CHECK_INCOMPLETE],
    ])("refuses a mixed snapshot with %s", async (_scenario, linkedOrdinal, newIds, reason) => {
        const f = fixture();
        f.chunks.push(f.chunk(1), f.chunk(2, "linked"));
        f.documents.push(f.doc("linked", "070"));
        f.list(f.remote(linkedOrdinal, "linked"), ...newIds.map(id => f.remote(1, id)));

        await expect(f.confirm()).rejects.toMatchObject({ status: 409, response: { reason } });
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each(["state", "job", "chunk", "document", "state update", "case update", "output proof"])("detects %s CAS loss", async (changed) => {
        const f = fixture();
        f.chunks.push(f.chunk(1, "linked"), f.chunk(2));
        f.documents.push(f.doc("linked", "070"));
        f.vendor.getRejectedDocumentsPage.mockImplementationOnce(async () => {
            if (changed === "state") f.state.version++;
            if (changed === "job") f.job.attempts++;
            if (changed === "chunk") f.chunks[1]!.rowVersion = "2";
            if (changed === "document") f.documents[0]!.rowVersion = "2";
            if (changed === "state update") f.flags.stateCasLost = true;
            if (changed === "case update") f.flags.caseCasLost = true;
            return { documents: [], total_rows: 0 };
        });
        if (changed === "output proof") f.state.outputProof = { kind: "OTHER_PROOF" };
        await expect(f.confirm()).rejects.toMatchObject({ status: 409, response: { reason: REASON.STATE_CHANGED } });
        expect(f.state.status).toBe("manual_review");
        expect(f.state.outputProof).toEqual(changed === "output proof" ? { kind: "OTHER_PROOF" } : null);
        expect(f.record.status).toBe("READY_TO_FINALIZE");
        expect(f.job.activeKey).not.toBeNull();
    });

    it("rechecks the local mirror after locking and before writing", async () => {
        const f = fixture();
        f.mirror.mockReturnValueOnce([]).mockReturnValueOnce([{ id: 1 }] as never);
        await expect(f.confirm()).rejects.toMatchObject({ status: 409, response: { reason: REASON.PROVIDER_DOCUMENT_FOUND } });
        expect(f.mirror).toHaveBeenCalledTimes(2);
        expect(f.db.service_record_revision_document_state.updateMany).not.toHaveBeenCalled();
    });

    it("rolls back a no-document outcome when U2 still blocks release", async () => {
        const f = fixture();
        f.flags.busySibling = true;
        await expect(f.confirm()).rejects.toMatchObject({ status: 409, response: { reason: REASON.NOT_READY_AFTER_OUTCOME } });
        expect(f.state).toMatchObject({ status: "manual_review", outputProof: null, version: 1 });
        expect(f.record.status).toBe("READY_TO_FINALIZE");
        expect(f.job.activeKey).not.toBeNull();
    });

    it("refuses a wrong branch or revision before the provider boundary", async () => {
        const f = fixture();
        for (const override of [{ branchId: "other-branch" }, { revisionId: "other-revision" }]) {
            await expect(f.confirm(override)).rejects.toMatchObject({ status: 404 });
        }
        expect(f.vendor.getInProgressDocumentsPage).not.toHaveBeenCalled();
    });

    it("deduplicates an in-progress scan in one process and then replays the stored actor", async () => {
        const f = fixture(), entered = gate(), release = gate();
        f.vendor.getInProgressDocumentsPage.mockImplementationOnce(async () => {
            entered.resolve(); await release.promise;
            return { documents: [], total_rows: 0 };
        });
        const first = f.confirm();
        await entered.promise;
        try {
            await expect(f.confirm()).rejects.toMatchObject({ status: 409, response: { reason: REASON.VENDOR_CHECK_IN_PROGRESS } });
        } finally { release.resolve(); }
        const applied = await first;
        expect(await f.confirm({ actorUserId: "another-user" })).toEqual(applied);
        expect(f.vendor.getInProgressDocumentsPage).toHaveBeenCalledTimes(1);
    });

    it("replays under lock when a second process scanned before the first committed", async () => {
        const f = fixture(), entered = gate(), release = gate();
        f.vendor.getInProgressDocumentsPage.mockImplementationOnce(async () => {
            entered.resolve(); await release.promise;
            return { documents: [], total_rows: 0 };
        });
        const second = f.service().confirmInitialNoProviderDocument({ ...request, actorUserId: "second-process" });
        await entered.promise;
        try {
            expect(await f.confirm()).toMatchObject({ outputProof: { actorUserId: request.actorUserId } });
        } finally { release.resolve(); }
        expect(await second).toMatchObject({ outputProof: { actorUserId: request.actorUserId } });
        expect(f.db.service_record_revision_document_state.updateMany).toHaveBeenCalledTimes(1);
        expect(f.vendor.getInProgressDocumentsPage).toHaveBeenCalledTimes(2);
    });

    it("refuses at 150 seconds even if the provider call is still pending", async () => {
        jest.useFakeTimers();
        const f = fixture();
        const entered = gate(), release = gate();
        f.vendor.getInProgressDocumentsPage.mockImplementationOnce(async () => {
            entered.resolve(); await release.promise;
            return { documents: [], total_rows: 0 };
        });
        const check = expect(f.confirm()).rejects.toMatchObject({ status: 409, response: { reason: REASON.VENDOR_CHECK_INCOMPLETE } });
        await entered.promise;
        await jest.advanceTimersByTimeAsync(150_000);
        await check;
        release.resolve();
        await jest.advanceTimersByTimeAsync(0);
        expect(f.vendor.getCompletedDocumentsPage).not.toHaveBeenCalled();
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });
});
