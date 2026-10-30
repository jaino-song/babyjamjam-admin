import { PrismaClient } from "@prisma/client";

import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG } from "domain/entities/system-setting.entity";

import { createContractDoc } from "./contracts-fixture";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal, assertThrowawayTarget, type IntegrityPrisma } from "../helpers/real-db";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

/**
 * SI-CONTRACT-05 / SI-CONTRACT-06 — document job lifecycle over the real
 * database: requestKey/activeKey idempotency, the `FOR UPDATE SKIP LOCKED`
 * lease claim, lease-token-guarded terminal writes, activeKey release on
 * terminal, and the auto-finalize attempt accounting. The job repository and
 * service are the real production classes; only the client repository
 * collaborator (not used by the finalize path) is stubbed. Every job a case
 * creates is driven to a terminal state before the case ends, so the global
 * processing-job cap and the claim queue stay deterministic.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describeReal("eformsign document job lifecycle (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let raw: PrismaClient;
    let tracker: RowTracker;
    let jobService: EformsignDocumentJobService;
    let jobRepository: SbEformsignDocumentJobRepository;
    let branchId: string;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        raw = handle.raw;
        tracker = new RowTracker();
        const branchRow = await raw.branch.create({
            data: { name: "무결성 작업 지점", slug: `throwaway-si-contracts-jobs-${Date.now().toString(36)}` },
        });
        tracker.track("branch", branchRow.id);
        branchId = branchRow.id;
        jobRepository = new SbEformsignDocumentJobRepository(handle.service);
        jobService = new EformsignDocumentJobService(
            jobRepository,
            new SbEformsignDocRepository(handle.service),
            { findById: async () => null } as never,
        );
    });

    afterAll(async () => {
        if (tracker) {
            await tracker.cleanup(raw);
        }
        if (handle) {
            await closeIntegrityPrisma(handle);
        }
    });

    /**
     * Claims exactly the one due job with the given id through the real
     * `claimDue` (which may legitimately surface other queued jobs first) and
     * returns its lease token. Any other job claimed on the way is completed
     * again so it cannot block later claims.
     */
    async function claimOnce(expectedJobId: string): Promise<string | null> {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const claimed = await jobRepository.claimDue(1);
            if (claimed.length === 0) {
                await sleep(25);
                continue;
            }
            for (const job of claimed) {
                if (job.id === expectedJobId) {
                    return job.leaseToken;
                }
                await jobRepository.markCompleted(job.id, job.leaseToken ?? "", job.documentId ?? undefined);
            }
        }
        return null;
    }

    /** Drives a queued job to `completed` so it never blocks later cases. */
    async function drainJob(jobId: string): Promise<void> {
        const lease = await claimOnce(jobId);
        if (lease) {
            await jobRepository.markCompleted(jobId, lease);
        }
    }

    invariant("SI-CONTRACT-05", "the same requestKey enqueued twice creates exactly one job and returns the existing one", async () => {
        const doc = await createContractDoc(handle, tracker, branchId, { clientId: null });
        const requestKey = `si-job-request-${doc.documentId}`;
        const first = await jobService.enqueueFinalizeDocument({
            branchId,
            documentId: doc.documentId,
            requestKey,
            source: "staff",
        });
        expect(first.existing).toBe(false);
        const second = await jobService.enqueueFinalizeDocument({
            branchId,
            documentId: doc.documentId,
            requestKey,
            source: "staff",
        });
        expect(second.existing).toBe(true);
        expect(second.job.id).toBe(first.job.id);
        expect(await raw.eformsign_document_job.count({ where: { requestKey } })).toBe(1);
        await drainJob(first.job.id);
    });

    invariant("SI-CONTRACT-05", "a different requestKey with the same activeKey cannot create a second active job", async () => {
        const doc = await createContractDoc(handle, tracker, branchId, { clientId: null });
        const first = await jobService.enqueueFinalizeDocument({
            branchId,
            documentId: doc.documentId,
            requestKey: `si-active-a-${doc.documentId}`,
            source: "staff",
        });
        // A retried caller that generates a new request key still converges on
        // the one active job for the document.
        const second = await jobService.enqueueFinalizeDocument({
            branchId,
            documentId: doc.documentId,
            requestKey: `si-active-b-${doc.documentId}`,
            source: "staff",
        });
        expect(second.existing).toBe(true);
        expect(second.job.id).toBe(first.job.id);
        expect(await raw.eformsign_document_job.count({ where: { documentId: doc.documentId } })).toBe(1);
        await drainJob(first.job.id);
    });

    invariant("SI-CONTRACT-05", "an expired lease reclaimed by the recovery sweep leaves the old worker's terminal write rejected and the new lease in charge", async () => {
        const doc = await createContractDoc(handle, tracker, branchId, { clientId: null });
        const job = (
            await jobService.enqueueFinalizeDocument({
                branchId,
                documentId: doc.documentId,
                requestKey: `si-lease-${doc.documentId}`,
                source: "staff",
            })
        ).job;

        const oldLease = await claimOnce(job.id);
        expect(oldLease).not.toBeNull();
        expect((await raw.eformsign_document_job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("processing");

        // The old worker dies. The recovery sweep requeues the job (progress
        // step is still null) and clears the lease.
        const recovered = await jobRepository.recoverStale(new Date(Date.now() + 60 * 60 * 1000));
        expect(recovered.map((row) => row.id)).toContain(job.id);
        const afterRecovery = await raw.eformsign_document_job.findUniqueOrThrow({ where: { id: job.id } });
        expect(afterRecovery.status).toBe("queued");
        expect(afterRecovery.leaseToken).toBeNull();

        // The old worker wakes up and tries to complete with its dead lease:
        // the lease_token predicate must reject the write.
        expect(await jobRepository.markCompleted(job.id, oldLease!)).toBeNull();
        expect((await raw.eformsign_document_job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("queued");

        // Another worker claims the reclaimed job and finishes it.
        const newLease = await claimOnce(job.id);
        expect(newLease).not.toBeNull();
        expect(newLease).not.toBe(oldLease);
        expect(await jobRepository.markCompleted(job.id, newLease!, doc.documentId)).not.toBeNull();
        const terminal = await raw.eformsign_document_job.findUniqueOrThrow({ where: { id: job.id } });
        expect(terminal.status).toBe("completed");
        expect(terminal.activeKey).toBeNull();
        expect(terminal.leaseToken).toBeNull();

        // A terminal write from the old lease stays rejected even now.
        expect(await jobRepository.markFailed(job.id, oldLease!, "SI_LATE")).toBeNull();
        expect((await raw.eformsign_document_job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("completed");
    });

    invariant("SI-CONTRACT-05", "after a terminal job the same document can get a new job: the active key was released", async () => {
        const doc = await createContractDoc(handle, tracker, branchId, { clientId: null });
        const firstJob = (
            await jobService.enqueueFinalizeDocument({
                branchId,
                documentId: doc.documentId,
                requestKey: `si-terminal-${doc.documentId}`,
                source: "staff",
            })
        ).job;
        const lease = await claimOnce(firstJob.id);
        expect(lease).not.toBeNull();
        expect(await jobRepository.markCompleted(firstJob.id, lease!, doc.documentId)).not.toBeNull();

        const second = await jobService.enqueueFinalizeDocument({
            branchId,
            documentId: doc.documentId,
            requestKey: `si-terminal-2-${doc.documentId}`,
            source: "staff",
        });
        expect(second.existing).toBe(false);
        expect(second.job.id).not.toBe(firstJob.id);
        expect(await raw.eformsign_document_job.count({ where: { documentId: doc.documentId } })).toBe(2);
        await drainJob(second.job.id);
    });

    invariant("SI-CONTRACT-06", "an auto-finalize failure increments the document attempt counter exactly once per failed job and releases the active key while the budget lasts", async () => {
        const doc = await createContractDoc(handle, tracker, branchId, { clientId: null });

        const firstJob = (
            await jobService.enqueueFinalizeDocument({
                branchId,
                documentId: doc.documentId,
                requestKey: `si-auto-1-${doc.documentId}`,
                source: "auto_finalize",
            })
        ).job;
        const firstLease = await claimOnce(firstJob.id);
        const failed = await jobRepository.markFailed(firstJob.id, firstLease!, "SI_PROVIDER_DOWN");
        expect(failed).not.toBeNull();
        expect(failed?.autoFinalizeOutcomeAttempts).toBe(1);
        expect((await raw.eformsign_doc.findUniqueOrThrow({ where: { documentId: doc.documentId } })).autoFinalizeAttempts).toBe(1);
        // Budget not exhausted (1 < default 3): the active key was released so
        // the next scheduler tick can queue the retry, and the outcome is
        // recorded exactly once for the job.
        const failedRow = await raw.eformsign_document_job.findUniqueOrThrow({ where: { id: firstJob.id } });
        expect(failedRow.activeKey).toBeNull();
        expect(failedRow.autoFinalizeOutcomeRecordedAt).not.toBeNull();

        // The dead lease cannot record a second outcome for the same job.
        expect(await jobRepository.markFailed(firstJob.id, firstLease!, "SI_PROVIDER_DOWN")).toBeNull();
        expect((await raw.eformsign_doc.findUniqueOrThrow({ where: { documentId: doc.documentId } })).autoFinalizeAttempts).toBe(1);
    });

    invariant("SI-CONTRACT-06", "the auto-finalize attempt counter reaches its budget and then the exhausted job keeps its active key", async () => {
        const doc = await createContractDoc(handle, tracker, branchId, { clientId: null });
        const maxAttempts = DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.maxAttempts;

        let lastJobId = "";
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const job = (
                await jobService.enqueueFinalizeDocument({
                    branchId,
                    documentId: doc.documentId,
                    requestKey: `si-auto-x-${attempt}-${doc.documentId}`,
                    source: "auto_finalize",
                })
            ).job;
            lastJobId = job.id;
            const lease = await claimOnce(job.id);
            expect(lease).not.toBeNull();
            expect(await jobRepository.markFailed(job.id, lease!, "SI_PROVIDER_DOWN")).not.toBeNull();
            expect((await raw.eformsign_doc.findUniqueOrThrow({ where: { documentId: doc.documentId } })).autoFinalizeAttempts).toBe(attempt);
        }

        // Budget exhausted: the last failure keeps its active key, so no new
        // auto-finalize job for the document can be enqueued past it.
        const exhaustedJob = await raw.eformsign_document_job.findUniqueOrThrow({ where: { id: lastJobId } });
        expect(exhaustedJob.activeKey).not.toBeNull();
        const blocked = await jobService.enqueueFinalizeDocument({
            branchId,
            documentId: doc.documentId,
            requestKey: `si-auto-x-over-${doc.documentId}`,
            source: "auto_finalize",
        });
        expect(blocked.existing).toBe(true);
        expect(blocked.job.id).toBe(lastJobId);
        expect(await raw.eformsign_document_job.count({ where: { documentId: doc.documentId } })).toBe(maxAttempts);
    });
});
