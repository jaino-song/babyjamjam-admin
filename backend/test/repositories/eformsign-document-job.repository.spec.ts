import { PrismaService } from "infrastructure/database/prisma.service";
import { isEntityChangeHintsSuppressed } from "infrastructure/database/entity-change-suppression";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";

const sqlText = (value: unknown): string => {
    if (value && typeof value === "object" && "strings" in value) {
        return ((value as { strings: string[] }).strings ?? []).join("");
    }
    return String(value);
};

const contractFragment = (alias = "") => {
    const column = (name: string) => (alias ? `${alias}.${name}` : name);
    return `(${column("source")} = 'staff'`
        + ` AND ${column("job_type")} IN ('create_document', 'finalize_document')`
        + ` AND ${column("request_key")} NOT LIKE 'service-record-%'`
        + ` AND (${column("payload")} IS NULL OR NOT (${column("payload")} ? 'kind')))`;
};
const CONTRACT_FRAGMENT = contractFragment();
const CONTRACT_FRAGMENT_J = contractFragment("j");
const CONTRACT_FRAGMENT_THEN = `WHEN ${CONTRACT_FRAGMENT} THEN payload`;

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

    it("authorizes a live lease and commits the dispatch_authorized marker in the caller transaction", async () => {
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
        const claim = queryRaw.mock.calls[1][0] as { values: unknown[] };
        // The authorization marker is the exclusivity marker, not send evidence:
        // it is written as dispatch_authorized and never as `creating`, and it is
        // absent from the NOT IN guard so a re-claimed row authorizes again.
        expect(sqlText(claim)).toContain("SET progress_step = ");
        expect(sqlText(claim)).not.toContain("progress_step = 'creating'");
        expect(claim.values).toContain("dispatch_authorized");
        expect(claim.values).not.toContain("creating");
        expect(sqlText(claim)).toContain("COALESCE(progress_step, '') NOT IN ('creating', 'sent')");
        expect(sqlText(claim)).not.toMatch(/NOT IN \([^)]*dispatch_authorized/);
        expect(sqlText(claim)).toContain("status = 'processing'");
    });

    it("authorizes again a row that still carries dispatch_authorized from an earlier attempt", async () => {
        queryRaw
            .mockResolvedValueOnce([row({
                id: dispatchJobId,
                branch_id: dispatchBranchId,
                status: "processing",
                progress_step: "dispatch_authorized",
                lease_token: dispatchLeaseToken,
                payload: { context: dispatchContext },
            })])
            .mockResolvedValueOnce([{ id: dispatchJobId }]);

        await expect(repository.authorizeForDispatchInTransaction({ $queryRaw: queryRaw } as never, {
            jobId: dispatchJobId,
            leaseToken: dispatchLeaseToken,
            expectedContext: dispatchContext,
        })).resolves.toEqual({ kind: "allow" });
        expect(queryRaw).toHaveBeenCalledTimes(2);
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
        const markerIndex = statements.findIndex((statement) => statement.includes("SET progress_step = ")
            && statement.includes("NOT IN ('creating', 'sent')"));
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
        const markerIndex = statements.findIndex((statement) => statement.includes("SET progress_step = ")
            && statement.includes("NOT IN ('creating', 'sent')"));
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
        { status: "processing", lease_token: dispatchLeaseToken, progress_step: "sent" },
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
        expect(statement).toContain("payload = CASE");
        expect(statement).toContain("service_record_revision");
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
        expect(statement).toContain("payload = CASE");
        expect(statement).toContain("service_record_revision");
        expect(statement).not.toContain("active_key = NULL");
    });

    it.each([
        "markReconciling",
        "markCompleted",
        "markFailed",
        "markRequiresAttention",
    ] as const)("retains a revision immutable payload through %s", async (transition) => {
        const immutablePayload = {
            kind: "service_record_revision",
            context: { revisionId: dispatchCaseId },
            immutablePayload: { generationId: "generation-1" },
            payloadFingerprint: "b".repeat(64),
            completeness: "complete",
        };
        queryRaw.mockResolvedValueOnce([row({
            status: transition === "markReconciling"
                ? "reconciling"
                : transition === "markCompleted"
                    ? "completed"
                    : transition === "markFailed"
                        ? "failed"
                        : "requires_attention",
            payload: immutablePayload,
            payload_fingerprint: immutablePayload.payloadFingerprint,
            active_key: transition === "markCompleted" ? null : row().active_key,
        })]);

        const transitioned = transition === "markReconciling"
            ? await repository.markReconciling(row().id, "00000000-0000-0000-0000-000000000099")
            : transition === "markCompleted"
                ? await repository.markCompleted(row().id, "00000000-0000-0000-0000-000000000099")
                : transition === "markFailed"
                    ? await repository.markFailed(
                        row().id,
                        "00000000-0000-0000-0000-000000000099",
                        "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED",
                    )
                    : await repository.markRequiresAttention(
                        row().id,
                        "00000000-0000-0000-0000-000000000099",
                        "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED",
                    );

        expect(transitioned?.payload).toEqual(immutablePayload);
        expect(transitioned?.payloadFingerprint).toBe(immutablePayload.payloadFingerprint);
        expect(sqlText(queryRaw.mock.calls[0][0])).toContain("jsonb_typeof(payload)");
    });

    it.each([
        ["one", JSON.stringify({ enabled: true, graceDays: 7, maxAttempts: 1 }), 1, "finalize:doc-1"],
        ["three", JSON.stringify({ enabled: true, graceDays: 7, maxAttempts: 3 }), 2, null],
        ["five", JSON.stringify({ enabled: true, graceDays: 7, maxAttempts: 5 }), 5, "finalize:doc-1"],
    ] as const)("honors the branch maxAttempts setting (%s)", async (_label, settingValue, recordedAttempts, expectedActiveKey) => {
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
                    update: jest.fn().mockResolvedValue({ autoFinalizeAttempts: recordedAttempts }),
                },
                system_setting: {
                    findUnique: jest.fn().mockResolvedValue({ value: settingValue }),
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
            autoFinalizeOutcomeAttempts: recordedAttempts,
            activeKey: expectedActiveKey,
        }));
        expect(executeRawInTransaction).toHaveBeenCalledTimes(2);
    });

    it.each([
        ["missing", null, 2, null],
        ["malformed", "{malformed", 3, "finalize:doc-1"],
        ["noninteger", JSON.stringify({ maxAttempts: "5" }), 3, "finalize:doc-1"],
        ["below-bound", JSON.stringify({ maxAttempts: 0 }), 1, "finalize:doc-1"],
        ["above-bound", JSON.stringify({ maxAttempts: 99 }), 3, null],
    ] as const)("uses the normalized cap for %s branch settings", async (_label, settingValue, recordedAttempts, expectedActiveKey) => {
        const executeRawInTransaction = jest.fn().mockResolvedValue(1);
        const queryRawInTransaction = jest.fn().mockResolvedValueOnce([row({
            job_type: "finalize_document",
            source: "auto_finalize",
            status: "failed",
            document_id: "doc-1",
            active_key: "finalize:doc-1",
            lease_token: "00000000-0000-0000-0000-000000000099",
        })]);
        const findUnique = jest.fn().mockResolvedValue({ value: settingValue });
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
                $queryRaw: queryRawInTransaction,
                $executeRaw: executeRawInTransaction,
                eformsign_doc: {
                    update: jest.fn().mockResolvedValue({ autoFinalizeAttempts: recordedAttempts }),
                },
                system_setting: {
                    findUnique,
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
            autoFinalizeOutcomeAttempts: recordedAttempts,
            activeKey: expectedActiveKey,
        }));
        expect(findUnique).toHaveBeenCalledWith({
            where: { key: "branch:00000000-0000-0000-0000-000000000010:contract_automation:auto_finalize" },
            select: { value: true },
        });
    });

    it("recovers only pre-send progress to queued and reconciles possible sends", async () => {
        const revisionPayload = {
            kind: "service_record_revision",
            context: { revisionId: dispatchCaseId },
            immutablePayload: { generationId: "generation-1" },
            payloadFingerprint: "b".repeat(64),
            completeness: "complete",
        };
        queryRaw.mockResolvedValueOnce([
            row({ progress_step: "validating", status: "queued" }),
            row({
                id: "00000000-0000-0000-0000-000000000002",
                progress_step: "creating",
                status: "reconciling",
                payload: revisionPayload,
                payload_fingerprint: revisionPayload.payloadFingerprint,
            }),
        ]);
        const recovered = await repository.recoverStale(new Date());
        expect(recovered.map((job) => job.status)).toEqual(["queued", "reconciling"]);
        expect(recovered[1]?.payload).toEqual(revisionPayload);
        const statement = sqlText(queryRaw.mock.calls[0][0]);
        expect(statement).toContain("progress_step IS NULL");
        expect(statement).toContain("ELSE 'reconciling'");
        // dispatch_authorized is deliberately absent from the requeue list: a crash
        // could have happened mid-click before `creating` persisted, so a stale
        // job carrying it goes to reconciling.
        expect(statement).toContain("progress_step IN ('queued', 'validating', 'preparing')");
        expect(statement).not.toContain("dispatch_authorized");
        expect((queryRaw.mock.calls[0][0] as { values: unknown[] }).values).not.toContain("dispatch_authorized");
        expect(statement).toContain("jsonb_typeof(payload)");
        expect(statement).toContain("status IN ('processing', 'reconciling')");
    });

    it("retains revision generation rows during terminal retention cleanup", async () => {
        executeRaw.mockResolvedValueOnce(1);

        await expect(repository.deleteExpiredTerminal(new Date("2026-09-01T00:00:00Z"))).resolves.toBe(1);

        const statement = sqlText(executeRaw.mock.calls[0][0]);
        expect(statement).toContain("jsonb_typeof(payload)");
        expect(statement).toContain("payload->>'kind' = 'service_record_revision'");
        expect(statement).toContain("COALESCE");
        expect(statement).toContain("NOT (");
    });

    it("scopes summary and every list section to the authenticated branch", async () => {
        queryRaw
            .mockResolvedValueOnce([{ active_count: 2, attention_count: 1, failed_count: 0, unresolved_count: 0 }])
            .mockResolvedValueOnce([]);
        await expect(repository.getSummary(row().branch_id)).resolves.toEqual({
            activeCount: 2,
            requiresAttentionCount: 1,
            failedCount: 0,
            unresolvedCount: 0,
            unresolvedJobIds: [],
        });
        expect(queryRaw.mock.calls.every((call) => sqlText(call[0]).includes("branch_id = "))).toBe(true);

        queryRaw.mockReset();
        queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        await repository.listForBranch(row().branch_id, new Date(), 100);
        expect(queryRaw).toHaveBeenCalledTimes(3);
        expect(queryRaw.mock.calls.every((call) => sqlText(call[0]).includes("branch_id = "))).toBe(true);
    });

    describe("updateProgress monotonic marker", () => {
        it("decides the step ordering in SQL while still advancing the heartbeat under the lease", async () => {
            queryRaw.mockResolvedValueOnce([row({ status: "processing", progress_step: "sent" })]);
            const heartbeatAt = new Date("2026-10-28T00:00:00Z");

            await repository.updateProgress(dispatchJobId, dispatchLeaseToken, "dispatch_authorized", heartbeatAt);

            const call = queryRaw.mock.calls[0][0];
            const statement = sqlText(call).replace(/\s+/g, " ");
            expect(statement).toContain("SET progress_step = CASE WHEN progress_step = 'sent' THEN progress_step");
            expect(statement).toContain("WHEN progress_step = 'creating' AND ");
            expect(statement).toContain("::text <> 'sent' THEN progress_step");
            expect(statement).toContain("WHEN progress_step = ");
            expect(statement).toContain("::text NOT IN ('creating', 'sent') THEN progress_step");
            expect(statement).toContain("ELSE ");
            expect(statement).toContain("END, heartbeat_at = ");
            expect(statement).toContain("updated_at = now()");
            expect(statement).toContain("lease_token = ");
            expect(statement).toContain("status IN ('processing', 'reconciling')");
            const values = (call as { values: unknown[] }).values;
            expect(values).toContain(heartbeatAt);
            expect(values).toContain("dispatch_authorized");
            expect(values).toContain(dispatchJobId);
            expect(values).toContain(dispatchLeaseToken);
        });

        const observeSuppression = (results: unknown[][]) => {
            const observed: boolean[] = [];
            queryRaw.mockReset();
            for (const result of results) {
                queryRaw.mockImplementationOnce(async () => {
                    observed.push(isEntityChangeHintsSuppressed());
                    return result;
                });
            }
            return observed;
        };

        it("a step change is announced: the step-moving statement runs unsuppressed and matches only a different step", async () => {
            const observed = observeSuppression([[row({ status: "processing", progress_step: "creating" })]]);

            const updated = await repository.updateProgress(dispatchJobId, dispatchLeaseToken, "creating");

            expect(updated?.progressStep).toBe("creating");
            expect(queryRaw).toHaveBeenCalledTimes(1);
            expect(observed).toEqual([false]);
            expect(sqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ")).toContain("progress_step IS DISTINCT FROM");
        });

        it("a heartbeat-only update (step unchanged) moves only heartbeat_at/updated_at and is suppressed", async () => {
            const observed = observeSuppression([[], [row({ status: "processing", progress_step: "creating" })]]);
            const heartbeatAt = new Date("2026-10-28T00:00:30Z");

            const updated = await repository.updateProgress(dispatchJobId, dispatchLeaseToken, "creating", heartbeatAt);

            expect(updated?.id).toBe(row().id);
            expect(queryRaw).toHaveBeenCalledTimes(2);
            // First statement (step would move) is not suppressed; the heartbeat-only one is.
            expect(observed).toEqual([false, true]);
            const heartbeatOnly = sqlText(queryRaw.mock.calls[1][0]).replace(/\s+/g, " ");
            expect(heartbeatOnly).toContain("SET heartbeat_at = ");
            expect(heartbeatOnly).not.toContain("progress_step");
            expect(heartbeatOnly).toContain("lease_token = ");
            expect(heartbeatOnly).toContain("status IN ('processing', 'reconciling')");
            expect((queryRaw.mock.calls[1][0] as { values: unknown[] }).values).toContain(heartbeatAt);
        });

        it("returns null and writes nothing visible when the lease is gone", async () => {
            const observed = observeSuppression([[], []]);

            await expect(repository.updateProgress(dispatchJobId, dispatchLeaseToken, "creating")).resolves.toBeNull();

            expect(observed).toEqual([false, true]);
        });
    });

    describe("contract job payload retention", () => {
        const leaseToken = "00000000-0000-4000-8000-000000000099";

        it.each(["markFailed", "markRequiresAttention"] as const)(
            "keeps a contract job payload through %s and clears every other kind",
            async (transition) => {
                queryRaw.mockResolvedValueOnce([row({
                    status: transition === "markFailed" ? "failed" : "requires_attention",
                })]);
                const transitioned = transition === "markFailed"
                    ? await repository.markFailed(row().id, leaseToken, "PRE_SEND_RETRY_EXHAUSTED")
                    : await repository.markRequiresAttention(row().id, leaseToken, "AMBIGUOUS_PROVIDER_STATE");

                expect(transitioned?.payload).toEqual({ clientId: 7 });
                const statement = sqlText(queryRaw.mock.calls[0][0]);
                const payloadCase = statement.slice(
                    statement.indexOf("payload = CASE"),
                    statement.indexOf("END,", statement.indexOf("payload = CASE")),
                );
                // Exactly two keep-branches, then NULL: the revision row, and a contract job.
                expect(payloadCase.match(/WHEN /g)).toHaveLength(2);
                expect(payloadCase).toContain("payload->>'kind' = 'service_record_revision' THEN payload");
                expect(payloadCase).toContain(CONTRACT_FRAGMENT_THEN);
                expect(payloadCase.trim().endsWith("ELSE NULL")).toBe(true);
                expect(payloadCase.indexOf(CONTRACT_FRAGMENT_THEN)).toBeLessThan(payloadCase.indexOf("ELSE NULL"));
            },
        );

        it("limits the contract keep-branch to staff jobs, so auto finalize and revision operation payloads are cleared", async () => {
            queryRaw.mockResolvedValueOnce([row({ status: "failed" })]);
            await repository.markFailed(row().id, leaseToken, "PRE_SEND_RETRY_EXHAUSTED");
            const statement = sqlText(queryRaw.mock.calls[0][0]);
            expect(statement).toContain("source = 'staff'");
            expect(statement).toContain("request_key NOT LIKE 'service-record-%'");
            expect(statement).toContain("(payload IS NULL OR NOT (payload ? 'kind'))");
            // No branch other than the exact revision kind may keep a payload that has a kind.
            expect(statement).not.toContain("service_record_revision_operations");
        });

        it("keeps the terminal active_key rules unchanged", async () => {
            queryRaw.mockResolvedValueOnce([row({ status: "failed", active_key: null })]);
            await repository.markFailed(row().id, leaseToken, "PRE_SEND_RETRY_EXHAUSTED");
            const statement = sqlText(queryRaw.mock.calls[0][0]);
            expect(statement).toContain("AND source <> 'auto_finalize' THEN NULL");
            expect(statement).toContain("ELSE active_key");
        });
    });

    describe("claimRecovery", () => {
        const jobId = "00000000-0000-4000-8000-000000000001";
        const branchId = "00000000-0000-4000-8000-000000000010";
        const userId = "11111111-1111-4111-8111-111111111111";
        const now = new Date("2026-10-22T03:00:00.000Z");
        const input = { jobId, branchId, userId, now };
        const failedRow = (overrides: Record<string, unknown> = {}) => row({
            id: jobId,
            branch_id: branchId,
            status: "failed",
            active_key: null,
            progress_step: "preparing",
            completed_at: new Date("2026-10-22T02:00:00Z"),
            last_error_code: "PRE_SEND_RETRY_EXHAUSTED",
            client_name: "김산모",
            ...overrides,
        });

        it("claims atomically with every guard in the UPDATE", async () => {
            queryRaw.mockResolvedValueOnce([failedRow({
                progress_step: `manual_in_progress:${userId}:${now.getTime() + 600_000}`,
            })]);

            const result = await repository.claimRecovery(input);

            expect(result.kind).toBe("claimed");
            if (result.kind === "claimed") {
                expect(result.job.payload).toEqual({ clientId: 7 });
                expect(result.job.clientName).toBe("김산모");
            }
            expect(queryRaw).toHaveBeenCalledTimes(1);
            const call = queryRaw.mock.calls[0][0];
            const statement = sqlText(call);
            expect(statement).toContain("UPDATE \"eformsign_document_job\" AS j");
            expect(statement).toContain("j.branch_id = ");
            expect(statement).toContain(CONTRACT_FRAGMENT_J);
            expect(statement).toContain("j.status IN ('failed', 'requires_attention')");
            expect(statement).toContain("COALESCE(j.progress_step, '') NOT LIKE 'manual_in_progress:%'");
            expect(statement).toContain(
                "CASE WHEN j.progress_step ~ '^manual_in_progress:[^:]+:[0-9]{1,15}$'",
            );
            expect(statement).toContain("THEN split_part(j.progress_step, ':', 3)::bigint");
            expect(statement).toContain("ELSE 0 END) < ");
            expect(statement).toContain("j.progress_step LIKE 'manual_in_progress:' || ");
            expect(statement).toContain("LEFT JOIN \"client\" c ON c.id = claimed.client_id");
            expect(statement).toContain("updated_at = now()");
            const values = (call as { values: unknown[] }).values;
            expect(values).toContain(`manual_in_progress:${userId}:${now.getTime() + 600_000}`);
            expect(values).toContain(String(now.getTime()));
            expect(values).toContain(userId);
            expect(values).toContain(jobId);
            expect(values).toContain(branchId);
        });

        it("reports not_found when the follow-up select finds no staff contract row for that branch", async () => {
            queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
            await expect(repository.claimRecovery(input)).resolves.toEqual({ kind: "not_found" });
            const followUp = sqlText(queryRaw.mock.calls[1][0]);
            expect(followUp).toContain("j.branch_id = ");
            expect(followUp).toContain(CONTRACT_FRAGMENT_J);
        });

        it("reports claimed_by_other with the live claim expiry", async () => {
            const expiresAt = now.getTime() + 300_000;
            queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([failedRow({
                status: "requires_attention",
                progress_step: `manual_in_progress:22222222-2222-4222-8222-222222222222:${expiresAt}`,
            })]);
            await expect(repository.claimRecovery(input)).resolves.toEqual({
                kind: "claimed_by_other",
                expiresAt: new Date(expiresAt),
            });
        });

        it.each([
            ["queued", "queued"],
            ["processing", "processing"],
            ["reconciling", "reconciling"],
            ["completed", "completed"],
        ])("reports invalid_state for a %s job", async (_label, status) => {
            queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([failedRow({ status })]);
            await expect(repository.claimRecovery(input)).resolves.toEqual({ kind: "invalid_state", status });
        });

        it("never reports an already resolved job as claimed", async () => {
            queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([failedRow({
                status: "completed",
                progress_step: "manual_resolved",
            })]);
            await expect(repository.claimRecovery(input)).resolves.toEqual({ kind: "invalid_state", status: "completed" });
        });

        it("rejects ids and users that could not be cast or would break the claim string", async () => {
            await expect(repository.claimRecovery({ ...input, jobId: "not-a-uuid" })).resolves.toEqual({ kind: "not_found" });
            await expect(repository.claimRecovery({ ...input, branchId: "x" })).resolves.toEqual({ kind: "not_found" });
            await expect(repository.claimRecovery({ ...input, userId: "a:b" })).rejects.toThrow("INVALID_MANUAL_CLAIM_USER");
            await expect(repository.claimRecovery({ ...input, userId: "a%" })).rejects.toThrow("INVALID_MANUAL_CLAIM_USER");
            expect(queryRaw).not.toHaveBeenCalled();
        });
    });

    describe("resolveManually", () => {
        const jobId = "00000000-0000-4000-8000-000000000001";
        const branchId = "00000000-0000-4000-8000-000000000010";
        const userId = "11111111-1111-4111-8111-111111111111";
        const now = new Date("2026-10-22T03:00:00.000Z");
        const input = { jobId, branchId, userId, now };
        const stuckRow = (overrides: Record<string, unknown> = {}) => row({
            id: jobId,
            branch_id: branchId,
            status: "requires_attention",
            progress_step: "reconciling",
            payload: null,
            completed_at: new Date("2026-10-22T02:00:00Z"),
            last_error_code: "AMBIGUOUS_PROVIDER_STATE",
            ...overrides,
        });

        it("resolves atomically, clearing payload and active key and keeping the error code", async () => {
            queryRaw.mockResolvedValueOnce([stuckRow({
                status: "completed",
                progress_step: "manual_resolved",
                active_key: null,
                client_name: "김산모",
            })]);

            const result = await repository.resolveManually(input);

            expect(result).toMatchObject({ kind: "resolved", job: { status: "completed", clientName: "김산모" } });
            const call = queryRaw.mock.calls[0][0];
            const statement = sqlText(call);
            expect(statement).toContain("SET status = 'completed', progress_step = ");
            expect(statement).toContain("active_key = NULL");
            expect(statement).toContain("payload = NULL");
            expect(statement).toContain("heartbeat_at = NULL, lease_token = NULL, updated_at = now()");
            expect(statement).not.toContain("last_error_code");
            expect(statement).toContain("j.branch_id = ");
            expect(statement).toContain(CONTRACT_FRAGMENT_J);
            expect(statement).toContain("j.status IN ('failed', 'requires_attention')");
            expect(statement).toContain("COALESCE(j.progress_step, '') NOT LIKE 'manual_in_progress:%'");
            expect(statement).toContain("CASE WHEN j.progress_step ~ '^manual_in_progress:[^:]+:[0-9]{1,15}$'");
            expect(statement).toContain("j.progress_step LIKE 'manual_in_progress:' || ");
            const values = (call as { values: unknown[] }).values;
            expect(values).toContain("manual_resolved");
            expect(values).toContain(now);
            expect(values).toContain(userId);
            expect(queryRaw).toHaveBeenCalledTimes(1);
        });

        it("is idempotent for a job staff already resolved", async () => {
            queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckRow({
                status: "completed",
                progress_step: "manual_resolved",
                active_key: null,
            })]);
            await expect(repository.resolveManually(input)).resolves.toMatchObject({
                kind: "already_resolved",
                job: { status: "completed", progressStep: "manual_resolved" },
            });
        });

        it("maps the remaining misses", async () => {
            queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
            await expect(repository.resolveManually(input)).resolves.toEqual({ kind: "not_found" });

            const expiresAt = now.getTime() + 60_000;
            queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckRow({
                progress_step: `manual_in_progress:22222222-2222-4222-8222-222222222222:${expiresAt}`,
            })]);
            await expect(repository.resolveManually(input)).resolves.toEqual({
                kind: "claimed_by_other",
                expiresAt: new Date(expiresAt),
            });

            queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckRow({ status: "processing" })]);
            await expect(repository.resolveManually(input)).resolves.toEqual({ kind: "invalid_state", status: "processing" });

            // A completed job that was not resolved by hand is not "already resolved".
            queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([stuckRow({ status: "completed", progress_step: "sent" })]);
            await expect(repository.resolveManually(input)).resolves.toEqual({ kind: "invalid_state", status: "completed" });
        });

        it("rejects malformed ids as not_found without querying", async () => {
            await expect(repository.resolveManually({ ...input, jobId: "nope" })).resolves.toEqual({ kind: "not_found" });
            expect(queryRaw).not.toHaveBeenCalled();
        });
    });

    describe("purgeExpiredAttentionPayloads", () => {
        it("nulls only contract requires_attention payloads older than seven days and keeps the active key", async () => {
            executeRaw.mockResolvedValueOnce(3);
            const now = new Date("2026-10-22T03:00:00.000Z");

            await expect(repository.purgeExpiredAttentionPayloads(now)).resolves.toBe(3);

            const call = executeRaw.mock.calls[0][0];
            const statement = sqlText(call);
            expect(statement).toContain(CONTRACT_FRAGMENT);
            expect(statement).toContain("status = 'requires_attention'");
            expect(statement).toContain("payload IS NOT NULL");
            expect(statement).toContain("SET payload = NULL, updated_at = now()");
            expect(statement).not.toContain("active_key");
            expect((call as { values: unknown[] }).values).toEqual([new Date("2026-10-15T03:00:00.000Z")]);
        });
    });

    describe("listRecentStaffFailures", () => {
        it("selects contract failed and requires_attention rows since the cutoff with the client name", async () => {
            queryRaw.mockResolvedValueOnce([row({ status: "failed", client_name: "김산모" })]);
            const since = new Date("2026-10-22T00:00:00.000Z");

            const jobs = await repository.listRecentStaffFailures(since);

            expect(jobs).toHaveLength(1);
            expect(jobs[0]?.clientName).toBe("김산모");
            const call = queryRaw.mock.calls[0][0];
            const statement = sqlText(call);
            expect(statement).toContain(CONTRACT_FRAGMENT_J);
            expect(statement).toContain("j.status IN ('failed', 'requires_attention')");
            expect(statement).toContain("j.completed_at >= ");
            expect(statement).toContain("ORDER BY j.completed_at");
            expect(statement).toContain("LEFT JOIN \"client\" c ON c.id = j.client_id");
            expect((call as { values: unknown[] }).values).toEqual([since]);
        });
    });

    describe("summary and list for recoverable contract jobs", () => {
        const branchId = "00000000-0000-4000-8000-000000000010";

        it("counts contract failed rows from the last 7 days and unresolved rows, and lists their ids", async () => {
            queryRaw
                .mockResolvedValueOnce([{ active_count: 1, attention_count: 4, failed_count: 2, unresolved_count: 3 }])
                .mockResolvedValueOnce([{ id: "job-newest" }, { id: "job-middle" }, { id: "job-oldest" }]);

            await expect(repository.getSummary(branchId)).resolves.toEqual({
                activeCount: 1,
                requiresAttentionCount: 4,
                failedCount: 2,
                unresolvedCount: 3,
                unresolvedJobIds: ["job-newest", "job-middle", "job-oldest"],
            });

            const counts = sqlText(queryRaw.mock.calls[0][0]);
            expect(counts).toContain("count(*) FILTER (WHERE status = 'requires_attention')::int AS attention_count");
            expect(counts).toMatch(/FILTER \(\s*WHERE \(source = 'staff'[\s\S]*?\) AND status = 'failed'\s+AND completed_at >= now\(\) - interval '7 days'\s*\)::int AS failed_count/);
            expect(counts).toMatch(/FILTER \(WHERE \(source = 'staff'[\s\S]*?\) AND \(\s*\(status = 'failed' AND completed_at >= now\(\) - interval '7 days'\)\s*OR status = 'requires_attention'\s*\)\)::int AS unresolved_count/);
            const ids = sqlText(queryRaw.mock.calls[1][0]);
            expect(ids).toContain(CONTRACT_FRAGMENT);
            expect(ids).toContain("ORDER BY completed_at DESC");
            expect(ids).toContain("LIMIT 50");
        });

        it("moves recent contract failures into requiresAttention and out of recent", async () => {
            const terminalSince = new Date("2026-10-21T03:00:00.000Z");
            queryRaw
                .mockResolvedValueOnce([row({ status: "queued", client_name: "A" })])
                .mockResolvedValueOnce([
                    row({ id: "job-failed", status: "failed", client_name: "B" }),
                    row({ id: "job-attention", status: "requires_attention", payload: null, client_name: null }),
                ])
                .mockResolvedValueOnce([row({ id: "job-done", status: "completed", client_name: "C" })]);

            const list = await repository.listForBranch(branchId, terminalSince, 20);

            expect(list.active.map((job) => job.clientName)).toEqual(["A"]);
            expect(list.requiresAttention.map((job) => job.id)).toEqual(["job-failed", "job-attention"]);
            expect(list.requiresAttention[1]?.clientName).toBeNull();
            expect(list.recent.map((job) => job.id)).toEqual(["job-done"]);

            const attention = sqlText(queryRaw.mock.calls[1][0]);
            expect(attention).toContain("j.status = 'requires_attention'");
            expect(attention).toContain(`j.status = 'failed' AND ${CONTRACT_FRAGMENT_J}`);
            expect(attention).toContain("j.completed_at >= now() - interval '7 days'");
            expect(attention).toContain("ORDER BY j.completed_at DESC");
            expect(attention).toContain("LIMIT 50");
            // The 7-day window is the repository's; terminalSince never narrows the attention list.
            expect((queryRaw.mock.calls[1][0] as { values: unknown[] }).values).not.toContain(terminalSince);

            const recent = sqlText(queryRaw.mock.calls[2][0]);
            expect(recent).toContain(`NOT (j.status = 'failed' AND ${CONTRACT_FRAGMENT_J})`);
            expect(recent).toContain("j.completed_at >= ");
            expect((queryRaw.mock.calls[2][0] as { values: unknown[] }).values).toContain(terminalSince);
            expect(queryRaw.mock.calls.every((call) => sqlText(call[0]).includes("LEFT JOIN \"client\" c ON c.id = j.client_id"))).toBe(true);
        });

        it("maps rows that carry no client_name column", async () => {
            queryRaw.mockResolvedValueOnce([row({ status: "queued" })]);
            const [job] = await repository.recoverStale(new Date());
            expect(job?.clientName).toBeNull();
        });
    });
});
