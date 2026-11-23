import { Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ServiceRecordInitialProviderRecoveryService, INITIAL_PROVIDER_SETTLE_MS } from "infrastructure/eformsign/service-record-initial-provider-recovery.service";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import { normalizeEformsignDocumentResponse } from "infrastructure/api/eformsign-response.normalizer";
import { initialProviderRecoveryInput, providerDocumentPage } from "../utils/service-record-initial-provider-recovery.fixture";
import type { EformsignApiDocumentResponse, EformsignApiListResponse } from "domain/repositories/eformsign.client.interface";
import { matchesWhere } from "../utils/prisma-where-evaluator";

const now = new Date("2026-11-22T12:00:00Z"), settled = new Date(now.getTime() - INITIAL_PROVIDER_SETTLE_MS);
const defaultScope = { branchId: "branch", clientId: 10, caseId: "12345678-case", revisionId: "revision", stateId: "state", generation: "generation" };
const cancelled = "JOB_CANCELLED_AFTER_DISPATCH";

function harness(linked: number[] = [], scope = defaultScope) {
    const input = initialProviderRecoveryInput(scope);
    const suffix = `[SR-${scope.caseId.slice(0, 8)}-r1-v3]`;
    const remote = (index: number, id = `remote-${index}`, prefix = "QA-frozen-customer") => normalizeEformsignDocumentResponse({
        id, created_date: settled.getTime(), updated_date: now.getTime(), document_name: `서비스 제공기록지 - ${prefix} (${index}/2) ${suffix}`, template: { id: "template" },
        creator: { name: "QA-provider" }, current_status: { status_type: "070", step_type: "06", step_index: "2" },
    });
    const state = { id: scope.stateId, ...scope, status: "manual_review", step: "manual_review", version: 1,
        lastErrorCode: cancelled, updatedAt: settled, inputFingerprint: input.payloadFingerprint,
        immutableInput: input.immutablePayload, documentVersion: 3,
        workflowScope: { generationKind: "INITIAL_FINALIZATION", requestKey: input.snapshotReference } };
    const record = { id: scope.caseId, branchId: scope.branchId, clientId: scope.clientId,
        currentRevisionId: scope.revisionId, status: "READY_TO_FINALIZE", client: { name: "QA-renamed-customer" } };
    const job = { id: `job-${scope.caseId}`, branchId: scope.branchId, clientId: scope.clientId,
        jobType: "create_document", source: "auto_finalize", leaseToken: null as string | null, attempts: 1,
        requestKey: input.snapshotReference, activeKey: `service-record-initial-finalization:${scope.caseId}`,
        payloadFingerprint: input.payloadFingerprint, updatedAt: settled, status: "failed", documentId: null,
        completedAt: null, heartbeatAt: settled as Date | null, lastErrorCode: cancelled, progressStep: "sent", progressDetail: "sent",
        payload: { ...input, kind: "service_record_revision", context: { ...input } } };
    const chunks = [1, 2].map(index => ({ id: `chunk-${index}`, branchId: scope.branchId, serviceRecordCaseId: scope.caseId,
        revisionId: scope.revisionId, snapshotVersion: 3, chunkIndex: index, chunkCount: 2, firstSessionIndex: index,
        lastSessionIndex: index, employeeNameSnapshot: "QA-provider", assignmentId: null, sourceHash: input.payloadFingerprint,
        status: linked.includes(index) ? "CREATED" : "CREATE_REQUESTED", updatedAt: settled,
        eformsignDocumentId: linked.includes(index) ? `remote-${index}` : null }));
    const docs = linked.map(index => ({ documentId: `remote-${index}`, statusType: "070" }));
    // Model PostgreSQL's extra timestamp digits independently of the JS Date read.
    let submillisecondMicros = 0n;
    const listings: Record<"inProgress" | "completed" | "rejected", EformsignApiDocumentResponse[]> = {
        inProgress: [remote(1), remote(2)], completed: [], rejected: [],
    };
    const list = (name: "inProgress" | "completed" | "rejected") => jest.fn(async (_token: string, limit: number, skip: number): Promise<EformsignApiListResponse> => (
        providerDocumentPage(listings[name], limit, skip)
    ));
    const client = {
        getInProgressDocumentsPage: list("inProgress"),
        getCompletedDocumentsPage: list("completed"),
        getRejectedDocumentsPage: list("rejected"),
        getDocument: jest.fn(async (_token: string, id: string) => remote(Number(id.split("-")[1]), id)),
        createDocument: jest.fn(),
    };
    const db = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        service_record_case: { findUnique: jest.fn(async () => ({ ...record })) },
        service_record_revision_document_state: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => where.id === state.id ? { ...state } : null),
            findFirst: jest.fn(async () => ({ ...state })) },
        service_record_snapshot_chunk: { findMany: jest.fn(async ({ where }: { where: { serviceRecordCaseId: string } }) => (
            chunks.filter(chunk => chunk.serviceRecordCaseId === where.serviceRecordCaseId).map(chunk => ({ ...chunk }))
        )),
            update: jest.fn(async ({ where, data }) => Object.assign(chunks.find(chunk => chunk.id === where.id)!, data)) },
        eformsign_doc: { findMany: jest.fn(async () => docs), upsert: jest.fn(async ({ create }) => { docs.push(create); return { id: 1 }; }) },
        eformsign_document_job: { updateMany: jest.fn(async ({ where, data }) => {
                const { updatedAt, payload, ...stable } = where;
                const actualMicros = BigInt(job.updatedAt.getTime()) * 1000n + submillisecondMicros;
                const timestampMatches = updatedAt instanceof Date
                    ? actualMicros === BigInt(updatedAt.getTime()) * 1000n
                    : actualMicros >= BigInt(updatedAt.gte.getTime()) * 1000n
                        && actualMicros < BigInt(updatedAt.lt.getTime()) * 1000n;
                if (!timestampMatches || !matchesWhere(job, stable)
                    || JSON.stringify(job.payload) !== JSON.stringify(payload.equals)) return { count: 0 };
                Object.assign(job, data); return { count: 1 };
            }) },
    };
    const candidate = () => ({ ...job, cursorUpdatedAt: job.updatedAt.toISOString() });
    const readCandidates = jest.fn(async (sql: Prisma.Sql) => {
        const cutoff = sql.values.find(value => value instanceof Date);
        return cutoff && job.status === "failed" && state.status === "manual_review" && state.updatedAt <= cutoff && job.updatedAt <= cutoff
            ? [candidate()] : [];
    });
    const prisma = { ...db, $queryRaw: readCandidates, $transaction: jest.fn(async (callback: (tx: typeof db) => Promise<unknown>) => {
        const before = structuredClone({ state, record, job, chunks, docs });
        try { return await callback(db); }
        catch (error) {
            Object.assign(state, before.state); Object.assign(record, before.record); Object.assign(job, before.job);
            chunks.splice(0, chunks.length, ...before.chunks); docs.splice(0, docs.length, ...before.docs);
            throw error;
        }
    }) };
    const credentials = { withCredentials: jest.fn(async (_principal, _capability, operation) => operation({ accessToken: "synthetic" })) };
    const snapshots = new CreateAndSendServiceRecordSnapshotUsecase(client as never, prisma as never, credentials as never, {} as never);
    const persist = jest.spyOn(snapshots, "persistCancelledInitialRemoteDocument");
    const promote = jest.fn(async () => { state.status = "processing"; state.step = "documents_created"; record.status = "DOCUMENTS_CREATED"; return true; });
    const service = new ServiceRecordInitialProviderRecoveryService(prisma as never, client as never, credentials as never,
        snapshots, { recordInitialFinalizationDocumentsCreatedInTransaction: promote } as never);
    const run = () => service.reconcile({ branchId: scope.branchId }, now);
    return { service, run, input, state, record, job, chunks, docs, db, prisma, client, credentials, listings, promote, snapshots, persist, remote, candidate,
        setSubmillisecondMicros: (value: bigint) => { submillisecondMicros = value; } };
}

