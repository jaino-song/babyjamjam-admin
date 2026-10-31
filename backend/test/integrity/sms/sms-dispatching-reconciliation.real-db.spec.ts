import type { Prisma } from "@prisma/client";

import { AligoService } from "application/services/aligo.service";
import { SmsProviderAcceptanceService } from "application/services/sms-provider-acceptance.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import {
    createBranch,
    createClient,
    createMessageTriggerJob,
    createMessageTriggerRule,
} from "../helpers/factories";
import { RowTracker } from "../helpers/tracker";
import { invariant } from "../helpers/known-defect";
import {
    GatedDeliveryStub,
    RecordingDeliveryStub,
    deleteAreaRowsByBranch,
    SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON,
    wireMessageTriggerService,
    withDeadline,
} from "./sms-wiring.local";

/**
 * SI-SMS-04 — a job stranded in `dispatching` must be reconciled, never re-sent.
 *
 * When the reclaim sweep (`reclaimStaleProcessingJobs`) is run against a job
 * whose provider call was started but whose result was never persisted, the
 * JOB row must never authorize a second send:
 *
 * 1. a log that reached `sent`/`accepted` reconciles the job to `sent`
 *    (`findSentTriggerJobIdsSystemScope` runs before the re-mark);
 * 2. a log stuck `started`/`uncertain` reconciles the job to
 *    `failed` with the provider-uncertain reason, and the log itself refuses
 *    a manual retry (`retryById` → 409 REQUEST_CONFLICT).
 *
 * SI-SMS-07 — dispatch re-checks CURRENT eligibility under the claim. The
 * safeguard (`SmsAutomationSafeguardService.check`) runs inside the claim and
 * again in the dispatch-authorization transaction, reading the client's
 * `smsAutomationEnabled` and the rule's `isActive` fresh.
 */
