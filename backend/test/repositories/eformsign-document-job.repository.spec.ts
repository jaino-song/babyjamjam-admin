import { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";

const sqlText = (value: unknown): string => {
    if (value && typeof value === "object" && "strings" in value) {
        return ((value as { strings: string[] }).strings ?? []).join("");
    }
    return String(value);
};

const row = (overrides: Record<string, unknown> = {}) => ({
    id: "00000000-0000-0000-0000-000000000001",
    branch_id: "00000000-0000-0000-0000-000000000010",
    client_id: 7,
    document_id: null,
    job_type: "create_document",
    source: "staff",
    status: "queued",
    request_key: "request-1",
    active_key: "create:branch:7",
    payload: { clientId: 7 },
    payload_fingerprint: "a".repeat(64),
    progress_step: "queued",
    attempts: 0,
    next_attempt_at: new Date("2026-08-13T00:00:00Z"),
    heartbeat_at: null,
    lease_token: null,
    auto_finalize_outcome_recorded_at: null,
    started_at: null,
    completed_at: null,
    last_error_code: null,
    created_by_user_id: null,
    created_at: new Date("2026-08-13T00:00:00Z"),
    updated_at: new Date("2026-08-13T00:00:00Z"),
    ...overrides,
});

const dispatchJobId = "00000000-0000-4000-8000-000000000001";
const dispatchLeaseToken = "00000000-0000-4000-8000-000000000099";
const dispatchBranchId = "00000000-0000-4000-8000-000000000010";
const dispatchCaseId = "00000000-0000-4000-8000-000000000020";

const dispatchContext = {
    branchId: dispatchBranchId,
    clientId: 7,
    serviceRecordCaseId: dispatchCaseId,
    revisionId: null,
    revisionNumber: null,
    businessFingerprint: "a".repeat(64),
    plannedSessionCount: 1,
    plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-09-01" }],
    documentSyncStatus: "pending" as const,
    lifecycleStatus: "IN_PROGRESS",
    formVersion: 3,
};

describe("SbEformsignDocumentJobRepository", () => {
    let queryRaw: jest.Mock;
    let executeRaw: jest.Mock;
    let repository: SbEformsignDocumentJobRepository;

    beforeEach(() => {
        queryRaw = jest.fn();
        executeRaw = jest.fn();
        const prisma = {
            $queryRaw: queryRaw,
            $executeRaw: executeRaw,
            $transaction: jest.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
                $queryRaw: queryRaw,
                $executeRaw: executeRaw,
            })),
        } as unknown as PrismaService;
        repository = new SbEformsignDocumentJobRepository(prisma);
    });

    it("returns the inserted job and never exposes the payload in a log path", async () => {
        queryRaw.mockResolvedValueOnce([row()]);
        const result = await repository.enqueue({
            branchId: row().branch_id,
            clientId: 7,
            jobType: "create_document",
            source: "staff",
            requestKey: "request-1",
            activeKey: "create:branch:7",
            payload: { clientId: 7 },
            payloadFingerprint: "a".repeat(64),
        });
        expect(result.existing).toBe(false);
        expect(result.job.status).toBe("queued");
        expect(sqlText(queryRaw.mock.calls[0][0])).toContain("ON CONFLICT DO NOTHING");
    });

    it("returns the existing request or active job after a matching unique conflict", async () => {
        queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([row()]);
        const result = await repository.enqueue({
            branchId: row().branch_id,
            clientId: 7,
            jobType: "create_document",
            source: "staff",
            requestKey: "request-1",
            activeKey: "create:branch:7",
            payload: {},
            payloadFingerprint: "a".repeat(64),
        });
        expect(result.existing).toBe(true);
        expect(sqlText(queryRaw.mock.calls[1][0])).toContain("request_key");
        expect(sqlText(queryRaw.mock.calls[1][0])).toContain("active_key");
    });

    it("rejects a reused request key with a different payload fingerprint", async () => {
        queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([row()]);
        await expect(repository.enqueue({
            branchId: row().branch_id,
            clientId: 7,
            jobType: "create_document",
            source: "staff",
            requestKey: "request-1",
            activeKey: "create:branch:7",
            payload: {},
            payloadFingerprint: "b".repeat(64),
        })).rejects.toThrow("EFORMSIGN_DOCUMENT_JOB_IDEMPOTENCY_MISMATCH");
    });

    it("authorizes a live lease and commits the creating marker in the caller transaction", async () => {
        queryRaw
            .mockResolvedValueOnce([row({
                id: dispatchJobId,
                branch_id: dispatchBranchId,
                status: "processing",
                progress_step: "preparing",
                lease_token: dispatchLeaseToken,
                payload: { context: dispatchContext },
            })])
            .mockResolvedValueOnce([{ id: dispatchJobId }]);

        const tx = { $queryRaw: queryRaw } as never;
        await expect(repository.authorizeForDispatchInTransaction(tx, {
            jobId: dispatchJobId,
            leaseToken: dispatchLeaseToken,
            expectedContext: dispatchContext,
        })).resolves.toEqual({ kind: "allow" });

        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(sqlText(queryRaw.mock.calls[0][0])).toContain("FOR UPDATE");
        expect(sqlText(queryRaw.mock.calls[1][0])).toContain("progress_step = 'creating'");
        expect(sqlText(queryRaw.mock.calls[1][0])).toContain("status = 'processing'");
    });

    it("returns stale without claiming when the locked revision context changed", async () => {
        queryRaw.mockResolvedValueOnce([row({
            id: dispatchJobId,
            branch_id: dispatchBranchId,
            status: "processing",
            progress_step: "preparing",
            lease_token: dispatchLeaseToken,
            payload: { context: dispatchContext },
        })]);

        await expect(repository.authorizeForDispatchInTransaction({ $queryRaw: queryRaw } as never, {
            jobId: dispatchJobId,
            leaseToken: dispatchLeaseToken,
            expectedContext: { ...dispatchContext, businessFingerprint: "b".repeat(64) },
        })).resolves.toEqual({ kind: "stale", reason: "revision_or_business_state_changed" });
        expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it("owns the root legacy authorization transaction and commits the marker after the client lock", async () => {
        const legacy = row({
            id: dispatchJobId,
            branch_id: dispatchBranchId,
            client_id: 7,
            status: "processing",
            progress_step: "preparing",
            lease_token: dispatchLeaseToken,
            payload: { clientId: 7 },
        });
        queryRaw.mockImplementation(async (query: unknown) => {
            const statement = sqlText(query);
            if (statement.includes("UPDATE \"eformsign_document_job\"")) return [{ id: dispatchJobId }];
            if (statement.includes("FROM \"eformsign_document_job\"")) return [legacy];
            if (statement.includes("FROM \"client\"")) return [{ id: 7 }];
            return [];
        });

        const result = await repository.authorizeForDispatch({
            jobId: dispatchJobId,
            leaseToken: dispatchLeaseToken,
            expectedContext: null,
        });

        expect(result).toEqual({ kind: "allow" });
        const statements = queryRaw.mock.calls.map(([query]) => sqlText(query));
        const clientLockIndex = statements.findIndex((statement) => statement.includes("FROM \"client\""));
        const markerIndex = statements.findIndex((statement) => statement.includes("progress_step = 'creating'"));
        expect(clientLockIndex).toBeGreaterThanOrEqual(0);
        expect(markerIndex).toBeGreaterThan(clientLockIndex);
        expect(statements[markerIndex]).toContain("status = 'processing'");
    });

    it("rereads the current case under the common lock before authorizing a revision job", async () => {
        const revisionJob = row({
            id: dispatchJobId,
            branch_id: dispatchBranchId,
            client_id: 7,
            status: "processing",
            progress_step: "preparing",
            lease_token: dispatchLeaseToken,
            payload: { context: dispatchContext },
        });
        const currentCase = {
            id: dispatchCaseId,
            branchId: dispatchBranchId,
            clientId: 7,
            requiredSessionCount: 1,
            plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-01" }],
            currentRevisionId: null,
            formVersion: 3,
            status: "IN_PROGRESS",
        };
        queryRaw.mockImplementation(async (query: unknown) => {
            const statement = sqlText(query);
            if (statement.includes("UPDATE \"eformsign_document_job\"")) return [{ id: dispatchJobId }];
            if (statement.includes("FROM \"eformsign_document_job\"")) return [revisionJob];
            if (statement.includes("FROM \"client\"")) return [{ id: 7 }];
            if (statement.includes("FROM \"service_record_case\"")) return [{ id: dispatchCaseId }];
            return [];
        });
        const transaction = {
            $queryRaw: queryRaw,
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue(currentCase),
            },
        };
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction)),
        } as unknown as PrismaService;
        const revisionRepository = new SbEformsignDocumentJobRepository(prisma);

        await expect(revisionRepository.authorizeForDispatch({
            jobId: dispatchJobId,
            leaseToken: dispatchLeaseToken,
            expectedContext: dispatchContext,
        })).resolves.toEqual({ kind: "allow" });

        expect(transaction.service_record_case.findUnique).toHaveBeenCalledTimes(2);
        const statements = queryRaw.mock.calls.map(([query]) => sqlText(query));
        const markerIndex = statements.findIndex((statement) => statement.includes("progress_step = 'creating'"));
        expect(markerIndex).toBeGreaterThan(
            statements.findIndex((statement) => statement.includes("FROM \"service_record_case\"")),
        );
    });

    it("fails closed before the marker when a legacy finalize document has no client owner", async () => {
        const finalizeJob = row({
            id: dispatchJobId,
            branch_id: dispatchBranchId,
            client_id: null,
            document_id: "legacy-finalize",
            job_type: "finalize_document",
            status: "processing",
            progress_step: "preparing",
            lease_token: dispatchLeaseToken,
            payload: { documentId: "legacy-finalize" },
        });
        queryRaw.mockResolvedValueOnce([finalizeJob]);
        const transaction = {
            $queryRaw: queryRaw,
            eformsign_doc: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 91,
                    documentId: "legacy-finalize",
                    branchId: dispatchBranchId,
                    clientId: null,
                    serviceRecordCaseId: null,
                }),
            },
        };
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction)),
        } as unknown as PrismaService;
        const finalizeRepository = new SbEformsignDocumentJobRepository(prisma);

        await expect(finalizeRepository.authorizeForDispatch({
            jobId: dispatchJobId,
            leaseToken: dispatchLeaseToken,
            expectedContext: null,
        })).resolves.toEqual({
            kind: "stale",
            reason: "SERVICE_RECORD_FINALIZE_OWNER_UNAVAILABLE",
        });
        expect(transaction.eformsign_doc.findUnique).toHaveBeenCalledTimes(1);
        expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it.each([
        { status: "failed", lease_token: dispatchLeaseToken, progress_step: "preparing" },
        { status: "processing", lease_token: "00000000-0000-4000-8000-000000000098", progress_step: "preparing" },
        { status: "processing", lease_token: dispatchLeaseToken, progress_step: "creating" },
        { status: "reconciling", lease_token: dispatchLeaseToken, progress_step: "reconciling" },
    ])("fails closed for a non-dispatchable job state %#", async (state) => {
        queryRaw.mockResolvedValueOnce([row({
            id: dispatchJobId,
            branch_id: dispatchBranchId,
            payload: { context: dispatchContext },
            ...state,
        })]);

        await expect(repository.authorizeForDispatchInTransaction({ $queryRaw: queryRaw } as never, {
            jobId: dispatchJobId,
            leaseToken: dispatchLeaseToken,
            expectedContext: dispatchContext,
        })).resolves.toMatchObject({ kind: "lost" });
        expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it("serializes replicas and refuses a fourth global active job", async () => {
        executeRaw.mockResolvedValue(1);
        queryRaw.mockResolvedValueOnce([{ count: 3 }]);
        await expect(repository.claimDue(2)).resolves.toEqual([]);
        expect(sqlText(executeRaw.mock.calls[0][0])).toContain("pg_advisory_xact_lock");
        expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it("claims only available capacity with SKIP LOCKED", async () => {
        executeRaw.mockResolvedValue(1);
        queryRaw.mockResolvedValueOnce([{ count: 2 }]).mockResolvedValueOnce([
            row({ status: "processing", attempts: 1 }),
        ]);
        const claimed = await repository.claimDue(3);
        expect(claimed).toHaveLength(1);
        const claimSql = sqlText(queryRaw.mock.calls[1][0]);
        expect(claimSql).toContain("FOR UPDATE SKIP LOCKED");
        expect(claimSql).toContain("attempts = attempts + 1");
        expect(claimSql).toContain("lease_token = gen_random_uuid()");
    });

    it("clears payload and active key on safe terminal transitions", async () => {
        queryRaw.mockResolvedValueOnce([row({ status: "completed", payload: null, active_key: null })]);
        await repository.markCompleted(row().id, "00000000-0000-0000-0000-000000000099", "doc-1");
        const statement = sqlText(queryRaw.mock.calls[0][0]);
        expect(statement).toContain("payload = NULL");
        expect(statement).toContain("active_key = NULL");
    });

    it("retains the active key for attention jobs while clearing sensitive payload", async () => {
        queryRaw.mockResolvedValueOnce([row({ status: "requires_attention", payload: null })]);
        await repository.markRequiresAttention(
            row().id,
            "00000000-0000-0000-0000-000000000099",
            "AMBIGUOUS_PROVIDER_STATE",
        );
        const statement = sqlText(queryRaw.mock.calls[0][0]);
        expect(statement).toContain("payload = NULL");
        expect(statement).not.toContain("active_key = NULL");
    });

    it("records an auto-finalize terminal attempt atomically and releases retry capacity below the cap", async () => {
        const executeRawInTransaction = jest.fn().mockResolvedValue(1);
        const queryRawInTransaction = jest.fn().mockResolvedValueOnce([row({
            job_type: "finalize_document",
            source: "auto_finalize",
            status: "failed",
            document_id: "doc-1",
            active_key: "finalize:doc-1",
            lease_token: "00000000-0000-0000-0000-000000000099",
        })]);
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
                $queryRaw: queryRawInTransaction,
                $executeRaw: executeRawInTransaction,
                eformsign_doc: {
                    update: jest.fn().mockResolvedValue({ autoFinalizeAttempts: 2 }),
                },
            })),
        } as unknown as PrismaService;
        const autoRepository = new SbEformsignDocumentJobRepository(prisma);

        const transitioned = await autoRepository.markFailed(
            row().id,
            "00000000-0000-0000-0000-000000000099",
            "PRE_SEND_RETRY_EXHAUSTED",
        );

        expect(transitioned).toEqual(expect.objectContaining({
            autoFinalizeOutcomeAttempts: 2,
            activeKey: null,
        }));
        expect(executeRawInTransaction).toHaveBeenCalledTimes(2);
    });

    it("retains the auto-finalize active key when the third terminal attempt is exhausted", async () => {
        const executeRawInTransaction = jest.fn().mockResolvedValue(1);
        const queryRawInTransaction = jest.fn().mockResolvedValueOnce([row({
            job_type: "finalize_document",
            source: "auto_finalize",
            status: "failed",
            document_id: "doc-1",
            active_key: "finalize:doc-1",
            lease_token: "00000000-0000-0000-0000-000000000099",
        })]);
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
                $queryRaw: queryRawInTransaction,
                $executeRaw: executeRawInTransaction,
                eformsign_doc: {
                    update: jest.fn().mockResolvedValue({ autoFinalizeAttempts: 3 }),
                },
            })),
        } as unknown as PrismaService;
        const autoRepository = new SbEformsignDocumentJobRepository(prisma);

        const transitioned = await autoRepository.markFailed(
            row().id,
            "00000000-0000-0000-0000-000000000099",
            "PRE_SEND_RETRY_EXHAUSTED",
        );

        expect(transitioned).toEqual(expect.objectContaining({
            autoFinalizeOutcomeAttempts: 3,
            activeKey: "finalize:doc-1",
        }));
    });

    it("recovers only pre-send progress to queued and reconciles possible sends", async () => {
        queryRaw.mockResolvedValueOnce([
            row({ progress_step: "validating", status: "queued" }),
            row({ id: "00000000-0000-0000-0000-000000000002", progress_step: "creating", status: "reconciling", payload: null }),
        ]);
        const recovered = await repository.recoverStale(new Date());
        expect(recovered.map((job) => job.status)).toEqual(["queued", "reconciling"]);
        const statement = sqlText(queryRaw.mock.calls[0][0]);
        expect(statement).toContain("progress_step IS NULL");
        expect(statement).toContain("ELSE 'reconciling'");
        expect(statement).toContain("status IN ('processing', 'reconciling')");
    });

    it("scopes summary and every list section to the authenticated branch", async () => {
        queryRaw.mockResolvedValueOnce([{ active_count: 2, attention_count: 1 }]);
        await expect(repository.getSummary(row().branch_id)).resolves.toEqual({
            activeCount: 2,
            requiresAttentionCount: 1,
        });
        expect(sqlText(queryRaw.mock.calls[0][0])).toContain("branch_id = ");

        queryRaw.mockReset();
        queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        await repository.listForBranch(row().branch_id, new Date(), 100);
        expect(queryRaw).toHaveBeenCalledTimes(3);
        expect(queryRaw.mock.calls.every((call) => sqlText(call[0]).includes("branch_id = "))).toBe(true);
    });
});
