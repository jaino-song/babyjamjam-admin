import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
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
    const tx = { $queryRaw: queryRaw };
    const prisma = {
        $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { prisma, tx, queryRaw };
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
            [],
        ]);
        const repository = new ServiceRecordEditRepository(harness.prisma as never);

        await expect(repository.allocateServiceRecordRevisionDocumentVersion(allocatorInput({ expectedDocumentVersion: null })))
            .resolves.toBe(3);

        const sqlCalls = harness.queryRaw.mock.calls.map(([query]) => sqlText(query));
        expect(sqlCalls.some((query) => query.includes("GREATEST"))).toBe(true);
        expect(sqlCalls.some((query) => query.includes("payload_fingerprint"))).toBe(true);
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
