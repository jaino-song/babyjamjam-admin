import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { assertNoBlockingRevisionDocumentStates, ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import type {
    AllocateServiceRecordRevisionDocumentVersionInput,
    PromoteServiceRecordRevisionSnapshotInput,
} from "domain/repositories/service-record-edit.repository.interface";

const branchId = "11111111-1111-4111-8111-111111111111";
const clientId = 17;
const caseId = "22222222-2222-4222-8222-222222222222";
const revisionId = "33333333-3333-4333-8333-333333333333";
const stateId = "44444444-4444-4444-8444-444444444444";
const immutableInput = { plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-08" }] };
const fingerprint = sha256CanonicalJson(immutableInput);
const snapshotJobId = "66666666-6666-4666-8666-666666666666";
const snapshotRequestKey = `service-record-revision:${caseId}:draft-1`;
const snapshotActiveKey = `service-record-revision:${caseId}`;

function stateRow(overrides: Record<string, unknown> = {}) {
    return {
        id: stateId,
        branchId,
        clientId,
        serviceRecordCaseId: caseId,
        revisionId,
        operation: "record_snapshot",
        generation: "generation-1",
        immutableInput,
        inputFingerprint: fingerprint,
        documentVersion: 3,
        sourceDocumentId: null,
        targetDocumentId: null,
        templateId: null,
        templateVersion: null,
        workflowScope: null,
        mirrorGeneration: null,
        outputProof: null,
        step: "pending",
        status: "pending",
        attempts: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        version: 0,
        createdAt: new Date("2026-09-08T00:00:00.000Z"),
        updatedAt: new Date("2026-09-08T00:00:00.000Z"),
        ...overrides,
    };
}

function retryableSnapshotState(overrides: Record<string, unknown> = {}) {
    return stateRow({
        status: "manual_review",
        step: "preflight_failed",
        workflowScope: {
            requestKey: snapshotRequestKey,
            activeKey: snapshotActiveKey,
            caseVersion: 7,
            formVersion: 2,
        },
        ...overrides,
    });
}

function snapshotJobRow(overrides: Record<string, unknown> = {}) {
    const payload = {
        kind: "service_record_revision",
        revisionId,
        revisionNumber: 1,
        generation: "generation-1",
        documentStateId: stateId,
        documentVersion: 3,
        immutablePayload: immutableInput,
        payloadFingerprint: fingerprint,
    };
    return {
        id: snapshotJobId,
        branchId,
        clientId,
        documentId: null,
        jobType: "create_document",
        source: "staff",
        status: "failed",
        requestKey: snapshotRequestKey,
        activeKey: null,
        payload,
        payloadFingerprint: sha256CanonicalJson(payload),
        progressStep: "preparing",
        ...overrides,
    };
}

function ownerCase() {
    return {
        id: caseId,
        formVersion: 2,
        currentRevisionId: revisionId,
        currentUsableRevisionId: null,
        currentUsableDocumentVersion: null,
    };
}

function validChunk() {
    return {
        id: "55555555-5555-4555-8555-555555555555",
        revisionId,
        snapshotVersion: 3,
        chunkIndex: 1,
        chunkCount: 1,
        status: "CREATED",
        documentId: "revision-doc-1",
        storedDocumentId: "revision-doc-1",
        documentRevisionId: revisionId,
        documentBranchId: branchId,
        documentClientId: clientId,
        documentCaseId: caseId,
        documentKind: "service_record_snapshot",
        documentStatusType: "003",
        documentSnapshotVersion: 3,
        documentSnapshotChunkIndex: 1,
    };
}

function transactionHarness(rows: unknown[]) {
    const queryRaw = jest.fn();
    rows.forEach((row) => queryRaw.mockResolvedValueOnce(row));
    // Row-less raw writes go through `$executeRaw` (affected count), see `rawStateExecute`.
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = { $queryRaw: queryRaw, $executeRaw: executeRaw };
    const prisma = {
        $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { prisma, tx, queryRaw, executeRaw };
}

function sqlText(value: unknown): string {
    if (value && typeof value === "object" && "strings" in value && "values" in value) {
        const query = value as { strings?: unknown; values?: unknown };
        const strings = Array.isArray(query.strings) ? query.strings : [];
        const values = Array.isArray(query.values) ? query.values : [];
        return strings.map((part, index) => (
            `${String(part)}${index < values.length ? sqlText(values[index]) : ""}`
        )).join("");
    }
    if (value && typeof value === "object" && "strings" in value) {
        const query = value as { strings?: unknown };
        return Array.isArray(query.strings) ? query.strings.map(String).join("") : String(value);
    }
    return String(value);
}

function allocatorInput(overrides: Partial<AllocateServiceRecordRevisionDocumentVersionInput> = {}): AllocateServiceRecordRevisionDocumentVersionInput {
    return {
        branchId,
        clientId,
        serviceRecordCaseId: caseId,
        revisionId,
        documentStateId: stateId,
        generation: "generation-1",
        expectedDocumentVersion: 3,
        ...overrides,
    };
}

function promotionInput(overrides: Partial<PromoteServiceRecordRevisionSnapshotInput> = {}): PromoteServiceRecordRevisionSnapshotInput {
    return {
        branchId,
        clientId,
        serviceRecordCaseId: caseId,
        revisionId,
        revisionNumber: 1,
        documentStateId: stateId,
        generation: "generation-1",
        documentVersion: 3,
        chunkCount: 1,
        documentIds: ["revision-doc-1"],
        ...overrides,
    };
}

function allocatorRows(state = stateRow()) {
    return [
        [], // discovery employee/schedule ids
        [], // client lock
        [], [], [], [], [], [], // case/children/revision locks
        [], // state lock
        [], // matching job lock
        [ownerCase()],
        [state],
        [], // matching jobs to patch
    ];
}

function promotionRows(chunkRows: unknown[], state = stateRow()) {
    return [
        [], // discovery employee/schedule ids
        [], // client lock
        [], [], [], [], [], [], // case/children/revision locks
        [], // state lock
        [], // matching job lock
        [ownerCase()],
        [{ revisionNumber: 1 }],
        [state],
        chunkRows,
    ];
}

describe("ServiceRecordEditRepository revision snapshot version/promotion seams", () => {
    it("replays the persisted document version without recomputing or changing state", async () => {
        const harness = transactionHarness(allocatorRows());
        const repository = new ServiceRecordEditRepository(harness.prisma as never);

        await expect(repository.allocateServiceRecordRevisionDocumentVersion(allocatorInput()))
            .resolves.toBe(3);

        const sqlCalls = harness.queryRaw.mock.calls.map(([query]) => sqlText(query));
        expect(sqlCalls.some((query) => query.includes("GREATEST"))).toBe(false);
        expect(sqlCalls.some((query) => query.includes("UPDATE \"service_record_revision_document_state\""))).toBe(false);
    });

    it("treats a null expectation as an idempotent replay after another allocator wins", async () => {
        const harness = transactionHarness(allocatorRows());
        const repository = new ServiceRecordEditRepository(harness.prisma as never);

        await expect(repository.allocateServiceRecordRevisionDocumentVersion(
            allocatorInput({ expectedDocumentVersion: null }),
        )).resolves.toBe(3);
    });

    it("allocates the next case version once and pins an existing job payload", async () => {
        const pendingState = stateRow({ documentVersion: null });
        const allocatedState = stateRow({ documentVersion: 3, version: 1 });
        const harness = transactionHarness([
            ...allocatorRows(pendingState).slice(0, 12),
            // PostgreSQL returns MAX(integer) through the raw driver as a
            // bigint in the real adapter. Keep this fixture honest so the
            // allocator cannot regress to a number-only cast.
            [{ maxVersion: 2n }],
            [allocatedState],
            [{ id: "66666666-6666-4666-8666-666666666666", payload: { kind: "service_record_revision", generation: "generation-1" } }],
        ]);
        const repository = new ServiceRecordEditRepository(harness.prisma as never);

        await expect(repository.allocateServiceRecordRevisionDocumentVersion(allocatorInput({ expectedDocumentVersion: null })))
            .resolves.toBe(3);

        const sqlCalls = harness.queryRaw.mock.calls.map(([query]) => sqlText(query));
        expect(sqlCalls.some((query) => query.includes("GREATEST"))).toBe(true);
        // The job payload pin is a row-less write, so it is issued through `$executeRaw`.
        const executeCalls = harness.executeRaw.mock.calls.map(([query]) => sqlText(query));
        expect(executeCalls).toHaveLength(1);
        expect(executeCalls[0]).toContain("payload_fingerprint");
    });

    it("rejects an auxiliary retry before changing state when its dispatch context is incomplete", async () => {
        const invalidState = stateRow({
            operation: "contract_period",
            status: "manual_review",
            step: "preflight_failed",
        });
        const harness = transactionHarness([
            [invalidState], // branch-scoped discovery
            [ownerCase()], // current revision lock
            [invalidState], // state reread under the owner lock
        ]);
        const repository = new ServiceRecordEditRepository(harness.prisma as never);

        await expect(repository.retryRevisionDocumentState({
            branchId,
            clientId,
            revisionId,
            stateId,
            expectedGeneration: invalidState.generation as string,
        })).rejects.toThrow("Revision operation dispatch context is unavailable");
        expect(harness.queryRaw).toHaveBeenCalledTimes(3);
        expect(harness.queryRaw.mock.calls.map(([query]) => sqlText(query))
            .some((query) => query.includes('UPDATE "service_record_revision_document_state"')))
            .toBe(false);
    });

    it("requeues the existing failed snapshot job without changing its payload or chunks", async () => {
        const retryState = retryableSnapshotState();
        const retriedState = retryableSnapshotState({ status: "pending", step: "retry_requested", version: 1, attempts: 1 });
        const harness = transactionHarness([
            [retryState], // branch-scoped discovery
            [ownerCase()], // current revision owner lock
            [retryState], // state reread under its lock
            [snapshotJobRow()], // exact existing snapshot job lock
            [retriedState], // state CAS
            [{ id: snapshotJobId }], // job CAS
        ]);
        const repository = new ServiceRecordEditRepository(harness.prisma as never);

        await expect(repository.retryRevisionDocumentState({
            branchId,
            clientId,
            revisionId,
            stateId,
            expectedGeneration: retryState.generation as string,
        })).resolves.toMatchObject({ status: "pending", step: "retry_requested", version: 1 });

        const sqlCalls = harness.queryRaw.mock.calls.map(([query]) => sqlText(query));
        expect(sqlCalls.some((query) => query.includes('FROM "eformsign_document_job" AS job')
            && query.includes("FOR UPDATE"))).toBe(true);
        const jobUpdate = sqlCalls.find((query) => query.includes('UPDATE "eformsign_document_job"'));
        expect(jobUpdate).toContain("status = 'queued'");
        expect(jobUpdate).toContain("progress_step = 'queued'");
        // The terminal re-queue guard also blocks dispatch_authorized (a crash
        // mid-click can leave it on a requires_attention row).
        const jobUpdateQuery = harness.queryRaw.mock.calls
            .map(([query]) => query as { values: unknown[] })
            .find((query) => sqlText(query).includes('UPDATE "eformsign_document_job"'));
        expect(sqlText(jobUpdateQuery)).toContain("NOT IN (");
        expect(jobUpdateQuery?.values).toContain("dispatch_authorized");
        expect(jobUpdate).not.toContain("payload =");
        expect(jobUpdate).not.toContain("document_id =");
        expect(sqlCalls.some((query) => query.includes('INSERT INTO "eformsign_document_job"'))).toBe(false);
        expect(sqlCalls.some((query) => query.includes("service_record_snapshot_chunk")
            && query.includes("UPDATE"))).toBe(false);
    });

    it("keeps an ambiguous snapshot outcome blocked instead of replaying the provider job", async () => {
        const retryState = retryableSnapshotState();
        const harness = transactionHarness([
            [retryState], // branch-scoped discovery
            [ownerCase()], // current revision owner lock
            [retryState], // state reread under its lock
            [snapshotJobRow({ status: "requires_attention", progressStep: "reconciling" })],
        ]);
        const repository = new ServiceRecordEditRepository(harness.prisma as never);

        await expect(repository.retryRevisionDocumentState({
            branchId,
            clientId,
            revisionId,
            stateId,
            expectedGeneration: retryState.generation as string,
        })).rejects.toThrow("Revision snapshot job is not safely retryable");

        const sqlCalls = harness.queryRaw.mock.calls.map(([query]) => sqlText(query));
        expect(sqlCalls).toHaveLength(4);
        expect(sqlCalls.some((query) => query.includes('UPDATE "service_record_revision_document_state"'))).toBe(false);
        expect(sqlCalls.some((query) => query.includes('UPDATE "eformsign_document_job"'))).toBe(false);
    });

    it.each(["dispatch_authorized", "creating", "sent", "reconciling", "unknown"])(
        "refuses to re-queue a terminal snapshot job whose progress step is %s",
        async (progressStep) => {
            const retryState = retryableSnapshotState();
            const harness = transactionHarness([
                [retryState], // branch-scoped discovery
                [ownerCase()], // current revision owner lock
                [retryState], // state reread under its lock
                [snapshotJobRow({ status: "requires_attention", progressStep })],
            ]);
            const repository = new ServiceRecordEditRepository(harness.prisma as never);

            await expect(repository.retryRevisionDocumentState({
                branchId,
                clientId,
                revisionId,
                stateId,
                expectedGeneration: retryState.generation as string,
            })).rejects.toThrow("Revision snapshot job is not safely retryable");

            const sqlCalls = harness.queryRaw.mock.calls.map(([query]) => sqlText(query));
            expect(sqlCalls.some((query) => query.includes('UPDATE "service_record_revision_document_state"'))).toBe(false);
            expect(sqlCalls.some((query) => query.includes('UPDATE "eformsign_document_job"'))).toBe(false);
        },
    );

    it("refuses pointer promotion until every persisted chunk/document is complete", async () => {
        const harness = transactionHarness(promotionRows([]));
        const repository = new ServiceRecordEditRepository(harness.prisma as never);

        await expect(repository.promoteServiceRecordRevisionSnapshot(promotionInput()))
            .resolves.toBe(false);

        const sqlCalls = harness.queryRaw.mock.calls.map(([query]) => sqlText(query));
        expect(sqlCalls.some((query) => query.includes("UPDATE \"service_record_case\""))).toBe(false);
    });

    it("promotes the exact revision/document set and marks state completed", async () => {
        const completedState = stateRow({ status: "completed", step: "completed", version: 1 });
        const harness = transactionHarness([
            ...promotionRows([validChunk()]),
            [{ id: caseId }],
            [completedState],
        ]);
        const repository = new ServiceRecordEditRepository(harness.prisma as never);

        await expect(repository.promoteServiceRecordRevisionSnapshot(promotionInput()))
            .resolves.toBe(true);

        const sqlCalls = harness.queryRaw.mock.calls.map(([query]) => sqlText(query));
        expect(sqlCalls.some((query) => query.includes("UPDATE \"service_record_case\""))).toBe(true);
        expect(sqlCalls.some((query) => query.includes("UPDATE \"service_record_revision_document_state\""))).toBe(true);
    });
});

describe("INITIAL documents-created boundary", () => {
    let evaluate: jest.SpiedFunction<typeof ServiceRecordLifecycleService.evaluateInitialSnapshotTerminalOutcomeInTransaction>;
    beforeEach(() => { evaluate = jest.spyOn(ServiceRecordLifecycleService, "evaluateInitialSnapshotTerminalOutcomeInTransaction").mockResolvedValue(false); });
    afterEach(() => { evaluate.mockRestore(); });
    const scope = { generationKind: "INITIAL_FINALIZATION", requestKey: `service-record-initial-finalization:${revisionId}` };
    function initialRows(options: { state?: Record<string, unknown>; owner?: Record<string, unknown>; chunks?: unknown[] } = {}) {
        return [...promotionRows([]).slice(0, 10),
            [{ ...ownerCase(), status: "READY_TO_FINALIZE", ...options.owner }],
            [stateRow({ workflowScope: scope, status: "processing", step: "dispatch_authorized", ...options.state })],
            options.chunks ?? [{ ...validChunk(), documentStatusType: "070" }]];
    }
    it("accepts review-requested documents, keeps pointer null, records creation and revokes tokens", async () => {
        const f = transactionHarness(initialRows());
        const repo = new ServiceRecordEditRepository(f.prisma as never);
        await expect(repo.recordInitialFinalizationDocumentsCreated(promotionInput())).resolves.toBe(true);
        const writes = f.executeRaw.mock.calls.map(([sql]) => sqlText(sql));
        expect(writes).toHaveLength(3);
        expect(writes[0]).toContain("status = 'processing', step = 'documents_created'");
        expect(writes[1]).toContain("status = 'DOCUMENTS_CREATED'");
        expect(writes[2]).toContain('UPDATE "service_record_token" SET active = false');
        expect(writes.join(" ")).not.toContain("current_usable_revision_id");
        expect(writes.join(" ")).not.toContain("waiting_for_completion");
    });
    it("replays documents_created idempotently without writes", async () => {
        const f = transactionHarness(initialRows({ state: { step: "documents_created" }, owner: { status: "DOCUMENTS_CREATED" } }));
        const repo = new ServiceRecordEditRepository(f.prisma as never);
        await expect(repo.recordInitialFinalizationDocumentsCreated(promotionInput())).resolves.toBe(true);
        expect(f.executeRaw).not.toHaveBeenCalled();
        expect(evaluate).toHaveBeenCalledWith({ branchId, documentId: "revision-doc-1" }, f.tx);
    });
    it("accepts only a fully scrubbed same-branch/revision tombstone and evaluates it after promotion in the same transaction", async () => {
        const f = transactionHarness(initialRows({ chunks: [{ ...validChunk(), documentStatusType: "049", documentClientId: null,
            documentCaseId: null, documentKind: null, documentSnapshotVersion: null, documentSnapshotChunkIndex: null }] }));
        evaluate.mockImplementation(async (_params, tx) => {
            expect(tx).toBe(f.tx);
            expect(f.executeRaw).toHaveBeenCalledTimes(3);
            return true;
        });
        await expect(new ServiceRecordEditRepository(f.prisma as never).recordInitialFinalizationDocumentsCreated(promotionInput())).resolves.toBe(true);
        expect(evaluate).toHaveBeenCalledWith({ branchId, documentId: "revision-doc-1" }, f.tx);
        const locks = f.queryRaw.mock.calls.map(([query]) => sqlText(query));
        const caseLock = locks.findIndex(query => /FROM "?service_record_case"?\s/.test(query) && query.includes("FOR UPDATE"));
        const stateLock = locks.findIndex(query => /FROM "?service_record_revision_document_state"?\s/.test(query) && query.includes("FOR UPDATE"));
        const docLock = locks.findIndex(query => /FROM "?eformsign_doc"?\s/.test(query) && query.includes("FOR UPDATE"));
        expect(caseLock).toBeGreaterThanOrEqual(0);
        expect(stateLock).toBeGreaterThanOrEqual(0);
        expect(docLock).toBeGreaterThanOrEqual(0);
        expect(caseLock).toBeLessThan(stateLock);
        expect(stateLock).toBeLessThan(docLock);
    });
    it("evaluates every chunk document rather than only the first", async () => {
        const f = transactionHarness(initialRows({ chunks: [1, 2].map(index => ({ ...validChunk(), chunkIndex: index, chunkCount: 2,
            documentId: `revision-doc-${index}`, storedDocumentId: `revision-doc-${index}`, documentSnapshotChunkIndex: index })) }));
        await expect(new ServiceRecordEditRepository(f.prisma as never).recordInitialFinalizationDocumentsCreated(
            promotionInput({ chunkCount: 2, documentIds: ["revision-doc-1", "revision-doc-2"] }),
        )).resolves.toBe(true);
        expect(evaluate.mock.calls.map(([params]) => params.documentId)).toEqual(["revision-doc-1", "revision-doc-2"]);
    });
    it.each([
        { state: { status: "capability_unverified", step: "capability_unverified" } },
        { state: { workflowScope: { ...scope, generationKind: "REVISION_SNAPSHOT" } } },
        { chunks: [] }, { owner: { status: "COMPLETED" } },
        { chunks: [{ ...validChunk(), documentClientId: 999 }] },
        { chunks: [{ ...validChunk(), documentStatusType: "049", documentBranchId: "other-branch" }] },
        { chunks: [{ ...validChunk(), documentStatusType: "049", documentRevisionId: "other-revision" }] },
    ])("refuses invalid creation scope before writes %#", async (options) => {
        const f = transactionHarness(initialRows(options));
        const repo = new ServiceRecordEditRepository(f.prisma as never);
        await expect(repo.recordInitialFinalizationDocumentsCreated(promotionInput())).resolves.toBe(false);
        expect(f.executeRaw).not.toHaveBeenCalled();
    });
    it("throws on a lost case CAS so prior state writes roll back", async () => {
        const f = transactionHarness(initialRows());
        f.executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
        const repo = new ServiceRecordEditRepository(f.prisma as never);
        await expect(repo.recordInitialFinalizationDocumentsCreated(promotionInput())).rejects.toThrow("case CAS lost");
        expect(f.executeRaw).toHaveBeenCalledTimes(2);
    });
    it("blocks the staff-confirm operation guard until Step B completes INITIAL", async () => {
        const state = stateRow({ workflowScope: scope, status: "processing", step: "documents_created" });
        const tx = { $queryRaw: jest.fn(async (query: unknown) => {
            const sql = sqlText(query);
            expect(sql).toContain("state.status IN ('not_required', 'completed')");
            expect(sql).not.toContain("'processing'");
            return state.status === "completed" ? [] : [state];
        }) };
        const input = { branchId, clientId, serviceRecordCaseId: caseId };
        await expect(assertNoBlockingRevisionDocumentStates(tx as never, input)).rejects.toMatchObject({
            code: "SERVICE_RECORD_REVISION_OPERATION_UNRESOLVED", status: "processing", operation: "record_snapshot",
        });
        state.status = "completed"; state.step = "completed";
        await expect(assertNoBlockingRevisionDocumentStates(tx as never, input)).resolves.toBeUndefined();
    });
});
