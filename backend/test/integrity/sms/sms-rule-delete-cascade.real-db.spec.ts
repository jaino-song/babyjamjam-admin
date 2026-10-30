import type { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { createBranch, createMessageTriggerJob, createMessageTriggerRule } from "../helpers/factories";
import { RowTracker } from "../helpers/tracker";
import { invariant, knownDefect } from "../helpers/known-defect";
import { deleteAreaRowsByBranch, wireMessageTriggerService } from "./sms-wiring.local";

/**
 * SI-SMS-02 — deleting a `message_trigger_rule` and its job history.
 *
 * `message_trigger_job.rule_id` carries `onDelete: Cascade` (schema.prisma), so
 * a hard rule delete erases every job of the rule — `sent` jobs included. The
 * approved delete path (`deleteIfTargetMatchesAndFenceJobs`) deliberately
 * refuses processing/dispatching jobs and sends with sent_at >= fenceStartedAt,
 * not older sent history. The plain `MessageTriggerService.deleteRule` path
 * (agent capabilities) cancels pending jobs and then hard-deletes the rule.
 * message_log survives via SetNull; dedupe is rule-scoped, so this demonstrates
 * loss of job history, not loss of the send log or a duplicate send.
 */
describeReal("SMS rule deletion vs job history (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let branchId: string;

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

    async function seedBranchWithRule(): Promise<{ ruleId: string }> {
        const branchRow = await createBranch(handle.raw, tracker);
        branchId = branchRow.id;
        const ruleRow = await createMessageTriggerRule(handle.raw, tracker, { branchId });
        return { ruleId: ruleRow.id };
    }

    async function createJob(ruleId: string, status: string, dedupeKey: string, sentAt?: Date): Promise<MessageTriggerJobEntity["id"]> {
        const job = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            branchId,
            status: status as "pending",
            ...(status === "sent" ? { sentAt: sentAt ?? new Date() } : {}),
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
            dedupeKey,
        });
        return job.id;
    }

    knownDefect("SI-SMS-02", "deleting a rule through MessageTriggerService.deleteRule keeps sent-job history", async () => {
        const { ruleId } = await seedBranchWithRule();
        const sentJobId = await createJob(ruleId, "sent", `si-02-sent-${Date.now()}`);
        const pendingJobId = await createJob(ruleId, "pending", `si-02-pending-${Date.now()}`);

        const { service } = wireMessageTriggerService(handle, branchId);
        await service.deleteRule(branchId, ruleId);

        const sentJob = await handle.raw.message_trigger_job.findUnique({ where: { id: sentJobId } });
        if (!sentJob || sentJob.status !== "sent") {
            const remaining = await handle.raw.message_trigger_job.count({ where: { ruleId } });
            throw new Error(
                `sent job history was erased by rule deletion: sentJob=${sentJob ? sentJob.status : "GONE"}, remaining jobs for rule=${remaining}`,
            );
        }
        void pendingJobId;
    }, /sent job history was erased by rule deletion/);

    knownDefect("SI-SMS-02", "deleting a rule through MessageTriggerService.deleteRule keeps its canceled-job audit trail", async () => {
        const { ruleId } = await seedBranchWithRule();
        const canceledJobId = await createJob(ruleId, "canceled", `si-02-canceled-${Date.now()}`);

        const { service } = wireMessageTriggerService(handle, branchId);
        await service.deleteRule(branchId, ruleId);

        const canceledJob = await handle.raw.message_trigger_job.findUnique({ where: { id: canceledJobId } });
        if (!canceledJob || canceledJob.status !== "canceled") {
            throw new Error(`canceled job history was erased by rule deletion: canceledJob=${canceledJob ? canceledJob.status : "GONE"}`);
        }
    }, /canceled job history was erased by rule deletion/);

    type RuleEntity = NonNullable<Parameters<ReturnType<typeof wireMessageTriggerService>["ruleRepository"]["deleteIfTargetMatchesAndFenceJobs"]>[1]>;

    function expectedRuleFor(rule: {
        id: string; branchId: string | null; name: string; isActive: boolean; eventType: string;
        offsetType: string; offsetDays: number; sendTime: string; recipientType: string;
        templateKey: string; isDefault: boolean; jobsStale: boolean; targetClientStatus: string;
        retryOnFailure: boolean; createdAt: Date; updatedAt: Date;
    }): RuleEntity {
        // The repository's target comparison reads these fields off the entity;
        // a structurally identical row object satisfies it.
        return rule as unknown as RuleEntity;
    }

    invariant("SI-SMS-02", "the approved rule-delete fence refuses a send that landed while the delete was preparing", async () => {
        const { ruleId } = await seedBranchWithRule();
        // The fence predicate is `sent_at >= fenceStartedAt`: it serializes the
        // delete against an in-flight send, so seed a job whose sentAt is at or
        // after the fence timestamp.
        const fenceStartedAt = new Date(Date.now() - 1_000);
        const sentJobId = await createJob(ruleId, "sent", `si-02-fence-sent-${Date.now()}`, new Date());
        const rule = await handle.raw.message_trigger_rule.findUniqueOrThrow({ where: { id: ruleId } });

        const { ruleRepository } = wireMessageTriggerService(handle, branchId);
        const deleted = await ruleRepository.deleteIfTargetMatchesAndFenceJobs(
            branchId, expectedRuleFor(rule), "Rule deleted", fenceStartedAt,
        );
        if (deleted) {
            throw new Error("approved rule delete succeeded although a job was sent during the delete (fence missing)");
        }
        const stillThere = await handle.raw.message_trigger_rule.findUnique({ where: { id: ruleId } });
        if (!stillThere) throw new Error("rule was deleted although the fence refused");
        void sentJobId;
    });

    invariant("SI-SMS-02", "the approved rule-delete path cancels pending jobs and deletes the rule when nothing was sent", async () => {
        const { ruleId } = await seedBranchWithRule();
        const pendingJobId = await createJob(ruleId, "pending", `si-02-fence-pending-${Date.now()}`);
        const rule = await handle.raw.message_trigger_rule.findUniqueOrThrow({ where: { id: ruleId } });

        const { ruleRepository } = wireMessageTriggerService(handle, branchId);
        const deleted = await ruleRepository.deleteIfTargetMatchesAndFenceJobs(branchId, expectedRuleFor(rule), "Rule deleted");
        if (!deleted) throw new Error("approved rule delete refused a rule with only a pending job");
        const pendingJob = await handle.raw.message_trigger_job.findUnique({ where: { id: pendingJobId } });
        // The DB Cascade still erases the canceled rows once the rule row goes.
        if (pendingJob) {
            throw new Error(`expected the cascade to remove the canceled pending job, found status=${pendingJob.status}`);
        }
        const ruleGone = await handle.raw.message_trigger_rule.findUnique({ where: { id: ruleId } });
        if (ruleGone) throw new Error("rule was not deleted");
    });
});
