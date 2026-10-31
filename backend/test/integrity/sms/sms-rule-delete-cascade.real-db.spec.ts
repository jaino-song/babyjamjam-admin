import type { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { NotFoundException } from "@nestjs/common";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import {
    AGENT_SMS_RULE_ID_PREFIX,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { createBranch, createMessageTriggerJob, createMessageTriggerRule } from "../helpers/factories";
import { RowTracker } from "../helpers/tracker";
import { invariant } from "../helpers/known-defect";
import { deleteAreaRowsByBranch, wireMessageTriggerService } from "./sms-wiring.local";

/**
 * SI-SMS-02 — deleting a `message_trigger_rule` and its job history.
 *
 * `message_trigger_job.rule_id` carries `onDelete: Cascade` (schema.prisma), so
 * a hard rule delete erases every job of the rule — `sent` jobs included. The
 * approved delete path (`deleteIfTargetMatchesAndFenceJobs`) deliberately
 * refuses processing/dispatching jobs and sends with sent_at >= fenceStartedAt,
 * not older sent history. The plain `MessageTriggerService.deleteRule` path
 * (agent capabilities) now cancels pending jobs and soft-deletes the rule.
 * The Cascade FK is unchanged; no application delete path hard-deletes rules.
 */
describeReal("SMS rule deletion vs job history (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let branchId: string;
    const branchIds = new Set<string>();

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
    });

    afterAll(async () => {
        if (tracker) {
            await deleteAreaRowsByBranch(handle.raw, [...branchIds]);
            await tracker.cleanup(handle.raw);
        }
        if (handle) await closeIntegrityPrisma(handle);
    });

    async function seedBranchWithRule(): Promise<{ ruleId: string }> {
        const branchRow = await createBranch(handle.raw, tracker);
        branchId = branchRow.id;
        branchIds.add(branchId);
        const ruleRow = await createMessageTriggerRule(handle.raw, tracker, { branchId });
        return { ruleId: ruleRow.id };
    }

    async function createJob(ruleId: string, status: string, dedupeKey: string, sentAt?: Date, templateKey: MessageTriggerTemplateKey = MessageTriggerTemplateKey.SERVICE_START_REMINDER): Promise<MessageTriggerJobEntity["id"]> {
        const job = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            branchId,
            status: status as "pending",
            ...(status === "sent" ? { sentAt: sentAt ?? new Date() } : {}),
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey,
            dedupeKey,
        });
        return job.id;
    }

    invariant("SI-SMS-02", "deleting a rule through MessageTriggerService.deleteRule keeps sent-job history", async () => {
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
        expect(await handle.raw.message_trigger_job.findUnique({ where: { id: pendingJobId } })).toMatchObject({ status: "canceled" });
        expect(await handle.raw.message_trigger_rule.findUnique({ where: { id: ruleId } })).toMatchObject({ deletedAt: expect.any(Date), isActive: false, jobsStale: false });
    });

    invariant("SI-SMS-02", "deleting a rule through MessageTriggerService.deleteRule keeps its canceled-job audit trail", async () => {
        const { ruleId } = await seedBranchWithRule();
        const canceledJobId = await createJob(ruleId, "canceled", `si-02-canceled-${Date.now()}`);

        const { service } = wireMessageTriggerService(handle, branchId);
        await service.deleteRule(branchId, ruleId);

        const canceledJob = await handle.raw.message_trigger_job.findUnique({ where: { id: canceledJobId } });
        if (!canceledJob || canceledJob.status !== "canceled") {
            throw new Error(`canceled job history was erased by rule deletion: canceledJob=${canceledJob ? canceledJob.status : "GONE"}`);
        }
    });

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

    invariant("SI-SMS-02", "the approved rule-delete path cancels and retains pending jobs and soft-deletes the rule when nothing was sent", async () => {
        const { ruleId } = await seedBranchWithRule();
        const pendingJobId = await createJob(ruleId, "pending", `si-02-fence-pending-${Date.now()}`);
        const rule = await handle.raw.message_trigger_rule.findUniqueOrThrow({ where: { id: ruleId } });

        const { ruleRepository } = wireMessageTriggerService(handle, branchId);
        const deleted = await ruleRepository.deleteIfTargetMatchesAndFenceJobs(branchId, expectedRuleFor(rule), "Rule deleted");
        if (!deleted) throw new Error("approved rule delete refused a rule with only a pending job");
        const pendingJob = await handle.raw.message_trigger_job.findUnique({ where: { id: pendingJobId } });
        expect(pendingJob?.status).toBe("canceled");
        const retained = await handle.raw.message_trigger_rule.findUniqueOrThrow({ where: { id: ruleId } });
        expect(retained.deletedAt).toBeInstanceOf(Date);
        expect(retained.isActive).toBe(false);
        expect(retained.jobsStale).toBe(false);
    });

    invariant("SI-SMS-02", "a legacy soft-deleted default rule is never recovered or activated and the same default template can be recreated", async () => {
        const { ruleId } = await seedBranchWithRule();
        // Legacy tombstones can still exist; new default deletions are refused.
        await handle.raw.message_trigger_rule.update({ where: { id: ruleId }, data: { isDefault: true, deletedAt: new Date(), isActive: false, jobsStale: false } });
        const { service, ruleRepository } = wireMessageTriggerService(handle, branchId);

        expect((await ruleRepository.findInactiveDefaultRules()).map(({ id }) => id)).not.toContain(ruleId);
        expect((await ruleRepository.findStaleRules()).map(({ id }) => id)).not.toContain(ruleId);
        expect(await ruleRepository.findById(branchId, ruleId)).toBeNull();
        expect(await ruleRepository.findByIdIncludingGlobal(branchId, ruleId)).toBeNull();
        expect((await ruleRepository.findAll(branchId)).map(({ id }) => id)).not.toContain(ruleId);

        // Execute the actual scheduler recovery paths, not a replacement updater.
        const scheduler = service as unknown as { recoverApprovedBranches(): Promise<void>; processStaleRuleRebuilds(): Promise<void> };
        await scheduler.recoverApprovedBranches();
        await scheduler.processStaleRuleRebuilds();
        const activation = new MessageAutomationActivationService(handle.service, new MessageAutomationBranchLockService(handle.service), new AdminAuditEventWriter(handle.service));
        await expect(activation.activateRuleWithParent(branchId, ruleId, { actor: { userId: "10000000-0000-4000-8000-000000009161", globalRole: "owner" } })).rejects.toBeInstanceOf(NotFoundException);
        expect(await handle.raw.message_trigger_rule.findUnique({ where: { id: ruleId } })).toMatchObject({ deletedAt: expect.any(Date), isActive: false, jobsStale: false });

        const retained = await handle.raw.message_trigger_rule.findUniqueOrThrow({ where: { id: ruleId } });
        const recreated = await createMessageTriggerRule(handle.raw, tracker, { branchId, name: retained.name, templateKey: retained.templateKey, isDefault: true });
        expect(recreated.id).not.toBe(ruleId);
        expect((await ruleRepository.findAll(branchId)).map(({ id }) => id)).toContain(recreated.id);
        await expect(createMessageTriggerRule(handle.raw, tracker, { branchId, templateKey: retained.templateKey, isDefault: true })).rejects.toThrow();
    });

    for (const templateKey of [MessageTriggerTemplateKey.CLIENT_GREETING, MessageTriggerTemplateKey.SERVICE_INFO]) {
        for (const path of ["service", "approvedService", "delete", "deleteIfTargetMatches", "deleteIfTargetMatchesAndFenceJobs"] as const) {
            invariant("SI-SMS-02", `${path} refuses deleting a default ${templateKey} without changing its rule or jobs`, async () => {
                const { ruleId } = await seedBranchWithRule();
                const before = await handle.raw.message_trigger_rule.update({ where: { id: ruleId }, data: { templateKey, isDefault: true, jobsStale: true } });
                const jobId = await createJob(ruleId, "pending", `${ruleId}:default`);
                const jobBefore = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: jobId } });
                const { service, ruleRepository } = wireMessageTriggerService(handle, branchId);
                const expected = await ruleRepository.findById(branchId, ruleId);
                if (!expected) throw new Error("fixture rule missing");
                const refusal = { status: 409, response: { code: "MESSAGE_DEFAULT_RULE_DELETE_BLOCKED", message: "기본 문자 규칙은 삭제할 수 없어요. 대신 비활성화해 주세요." } };
                if (path === "service") {
                    await expect(service.deleteRule(branchId, ruleId)).rejects.toMatchObject(refusal);
                } else if (path === "approvedService") {
                    const snapshot = { ...before, createdAt: before.createdAt.toISOString(), updatedAt: before.updatedAt.toISOString() };
                    const version = (service as unknown as { ruleTargetVersion(rule: RuleEntity): string }).ruleTargetVersion(expected);
                    await expect(service.deleteRuleApprovedTarget(branchId, ruleId, version, snapshot)).rejects.toMatchObject(refusal);
                } else if (path === "delete") {
                    await ruleRepository.delete(branchId, ruleId);
                } else if (path === "deleteIfTargetMatches") {
                    expect(await ruleRepository.deleteIfTargetMatches(branchId, expected)).toBe(false);
                } else {
                    expect(await ruleRepository.deleteIfTargetMatchesAndFenceJobs(branchId, expected, "Rule deleted")).toBe(false);
                }
                expect(await handle.raw.message_trigger_rule.findUniqueOrThrow({ where: { id: ruleId } })).toEqual(before);
                expect(await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: jobId } })).toEqual(jobBefore);
            });
        }

        invariant("SI-SMS-02", `deactivate then list keeps default ${templateKey} inactive without creating rows or jobs`, async () => {
            const { ruleId } = await seedBranchWithRule();
            await handle.raw.message_trigger_rule.update({ where: { id: ruleId }, data: { templateKey, isDefault: true } });
            await createMessageTriggerRule(handle.raw, tracker, { branchId, isDefault: true, templateKey: templateKey === MessageTriggerTemplateKey.CLIENT_GREETING ? MessageTriggerTemplateKey.SERVICE_INFO : MessageTriggerTemplateKey.CLIENT_GREETING });
            const jobId = await createJob(ruleId, "pending", `${ruleId}:deactivate`);
            const { service } = wireMessageTriggerService(handle, branchId);
            await service.updateRule(branchId, ruleId, { isActive: false });
            const before = await handle.raw.message_trigger_rule.findMany({ where: { branchId }, orderBy: { id: "asc" } });
            const jobsBefore = await handle.raw.message_trigger_job.findMany({ where: { branchId }, orderBy: { id: "asc" } });
            expect(jobsBefore.find(({ id }) => id === jobId)?.status).toBe("canceled");
            expect((await service.listRules(branchId)).find(({ id }) => id === ruleId)?.isActive).toBe(false);
            expect(await handle.raw.message_trigger_rule.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(before);
            expect(await handle.raw.message_trigger_job.findMany({ where: { branchId }, orderBy: { id: "asc" } })).toEqual(jobsBefore);
        });
    }

    invariant("SI-SMS-02", "the target-matched delete retains history and cannot update or delete the tombstone again", async () => {
        const { ruleId } = await seedBranchWithRule();
        const sentJobId = await createJob(ruleId, "sent", `si-02-target-sent-${Date.now()}`);
        const canceledJobId = await createJob(ruleId, "canceled", `si-02-target-canceled-${Date.now()}`);
        const { ruleRepository } = wireMessageTriggerService(handle, branchId);
        const expected = await ruleRepository.findById(branchId, ruleId);
        if (!expected) throw new Error("fixture rule missing");
        expect(await ruleRepository.deleteIfTargetMatches(branchId, expected)).toBe(true);
        expect(await ruleRepository.deleteIfTargetMatches(branchId, expected)).toBe(false);
        await expect(ruleRepository.update(branchId, expected)).rejects.toThrow();
        expect(await handle.raw.message_trigger_job.count({ where: { id: { in: [sentJobId, canceledJobId] } } })).toBe(2);
        expect(await handle.raw.message_trigger_rule.findUnique({ where: { id: ruleId } })).toMatchObject({ deletedAt: expect.any(Date), isActive: false, jobsStale: false });
    });

    invariant("SI-SMS-02", "the approved delete retains old sent and canceled history alongside the canceled pending job", async () => {
        const { ruleId } = await seedBranchWithRule();
        const sentJobId = await createJob(ruleId, "sent", `si-02-approved-sent-${Date.now()}`, new Date(Date.now() - 60_000));
        const canceledJobId = await createJob(ruleId, "canceled", `si-02-approved-canceled-${Date.now()}`);
        const pendingJobId = await createJob(ruleId, "pending", `si-02-approved-pending-${Date.now()}`);
        const { ruleRepository } = wireMessageTriggerService(handle, branchId);
        const expected = await ruleRepository.findById(branchId, ruleId);
        if (!expected) throw new Error("fixture rule missing");
        expect(await ruleRepository.deleteIfTargetMatchesAndFenceJobs(branchId, expected, "Rule deleted", new Date())).toBe(true);
        for (const [id, status] of [[sentJobId, "sent"], [canceledJobId, "canceled"], [pendingJobId, "canceled"]]) {
            expect(await handle.raw.message_trigger_job.findUnique({ where: { id } })).toMatchObject({ status });
        }
    });

    invariant("SI-SMS-02", "deleted rules are excluded from active and stale readers and job claims even with stale activation flags", async () => {
        const { ruleId } = await seedBranchWithRule();
        const jobId = await createJob(ruleId, "pending", `si-02-deleted-claim-${Date.now()}`);
        const { ruleRepository, jobRepository } = wireMessageTriggerService(handle, branchId);
        // Simulate a stale writer: deletion is an independent eligibility fence.
        const rule = await handle.raw.message_trigger_rule.update({ where: { id: ruleId }, data: { deletedAt: new Date(), isActive: true, jobsStale: false } });
        expect((await ruleRepository.findActiveByEventTypes(branchId, [rule.eventType as Parameters<typeof ruleRepository.findActiveByEventTypes>[1][number]])).map(({ id }) => id)).not.toContain(ruleId);
        expect(await ruleRepository.findActiveTemplateKeys([rule.templateKey as MessageTriggerTemplateKey], branchId)).not.toContain(rule.templateKey);
        expect(await jobRepository.claimPendingWithRuleFence(jobId, branchId)).toBeNull();
        await handle.raw.message_trigger_rule.update({ where: { id: ruleId }, data: { jobsStale: true } });
        expect((await ruleRepository.findStaleRules()).map(({ id }) => id)).not.toContain(ruleId);
    });

    for (const path of ["service", "approvedService", "delete", "deleteIfTargetMatches", "deleteIfTargetMatchesAndFenceJobs"] as const) {
        invariant("SI-SMS-02", `${path} refuses the reserved agent rule and a new agent SMS remains claimable`, async () => {
            const branch = await createBranch(handle.raw, tracker);
            branchId = branch.id;
            branchIds.add(branchId);
            const ruleId = `${AGENT_SMS_RULE_ID_PREFIX}${branchId}`;
            const rule = await createMessageTriggerRule(handle.raw, tracker, { branchId, id: ruleId, isActive: false, templateKey: MessageTriggerTemplateKey.INFO });
            const { service, ruleRepository, jobRepository } = wireMessageTriggerService(handle, branchId);
            const existingJob = await createJob(ruleId, "pending", `${ruleId}:existing`, undefined, MessageTriggerTemplateKey.INFO);
            if (path === "service") {
                await expect(service.deleteRule(branchId, ruleId)).rejects.toBeInstanceOf(NotFoundException);
            } else if (path === "approvedService") {
                await expect(service.deleteRuleApprovedTarget(branchId, ruleId, "ignored", undefined)).rejects.toBeInstanceOf(NotFoundException);
            } else if (path === "delete") {
                await ruleRepository.delete(branchId, ruleId);
            } else if (path === "deleteIfTargetMatches") {
                expect(await ruleRepository.deleteIfTargetMatches(branchId, expectedRuleFor(rule))).toBe(false);
            } else {
                expect(await ruleRepository.deleteIfTargetMatchesAndFenceJobs(branchId, expectedRuleFor(rule), "Rule deleted")).toBe(false);
            }
            expect(await handle.raw.message_trigger_rule.findUniqueOrThrow({ where: { id: ruleId } })).toMatchObject({ deletedAt: null, isActive: false, jobsStale: false });
            expect(await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: existingJob } })).toMatchObject({ status: "pending" });
            const newJob = await createJob(ruleId, "pending", `${ruleId}:new`, undefined, MessageTriggerTemplateKey.INFO);
            expect(await jobRepository.claimPendingWithRuleFence(newJob, branchId)).not.toBeNull();
        });
    }

    invariant("SI-SMS-02", "disabling branch automation also cancels pending and processing jobs of soft-deleted rules", async () => {
        const { ruleId } = await seedBranchWithRule();
        const pendingId = await createJob(ruleId, "pending", `${ruleId}:deleted-pending`);
        const processingId = await createJob(ruleId, "pending", `${ruleId}:deleted-processing`);
        await handle.raw.message_trigger_job.update({ where: { id: processingId }, data: { status: "processing", claimToken: "deleted-rule-claim" } });
        await handle.raw.message_trigger_rule.update({ where: { id: ruleId }, data: { deletedAt: new Date(), isActive: false } });
        const activation = new MessageAutomationActivationService(handle.service, new MessageAutomationBranchLockService(handle.service), new AdminAuditEventWriter(handle.service));
        await activation.setTriggerDispatchEnabled(branchId, false, { userId: "10000000-0000-4000-8000-000000009161", globalRole: "owner" });
        for (const id of [pendingId, processingId]) {
            expect(await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "canceled", claimToken: null });
        }
    });
});
