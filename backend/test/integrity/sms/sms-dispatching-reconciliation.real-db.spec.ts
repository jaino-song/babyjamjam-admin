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
    deleteAreaRowsByBranch,
    SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON,
    wireMessageTriggerService,
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
});