describe("cancelled INITIAL provider recovery (presence only)", () => {
    beforeEach(() => { jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined); jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined); });
    afterEach(() => jest.restoreAllMocks());

    it.each([[], [1], [1, 2]].map(linked => ({ linked })))("all linked or matched ($linked) links once and completes atomically", async ({ linked }) => {
        const f = harness(linked);
        expect(await f.run()).toBe(1);
        expect(f.job).toMatchObject({ status: "completed", activeKey: null, heartbeatAt: null, documentId: "remote-1" });
        expect(f.state).toMatchObject({ status: "processing", step: "documents_created" });
        expect(f.record.status).toBe("DOCUMENTS_CREATED");
        expect(f.persist).toHaveBeenCalledTimes(2 - linked.length);
        expect(f.prisma.$transaction).toHaveBeenCalledTimes(1); // No nested persistence transaction.
        expect(f.promote).toHaveBeenCalledWith({ tx: f.db }, expect.objectContaining({ documentIds: ["remote-1", "remote-2"] }), "cancelled_after_dispatch");
        const sql = f.db.$queryRaw.mock.calls.map(call => String(call[0])).join(" ");
        expect(sql.indexOf("service_record_case")).toBeLessThan(sql.indexOf("service_record_revision_document_state"));
        expect(sql.indexOf("service_record_revision_document_state")).toBeLessThan(sql.indexOf("service_record_snapshot_chunk"));
        expect(f.client.createDocument).not.toHaveBeenCalled();
    });

    it("rebuilds titles from frozen payload after a customer rename, accepting a changed prefix", async () => {
        const f = harness();
        f.listings.inProgress = [f.remote(1, "remote-1", "QA-renamed"), f.remote(2)];
        f.client.getDocument.mockResolvedValueOnce(f.listings.inProgress[0]!);
        expect(await f.run()).toBe(1);
        expect(f.docs[0]).toMatchObject({ customerName: "QA-mom", documentName: expect.stringContaining("QA-frozen-customer") });
        expect(f.db.service_record_case.findUnique).toHaveBeenCalledTimes(1); // Only CAS, never title input.
    });

    it("commits cancellation timestamps containing microseconds beyond Prisma's JS Date precision", async () => {
        const f = harness();
        f.setSubmillisecondMicros(321n);
        expect(await f.run()).toBe(1);
        expect(f.job).toMatchObject({ status: "completed", activeKey: null, documentId: "remote-1" });
    });

    it.each(["timestamp", "lease", "progress", "payload", "attempts"])("job %s changed during lookup is a no-op", async change => {
        const f = harness();
        f.setSubmillisecondMicros(321n);
        const getDocument = f.client.getDocument.getMockImplementation()!;
        f.client.getDocument.mockImplementationOnce(async (token, id) => {
            if (change === "timestamp") f.job.updatedAt = new Date(settled.getTime() + 1);
            if (change === "lease") f.job.leaseToken = "new-lease";
            if (change === "progress") f.job.progressStep = "creating";
            if (change === "payload") f.job.payload = { ...f.job.payload, context: { ...f.job.payload.context, branchId: "changed" } };
            if (change === "attempts") f.job.attempts++;
            return getDocument(token, id);
        });
        expect(await f.run()).toBe(0);
        expect(f.job.status).toBe("failed"); expect(f.job.activeKey).not.toBeNull();
        expect(f.persist).not.toHaveBeenCalled(); expect(f.promote).not.toHaveBeenCalled();
    });

    it.each(["none", "one", "linked-one", "ambiguous", "unassignable", "error", "detail-error"])("%s leaves every row/key unchanged", async kind => {
        const f = harness(kind === "linked-one" ? [1] : []);
        f.listings.inProgress = kind === "none" || kind === "linked-one" ? []
            : kind === "ambiguous" ? [f.remote(1), f.remote(1, "duplicate"), f.remote(2)]
            : kind === "unassignable" ? [f.remote(1), f.remote(2), { ...f.remote(2, "other"), document_name: `[SR-12345678-r1-v3]` }]
            : kind === "one" ? [f.remote(1)] : [f.remote(1), f.remote(2)];
        if (kind === "error") f.client.getRejectedDocumentsPage.mockRejectedValue(new Error("secret vendor payload"));
        if (kind === "detail-error") f.client.getDocument.mockRejectedValue(new Error("secret vendor payload"));
        const before = structuredClone({ state: f.state, job: f.job, chunks: f.chunks, docs: f.docs });
        expect(await f.run()).toBe(0);
        expect({ state: f.state, job: f.job, chunks: f.chunks, docs: f.docs }).toEqual(before);
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
        expect(f.persist).not.toHaveBeenCalled();
    });

    it("finds matches on later pages and in 03/04, deduplicating a provider id across lists", async () => {
        const f = harness();
        const noise = Array.from({ length: 100 }, (_, i) => ({ ...f.remote(1, `noise-${i}`), document_name: "other" }));
        f.listings.inProgress = [...noise, f.remote(1)];
        f.listings.completed = [f.remote(1)];
        f.listings.rejected = [f.remote(2)];
        expect(await f.run()).toBe(1);
        expect(f.client.getInProgressDocumentsPage.mock.calls.some(([, limit, skip]) => skip >= limit)).toBe(true);
    });

    it("defers if the vendor reports 51 rows but truncates the page before the duplicate on row 51", async () => {
        const f = harness();
        f.listings.inProgress.push(...Array.from({ length: 48 }, (_, i) => ({ ...f.remote(1, `noise-${i}`), document_name: "other" })), f.remote(1, "duplicate"));
        f.client.getInProgressDocumentsPage.mockImplementationOnce(async (_token, limit, skip) => providerDocumentPage(f.listings.inProgress, Math.min(limit, 50), skip));
        expect(f.listings.inProgress).toHaveLength(51);
        expect(await f.run()).toBe(0);
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
        expect(f.job.activeKey).not.toBeNull();
    });

    it("checks the last page for another provider document for the same chunk", async () => {
        const f = harness();
        f.listings.inProgress.push(...Array.from({ length: 98 }, (_, i) => ({ ...f.remote(1, `noise-${i}`), document_name: "other" })), f.remote(1, "duplicate"));
        expect(await f.run()).toBe(0);
        expect(f.client.getInProgressDocumentsPage).toHaveBeenCalledWith("synthetic", 100, 100);
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });

    it("filters vendor error text before it reaches the credential boundary logger", async () => {
        const f = harness();
        f.client.getDocument.mockRejectedValue(new Error("QA-customer-title"));
        expect(await f.run()).toBe(0);
        await expect(f.credentials.withCredentials.mock.results[0]!.value).rejects.toThrow(/^INITIAL provider lookup deferred$/);
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each(["missing total", "growing total", "shrinking total", "repeated id", "changed coverage", "page cap"])("%s leaves recovery unchanged", async kind => {
        const f = harness();
        const list = f.client.getInProgressDocumentsPage;
        const noise = (i: number) => ({ ...f.remote(1, `noise-${i}`), document_name: "other" });
        list.mockImplementation(async (_token, limit, skip) => {
            if (kind === "missing total") return { documents: f.listings.inProgress } as EformsignApiListResponse;
            if (kind === "page cap") return { documents: Array.from({ length: limit }, (_, i) => noise(skip + i)), total_rows: limit * 1000 };
            const documents = [...f.listings.inProgress, ...Array.from({ length: limit - 1 }, (_, i) => noise(i))];
            const page = providerDocumentPage(documents, limit, skip);
            if (kind === "growing total" && skip > 0) page.total_rows++;
            if (kind === "shrinking total" && skip > 0) return { documents: [], total_rows: limit };
            if (kind === "repeated id" && skip > 0) page.documents[0] = documents[0]!;
            if (kind === "changed coverage" && skip > 0 && list.mock.calls.length > 2) page.documents[0] = noise(limit + 1);
            return page;
        });
        expect(await f.run()).toBe(0);
        if (kind === "page cap") expect(list).toHaveBeenCalledTimes(1);
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
        expect(f.job.activeKey).not.toBeNull();
    });

    it.each(["state", "revision", "generation", "chunk", "job", "promote", "persist"])("%s precondition/error rolls back all recovery writes", async kind => {
        const f = harness();
        if (kind === "state") f.db.service_record_revision_document_state.findUnique.mockResolvedValueOnce({ ...f.state })
            .mockResolvedValueOnce({ ...f.state, version: 2 });
        if (kind === "revision") f.record.currentRevisionId = "new-revision";
        if (kind === "generation") f.db.service_record_revision_document_state.findFirst.mockResolvedValue({ ...f.state, id: "new-state" });
        if (kind === "chunk") f.db.service_record_snapshot_chunk.findMany.mockResolvedValueOnce(f.chunks.map(chunk => ({ ...chunk })))
            .mockResolvedValueOnce(f.chunks.map(chunk => ({ ...chunk, updatedAt: now })));
        if (kind === "job") f.db.eformsign_document_job.updateMany.mockResolvedValue({ count: 0 });
        if (kind === "promote") f.promote.mockResolvedValue(false);
        if (kind === "persist") f.persist.mockRejectedValue(new Error("synthetic write failure"));
        const before = structuredClone({ state: f.state, record: f.record, job: f.job, chunks: f.chunks, docs: f.docs });
        expect(await f.run()).toBe(0);
        expect({ state: f.state, record: f.record, job: f.job, chunks: f.chunks, docs: f.docs }).toEqual(before);
    });

    it.each(["SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED", "SERVICE_RECORD_INITIAL_DELETED_STATUS_UNKNOWN"])("N9-1 preserves %s", async code => {
        const f = harness([1]); f.state.status = "failed"; f.state.lastErrorCode = code;
        expect(await f.run()).toBe(0);
        expect(f.state.lastErrorCode).toBe(code); expect(f.promote).not.toHaveBeenCalled();
    });

    it("R3-1 delete before U4 with an unproven second chunk retains manual review/key", async () => {
        const f = harness([1]); f.docs[0]!.statusType = "049";
        f.listings.inProgress = [];
        expect(await f.run()).toBe(0);
        expect(f.state).toMatchObject({ status: "manual_review", lastErrorCode: cancelled });
        expect(f.job.activeKey).not.toBeNull();
    });

    it("does not relink a provider match owned by another branch", async () => {
        const f = harness([1]);
        f.docs.push({ documentId: "remote-2", statusType: "070", branchId: "other-branch" } as never);
        const before = structuredClone({ job: f.job, docs: f.docs, chunks: f.chunks });
        expect(await f.run()).toBe(0);
        expect({ job: f.job, docs: f.docs, chunks: f.chunks }).toEqual(before);
        expect(f.persist).not.toHaveBeenCalled();
        expect(f.db.eformsign_document_job.updateMany).not.toHaveBeenCalled();
    });

    it("defers stale provider detail instead of overwriting a newer local mirror", async () => {
        const f = harness([1]);
        f.docs.push({ documentId: "remote-2", branchId: defaultScope.branchId, clientId: null, serviceRecordCaseId: null,
            revisionId: null, snapshotVersion: null, snapshotChunkIndex: null, documentKind: null, statusType: "003",
            updatedDate: new Date(now.getTime() + 1) } as never);
        const before = structuredClone({ job: f.job, docs: f.docs, chunks: f.chunks });
        expect(await f.run()).toBe(0);
        expect({ job: f.job, docs: f.docs, chunks: f.chunks }).toEqual(before);
        expect(f.persist).not.toHaveBeenCalled();
    });

    it("does not overwrite a completed-deletion decision made during the provider lookup", async () => {
        const f = harness([1]);
        f.db.service_record_revision_document_state.findUnique.mockResolvedValueOnce({ ...f.state }).mockResolvedValueOnce({
            ...f.state, status: "failed", lastErrorCode: "SERVICE_RECORD_INITIAL_COMPLETED_DOCUMENT_DELETED",
        });
        expect(await f.run()).toBe(0);
        expect(f.promote).not.toHaveBeenCalled();
        expect(f.db.eformsign_document_job.updateMany).not.toHaveBeenCalled();
    });

    it("enforces the ten-minute state settle delay and selects only settled unleased cancellations", async () => {
        const f = harness(); f.state.updatedAt = new Date(settled.getTime() + 1);
        expect(await f.run()).toBe(0);
        const [query] = f.prisma.$queryRaw.mock.calls[0]!;
        expect(query.sql).toContain("j.status = 'failed'");
        expect(query.sql).toContain("j.document_id IS NULL");
        expect(query.sql).toContain("j.lease_token IS NULL");
        expect(query.values).toContainEqual(settled);
        expect(query.values).toContain(cancelled);
        expect(f.client.getDocument).not.toHaveBeenCalled();
    });

    it("reaches a matchable newer job on the second pass after 101 eligible unmatched cancellations", async () => {
        const f = harness();
        const older = Array.from({ length: 101 }, (_, index) => {
            const caseId = `${String(index).padStart(8, "0")}-case`;
            const row = harness([], { ...defaultScope, caseId, stateId: `state-${caseId}`, revisionId: `rev-${caseId}`, generation: `gen-${caseId}` });
            row.job.updatedAt = new Date(settled.getTime() - 101 + index);
            return row;
        });
        const candidates = [...older, f];
        f.prisma.$queryRaw.mockImplementation(async (query) => {
            const after = query.sql.includes("(j.updated_at, j.id) >") ? query.values.at(-3) : undefined;
            const limit = Number(query.values.at(-1));
            return candidates.filter(row => after === undefined || row.job.updatedAt > new Date(String(after)))
                .slice(0, limit).map(row => row.candidate());
        });
        f.db.service_record_revision_document_state.findUnique.mockImplementation(async ({ where }) => ({ ...candidates.find(row => row.state.id === where.id)!.state }));
        f.db.service_record_snapshot_chunk.findMany.mockImplementation(async ({ where }) => candidates.find(row => row.record.id === where.serviceRecordCaseId)!.chunks.map(chunk => ({ ...chunk })));

        expect(await f.run()).toBe(0);
        expect(f.client.getInProgressDocumentsPage).toHaveBeenCalledTimes(100);
        expect(await f.run()).toBe(1);
        expect(f.client.getInProgressDocumentsPage).toHaveBeenCalledTimes(102);
        expect(f.job).toMatchObject({ status: "completed", activeKey: null });
        expect(older.every(row => row.job.status === "failed" && row.job.activeKey !== null)).toBe(true);
    });

    it("honours a lost sweep lease before any mutation", async () => {
        const f = harness();
        expect(await f.service.reconcile({ shouldContinue: () => false }, now)).toBe(0);
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });
});
