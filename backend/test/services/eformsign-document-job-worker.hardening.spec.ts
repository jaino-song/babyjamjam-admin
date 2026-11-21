import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { EformsignDocumentJobWorkerService } from "application/services/eformsign-document-job-worker.service";
import { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
import { captureBackendError } from "infrastructure/observability/service-record-sentry";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

jest.mock("infrastructure/observability/service-record-sentry", () => ({
    captureBackendError: jest.fn(),
    captureDocumentJobFailure: jest.fn(),
}));

const now = new Date("2026-11-21T00:00:00Z");
const branchId = "00000000-0000-4000-8000-000000000010";
const authorizationFailure = "SERVICE_RECORD_REVISION_AUTHORIZATION_FAILURE";

function revisionJob(overrides: Partial<EformsignDocumentJobEntity> = {}) {
    return new EformsignDocumentJobEntity({
        id: "00000000-0000-4000-8000-000000000001",
        branchId, clientId: 7, documentId: null,
        jobType: "create_document", source: "staff", status: "processing",
        requestKey: "service-record-revision:case:draft", activeKey: "revision:case:draft",
        payload: {
            kind: "service_record_revision",
            context: {
                branchId, clientId: 7,
                serviceRecordCaseId: "00000000-0000-4000-8000-000000000020",
                revisionId: null, revisionNumber: null, businessFingerprint: "a".repeat(64),
                plannedSessionCount: 1, plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-11-21" }],
                documentSyncStatus: "pending", lifecycleStatus: "READY_TO_FINALIZE", formVersion: 2,
            },
            immutablePayload: {}, payloadFingerprint: "b".repeat(64), completeness: "complete",
        },
        payloadFingerprint: "b".repeat(64), progressStep: null, progressDetail: null,
        attempts: 1, nextAttemptAt: now, heartbeatAt: now,
        leaseToken: "00000000-0000-4000-8000-000000000099",
        autoFinalizeOutcomeRecordedAt: null, autoFinalizeOutcomeAttempts: null,
        startedAt: now, completedAt: null, lastErrorCode: null, createdByUserId: null,
        createdAt: now, updatedAt: now, ...overrides,
    });
}

function buildWorker(claimed: EformsignDocumentJobEntity, random = jest.fn(() => 0.5)) {
    const cause = new Error("authorization unavailable");
    const repository = {
        recoverStale: jest.fn().mockResolvedValue([]), claimDue: jest.fn().mockResolvedValue([claimed]),
        authorizeForDispatch: jest.fn().mockRejectedValue(cause),
        scheduleRetry: jest.fn().mockResolvedValue(null), markFailed: jest.fn().mockResolvedValue(null),
        markReconciling: jest.fn().mockResolvedValue(null), markRequiresAttention: jest.fn().mockResolvedValue(null),
        deleteExpiredTerminal: jest.fn().mockResolvedValue(0),
        purgeExpiredAttentionPayloads: jest.fn().mockResolvedValue(0),
        listRecentStaffFailures: jest.fn().mockResolvedValue([]),
    };
    const dispatch = { execute: jest.fn() };
    const contractRecovery = { recoverBeforeCreation: jest.fn().mockResolvedValue("retry") };
    const worker = new EformsignDocumentJobWorkerService(
        new ConfigService({ EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED: "true" }),
        repository as never, dispatch as never, { execute: jest.fn() } as never,
        { reconcile: jest.fn() } as never, { recordTerminalFailure: jest.fn() } as never,
        {} as never, { findById: jest.fn().mockResolvedValue({ id: 7 }) } as never,
        createSchedulerLeaseMock(), {} as never, {} as never,
        undefined, undefined, undefined, contractRecovery as never, random,
    );
    return { worker, repository, cause, random, contractRecovery, dispatch };
}

describe("document-job worker hardening", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(now);
        jest.mocked(captureBackendError).mockReset();
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it.each([0, 0.5, 1])("bounds revision retry delays with random %s and preserves exhaustion", async value => {
        const expected = value === 0 ? [48_000, 240_000, 720_000]
            : value === 1 ? [72_000, 360_000, 1_080_000] : [60_000, 300_000, 900_000];
        for (const [index, delay] of expected.entries()) {
            const claimed = revisionJob({ attempts: index + 1 });
            const { worker, repository, random } = buildWorker(claimed, jest.fn(() => value));
            await worker.processDueJobs();
            expect(repository.scheduleRetry).toHaveBeenCalledTimes(1);
            expect(repository.scheduleRetry).toHaveBeenCalledWith(
                claimed.id, claimed.leaseToken, new Date(now.getTime() + delay), authorizationFailure,
            );
            expect(delay).toBeGreaterThanOrEqual(30_000);
            expect(repository.markFailed).not.toHaveBeenCalled();
            expect(random).toHaveBeenCalledTimes(1);
        }
        const claimed = revisionJob({ attempts: 4 });
        const { worker, repository, random } = buildWorker(claimed, jest.fn(() => value));
        await worker.processDueJobs();
        expect(repository.markFailed).toHaveBeenCalledTimes(1);
        expect(repository.markFailed).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, "PRE_SEND_RETRY_EXHAUSTED");
        expect(repository.scheduleRetry).not.toHaveBeenCalled();
        expect(random).not.toHaveBeenCalled();
    });

    it("also jitters revision operation authorization retries", async () => {
        const base = revisionJob();
        const claimed = revisionJob({ payload: {
            kind: "service_record_revision_operations",
            context: { ...base.payload?.["context"] as object, revisionId: "00000000-0000-4000-8000-000000000021", revisionNumber: 1 },
            operations: { contract: {
                documentStateId: "00000000-0000-4000-8000-000000000022",
                generation: "00000000-0000-4000-8000-000000000023",
            } },
        } });
        const { worker, repository } = buildWorker(claimed, jest.fn(() => 0));
        await worker.processDueJobs();
        expect(repository.scheduleRetry).toHaveBeenCalledTimes(1);
        expect(repository.scheduleRetry).toHaveBeenCalledWith(
            claimed.id, claimed.leaseToken, new Date(now.getTime() + 48_000), authorizationFailure,
        );
    });

    it("captures the cause once and emits only safe warning fields", async () => {
        const claimed = revisionJob();
        const { worker, repository, cause, dispatch } = buildWorker(claimed);
        cause.message = "private customer details, phone, SQL and payload";
        await worker.processDueJobs();
        expect(captureBackendError).toHaveBeenCalledTimes(1);
        expect(captureBackendError).toHaveBeenCalledWith(cause, {
            handled: true, operation: "document-job-authorization",
        });
        expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
        expect(Logger.prototype.warn).toHaveBeenCalledWith({
            jobId: claimed.id, jobType: claimed.jobType, errorName: "Error", errorMessage: authorizationFailure,
        });
        expect(repository.scheduleRetry).toHaveBeenCalledTimes(1);
        expect(repository.markReconciling).not.toHaveBeenCalled();
        expect(dispatch.execute).not.toHaveBeenCalled();
    });

    it.each([null, "creating", "sent"])("preserves handling with %s evidence when capture and logging throw", async progressStep => {
        const claimed = revisionJob({ progressStep });
        const { worker, repository } = buildWorker(claimed);
        jest.mocked(captureBackendError).mockImplementation(() => { throw new Error("capture unavailable"); });
        jest.mocked(Logger.prototype.warn).mockImplementation(() => { throw new Error("logger unavailable"); });
        await expect(worker.processDueJobs()).resolves.toBeUndefined();
        expect(captureBackendError).toHaveBeenCalledTimes(1);
        expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
        if (progressStep) {
            expect(repository.markReconciling).toHaveBeenCalledTimes(1);
            expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, claimed.leaseToken, progressStep);
            expect(repository.scheduleRetry).not.toHaveBeenCalled();
        } else {
            expect(repository.scheduleRetry).toHaveBeenCalledTimes(1);
            expect(repository.markReconciling).not.toHaveBeenCalled();
        }
    });

    it("preserves contract recovery delays and exhaustion without reading random", async () => {
        for (const [index, delay] of [60_000, 300_000, 900_000, null].entries()) {
            const claimed = revisionJob({
                attempts: index + 1, requestKey: "contract:qa", contractGeneration: "generation",
                payload: { clientId: 7, contractData: {} },
            });
            const { worker, repository, contractRecovery, random } = buildWorker(claimed, jest.fn(() => 0));
            await worker.processDueJobs();
            expect(contractRecovery.recoverBeforeCreation).toHaveBeenCalledTimes(1);
            expect(contractRecovery.recoverBeforeCreation).toHaveBeenCalledWith(
                { jobId: claimed.id, leaseToken: claimed.leaseToken, contractGeneration: claimed.contractGeneration },
                delay === null ? null : new Date(now.getTime() + delay), authorizationFailure,
            );
            expect(repository.scheduleRetry).not.toHaveBeenCalled();
            expect(random).not.toHaveBeenCalled();
        }
    });
});
