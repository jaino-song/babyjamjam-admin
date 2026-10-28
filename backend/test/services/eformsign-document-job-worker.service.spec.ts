import { ConflictException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ContractSupersedeService } from "application/services/contract-supersede.service";
import {
    EformsignDocumentJobWorkerService,
    type ServiceRecordRevisionOperationCoordinatorPort,
} from "application/services/eformsign-document-job-worker.service";
import { classifyRecovery, EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
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

function revisionOperationPayload(overrides: {
    context?: Record<string, unknown>;
    operations?: Record<string, unknown>;
} = {}) {
    return {
        kind: "service_record_revision_operations",
        context: {
            branchId,
            clientId: 7,
            serviceRecordCaseId: "00000000-0000-0000-0000-000000000020",
            revisionId: "00000000-0000-0000-0000-000000000021",
            revisionNumber: 1,
            businessFingerprint: "a".repeat(64),
            plannedSessionCount: null,
            plannedSessionDates: [],
            documentSyncStatus: "waiting_for_completion",
            lifecycleStatus: "IN_PROGRESS",
            formVersion: 1,
            ...overrides.context,
        },
        operations: {
            contract: {
                documentStateId: "00000000-0000-0000-0000-000000000022",
                generation: "00000000-0000-0000-0000-000000000023",
            },
            receipt: {
                documentStateId: "00000000-0000-0000-0000-000000000024",
                expectedGeneration: "00000000-0000-0000-0000-000000000025",
            },
            ...overrides.operations,
        },
    };
}

function buildWorker(overrides: {
    repository?: Record<string, jest.Mock>;
    dispatch?: Record<string, jest.Mock>;
    finalize?: Record<string, jest.Mock>;
    reconciliation?: Record<string, jest.Mock>;
    schedulerLease?: ReturnType<typeof createSchedulerLeaseMock>;
    revisionGenerator?: { executeRevision: jest.Mock };
    revisionOperationCoordinator?: ServiceRecordRevisionOperationCoordinatorPort;
    contractSupersede?: Record<string, jest.Mock> | ContractSupersedeService;
    notification?: Record<string, jest.Mock>;
    client?: Record<string, jest.Mock>;
} = {}) {
    const repository = {
        recoverStale: jest.fn().mockResolvedValue([]),
        claimDue: jest.fn().mockResolvedValue([]),
        authorizeForDispatch: jest.fn().mockResolvedValue({ kind: "allow" }),
        updateProgress: jest.fn().mockImplementation(async () => job()),
        scheduleRetry: jest.fn().mockResolvedValue(null),
        markReconciling: jest.fn().mockResolvedValue(null),
        markCompleted: jest.fn().mockResolvedValue(null),
        markFailed: jest.fn().mockResolvedValue(null),
        markRequiresAttention: jest.fn().mockResolvedValue(null),
        deleteExpiredTerminal: jest.fn().mockResolvedValue(0),
        purgeExpiredAttentionPayloads: jest.fn().mockResolvedValue(0),
        listRecentStaffFailures: jest.fn().mockResolvedValue([]),
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
    const eformsignDocRepository = {
        findByDocumentId: jest.fn().mockResolvedValue({ documentId: "doc" }),
    };
    // The default client is already linked to the replacement ("new-doc"), which the
    // supersede path requires before it cancels the old contract.
    const clientRepository = {
        findById: jest.fn().mockResolvedValue({ id: 7, eDocId: "new-doc" }),
        ...overrides.client,
    };
    const schedulerLease = overrides.schedulerLease ?? createSchedulerLeaseMock();
    const contractSupersedeService = (overrides.contractSupersede instanceof ContractSupersedeService
        ? overrides.contractSupersede
        : {
            supersede: jest.fn().mockResolvedValue({ documentId: "old-doc", superseded: true }),
            isDocumentVisibleToBranch: jest.fn().mockResolvedValue(true),
            ...overrides.contractSupersede,
        }) as unknown as { supersede: jest.Mock };
    const notificationService = {
        sendToBranchUsers: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
        ...overrides.notification,
    };
    const revisionGenerator = overrides.revisionGenerator ?? {
        executeRevision: jest.fn().mockResolvedValue({
            documentIds: ["revision-document-1"],
            documentVersion: 3,
            chunkCount: 1,
        }),
    };
    const worker = new EformsignDocumentJobWorkerService(
        new ConfigService({ EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED: "true" }),
        repository as never,
        dispatch as never,
        finalize as never,
        reconciliation as never,
        autoFinalizeScheduler as never,
        eformsignDocRepository as never,
        clientRepository as never,
        schedulerLease,
        contractSupersedeService as never,
        notificationService as never,
        revisionGenerator as never,
        overrides.revisionOperationCoordinator as never,
    );
    return {
        worker,
        repository,
        dispatch,
        finalize,
        reconciliation,
        autoFinalizeScheduler,
        eformsignDocRepository,
        clientRepository,
        schedulerLease,
        contractSupersedeService,
        notificationService,
        revisionGenerator,
        revisionOperationCoordinator: overrides.revisionOperationCoordinator,
    };
}

describe("EformsignDocumentJobWorkerService", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("routes a complete revision generation payload to the immutable renderer", async () => {
        const claimed = job({
            payload: {
                kind: "service_record_revision",
                context: {
                    branchId,
                    clientId: 7,
                    serviceRecordCaseId: "00000000-0000-0000-0000-000000000011",
                    revisionId: null,
                    revisionNumber: null,
                    businessFingerprint: "a".repeat(64),
                    plannedSessionCount: 1,
                    plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-08-13" }],
                    documentSyncStatus: "pending",
                    lifecycleStatus: "READY_TO_FINALIZE",
                    formVersion: 2,
                },
                immutablePayload: {
                    kind: "service_record_revision_input",
                    plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-08-13" }],
                },
                payloadFingerprint: "b".repeat(64),
                completeness: "complete",
                documentStateId: "00000000-0000-0000-0000-000000000012",
                documentVersion: 3,
                snapshotReference: "service-record-revision:case:draft",
                generation: "00000000-0000-0000-0000-000000000013",
            },
        });
        const { worker, repository, dispatch, revisionGenerator } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
        });

        await worker.processDueJobs();

        expect(dispatch.execute).not.toHaveBeenCalled();
        expect(revisionGenerator.executeRevision).toHaveBeenCalledWith(
            expect.objectContaining({
                generationKind: "REVISION_SNAPSHOT",
                documentStateId: "00000000-0000-0000-0000-000000000012",
                documentVersion: 3,
                generation: "00000000-0000-0000-0000-000000000013",
                immutablePayload: expect.objectContaining({ kind: "service_record_revision_input" }),
            }),
            workerPrincipal,
        );
        expect(repository.markCompleted).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "revision-document-1",
        );
    });

    it("reconciles a provider failure after the durable dispatch marker", async () => {
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
        expect(repository.scheduleRetry).not.toHaveBeenCalled();
        expect(repository.markReconciling).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "creating",
        );
    });

    it("classifies additive-envelope dispatch failures exactly as before", async () => {
        // Through this seam a permitted create job always carries the durable
        // creating marker, so the observable classification boundary is the
        // progress step recorded on markReconciling: an ambiguous failure
        // reconciles on the live progress step ("reconciling" when none was
        // emitted), a non-ambiguous one reconciles on the durable marker
        // ("creating"). The additive code/outcome/recovery fields must not
        // move a failure across that boundary in either direction.

        // An iframe-hint pre-send failure stays non-ambiguous even while
        // carrying NOT_APPLIED outcome fields: it reconciles on the durable
        // marker, not as an unknown-outcome run.
        const preSendClaim = job();
        const preSend = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([preSendClaim]) },
            dispatch: {
                execute: jest.fn().mockResolvedValue({
                    ok: false,
                    reason: "editor timeout",
                    fallbackHint: "iframe",
                    durationMs: 10,
                    code: "DOCUMENT_DISPATCH_FAILED",
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            },
        });
        await preSend.worker.processDueJobs();
        expect(preSend.repository.markReconciling).toHaveBeenCalledWith(
            preSendClaim.id,
            preSendClaim.leaseToken,
            "creating",
        );

        // A manual_check failure carrying UNKNOWN outcome fields stays
        // ambiguous exactly as before: it reconciles on the (absent) live
        // progress step, not on the durable marker.
        const ambiguousClaim = job();
        const ambiguous = buildWorker({
            repository: {
                claimDue: jest.fn().mockResolvedValue([ambiguousClaim]),
                markReconciling: jest.fn().mockResolvedValue({ ...ambiguousClaim, status: "reconciling", payload: null }),
            },
            dispatch: {
                execute: jest.fn().mockResolvedValue({
                    ok: false,
                    reason: "remote_unconfirmed",
                    fallbackHint: "manual_check",
                    durationMs: 10,
                    code: "REMOTE_DOCUMENT_UNCONFIRMED",
                    outcome: "UNKNOWN",
                    recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
                }),
            },
        });
        await ambiguous.worker.processDueJobs();
        expect(ambiguous.repository.markReconciling).toHaveBeenCalledWith(
            ambiguousClaim.id,
            ambiguousClaim.leaseToken,
            "reconciling",
        );
    });

    it.each([
        "template_workflow_config_invalid",
        "template_workflow_unsupported",
        "template_workflow_config_unavailable",
    ])("keeps %s on the pre-send retry path even with a creating marker", async (reason) => {
        const claimed = job({ progressStep: "creating" });
        const { worker, repository, dispatch, reconciliation } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
            dispatch: {
                execute: jest.fn().mockResolvedValue({
                    ok: false,
                    reason,
                    fallbackHint: "manual_check",
                    durationMs: 1,
                }),
            },
        });

        await worker.processDueJobs();

        expect(dispatch.execute).toHaveBeenCalled();
        expect(repository.scheduleRetry).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            expect.any(Date),
            reason,
        );
        expect(repository.markReconciling).not.toHaveBeenCalled();
        expect(reconciliation.reconcile).not.toHaveBeenCalled();
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

    describe("send evidence latched across finalize steps and attempts", () => {
        function finalizeClaim(overrides: Partial<EformsignDocumentJobEntity> = {}) {
            return job({
                id: "00000000-0000-0000-0000-000000000003",
                jobType: "finalize_document",
                documentId: "doc-3",
                activeKey: "finalize:doc-3",
                payload: { documentId: "doc-3" },
                ...overrides,
            });
        }

        function persistedSteps(repository: { updateProgress: jest.Mock }): string[] {
            return repository.updateProgress.mock.calls.map((call) => call[2] as string);
        }

        it("reconciles instead of failing when a later step reports progress and fails after an earlier step was sent", async () => {
            // Reproduced scenario: three authorization failures consumed the
            // pre-send retries (attempts is now 4). Step one sends; step two
            // reports `client-started` and fails before sending anything.
            const claimed = finalizeClaim({ attempts: 4 });
            const transitioned = finalizeClaim({ attempts: 4, status: "requires_attention", progressStep: "sent" });
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
                        .mockImplementationOnce(async ({ onProgress }) => {
                            await onProgress?.("client-started");
                            return { ok: false, reason: "browser closed before send", durationMs: 1 };
                        }),
                },
                reconciliation: {
                    reconcile: jest.fn().mockResolvedValue({ status: "requires_attention", transitioned }),
                },
            });

            await worker.processDueJobs();

            expect(finalize.execute).toHaveBeenCalledTimes(2);
            expect(repository.markFailed).not.toHaveBeenCalled();
            expect(repository.scheduleRetry).not.toHaveBeenCalled();
            expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, "sent");
            expect(reconciliation.reconcile).toHaveBeenCalled();
            // `sent` is never walked back by the later ordinary step.
            expect(persistedSteps(repository)).toEqual(["sent", "sent"]);
            expect(classifyRecovery(transitioned)).toBe("verify_result");
        });

        it("reconciles when a step that sent is followed by a later step that throws", async () => {
            const claimed = finalizeClaim({ attempts: 4 });
            const { worker, repository, reconciliation } = buildWorker({
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
                        .mockImplementationOnce(async ({ onProgress }) => {
                            await onProgress?.("client-started");
                            throw new Error("browser disconnected");
                        }),
                },
            });

            await worker.processDueJobs();

            expect(repository.markFailed).not.toHaveBeenCalled();
            expect(repository.scheduleRetry).not.toHaveBeenCalled();
            expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, "sent");
            expect(reconciliation.reconcile).toHaveBeenCalled();
        });

        it("keeps a latched creating step from the same attempt through a later failing step", async () => {
            const claimed = finalizeClaim({ attempts: 2 });
            const { worker, repository } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
                },
                finalize: {
                    execute: jest.fn()
                        .mockImplementationOnce(async ({ onProgress }) => {
                            await onProgress?.("creating");
                            return { ok: true, completed: false, durationMs: 1 };
                        })
                        .mockImplementationOnce(async ({ onProgress }) => {
                            await onProgress?.("client-started");
                            return { ok: false, reason: "boom", durationMs: 1 };
                        }),
                },
            });

            await worker.processDueJobs();

            expect(repository.scheduleRetry).not.toHaveBeenCalled();
            expect(repository.markFailed).not.toHaveBeenCalled();
            expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, "creating");
        });

        it("reconciles a later attempt that inherited a sent marker instead of scheduling another retry", async () => {
            // Sent in attempt N; attempt N+1 is claimed with the durable `sent`
            // marker and its authorization fails before any step runs.
            const claimed = finalizeClaim({ attempts: 2, progressStep: "sent" });
            const { worker, repository, finalize } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    authorizeForDispatch: jest.fn().mockRejectedValue(new Error("database unavailable")),
                    markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
                },
            });

            await worker.processDueJobs();

            expect(finalize.execute).not.toHaveBeenCalled();
            expect(repository.scheduleRetry).not.toHaveBeenCalled();
            expect(repository.markFailed).not.toHaveBeenCalled();
            expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, "sent");
        });

        it("reconciles a later attempt that inherited a sent marker when its finalize step fails pre-send", async () => {
            const claimed = finalizeClaim({ attempts: 4, progressStep: "sent" });
            const { worker, repository } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
                },
                finalize: {
                    execute: jest.fn().mockImplementation(async ({ onProgress }) => {
                        await onProgress?.("client-started");
                        return { ok: false, reason: "boom", durationMs: 1 };
                    }),
                },
            });

            await worker.processDueJobs();

            expect(repository.markFailed).not.toHaveBeenCalled();
            expect(repository.scheduleRetry).not.toHaveBeenCalled();
            expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, "sent");
        });

        it("persists a latched creating step through the heartbeat and later progress for a send that began mid-attempt", async () => {
            const claimed = finalizeClaim({ attempts: 1 });
            const { worker, repository } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
                },
                finalize: {
                    execute: jest.fn().mockImplementation(async ({ onProgress }) => {
                        await onProgress?.("sent");
                        await onProgress?.("info-inserted");
                        await onProgress?.("client-started");
                        return { ok: false, reason: "boom", durationMs: 1 };
                    }),
                },
            });

            await worker.processDueJobs();

            expect(persistedSteps(repository)).toEqual(["sent", "sent", "sent"]);
            expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, "sent");
        });

        it("still retries a genuine pre-send failure at 1, 5 and 15 minutes and then fails it as manual_send", async () => {
            const delays = [60_000, 5 * 60_000, 15 * 60_000];
            for (const [index, delay] of delays.entries()) {
                const claimed = finalizeClaim({ attempts: index + 1 });
                const { worker, repository } = buildWorker({
                    repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
                    finalize: {
                        execute: jest.fn().mockImplementation(async ({ onProgress }) => {
                            await onProgress?.("client-started");
                            return { ok: false, reason: "boom", durationMs: 1 };
                        }),
                    },
                });
                const before = Date.now();

                await worker.processDueJobs();

                expect(repository.markReconciling).not.toHaveBeenCalled();
                expect(repository.markFailed).not.toHaveBeenCalled();
                const [id, lease, nextAttemptAt, code] = repository.scheduleRetry.mock.calls[0]!;
                expect([id, lease, code]).toEqual([claimed.id, claimed.leaseToken, "HEADLESS_FINALIZE_PRE_SEND_FAILURE"]);
                expect((nextAttemptAt as Date).getTime() - before).toBeGreaterThanOrEqual(delay - 50);
                expect((nextAttemptAt as Date).getTime() - before).toBeLessThan(delay + 5_000);
            }

            const claimed = finalizeClaim({ attempts: 4 });
            const failed = finalizeClaim({ attempts: 4, status: "failed", lastErrorCode: "PRE_SEND_RETRY_EXHAUSTED" });
            const { worker, repository } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markFailed: jest.fn().mockResolvedValue(failed),
                },
                finalize: {
                    execute: jest.fn().mockImplementation(async ({ onProgress }) => {
                        await onProgress?.("client-started");
                        return { ok: false, reason: "boom", durationMs: 1 };
                    }),
                },
            });

            await worker.processDueJobs();

            expect(repository.scheduleRetry).not.toHaveBeenCalled();
            expect(repository.markReconciling).not.toHaveBeenCalled();
            expect(repository.markFailed).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, "PRE_SEND_RETRY_EXHAUSTED");
            expect(classifyRecovery(failed)).toBe("manual_send");
        });

        it("latches a send across the creation path's later progress steps too", async () => {
            const claimed = job({ attempts: 4 });
            const { worker, repository } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
                },
                dispatch: {
                    execute: jest.fn().mockImplementation(async (_branchId, { onProgress }) => {
                        await onProgress?.("sent");
                        await onProgress?.("client-started");
                        throw new Error("browser disconnected");
                    }),
                },
            });

            await worker.processDueJobs();

            expect(persistedSteps(repository)).toEqual(["sent", "sent"]);
            expect(repository.markFailed).not.toHaveBeenCalled();
            expect(repository.scheduleRetry).not.toHaveBeenCalled();
            expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, "sent");
        });
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

    it("routes partial revision operations to the coordinator with persisted state descriptors", async () => {
        const payload = revisionOperationPayload();
        const claimed = job({ payload });
        const coordinator: ServiceRecordRevisionOperationCoordinatorPort = {
            process: jest.fn().mockResolvedValue({
                revisionGeneration: null,
                status: "completed",
                reason: null,
                contract: null,
                receipt: null,
            }),
        };
        const { worker, repository, dispatch, finalize, revisionGenerator } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
            revisionOperationCoordinator: coordinator,
        });

        await worker.processDueJobs();

        expect(repository.authorizeForDispatch).toHaveBeenCalledWith({
            jobId: claimed.id,
            leaseToken: claimed.leaseToken,
            expectedContext: payload.context,
        });
        expect(coordinator.process).toHaveBeenCalledWith({
            ...payload.context,
            contract: payload.operations.contract,
            receipt: payload.operations.receipt,
        });
        expect(dispatch.execute).not.toHaveBeenCalled();
        expect(finalize.execute).not.toHaveBeenCalled();
        expect(revisionGenerator.executeRevision).not.toHaveBeenCalled();
        expect(repository.markCompleted).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            undefined,
        );
    });

    it("does not route a stale operation claim to any renderer or coordinator", async () => {
        const claimed = job({ payload: revisionOperationPayload() });
        const coordinator: ServiceRecordRevisionOperationCoordinatorPort = {
            process: jest.fn(),
        };
        const { worker, repository, dispatch, revisionGenerator } = buildWorker({
            repository: {
                claimDue: jest.fn().mockResolvedValue([claimed]),
                authorizeForDispatch: jest.fn().mockResolvedValue({
                    kind: "stale",
                    reason: "revision_or_business_state_changed",
                }),
            },
            revisionOperationCoordinator: coordinator,
        });

        await worker.processDueJobs();

        expect(coordinator.process).not.toHaveBeenCalled();
        expect(dispatch.execute).not.toHaveBeenCalled();
        expect(revisionGenerator.executeRevision).not.toHaveBeenCalled();
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "revision_or_business_state_changed",
        );
    });

    it("does not route an ownership-lost operation claim to any renderer or coordinator", async () => {
        const claimed = job({ payload: revisionOperationPayload({ context: { clientId: 8 } }) });
        const coordinator: ServiceRecordRevisionOperationCoordinatorPort = {
            process: jest.fn(),
        };
        const { worker, repository, dispatch, revisionGenerator } = buildWorker({
            repository: {
                claimDue: jest.fn().mockResolvedValue([claimed]),
                authorizeForDispatch: jest.fn().mockResolvedValue({
                    kind: "lost",
                    reason: "ownership_changed",
                }),
            },
            revisionOperationCoordinator: coordinator,
        });

        await worker.processDueJobs();

        expect(coordinator.process).not.toHaveBeenCalled();
        expect(dispatch.execute).not.toHaveBeenCalled();
        expect(revisionGenerator.executeRevision).not.toHaveBeenCalled();
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "ownership_changed",
        );
    });

    it("fails closed for malformed operation descriptors without invoking the legacy creation path", async () => {
        const claimed = job({
            payload: revisionOperationPayload({
                operations: {
                    contract: {
                        documentStateId: "state-only",
                    },
                },
            }),
        });
        const coordinator: ServiceRecordRevisionOperationCoordinatorPort = {
            process: jest.fn(),
        };
        const { worker, repository, dispatch, revisionGenerator } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
            revisionOperationCoordinator: coordinator,
        });

        await worker.processDueJobs();

        expect(repository.authorizeForDispatch).not.toHaveBeenCalled();
        expect(coordinator.process).not.toHaveBeenCalled();
        expect(dispatch.execute).not.toHaveBeenCalled();
        expect(revisionGenerator.executeRevision).not.toHaveBeenCalled();
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "INVALID_SERVICE_RECORD_REVISION_OPERATION_JOB_PAYLOAD",
        );
    });

    it("fails closed when the operation coordinator is unavailable", async () => {
        const claimed = job({ payload: revisionOperationPayload() });
        const { worker, repository, dispatch, revisionGenerator } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
        });

        await worker.processDueJobs();

        expect(dispatch.execute).not.toHaveBeenCalled();
        expect(revisionGenerator.executeRevision).not.toHaveBeenCalled();
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "SERVICE_RECORD_REVISION_OPERATION_COORDINATOR_UNAVAILABLE",
        );
    });

    it("blocks a recovered revision reconciliation before target or provider reads", async () => {
        const recovered = job({
            status: "reconciling",
            progressStep: "creating",
            requestKey: "service-record-initial-finalization:00000000-0000-4000-8000-000000000021",
            payload: {
                kind: "service_record_revision",
                generationKind: "INITIAL_FINALIZATION",
                revisionId: "00000000-0000-4000-8000-000000000021",
                revisionNumber: 1,
                context: {
                    branchId,
                    clientId: 7,
                    serviceRecordCaseId: "00000000-0000-4000-8000-000000000020",
                    revisionId: "00000000-0000-4000-8000-000000000021",
                    revisionNumber: 1,
                    businessFingerprint: "a".repeat(64),
                    plannedSessionCount: 1,
                    plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-08-13" }],
                    documentSyncStatus: "capability_unverified",
                    lifecycleStatus: "READY_TO_FINALIZE",
                    formVersion: 1,
                },
                immutablePayload: { generationId: "generation-1" },
                payloadFingerprint: "b".repeat(64),
                completeness: "complete",
                manualReviewRequired: true,
            },
            payloadFingerprint: "b".repeat(64),
        });
        const { worker, repository, reconciliation, clientRepository } = buildWorker({
            repository: {
                recoverStale: jest.fn().mockResolvedValue([recovered]),
            },
        });

        await worker.processDueJobs();

        expect(reconciliation.reconcile).not.toHaveBeenCalled();
        expect(clientRepository.findById).not.toHaveBeenCalled();
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            recovered.id,
            recovered.leaseToken,
            "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED",
        );
    });

    it("fails closed for a recovered revision marker with missing immutable evidence", async () => {
        const recovered = job({
            status: "reconciling",
            progressStep: "creating",
            requestKey: "service-record-initial-finalization:00000000-0000-4000-8000-000000000021",
            payload: {
                kind: "service_record_revision",
                revisionId: "00000000-0000-4000-8000-000000000021",
            },
        });
        const { worker, repository, reconciliation } = buildWorker({
            repository: {
                recoverStale: jest.fn().mockResolvedValue([recovered]),
            },
        });

        await worker.processDueJobs();

        expect(reconciliation.reconcile).not.toHaveBeenCalled();
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            recovered.id,
            recovered.leaseToken,
            "INVALID_SERVICE_RECORD_REVISION_JOB_PAYLOAD",
        );
    });

    it("keeps a redacted operation job out of legacy reconciliation by its request namespace", async () => {
        const recovered = job({
            status: "reconciling",
            progressStep: "creating",
            requestKey: "service-record-revision-operations:revision-1:contract+receipt",
            payload: null,
        });
        const { worker, repository, reconciliation, clientRepository } = buildWorker({
            repository: {
                recoverStale: jest.fn().mockResolvedValue([recovered]),
            },
        });

        await worker.processDueJobs();

        expect(reconciliation.reconcile).not.toHaveBeenCalled();
        expect(clientRepository.findById).not.toHaveBeenCalled();
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            recovered.id,
            recovered.leaseToken,
            "INVALID_SERVICE_RECORD_REVISION_JOB_PAYLOAD",
        );
    });

    it("commits the legacy create marker under the transaction before dispatch", async () => {
        const claimed = job();
        const authorizeForDispatch = jest.fn().mockResolvedValue({ kind: "allow" });
        const { worker } = buildWorker({ repository: { authorizeForDispatch } });

        const authorization = await (worker as unknown as {
            authorizeRevisionJob: (job: EformsignDocumentJobEntity) => Promise<unknown>;
        }).authorizeRevisionJob(claimed);

        expect(authorization).toEqual({ kind: "allow", irreversible: true });
        expect(authorizeForDispatch).toHaveBeenCalledWith({
            jobId: claimed.id,
            leaseToken: claimed.leaseToken,
            expectedContext: null,
        });
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
        const authorizeForDispatch = jest.fn().mockResolvedValue({ kind: "allow" });
        const { worker, repository } = buildWorker({ repository: { authorizeForDispatch } });

        const authorization = await (worker as unknown as {
            authorizeRevisionJob: (job: EformsignDocumentJobEntity) => Promise<unknown>;
        }).authorizeRevisionJob(claimed);

        expect(authorization).toEqual({ kind: "allow", irreversible: true });
        expect(authorizeForDispatch).toHaveBeenCalledWith({
            jobId: claimed.id,
            leaseToken: claimed.leaseToken,
            expectedContext: context,
        });
        expect(repository.markRequiresAttention).not.toHaveBeenCalled();
    });

    it("delegates legacy finalize ownership to the repository boundary", async () => {
        const claimed = job({
            clientId: null,
            documentId: "legacy-finalize-document",
            jobType: "finalize_document",
            payload: { documentId: "legacy-finalize-document" },
        });
        const authorizeForDispatch = jest.fn().mockResolvedValue({
            kind: "stale",
            reason: "SERVICE_RECORD_FINALIZE_OWNER_UNAVAILABLE",
        });
        const { worker } = buildWorker({
            repository: { authorizeForDispatch },
        });

        const authorization = await (worker as unknown as {
            authorizeRevisionJob: (job: EformsignDocumentJobEntity) => Promise<unknown>;
        }).authorizeRevisionJob(claimed);

        expect(authorization).toEqual({
            kind: "stale",
            reason: "SERVICE_RECORD_FINALIZE_OWNER_UNAVAILABLE",
        });
        expect(authorizeForDispatch).toHaveBeenCalledWith({
            jobId: claimed.id,
            leaseToken: claimed.leaseToken,
            expectedContext: null,
        });
    });

    it("forwards a valid prefillAmounts payload to the finalize usecase", async () => {
        const prefillAmounts = {
            fullPrice: 1015000, grant: 812000, actualPrice: 203000, servicePeriod: "20261005 ~ 20261014",
        };
        const claimed = job({
            jobType: "finalize_document",
            documentId: "doc-amounts",
            activeKey: "finalize:doc-amounts",
            payload: { documentId: "doc-amounts", prefillAmounts },
        });
        const { worker, finalize } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
            finalize: { execute: jest.fn().mockResolvedValue({ ok: true, completed: true, durationMs: 1 }) },
        });

        await worker.processDueJobs();

        expect(finalize.execute).toHaveBeenCalledWith(expect.objectContaining({
            documentId: "doc-amounts",
            prefillAmounts,
        }), workerPrincipal);
    });

    it.each([
        ["a non-object", "1000"],
        ["an array", [1, 2, 3]],
        ["null", null],
        ["a negative amount", { fullPrice: -1, grant: 0, actualPrice: 0 }],
        ["a fractional amount", { fullPrice: 1000.5, grant: 0, actualPrice: 0 }],
        ["a string amount", { fullPrice: "1000", grant: 0, actualPrice: 0 }],
        ["a missing amount", { fullPrice: 1000, grant: 0 }],
        ["an empty servicePeriod", { fullPrice: 1, grant: 1, actualPrice: 0, servicePeriod: "" }],
        ["a whitespace-only servicePeriod", { fullPrice: 1, grant: 1, actualPrice: 0, servicePeriod: "   " }],
        ["a non-string servicePeriod", { fullPrice: 1, grant: 1, actualPrice: 0, servicePeriod: 7 }],
        ["an oversized servicePeriod", { fullPrice: 1, grant: 1, actualPrice: 0, servicePeriod: "x".repeat(65) }],
    ])("routes a finalize payload with %s prefillAmounts to the invalid-payload path", async (_label, prefillAmounts) => {
        const claimed = job({
            jobType: "finalize_document",
            documentId: "doc-bad-amounts",
            activeKey: "finalize:doc-bad-amounts",
            payload: { documentId: "doc-bad-amounts", prefillAmounts },
        });
        const { worker, repository, finalize } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
        });

        await expect(worker.processDueJobs()).resolves.not.toThrow();

        expect(finalize.execute).not.toHaveBeenCalled();
        expect(repository.markRequiresAttention).toHaveBeenCalledWith(
            claimed.id,
            claimed.leaseToken,
            "INVALID_FINALIZE_JOB_PAYLOAD",
        );
    });

    describe("cancelling the superseded contract after a server-side reissue", () => {
        const LEASE = "00000000-0000-0000-0000-000000000099";
        const reissueJob = (supersedeDocumentId: string | undefined, overrides: Partial<EformsignDocumentJobEntity> = {}) => job({
            payload: {
                clientId: 7,
                contractData: contractData(),
                ...(supersedeDocumentId ? { supersedeDocumentId } : {}),
            },
            ...overrides,
        });
        const completedJob = () => job({ status: "completed" });

        it("cancels the superseded contract after the new one is created", async () => {
            const claimed = reissueJob("old-doc");
            const { worker, repository, contractSupersedeService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markCompleted: jest.fn().mockResolvedValue(completedJob()),
                },
                dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "new-doc", durationMs: 1 }) },
            });

            await worker.processDueJobs();

            expect(repository.markCompleted).toHaveBeenCalledWith(claimed.id, LEASE, "new-doc");
            expect(contractSupersedeService.supersede).toHaveBeenCalledTimes(1);
            expect(contractSupersedeService.supersede).toHaveBeenCalledWith({
                branchId,
                clientId: 7,
                documentId: "old-doc",
                principal: workerPrincipal,
            });
            // Cancel runs only after the new contract is durably recorded.
            expect(repository.markCompleted.mock.invocationCallOrder[0]!)
                .toBeLessThan(contractSupersedeService.supersede.mock.invocationCallOrder[0]!);
        });

        it("notifies the branch when the old contract cannot be cancelled, without failing the job", async () => {
            const claimed = reissueJob("old-doc");
            const { worker, repository, notificationService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markCompleted: jest.fn().mockResolvedValue(completedJob()),
                },
                dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "new-doc", durationMs: 1 }) },
                contractSupersede: {
                    supersede: jest.fn().mockRejectedValue(new ConflictException({ code: "REQUEST_CONFLICT" })),
                },
            });

            await worker.processDueJobs();

            expect(repository.markCompleted).toHaveBeenCalledTimes(1);
            // A supersede failure never re-marks the already completed job.
            expect(repository.scheduleRetry).not.toHaveBeenCalled();
            expect(repository.markReconciling).not.toHaveBeenCalled();
            expect(repository.markFailed).not.toHaveBeenCalled();
            expect(repository.markRequiresAttention).not.toHaveBeenCalled();
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
                branchId,
                "기존 계약서 취소 실패",
                "새 계약서는 보냈지만 기존 계약서를 취소하지 못했어요. 전자문서 목록에서 확인해 주세요",
                expect.objectContaining({ type: "contract-supersede-failed", documentId: "old-doc" }),
                expect.objectContaining({ dedupe: { type: "contract-supersede-failed", documentId: "old-doc" } }),
            );
        });

        it("still finishes the run and polls again when the failure notification itself rejects", async () => {
            const claimed = reissueJob("old-doc");
            const claimDue = jest.fn().mockResolvedValueOnce([claimed]).mockResolvedValue([]);
            const { worker, repository, notificationService } = buildWorker({
                repository: {
                    claimDue,
                    markCompleted: jest.fn().mockResolvedValue(completedJob()),
                },
                dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "new-doc", durationMs: 1 }) },
                contractSupersede: {
                    supersede: jest.fn().mockRejectedValue(new ConflictException({ code: "REQUEST_CONFLICT" })),
                },
                notification: {
                    sendToBranchUsers: jest.fn().mockRejectedValue(new Error("notification store down")),
                },
            });

            await expect(worker.processDueJobs()).resolves.toBeUndefined();
            await expect(worker.processDueJobs()).resolves.toBeUndefined();

            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
            expect(claimDue).toHaveBeenCalledTimes(2);
            expect(repository.markCompleted).toHaveBeenCalledTimes(1);
            expect(repository.scheduleRetry).not.toHaveBeenCalled();
            expect(repository.markReconciling).not.toHaveBeenCalled();
            expect(repository.markFailed).not.toHaveBeenCalled();
            expect(repository.markRequiresAttention).not.toHaveBeenCalled();
        });

        // The real service over doubles, so the worker's own branch check is what is under test:
        // the stored document belongs to client 7 and is unsigned, so without the check the
        // cancel would go through.
        const realSupersedeService = (visibility: {
            headquarters: boolean;
            localDocument?: (lookupBranchId: string) => unknown;
            otherBranchDocumentIds?: string[];
        }) => {
            const cancelDocuments = jest.fn().mockResolvedValue({ result: { success_result: ["old-doc"], fail_result: [] } });
            const purgeDocuments = jest.fn().mockResolvedValue(undefined);
            const service = new ContractSupersedeService(
                {
                    isHeadquartersBranch: jest.fn().mockResolvedValue(visibility.headquarters),
                    findSupersedeCandidate: jest.fn().mockResolvedValue({
                        clientId: 7, documentKind: "contract", statusType: "030", stepType: "05", stepName: "고객 서명",
                    }),
                } as never,
                {
                    withCredentials: jest.fn(async (_p: unknown, _c: string, operation: (c: unknown) => unknown) => (
                        operation({ accessToken: "token", refreshToken: "refresh" })
                    )),
                } as never,
                {
                    cancelDocuments,
                    getDocumentById: jest.fn().mockResolvedValue({
                        current_status: { status_type: "030", step_type: "05", step_name: "고객 서명" },
                    }),
                } as never,
                { findTerminalDocumentIds: jest.fn().mockResolvedValue([]), purgeDocuments } as never,
                {
                    findByDocumentIdIncludingPurgePending: jest.fn(async (lookupBranchId: string) => (
                        visibility.localDocument?.(lookupBranchId) ?? null
                    )),
                    findDocumentIdsForOtherBranches: jest.fn().mockResolvedValue(visibility.otherBranchDocumentIds ?? []),
                } as never,
            );
            return { service, cancelDocuments, purgeDocuments };
        };
        const runWithRealService = async (service: ContractSupersedeService) => {
            const claimed = reissueJob("old-doc");
            const built = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markCompleted: jest.fn().mockResolvedValue(completedJob()),
                },
                dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "new-doc", durationMs: 1 }) },
                contractSupersede: service,
            });
            await built.worker.processDueJobs();
            return built;
        };

        it("does not cancel a document another branch owns and notifies the branch", async () => {
            const { service, cancelDocuments, purgeDocuments } = realSupersedeService({
                headquarters: false,
                // Only a different branch holds the document; this job's branch finds nothing.
                localDocument: (lookupBranchId) => (lookupBranchId === "other-branch-id" ? { documentId: "old-doc" } : null),
            });

            const { repository, notificationService } = await runWithRealService(service);

            expect(repository.markCompleted).toHaveBeenCalledTimes(1);
            expect(cancelDocuments).not.toHaveBeenCalled();
            expect(purgeDocuments).not.toHaveBeenCalled();
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
                branchId,
                "기존 계약서 취소 실패",
                expect.any(String),
                expect.objectContaining({ type: "contract-supersede-failed", documentId: "old-doc" }),
                expect.anything(),
            );
        });

        it("keeps a headquarters job out of a document another branch owns", async () => {
            const { service, cancelDocuments } = realSupersedeService({
                headquarters: true,
                otherBranchDocumentIds: ["old-doc"],
            });

            const { notificationService } = await runWithRealService(service);

            expect(cancelDocuments).not.toHaveBeenCalled();
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
        });

        it("lets a headquarters job cancel an unassigned (null-branch) document", async () => {
            const { service, cancelDocuments, purgeDocuments } = realSupersedeService({
                headquarters: true,
                // A null-branch document is in nobody's "other branch" list.
                otherBranchDocumentIds: ["someone-elses-doc"],
            });

            const { notificationService } = await runWithRealService(service);

            expect(cancelDocuments).toHaveBeenCalledWith("token", ["old-doc"]);
            expect(purgeDocuments).toHaveBeenCalledWith(["old-doc"]);
            expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        });

        it("logs only ids and the error class when the cancel fails", async () => {
            const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
            try {
                const claimed = reissueJob("old-doc");
                const { worker } = buildWorker({
                    repository: {
                        claimDue: jest.fn().mockResolvedValue([claimed]),
                        markCompleted: jest.fn().mockResolvedValue(completedJob()),
                    },
                    dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "new-doc", durationMs: 1 }) },
                    contractSupersede: {
                        supersede: jest.fn().mockRejectedValue(new Error("vendor said 010-9999-9999 is invalid")),
                    },
                });

                await worker.processDueJobs();

                const lines = warn.mock.calls.map((call) => String(call[0]));
                expect(lines.some((line) => line.includes("oldDocumentId=old-doc")
                    && line.includes("newDocumentId=new-doc") && line.includes("Error"))).toBe(true);
                expect(lines.join("\n")).not.toContain("010-9999-9999");
            } finally {
                warn.mockRestore();
            }
        });

        it("never cancels when the old id equals the new document id", async () => {
            const claimed = reissueJob("new-doc");
            const { worker, contractSupersedeService, notificationService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markCompleted: jest.fn().mockResolvedValue(completedJob()),
                },
                dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "new-doc", durationMs: 1 }) },
            });

            await worker.processDueJobs();

            expect(contractSupersedeService.supersede).not.toHaveBeenCalled();
            expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        });

        it("does nothing extra without supersedeDocumentId", async () => {
            const claimed = reissueJob(undefined);
            const { worker, contractSupersedeService, notificationService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markCompleted: jest.fn().mockResolvedValue(completedJob()),
                },
                dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "new-doc", durationMs: 1 }) },
            });

            await worker.processDueJobs();

            expect(contractSupersedeService.supersede).not.toHaveBeenCalled();
            expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        });

        it("does nothing when the lease was lost and the completion was not recorded", async () => {
            const claimed = reissueJob("old-doc");
            const { worker, contractSupersedeService, notificationService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markCompleted: jest.fn().mockResolvedValue(null),
                },
                dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "new-doc", durationMs: 1 }) },
            });

            await worker.processDueJobs();

            expect(contractSupersedeService.supersede).not.toHaveBeenCalled();
            expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        });

        it("skips the cancel and notifies when the payload client differs from the job's verified client", async () => {
            const claimed = reissueJob("old-doc", {
                payload: {
                    clientId: 99,
                    contractData: contractData(),
                    supersedeDocumentId: "old-doc",
                },
            });
            const { worker, contractSupersedeService, notificationService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markCompleted: jest.fn().mockResolvedValue(completedJob()),
                },
                dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "new-doc", durationMs: 1 }) },
            });

            await worker.processDueJobs();

            expect(contractSupersedeService.supersede).not.toHaveBeenCalled();
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
        });

        it.each([
            ["the client still points at the old contract (link failed)", { id: 7, eDocId: "old-doc" }],
            ["the client has no linked contract", { id: 7, eDocId: null }],
            ["the client is not found in the branch", null],
        ])("skips the cancel and notifies once when %s", async (_label, client) => {
            const claimed = reissueJob("old-doc");
            const findById = jest.fn()
                // ownsTarget runs first and must still see the client to dispatch.
                .mockResolvedValueOnce({ id: 7, eDocId: "old-doc" })
                .mockResolvedValue(client);
            const { worker, repository, contractSupersedeService, notificationService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markCompleted: jest.fn().mockResolvedValue(completedJob()),
                },
                dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "new-doc", durationMs: 1 }) },
                client: { findById },
            });

            await worker.processDueJobs();

            expect(repository.markCompleted).toHaveBeenCalledTimes(1);
            expect(findById).toHaveBeenLastCalledWith(branchId, 7);
            expect(contractSupersedeService.supersede).not.toHaveBeenCalled();
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
                branchId,
                "기존 계약서 취소 실패",
                expect.any(String),
                expect.objectContaining({ type: "contract-supersede-failed", documentId: "old-doc" }),
                expect.objectContaining({ dedupe: { type: "contract-supersede-failed", documentId: "old-doc" } }),
            );
        });

        it("applies the same replacement-link guard after reconciliation completes an ambiguous send", async () => {
            const claimed = reissueJob("old-doc");
            const { worker, contractSupersedeService, notificationService } = buildWorker({
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
                reconciliation: {
                    reconcile: jest.fn().mockResolvedValue({
                        status: "completed", documentId: "adopted-doc", completionRecorded: true,
                    }),
                },
                // Default client is linked to "new-doc", not the adopted replacement.
            });

            await worker.processDueJobs();

            expect(contractSupersedeService.supersede).not.toHaveBeenCalled();
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
        });

        it("cancels the old contract when reconciliation later completes an ambiguous send", async () => {
            const claimed = reissueJob("old-doc");
            const { worker, contractSupersedeService, reconciliation } = buildWorker({
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
                reconciliation: {
                    reconcile: jest.fn().mockResolvedValue({
                        status: "completed", documentId: "adopted-doc", completionRecorded: true,
                    }),
                },
                client: { findById: jest.fn().mockResolvedValue({ id: 7, eDocId: "adopted-doc" }) },
            });

            await worker.processDueJobs();

            expect(reconciliation.reconcile).toHaveBeenCalledTimes(1);
            expect(contractSupersedeService.supersede).toHaveBeenCalledWith({
                branchId,
                clientId: 7,
                documentId: "old-doc",
                principal: workerPrincipal,
            });
        });

        it("does not cancel after reconciliation when its completion was not recorded or it needs attention", async () => {
            for (const outcome of [
                { status: "completed", documentId: "adopted-doc", completionRecorded: false },
                { status: "requires_attention", reason: "AMBIGUOUS_PROVIDER_STATE" },
            ]) {
                const claimed = reissueJob("old-doc");
                const { worker, contractSupersedeService } = buildWorker({
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
                    reconciliation: { reconcile: jest.fn().mockResolvedValue(outcome) },
                });

                await worker.processDueJobs();

                expect(contractSupersedeService.supersede).not.toHaveBeenCalled();
            }
        });
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
            "creating",
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

    describe("staff contract failure notifications", () => {
        const JOB_ID = "00000000-0000-0000-0000-000000000001";
        const FAILED_TYPE = "eformsign-document-job-failed";
        const HOUR_MS = 60 * 60_000;
        const flush = async () => {
            for (let tick = 0; tick < 5; tick += 1) await new Promise<void>((resolve) => setImmediate(resolve));
        };
        const named = { findById: jest.fn().mockResolvedValue({ id: 7, name: "김산모" }) };

        function expectedCall(title: string, body: string, recoveryKind: string, id = JOB_ID) {
            const documentId = `eformsign-document-job:${id}`;
            return [
                branchId,
                title,
                body,
                {
                    type: FAILED_TYPE,
                    documentId,
                    jobId: id,
                    recoveryKind,
                    url: `/contracts?recoverJobId=${id}`,
                },
                { dedupe: { type: FAILED_TYPE, documentId } },
            ];
        }

        function exhaustedCreate() {
            return {
                claimed: job({ attempts: 4 }),
                failed: job({ attempts: 4, status: "failed", lastErrorCode: "PRE_SEND_RETRY_EXHAUSTED" }),
                dispatch: {
                    execute: jest.fn().mockResolvedValue({
                        ok: false,
                        reason: "template_workflow_config_invalid",
                        durationMs: 1,
                    }),
                },
            };
        }

        it("notifies the branch when a staff create job exhausts its pre-send retries", async () => {
            const { claimed, failed, dispatch } = exhaustedCreate();
            const { worker, repository, notificationService, clientRepository } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markFailed: jest.fn().mockResolvedValue(failed),
                },
                dispatch,
                client: { findById: jest.fn().mockResolvedValue({ id: 7, name: "김산모" }) },
            });

            await worker.processDueJobs();
            await flush();

            expect(repository.markFailed).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, "PRE_SEND_RETRY_EXHAUSTED");
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
                ...expectedCall(
                    "계약서 자동 전송 실패 · 김산모",
                    "자동 전송에 실패했어요. 눌러서 직접 작성해 주세요.",
                    "manual_send",
                ),
            );
            expect(clientRepository.findById).toHaveBeenCalledWith(branchId, 7);
        });

        it("uses the 검토완료 copy for a failed finalize job", async () => {
            const claimed = job({
                jobType: "finalize_document",
                documentId: "doc-1",
                payload: { documentId: "doc-1" },
                attempts: 4,
            });
            const failed = job({
                jobType: "finalize_document",
                documentId: "doc-1",
                payload: { documentId: "doc-1" },
                attempts: 4,
                status: "failed",
            });
            const { worker, repository, notificationService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markFailed: jest.fn().mockResolvedValue(failed),
                },
                finalize: { execute: jest.fn().mockResolvedValue({ ok: false, reason: "boom", durationMs: 1 }) },
                client: named,
            });

            await worker.processDueJobs();
            await flush();

            expect(repository.markFailed).toHaveBeenCalled();
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
                ...expectedCall(
                    "검토완료 자동 처리 실패 · 김산모",
                    "자동 처리에 실패했어요. 눌러서 직접 처리해 주세요.",
                    "manual_send",
                ),
            );
        });

        it("asks staff to verify the result when a payload-less create job needs attention", async () => {
            const claimed = job({ payload: {} });
            const attention = job({ payload: {}, status: "requires_attention" });
            const { worker, repository, notificationService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markRequiresAttention: jest.fn().mockResolvedValue(attention),
                },
                client: named,
            });

            await worker.processDueJobs();
            await flush();

            expect(repository.markRequiresAttention).toHaveBeenCalledWith(
                claimed.id,
                claimed.leaseToken,
                "INVALID_CREATE_JOB_PAYLOAD",
            );
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
                ...expectedCall(
                    "전자문서 결과 확인 필요 · 김산모",
                    "전송 여부를 확인하지 못했어요. 눌러서 결과를 확인해 주세요.",
                    "verify_result",
                ),
            );
        });

        it("does not notify when the lease was lost and the transition returned null", async () => {
            const exhausted = exhaustedCreate();
            const lostFailed = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([exhausted.claimed]),
                    markFailed: jest.fn().mockResolvedValue(null),
                },
                dispatch: exhausted.dispatch,
            });
            await lostFailed.worker.processDueJobs();
            await flush();
            expect(lostFailed.repository.markFailed).toHaveBeenCalled();
            expect(lostFailed.notificationService.sendToBranchUsers).not.toHaveBeenCalled();

            const lostAttention = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([job({ payload: {} })]),
                    markRequiresAttention: jest.fn().mockResolvedValue(null),
                },
            });
            await lostAttention.worker.processDueJobs();
            await flush();
            expect(lostAttention.repository.markRequiresAttention).toHaveBeenCalled();
            expect(lostAttention.notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        });

        it("never notifies for auto_finalize or service-record revision jobs", async () => {
            const autoFinalize = job({
                source: "auto_finalize",
                payload: {},
                status: "requires_attention",
            });
            const autoRun = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([job({ source: "auto_finalize", payload: {} })]),
                    markRequiresAttention: jest.fn().mockResolvedValue(autoFinalize),
                },
            });
            await autoRun.worker.processDueJobs();
            await flush();
            expect(autoRun.repository.markRequiresAttention).toHaveBeenCalled();
            expect(autoRun.notificationService.sendToBranchUsers).not.toHaveBeenCalled();

            const revisionFields = {
                requestKey: "service-record-revision-operations:abc",
                payload: { kind: "service_record_revision_operations" },
            };
            const revisionRun = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([job(revisionFields)]),
                    markRequiresAttention: jest.fn().mockResolvedValue(
                        job({ ...revisionFields, status: "requires_attention" }),
                    ),
                },
            });
            await revisionRun.worker.processDueJobs();
            await flush();
            expect(revisionRun.repository.markRequiresAttention).toHaveBeenCalled();
            expect(revisionRun.notificationService.sendToBranchUsers).not.toHaveBeenCalled();

            const sweepRun = buildWorker({
                repository: {
                    listRecentStaffFailures: jest.fn().mockResolvedValue([
                        autoFinalize,
                        job({ ...revisionFields, status: "failed" }),
                    ]),
                },
            });
            await sweepRun.worker.processDueJobs();
            await flush();
            expect(sweepRun.repository.listRecentStaffFailures).toHaveBeenCalled();
            expect(sweepRun.notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        });

        it("keeps the transition and the tick alive when the notification send rejects", async () => {
            const { claimed, failed, dispatch } = exhaustedCreate();
            const { worker, repository, notificationService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([claimed]),
                    markFailed: jest.fn().mockResolvedValue(failed),
                },
                dispatch,
                notification: { sendToBranchUsers: jest.fn().mockRejectedValue(new Error("mail down")) },
                client: named,
            });

            await expect(worker.processDueJobs()).resolves.toBeUndefined();
            await flush();

            expect(repository.markFailed).toHaveBeenCalledTimes(1);
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
        });

        it.each([
            ["the client lookup throws", { findById: jest.fn().mockRejectedValue(new Error("db down")) }],
            ["the client is missing", { findById: jest.fn().mockResolvedValue(null) }],
        ])("falls back to 고객 when %s", async (_label, client) => {
            const exhausted = exhaustedCreate();
            // The ownership check also reads the client; let it pass, then fail the name lookup.
            const findById = jest.fn()
                .mockResolvedValueOnce({ id: 7 })
                .mockImplementation(client.findById);
            const { worker, repository, notificationService } = buildWorker({
                repository: {
                    claimDue: jest.fn().mockResolvedValue([exhausted.claimed]),
                    markFailed: jest.fn().mockResolvedValue(exhausted.failed),
                },
                dispatch: exhausted.dispatch,
                client: { findById },
            });

            await expect(worker.processDueJobs()).resolves.toBeUndefined();
            await flush();

            expect(repository.markFailed).toHaveBeenCalledTimes(1);
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
            expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
                ...expectedCall(
                    "계약서 자동 전송 실패 · 고객",
                    "자동 전송에 실패했어요. 눌러서 직접 작성해 주세요.",
                    "manual_send",
                ),
            );
        });

        describe("reconciliation transitions", () => {
            function reconcilingRun(result: Record<string, unknown>) {
                const stale = job({ status: "reconciling" });
                return buildWorker({
                    repository: { recoverStale: jest.fn().mockResolvedValue([stale]) },
                    reconciliation: { reconcile: jest.fn().mockResolvedValue(result) },
                    client: named,
                });
            }

            it("notifies from the entity the reconciliation service transitioned", async () => {
                const transitioned = job({ status: "requires_attention" });
                const { worker, reconciliation, notificationService } = reconcilingRun({
                    status: "requires_attention",
                    reason: "AMBIGUOUS_PROVIDER_STATE",
                    transitioned,
                });

                await worker.processDueJobs();
                await flush();

                expect(reconciliation.reconcile).toHaveBeenCalledTimes(1);
                expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
                expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
                    ...expectedCall(
                        "전자문서 결과 확인 필요 · 김산모",
                        "전송 여부를 확인하지 못했어요. 눌러서 결과를 확인해 주세요.",
                        "verify_result",
                    ),
                );
            });

            it("does not notify when the reconciliation lost the lease (transitioned null)", async () => {
                const { worker, reconciliation, notificationService } = reconcilingRun({
                    status: "requires_attention",
                    reason: "AMBIGUOUS_PROVIDER_STATE",
                    transitioned: null,
                });

                await worker.processDueJobs();
                await flush();

                expect(reconciliation.reconcile).toHaveBeenCalledTimes(1);
                expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
            });

            it("does not notify for the MISSING_JOB_LEASE result that never transitions", async () => {
                const { worker, reconciliation, notificationService } = reconcilingRun({
                    status: "requires_attention",
                    reason: "MISSING_JOB_LEASE",
                });

                await worker.processDueJobs();
                await flush();

                expect(reconciliation.reconcile).toHaveBeenCalledTimes(1);
                expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
            });
        });

        describe("hourly recovery sweep", () => {
            const T0 = 1_800_000_000_000;
            let nowSpy: jest.SpyInstance<number, []>;

            beforeEach(() => {
                nowSpy = jest.spyOn(Date, "now").mockReturnValue(T0);
            });
            afterEach(() => {
                nowSpy.mockRestore();
            });

            it("purges and re-notifies once per hour, using the joined client name", async () => {
                const failure = job({ status: "failed", clientName: "이산모" });
                const { worker, repository, notificationService, clientRepository } = buildWorker({
                    repository: { listRecentStaffFailures: jest.fn().mockResolvedValue([failure]) },
                });

                await worker.processDueJobs();
                await flush();

                expect(repository.purgeExpiredAttentionPayloads).toHaveBeenCalledTimes(1);
                expect(repository.purgeExpiredAttentionPayloads).toHaveBeenCalledWith(new Date(T0));
                expect(repository.listRecentStaffFailures).toHaveBeenCalledTimes(1);
                expect(repository.listRecentStaffFailures).toHaveBeenCalledWith(new Date(T0 - 24 * HOUR_MS));
                expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);
                expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
                    ...expectedCall(
                        "계약서 자동 전송 실패 · 이산모",
                        "자동 전송에 실패했어요. 눌러서 직접 작성해 주세요.",
                        "manual_send",
                    ),
                );
                expect(clientRepository.findById).not.toHaveBeenCalled();

                nowSpy.mockReturnValue(T0 + HOUR_MS - 1);
                await worker.processDueJobs();
                await flush();
                expect(repository.purgeExpiredAttentionPayloads).toHaveBeenCalledTimes(1);
                expect(repository.listRecentStaffFailures).toHaveBeenCalledTimes(1);
                expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);

                nowSpy.mockReturnValue(T0 + HOUR_MS);
                await worker.processDueJobs();
                await flush();
                expect(repository.purgeExpiredAttentionPayloads).toHaveBeenCalledTimes(2);
                expect(repository.listRecentStaffFailures).toHaveBeenCalledTimes(2);
                expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(2);
            });

            it("still re-notifies when the purge throws, and still purges when the listing throws", async () => {
                const failure = job({ status: "requires_attention", clientName: "이산모" });
                const purgeFails = buildWorker({
                    repository: {
                        purgeExpiredAttentionPayloads: jest.fn().mockRejectedValue(new Error("db")),
                        listRecentStaffFailures: jest.fn().mockResolvedValue([failure]),
                    },
                });
                await expect(purgeFails.worker.processDueJobs()).resolves.toBeUndefined();
                await flush();
                expect(purgeFails.repository.claimDue).toHaveBeenCalled();
                expect(purgeFails.notificationService.sendToBranchUsers).toHaveBeenCalledTimes(1);

                const listFails = buildWorker({
                    repository: {
                        listRecentStaffFailures: jest.fn().mockRejectedValue(new Error("db")),
                    },
                });
                await expect(listFails.worker.processDueJobs()).resolves.toBeUndefined();
                await flush();
                expect(listFails.repository.claimDue).toHaveBeenCalled();
                expect(listFails.repository.purgeExpiredAttentionPayloads).toHaveBeenCalledTimes(1);
                expect(listFails.notificationService.sendToBranchUsers).not.toHaveBeenCalled();
            });

            it("keeps going through the listing when one notification fails", async () => {
                const first = job({ id: "00000000-0000-0000-0000-0000000000a1", status: "failed", clientName: "가" });
                const second = job({ id: "00000000-0000-0000-0000-0000000000a2", status: "failed", clientName: "나" });
                const { worker, notificationService } = buildWorker({
                    repository: { listRecentStaffFailures: jest.fn().mockResolvedValue([first, second]) },
                    notification: {
                        sendToBranchUsers: jest.fn()
                            .mockRejectedValueOnce(new Error("mail down"))
                            .mockResolvedValue({ sent: 1, failed: 0 }),
                    },
                });

                await worker.processDueJobs();
                await flush();

                expect(notificationService.sendToBranchUsers).toHaveBeenCalledTimes(2);
            });
        });
    });
});