describeReal("SMS dispatching reconciliation and eligibility re-check (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let branchId: string;
    let ruleId: string;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
    });

    afterAll(async () => {
        if (tracker) {
            if (branchId) await deleteAreaRowsByBranch(handle.raw, [branchId]);
            await tracker.cleanup(handle.raw);
        }
        if (handle) await closeIntegrityPrisma(handle);
    });

    async function seedBranchRuleClient(clientOverrides: Partial<Prisma.clientUncheckedCreateInput> = {}): Promise<void> {
        const branchRow = await createBranch(handle.raw, tracker);
        branchId = branchRow.id;
        const ruleRow = await createMessageTriggerRule(handle.raw, tracker, { branchId });
        ruleId = ruleRow.id;
        await createClient(handle.raw, tracker, { branchId, ...clientOverrides });
    }

    /** A stale claimed row (dispatching, token kept, updatedAt older than the reclaim cutoff). */
    async function seedStaleDispatchingJob(clientId: number | null): Promise<string> {
        const job = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            branchId,
            clientId,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: `si-04-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            status: "dispatching",
            claimToken: `si-04-claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            scheduledFor: new Date(Date.now() - 2 * 60 * 1000),
        });
        // The reclaim sweep only takes rows whose updatedAt predates the cutoff.
        const staleUpdatedAt = new Date(Date.now() - 15 * 60 * 1000);
        await handle.raw.$executeRaw`
            UPDATE "message_trigger_job" SET updated_at = ${staleUpdatedAt} WHERE id = ${job.id}
        `;
        return job.id;
    }

    async function seedProviderLog(jobId: string, shape: "sent" | "started"): Promise<number> {
        const log = await handle.raw.message_log.create({
            data: {
                branchId,
                provider: "aligo_sms",
                templateKey: "service_info_sms",
                triggerJobId: jobId,
                receiver: "01000000002",
                messageBody: "SI-SMS-04 reconciliation probe",
                variables: { automationKey: "SERVICE_INFO_SMS", triggerType: "service_start_before_7_days" },
                status: shape === "sent" ? "sent" : "pending",
                aligoMid: shape === "sent" ? "si-04-mid" : null,
                attempts: shape === "sent" ? 1 : 0,
                ...(shape === "sent"
                    ? { providerAcceptanceState: "accepted", providerAcceptedAt: new Date() }
                    : { providerAcceptanceState: "started", providerCallStartedAt: new Date(Date.now() - 15 * 60 * 1000) }),
            },
        });
        tracker.track("message_log", log.id);
        return log.id;
    }

    async function retryServiceForLog(): Promise<{ service: SmsRetryService; sendSms: jest.Mock }> {
        const logRepository = new SbMessageLogRepository(handle.service);
        const sendSms = jest.fn().mockImplementation(async () => {
            throw new Error("provider must never be called from this audit path");
        });
        const { jobRepository } = wireMessageTriggerService(handle, branchId);
        const module = await import("./sms-wiring.local");
        const service = new SmsRetryService(
            logRepository,
            { sendSms } as unknown as AligoService,
            module.noopApprovalStub() as unknown as ConstructorParameters<typeof SmsRetryService>[2],
            new SmsProviderAcceptanceService(logRepository),
            undefined,
            undefined,
            undefined,
            jobRepository,
            undefined,
        );
        return { service, sendSms };
    }

    invariant("SI-SMS-04", "a dispatching job whose log reached sent is reconciled to sent, never to failed", async () => {
        await seedBranchRuleClient();
        const jobId = await seedStaleDispatchingJob(null);
        const logId = await seedProviderLog(jobId, "sent");

        const wired = wireMessageTriggerService(handle, branchId);
        await wired.service.dispatchDueJobs();

        const job = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: jobId } });
        if (job.status !== "sent") {
            throw new Error(
                `dispatching job with an accepted (sent) log was not reconciled to sent: status=${job.status} cancelReason=${job.cancelReason}`,
            );
        }
        if (wired.delivery.providerCalls.length > 0) {
            throw new Error(`the reconciled job was re-sent: ${wired.delivery.providerCalls.length} provider calls`);
        }
        void logId;
    });

    invariant("SI-SMS-04", "a dispatching job with a started log lands in failed+uncertain and its log refuses a manual retry", async () => {
        await seedBranchRuleClient();
        const jobId = await seedStaleDispatchingJob(null);
        const logId = await seedProviderLog(jobId, "started");

        const wired = wireMessageTriggerService(handle, branchId);
        await wired.service.dispatchDueJobs();

        const job = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: jobId } });
        if (job.status !== "failed" || job.cancelReason !== SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON) {
            throw new Error(
                `dispatching job with a started log did not land in the uncertain-failed state: status=${job.status} reason=${job.cancelReason}`,
            );
        }

        const { service, sendSms } = await retryServiceForLog();
        await expect(service.retryById(branchId, logId))
            .rejects.toThrow(/충돌해 처리할 수 없/);

        const log = await handle.raw.message_log.findUniqueOrThrow({ where: { id: logId } });
        if (log.status !== "pending" || log.providerAcceptanceState !== "started") {
            throw new Error(`the uncertain log was mutated by the refused retry: status=${log.status} state=${log.providerAcceptanceState}`);
        }
        if (sendSms.mock.calls.length > 0) {
            throw new Error("provider was called although the log is uncertain");
        }
        expect(wired.delivery.providerCalls).toHaveLength(0);
    });

    invariant("SI-SMS-07", "a due job for a client whose SMS automation is off is canceled at dispatch, not sent", async () => {
        await seedBranchRuleClient({ smsAutomationEnabled: false });
        const client = await handle.raw.client.findFirstOrThrow({ where: { branchId } });
        const dueJob = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            branchId,
            clientId: client.id,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: `si-07-off-${Date.now()}`,
            status: "pending",
            scheduledFor: new Date(Date.now() + 60 * 1000),
        });
        tracker.track("message_trigger_job", dueJob.id);

        const wired = wireMessageTriggerService(handle, branchId);
        const dueJobEntity = MessageTriggerJobEntity.reconstitute(
            dueJob.id, dueJob.branchId, dueJob.ruleId, dueJob.status as MessageTriggerJobEntity["status"],
            dueJob.scheduledFor, dueJob.sentAt, dueJob.canceledAt, dueJob.cancelReason,
            dueJob.clientId, dueJob.employeeScheduleId,
            dueJob.recipientType as MessageTriggerRecipientType, dueJob.recipientPhone,
            dueJob.templateKey as MessageTriggerTemplateKey, dueJob.dedupeKey,
            dueJob.payload as unknown as MessageTriggerJobEntity["payload"],
            dueJob.createdAt, dueJob.updatedAt, dueJob.attempts, dueJob.nextAttemptAt, dueJob.claimToken,
        );
        const dispatch = (wired.service as unknown as {
            dispatchClaimedJob(
                job: MessageTriggerJobEntity,
                sentIds: Set<string>,
                approvedBranchIds: Set<string>,
            ): Promise<boolean>;
        }).dispatchClaimedJob;
        const handled = await dispatch.call(
            wired.service, dueJobEntity, new Set<string>(), new Set<string>([branchId]),
        );

        const job = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: dueJob.id } });
        if (job.status !== "canceled") {
            throw new Error(`a job for an opted-out client was not canceled: status=${job.status} reason=${job.cancelReason}`);
        }
        if (handled !== true) throw new Error("the refused dispatch was not reported as handled");
        expect(wired.delivery.providerCalls).toHaveLength(0);
    });

    invariant("SI-SMS-07", "a due job for an eligible client under an active rule can be claimed for dispatch", async () => {
        await seedBranchRuleClient();
        const client = await handle.raw.client.findFirstOrThrow({ where: { branchId } });
        const dueJob = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            branchId,
            clientId: client.id,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: `si-07-on-${Date.now()}`,
            status: "pending",
            scheduledFor: new Date(Date.now() + 60 * 1000),
        });

        const wired = wireMessageTriggerService(handle, branchId);
        const claimToken = await wired.jobRepository.claimPendingWithRuleFence(dueJob.id, branchId);

        if (claimToken === null) {
            throw new Error("an eligible pending job could not be claimed for dispatch");
        }
        expect(wired.delivery.providerCalls).toHaveLength(0);
    });

    /** Rebuilt entity over a freshly read row, for a `dispatchClaimedJob` probe. */
    async function liveJobEntity(jobId: string): Promise<MessageTriggerJobEntity> {
        const row = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: jobId } });
        return MessageTriggerJobEntity.reconstitute(
            row.id, row.branchId, row.ruleId, row.status as MessageTriggerJobEntity["status"],
            row.scheduledFor, row.sentAt, row.canceledAt, row.cancelReason,
            row.clientId, row.employeeScheduleId,
            row.recipientType as MessageTriggerRecipientType, row.recipientPhone,
            row.templateKey as MessageTriggerTemplateKey, row.dedupeKey,
            row.payload as unknown as MessageTriggerJobEntity["payload"],
            row.createdAt, row.updatedAt, row.attempts, row.nextAttemptAt, row.claimToken,
        );
    }

    function dispatchProbe(wired: ReturnType<typeof wireMessageTriggerService>): {
        run(entity: MessageTriggerJobEntity): Promise<boolean>;
    } {
        const dispatch = (wired.service as unknown as {
            dispatchClaimedJob(
                job: MessageTriggerJobEntity,
                sentIds: Set<string>,
                approvedBranchIds: Set<string>,
            ): Promise<boolean>;
        }).dispatchClaimedJob;
        return {
            run: (entity) => dispatch.call(wired.service, entity, new Set<string>(), new Set<string>([branchId])),
        };
    }

    invariant("SI-SMS-07", "a due job whose rule was deactivated AFTER scheduling is not sent (dispatch re-checks the rule)", async () => {
        await seedBranchRuleClient();
        const client = await handle.raw.client.findFirstOrThrow({ where: { branchId } });
        const dueJob = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            branchId,
            clientId: client.id,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: `si-07-rule-off-${Date.now()}`,
            status: "pending",
            payload: {
                memberId: "si-07-member",
                recipientName: "무결성 수신자",
                recipientPhone: "01000000002",
                messageBody: "SI-SMS-07 eligibility re-check probe",
                templateVariables: { triggerType: "agent_scheduled", retrySafety: "" },
            },
            scheduledFor: new Date(Date.now() + 60 * 1000),
        });
        // The job was scheduled against an active rule; the rule is deactivated after.
        await handle.raw.message_trigger_rule.update({ where: { id: ruleId }, data: { isActive: false } });

        const wired = wireMessageTriggerService(handle, branchId);
        const handled = await dispatchProbe(wired).run(await liveJobEntity(dueJob.id));

        const job = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: dueJob.id } });
        if (job.status === "sent" || job.status === "processing" || job.status === "dispatching") {
            throw new Error(
                `a dispatch-time inactive rule did not stop the job: status=${job.status} reason=${job.cancelReason}`,
            );
        }
        if (!handled) throw new Error("the deactivated-rule dispatch was not reported as handled");
        expect(wired.delivery.providerCalls).toHaveLength(0);
    });

    invariant("SI-SMS-07", "a due job under a jobsStale rule is not claimable, so it is not sent", async () => {
        await seedBranchRuleClient();
        const client = await handle.raw.client.findFirstOrThrow({ where: { branchId } });
        const dueJob = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            branchId,
            clientId: client.id,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: `si-07-rule-stale-${Date.now()}`,
            status: "pending",
            payload: {
                memberId: "si-07-member",
                recipientName: "무결성 수신자",
                recipientPhone: "01000000002",
                messageBody: "SI-SMS-07 eligibility re-check probe",
                templateVariables: { triggerType: "agent_scheduled", retrySafety: "" },
            },
            scheduledFor: new Date(Date.now() + 60 * 1000),
        });
        // The rule is flagged stale after the job exists; the claim refuses
        // stale rules until the rebuild re-publishes the rule.
        await handle.raw.message_trigger_rule.update({ where: { id: ruleId }, data: { jobsStale: true } });

        const wired = wireMessageTriggerService(handle, branchId);
        const handled = await dispatchProbe(wired).run(await liveJobEntity(dueJob.id));

        const job = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: dueJob.id } });
        if (job.status === "sent" || job.status === "processing" || job.status === "dispatching") {
            throw new Error(
                `a dispatch-time stale rule did not stop the job: status=${job.status} reason=${job.cancelReason}`,
            );
        }
        const claim = await wired.jobRepository.claimPendingWithRuleFence(dueJob.id, branchId);
        if (claim !== null) {
            throw new Error("a job under a jobsStale rule was claimable for dispatch");
        }
        if (handled) throw new Error("the stale-rule dispatch was unexpectedly reported as handled");
        expect(wired.delivery.providerCalls).toHaveLength(0);
    });

    invariant("SI-SMS-07", "a due job for a client whose smsAutomationEnabled is flipped off AFTER creation is canceled at dispatch", async () => {
        await seedBranchRuleClient();
        const client = await handle.raw.client.findFirstOrThrow({ where: { branchId } });
        const dueJob = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            branchId,
            clientId: client.id,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: `si-07-client-off-${Date.now()}`,
            status: "pending",
            payload: {
                memberId: "si-07-member",
                recipientName: "무결성 수신자",
                recipientPhone: "01000000002",
                messageBody: "SI-SMS-07 eligibility re-check probe",
                templateVariables: { triggerType: "agent_scheduled", retrySafety: "" },
            },
            scheduledFor: new Date(Date.now() + 60 * 1000),
        });
        // Flip AFTER the claim, while preparation runs outside the branch lock.
        // Only the dispatch-authorization re-check can observe this new value.
        class OptOutDuringPreparation extends RecordingDeliveryStub {
            override async prepareJob(job: MessageTriggerJobEntity) {
                const preparation = await super.prepareJob(job);
                expect(preparation).not.toBeNull();
                const claimed = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: job.id } });
                expect(claimed.status).toBe("processing");
                expect(claimed.claimToken).not.toBeNull();
                await handle.raw.client.update({ where: { id: client.id }, data: { smsAutomationEnabled: false } });
                return preparation;
            }
        }
        const wired = wireMessageTriggerService(handle, branchId, OptOutDuringPreparation);
        const handled = await dispatchProbe(wired).run(await liveJobEntity(dueJob.id));

        const job = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: dueJob.id } });
        if (job.status !== "canceled") {
            throw new Error(
                `a job whose client was opted out after scheduling was not canceled: status=${job.status} reason=${job.cancelReason}`,
            );
        }
        if (job.cancelReason !== "sms_automation_safeguard:recipient") {
            throw new Error(`unexpected cancel reason for the opted-out client: ${job.cancelReason}`);
        }
        if (!handled) throw new Error("the opted-out-client dispatch was not reported as handled");
        expect(wired.delivery.providerCalls).toHaveLength(0);
    });

    /**
     * SI-SMS-09 — the reclaim keeps the claim token of a `dispatching` row, so
     * the reclaimer and the still-in-flight original worker hold the SAME
     * fence value. `persistTriggerJobStatus` fences everything on that token,
     * so the in-flight worker's finishing write can overwrite the reclaimer's
     * terminal (failed, provider-uncertain) state. Forcing interleaving: the
     * original worker is paused inside the local provider call, after admission
     * but before its result returns and before the finishing write; a second real
     * `dispatchDueJobs()` tick reclaims the stale row through the production
     * reclaim path; releasing the worker lets it finish its CAS write.
     *
     * Intended (operator decision 2026-10-31): a late authoritative provider
     * success resolves the reclaimed uncertain failure without another send.
     */
    invariant(
        "SI-SMS-09",
        "a late worker rewriting a reconciled failed job to sent is intended (operator decision 2026-10-31)",
        async () => {
            await seedBranchRuleClient();
            const client = await handle.raw.client.findFirstOrThrow({ where: { branchId } });
            const dueJob = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
                branchId,
                clientId: client.id,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                dedupeKey: `si-09-${Date.now()}`,
                status: "pending",
                scheduledFor: new Date(Date.now() + 60 * 1000),
                payload: {
                    memberId: "si-09-member",
                    recipientName: "무결성 수신자",
                    recipientPhone: "01000000002",
                    messageBody: "SI-SMS-09 in-flight overwrite probe",
                    templateVariables: { triggerType: "agent_scheduled", retrySafety: "" },
                },
            });

            const wired = wireMessageTriggerService(handle, branchId, GatedDeliveryStub);
            const delivery = wired.delivery as GatedDeliveryStub;
            delivery.arm();
            const worker = wired.service.dispatchPendingJobNow(dueJob.id, { expectedBranchId: branchId });
            // Observe rejections even when a setup assertion fails before release.
            const settledWorker = worker.then(() => undefined, (error: unknown) => error);
            try {
                await withDeadline(Promise.race([
                    delivery.reached,
                    worker.then(() => { throw new Error("worker exited before the provider pause"); }),
                ]), 5_000, "worker never reached the provider pause");

                // The original provider call is in flight; the durable row is
                // dispatching under the original worker's claim token.
                const row = await handle.raw.message_trigger_job.findUniqueOrThrow({
                    where: { id: dueJob.id }, select: { status: true, claimToken: true },
                });
                expect(row.status).toBe("dispatching");
                expect(row.claimToken).not.toBeNull();
                expect(delivery.providerCalls).toHaveLength(1);
                const claimToken = row.claimToken;

                // Age only our row past the reclaim cutoff, then run a real
                // second scheduler tick while the original result is paused.
                await handle.raw.$executeRaw`
                    UPDATE "message_trigger_job" SET updated_at = ${new Date(Date.now() - 15 * 60 * 1000)}
                    WHERE id = ${dueJob.id}
                `;
                await wireMessageTriggerService(handle, branchId).service.dispatchDueJobs();

                const reconciled = await handle.raw.message_trigger_job.findUniqueOrThrow({
                    where: { id: dueJob.id },
                    select: { status: true, cancelReason: true, claimToken: true },
                });
                expect(reconciled.status).toBe("failed");
                expect(reconciled.cancelReason).toBe(SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON);
                expect(reconciled.claimToken).toBe(claimToken);

                // Release the late success: its finishing CAS presents the same
                // token the reclaimer kept. Pin today's late-result precedence.
                delivery.open();
                await withDeadline(worker, 15_000, "the paused worker never finished after the release");

                const after = await handle.raw.message_trigger_job.findUniqueOrThrow({
                    where: { id: dueJob.id },
                    select: { status: true, cancelReason: true, sentAt: true },
                });
                expect(after.status).toBe("sent");
                expect(after.cancelReason).toBeNull();
                expect(after.sentAt).not.toBeNull();
                expect(delivery.providerCalls).toHaveLength(1);
            } finally {
                delivery.open();
                await withDeadline(settledWorker, 15_000, "worker did not settle during cleanup");
            }
        },
    );
});
