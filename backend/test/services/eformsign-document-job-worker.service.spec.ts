import { ConfigService } from "@nestjs/config";

import { EformsignDocumentJobWorkerService } from "application/services/eformsign-document-job-worker.service";
import { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

const branchId = "00000000-0000-0000-0000-000000000010";
const workerPrincipal = { branchId, source: "worker" as const };

function job(overrides: Partial<EformsignDocumentJobEntity> = {}): EformsignDocumentJobEntity {
    return new EformsignDocumentJobEntity({
        id: "00000000-0000-0000-0000-000000000001",
        branchId,
        clientId: 7,
        documentId: null,
        jobType: "create_document",
        source: "staff",
        status: "processing",
        requestKey: "request-1",
        activeKey: "create:branch:7",
        payload: {
            clientId: 7,
            contractData: contractData(),
        },
        payloadFingerprint: "a".repeat(64),
        progressStep: null,
        attempts: 1,
        nextAttemptAt: new Date(),
        heartbeatAt: new Date(),
        leaseToken: "00000000-0000-0000-0000-000000000099",
        autoFinalizeOutcomeRecordedAt: null,
        autoFinalizeOutcomeAttempts: null,
        startedAt: new Date(),
        completedAt: null,
        lastErrorCode: null,
        createdByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });
}

function contractData() {
    return {
        customerName: "고객",
        customerContact: "010-0000-0000",
        customerDOB: "1990-01-01",
        customerAddress: "주소",
        caretaker1Name: "담당자",
        caretaker1Contact: "010-1111-1111",
        type: "A",
        days: "5",
        area: "서울",
        contractDuration: "5",
        startYear: "2026",
        startMonth: "08",
        startDay: "13",
        startDate: "2026-08-13",
        endYear: "2026",
        endMonth: "08",
        endDay: "17",
        endDate: "2026-08-17",
        paymentYear: "2026",
        paymentMonth: "08",
        paymentDay: "13",
        fullPrice: "100",
        grant: "50",
        actualPrice: "50",
    };
}

function buildWorker(overrides: {
    repository?: Record<string, jest.Mock>;
    dispatch?: Record<string, jest.Mock>;
    finalize?: Record<string, jest.Mock>;
    reconciliation?: Record<string, jest.Mock>;
    schedulerLease?: ReturnType<typeof createSchedulerLeaseMock>;
    prisma?: { $transaction: jest.Mock };
} = {}) {
    const repository = {
        recoverStale: jest.fn().mockResolvedValue([]),
        claimDue: jest.fn().mockResolvedValue([]),
        updateProgress: jest.fn().mockImplementation(async () => job()),
        scheduleRetry: jest.fn().mockResolvedValue(null),
        markReconciling: jest.fn().mockResolvedValue(null),
        markCompleted: jest.fn().mockResolvedValue(null),
        markFailed: jest.fn().mockResolvedValue(null),
        markRequiresAttention: jest.fn().mockResolvedValue(null),
        deleteExpiredTerminal: jest.fn().mockResolvedValue(0),
        ...overrides.repository,
    };
    const dispatch = {
        execute: jest.fn(),
        ...overrides.dispatch,
    };
    const finalize = {
        execute: jest.fn(),
        ...overrides.finalize,
    };
    const reconciliation = {
        reconcile: jest.fn().mockResolvedValue({ status: "requires_attention" }),
        ...overrides.reconciliation,
    };
    const autoFinalizeScheduler = {
        recordTerminalFailure: jest.fn().mockResolvedValue(undefined),
    };
    const schedulerLease = overrides.schedulerLease ?? createSchedulerLeaseMock();
    const worker = new EformsignDocumentJobWorkerService(
        new ConfigService({ EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED: "true" }),
        repository as never,
        dispatch as never,
        finalize as never,
        reconciliation as never,
        autoFinalizeScheduler as never,
        { findByDocumentId: jest.fn().mockResolvedValue({ documentId: "doc" }) } as never,
        { findById: jest.fn().mockResolvedValue({ id: 7 }) } as never,
        schedulerLease,
        overrides.prisma as never,
    );
    return { worker, repository, dispatch, finalize, reconciliation, autoFinalizeScheduler, schedulerLease, prisma: overrides.prisma };
}

describe("EformsignDocumentJobWorkerService", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("retries a pre-send failure with the first durable backoff", async () => {
        const claimed = job();
        const { worker, repository, dispatch } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
            dispatch: {
                execute: jest.fn().mockResolvedValue({
                    ok: false,
                    reason: "editor timeout",
                    fallbackHint: "iframe",
                    durationMs: 10,
                }),
            },
        });

        await worker.processDueJobs();

        expect(dispatch.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ clientId: 7, contractData: expect.any(Object), onProgress: expect.any(Function) }),
            workerPrincipal,
        );
        expect(repository.scheduleRetry).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            expect.any(Date),
            "HEADLESS_CREATE_PRE_SEND_FAILURE",
        );
        expect(repository.markReconciling).not.toHaveBeenCalled();
    });

    it("does not retry after the provider send becomes ambiguous", async () => {
        const claimed = job();
        const { worker, repository, reconciliation } = buildWorker({
            repository: {
                claimDue: jest.fn().mockResolvedValue([claimed]),
                markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
            },
            dispatch: {
                execute: jest.fn().mockImplementation(async (_branchId, { onProgress }) => {
                    await onProgress?.("creating");
                    return { ok: false, reason: "browser disconnected", durationMs: 10 };
                }),
            },
        });

        await worker.processDueJobs();

        expect(repository.scheduleRetry).not.toHaveBeenCalled();
        expect(repository.markReconciling).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "creating",
        );
        expect(reconciliation.reconcile).toHaveBeenCalledWith(
            expect.objectContaining({ payload: claimed.payload }),
            workerPrincipal,
        );
    });

    it("keeps a send-progress marker when the headless call throws", async () => {
        const claimed = job();
        const { worker, repository, reconciliation } = buildWorker({
            repository: {
                claimDue: jest.fn().mockResolvedValue([claimed]),
                markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
            },
            dispatch: {
                execute: jest.fn().mockImplementation(async (_branchId, { onProgress }) => {
                    await onProgress?.("sent");
                    throw new Error("browser disconnected");
                }),
            },
        });

        await worker.processDueJobs();

        expect(repository.scheduleRetry).not.toHaveBeenCalled();
        expect(repository.markReconciling).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "sent",
        );
        expect(reconciliation.reconcile).toHaveBeenCalled();
    });

    it("does not retry a later finalize step after an earlier step was sent", async () => {
        const claimed = job({
            id: "00000000-0000-0000-0000-000000000003",
            jobType: "finalize_document",
            documentId: "doc-3",
            activeKey: "finalize:doc-3",
            payload: { documentId: "doc-3" },
        });
        const { worker, repository, finalize, reconciliation } = buildWorker({
            repository: {
                claimDue: jest.fn().mockResolvedValue([claimed]),
                markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
            },
            finalize: {
                execute: jest.fn()
                    .mockImplementationOnce(async ({ onProgress }) => {
                        await onProgress?.("sent");
                        return { ok: true, completed: false, durationMs: 1 };
                    })
                    .mockResolvedValueOnce({
                        ok: false,
                        reason: "provider timeout",
                        fallbackHint: "iframe",
                        durationMs: 1,
                    }),
            },
        });

        await worker.processDueJobs();

        expect(finalize.execute).toHaveBeenCalledTimes(2);
        expect(repository.scheduleRetry).not.toHaveBeenCalled();
        expect(repository.markReconciling).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "sent",
        );
        expect(reconciliation.reconcile).toHaveBeenCalled();
    });

    it("does not call eformsign for a revision whose capability is unverified", async () => {
        const claimed = job({
            payload: {
                kind: "service_record_revision",
                revisionId: "revision-1",
                revisionNumber: 1,
                context: {
                    branchId,
                    clientId: 7,
                    serviceRecordCaseId: "00000000-0000-0000-0000-000000000020",
                    revisionId: "00000000-0000-0000-0000-000000000021",
                    revisionNumber: 1,
                    businessFingerprint: "a".repeat(64),
                    plannedSessionCount: null,
                    plannedSessionDates: [],
                    documentSyncStatus: "capability_unverified",
                    lifecycleStatus: "IN_PROGRESS",
                    formVersion: 1,
                },
                immutablePayload: {},
                payloadFingerprint: "b".repeat(64),
                completeness: "complete",
            },
        });
        const { worker, repository, dispatch } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
        });

        await worker.processDueJobs();

        expect(dispatch.execute).not.toHaveBeenCalled();
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED",
        );
    });

    it("commits the legacy create marker under the transaction before dispatch", async () => {
        const claimed = job();
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: claimed.id }]),
        };
        const prisma = {
            $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction)),
        };
        const { worker } = buildWorker({ prisma });

        const authorization = await (worker as unknown as {
            authorizeRevisionJob: (job: EformsignDocumentJobEntity) => Promise<unknown>;
        }).authorizeRevisionJob(claimed);

        expect(authorization).toEqual({ kind: "allow", irreversible: true });
        expect(transaction.$queryRaw).toHaveBeenCalled();
        const markerQuery = transaction.$queryRaw.mock.calls.at(-1)?.[0];
        expect(markerQuery?.strings?.join(" ")).toContain("progress_step = 'creating'");
    });

    it("forwards revision authorization to the caller-transaction repository seam", async () => {
        const context = {
            branchId,
            clientId: 7,
            serviceRecordCaseId: "00000000-0000-0000-0000-000000000020",
            revisionId: null,
            revisionNumber: null,
            businessFingerprint: "b".repeat(64),
            plannedSessionCount: null,
            plannedSessionDates: [],
            documentSyncStatus: "pending" as const,
            lifecycleStatus: "IN_PROGRESS",
            formVersion: 1,
        };
        const claimed = job({
            payload: {
                kind: "service_record_revision",
                context,
                immutablePayload: { clientId: 7 },
                payloadFingerprint: "c".repeat(64),
                completeness: "complete",
            },
        });
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    id: context.serviceRecordCaseId,
                    branchId,
                    clientId: 7,
                    requiredSessionCount: null,
                    plannedSessions: null,
                    currentRevisionId: null,
                    formVersion: 1,
                    status: "IN_PROGRESS",
                }),
            },
        };
        const authorizeForDispatchInTransaction = jest.fn().mockResolvedValue({ kind: "allow" });
        const prisma = {
            $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction)),
        };
        const { worker, repository } = buildWorker({
            repository: { authorizeForDispatchInTransaction },
            prisma,
        });

        const authorization = await (worker as unknown as {
            authorizeRevisionJob: (job: EformsignDocumentJobEntity) => Promise<unknown>;
        }).authorizeRevisionJob(claimed);

        expect(authorization).toEqual({ kind: "allow", irreversible: true });
        expect(authorizeForDispatchInTransaction).toHaveBeenCalledWith(transaction, {
            jobId: claimed.id,
            leaseToken: claimed.leaseToken,
            expectedContext: context,
        });
        expect(repository.markRequiresAttention).not.toHaveBeenCalled();
    });

    it("fails closed for an old finalize job whose document has no client owner", async () => {
        const claimed = job({
            clientId: null,
            documentId: "legacy-finalize-document",
            jobType: "finalize_document",
            payload: { documentId: "legacy-finalize-document" },
        });
        const transaction = {
            eformsign_doc: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 91,
                    documentId: claimed.documentId,
                    branchId,
                    clientId: null,
                    serviceRecordCaseId: null,
                }),
            },
            $queryRaw: jest.fn(),
        };
        const prisma = {
            $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction)),
        };
        const authorizeForDispatchInTransaction = jest.fn();
        const { worker } = buildWorker({
            repository: { authorizeForDispatchInTransaction },
            prisma,
        });

        const authorization = await (worker as unknown as {
            authorizeRevisionJob: (job: EformsignDocumentJobEntity) => Promise<unknown>;
        }).authorizeRevisionJob(claimed);

        expect(authorization).toEqual({
            kind: "stale",
            reason: "SERVICE_RECORD_FINALIZE_OWNER_UNAVAILABLE",
        });
        expect(authorizeForDispatchInTransaction).not.toHaveBeenCalled();
        expect(transaction.$queryRaw).not.toHaveBeenCalled();
    });

    it("keeps the durable creating marker when a later provider step reports progress", async () => {
        const claimed = job({ progressStep: "creating" });
        const { worker, repository } = buildWorker();
        await (worker as unknown as {
            recordProgress: (
                jobId: string,
                leaseToken: string,
                step: string,
                preserveDispatchMarker: boolean,
            ) => Promise<void>;
        }).recordProgress(claimed.id, claimed.leaseToken!, "info-inserted", true);

        expect(repository.updateProgress).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "creating",
            expect.any(Date),
        );
    });

    it("persists progress and sends a heartbeat while a provider operation is running", async () => {
        jest.useFakeTimers();
        const claimed = job();
        let resolveDispatch!: (value: unknown) => void;
        const dispatchPromise = new Promise((resolve) => {
            resolveDispatch = resolve;
        });
        const { worker, repository } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
            dispatch: {
                execute: jest.fn().mockImplementation(async (_branchId, { onProgress }) => {
                    await onProgress?.("info-inserted");
                    return dispatchPromise;
                }),
            },
        });

        const processing = worker.processDueJobs();
        for (let tick = 0; tick < 10 && repository.updateProgress.mock.calls.length === 0; tick += 1) {
            await Promise.resolve();
        }
        jest.advanceTimersByTime(30_000);
        await Promise.resolve();
        expect(repository.updateProgress).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "info-inserted",
            expect.any(Date),
        );

        resolveDispatch({ ok: true, documentId: "doc-1", durationMs: 10 });
        await processing;
        expect(repository.markCompleted).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "doc-1",
        );
    });

    it("dispatches creation and consecutive finalization jobs through their typed payloads", async () => {
        const createJob = job();
        const finalizeJob = job({
            id: "00000000-0000-0000-0000-000000000002",
            jobType: "finalize_document",
            documentId: "doc-2",
            activeKey: "finalize:doc-2",
            payload: { documentId: "doc-2", prefillEndDate: "2026-08-17" },
        });
        const { worker, repository, dispatch, finalize } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([createJob, finalizeJob]) },
            dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "doc-1", durationMs: 1 }) },
            finalize: { execute: jest.fn().mockResolvedValue({ ok: true, completed: true, durationMs: 1 }) },
        });

        await worker.processDueJobs();

        expect(dispatch.execute).toHaveBeenCalledTimes(1);
        expect(finalize.execute).toHaveBeenCalledWith(expect.objectContaining({
            documentId: "doc-2",
            prefillEndDate: "2026-08-17",
        }), workerPrincipal);
        expect(repository.markCompleted).toHaveBeenNthCalledWith(
            1,
            createJob.id,
            createJob.leaseToken,
            "doc-1",
        );
        expect(repository.markCompleted).toHaveBeenNthCalledWith(
            2,
            finalizeJob.id,
            finalizeJob.leaseToken,
            "doc-2",
        );
    });

    it("starts all three claimed jobs immediately instead of holding stale in-memory claims", async () => {
        const claimed = [1, 2, 3].map((index) => job({
            id: `00000000-0000-0000-0000-00000000000${index}`,
            clientId: index,
            activeKey: `create:${branchId}:${index}`,
            payload: { clientId: index, contractData: contractData() },
        }));
        const started: number[] = [];
        const releases = new Map<number, () => void>();
        const { worker } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue(claimed) },
            dispatch: {
                execute: jest.fn().mockImplementation(async (_branchId, { clientId }) => {
                    started.push(clientId);
                    await new Promise<void>((resolve) => releases.set(clientId, resolve));
                    return { ok: true, documentId: `doc-${clientId}`, durationMs: 1 };
                }),
            },
        });

        const processing = worker.processDueJobs();
        for (let tick = 0; tick < 20 && started.length < 3; tick += 1) await Promise.resolve();
        expect(started.sort()).toEqual([1, 2, 3]);
        releases.forEach((release) => release());
        await processing;
    });

    it("skips the run when the scheduler lease is not held", async () => {
        const { worker, repository } = buildWorker({
            schedulerLease: createSchedulerLeaseMock(false),
        });

        await worker.processDueJobs();

        expect(repository.recoverStale).not.toHaveBeenCalled();
    });
});
