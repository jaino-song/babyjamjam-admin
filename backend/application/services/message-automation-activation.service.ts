import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import {
    MESSAGE_AUTOMATION_DATABASE,
    MessageAutomationDatabase,
} from "domain/repositories/message-automation-database.repository.interface";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import {
    SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
} from "domain/constants/service-record-link-message";
import { isManualMessageTriggerJob, isManualMessageTriggerRule } from "domain/constants/message-trigger-job-ownership";
import { manualMessageTriggerJobPredicate } from "application/utils/message-trigger-job-ownership-sql";
import {
    AdminAuditActor,
    AdminAuditEventWriter,
} from "./admin-audit-event.service";
import { currentAdminAuditActor } from "./admin-audit-context";
import { MessageAutomationBranchLockService } from "./message-automation-branch-lock.service";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

export const MESSAGE_AUTOMATION_TRIGGER_DISPATCH_POLICY_ID = "trigger-dispatch" as const;
export const MESSAGE_AUTOMATION_PARENT_DISABLED_CODE = "MESSAGE_AUTOMATION_PARENT_DISABLED";
export const MESSAGE_AUTOMATION_PARENT_DISABLED_REASON = "Message automation parent disabled";

type AutomationTransaction = Prisma.TransactionClient;

type RuleRow = {
    id: string;
    branchId: string | null;
    name: string;
    isActive: boolean;
    eventType: string;
    offsetType: string;
    offsetDays: number;
    sendTime: string;
    recipientType: string;
    templateKey: string;
    isDefault: boolean;
    jobsStale: boolean;
    createdAt: Date;
    updatedAt: Date;
};

type JobLockRow = {
    id: string;
    rule_id: string;
    status: string;
    cancel_reason: string | null;
    dedupe_key: string;
};

type RetryRuleLockRow = {
    id: string;
    branch_id: string | null;
    is_active: boolean;
    template_key: string;
};

interface ActivationOptions {
    actor?: AdminAuditActor;
}

/**
 * Owns the branch-scoped message automation state transition.  Parent state,
 * child activation/overrides, mutable jobs and the audit event all share one
 * transaction held under the branch advisory lock.
 */
@Injectable()
export class MessageAutomationActivationService {
    constructor(
        @Inject(MESSAGE_AUTOMATION_DATABASE)
        private readonly prisma: MessageAutomationDatabase,
        private readonly branchLock: MessageAutomationBranchLockService,
        private readonly auditWriter: AdminAuditEventWriter,
    ) {}

    getParentKey(branchId: string): string {
        return `branch:${branchId}:message_policy:${MESSAGE_AUTOMATION_TRIGGER_DISPATCH_POLICY_ID}:enabled`;
    }

    async getTriggerDispatchEnabled(
        branchId: string,
        transaction?: AutomationTransaction,
    ): Promise<boolean> {
        const key = this.getParentKey(branchId);
        const client = transaction ?? this.prisma;
        const setting = await client.system_setting.findUnique({ where: { key } });
        return setting?.value === undefined ? true : setting.value === "true";
    }

    async assertTriggerDispatchEnabled(
        branchId: string,
        transaction?: AutomationTransaction,
    ): Promise<void> {
        if (!(await this.getTriggerDispatchEnabled(branchId, transaction))) {
            throw this.parentDisabledConflict();
        }
    }

    /**
     * Set the branch parent. Disabling first fences all local automatic rules,
     * global overrides and mutable automatic jobs in the same transaction.
     */
    async setTriggerDispatchEnabled(
        branchId: string,
        enabled: boolean,
        actor?: AdminAuditActor,
    ): Promise<SystemSettingEntity> {
        this.requireBranch(branchId);
        const effectiveActor = actor ?? currentAdminAuditActor();
        return this.branchLock.runExclusive(branchId, async (transaction) => {
            const key = this.getParentKey(branchId);
            const current = await transaction.system_setting.findUnique({ where: { key } });
            const currentEnabled = current?.value === undefined ? true : current.value === "true";
            const lockedRules = await this.lockAutomaticRules(branchId, transaction);
            if (!enabled || !currentEnabled) {
                await this.normalizeBranchOff(branchId, transaction, lockedRules);
            }

            let updated = current;
            const storedValue = String(enabled);
            if (!current || current.value !== storedValue) {
                updated = await transaction.system_setting.upsert({
                    where: { key },
                    create: { key, value: storedValue },
                    update: { value: storedValue, updatedAt: new Date() },
                });
            }

            if (!enabled || !current || current.value !== storedValue) {
                await this.appendAudit(transaction, effectiveActor, {
                    branchId,
                    targetId: key,
                    before: current ? { key, enabled: currentEnabled, valueDigest: digest(current.value) } : null,
                    after: { key, enabled, valueDigest: digest(updated!.value) },
                });
            }

            return new SystemSettingEntity(updated!.key, updated!.value, updated!.updatedAt);
        });
    }

    /**
     * Confirm one rule and its parent together. Both branch-owned rules and
     * branchless global rules are supported; global rows are represented by a
     * branch override and are never mutated by a branch activation.
     */
    async activateRuleWithParent(
        branchId: string,
        ruleId: string,
        options: ActivationOptions = {},
        transaction?: AutomationTransaction,
    ): Promise<MessageTriggerRuleEntity> {
        this.requireBranch(branchId);
        const actor = options.actor ?? currentAdminAuditActor();
        const activate = async (transactionClient: AutomationTransaction): Promise<MessageTriggerRuleEntity> => {
            const lockedRules = await this.lockAutomaticRules(branchId, transactionClient);
            const rule = lockedRules.find((candidate) => candidate.id === ruleId);
            if (!rule || (rule.branchId !== null && rule.branchId !== branchId)) {
                throw new NotFoundException(`Trigger rule ${ruleId} not found`);
            }
            this.assertAutomaticRule(rule.templateKey, ruleId);
            if (!rule.isActive && rule.branchId === null) {
                throw new ConflictException("Global rule is disabled");
            }

            const key = this.getParentKey(branchId);
            const parent = await transactionClient.system_setting.findUnique({ where: { key } });
            const parentWasEnabled = parent?.value === undefined ? true : parent.value === "true";
            if (!parentWasEnabled) {
                await this.normalizeBranchOff(branchId, transactionClient, lockedRules);
                await transactionClient.system_setting.upsert({
                    where: { key },
                    create: { key, value: "true" },
                    update: { value: "true", updatedAt: new Date() },
                });
            }

            const before = await this.readEffectiveRule(transactionClient, branchId, rule);
            if (rule.branchId === null) {
                const override = await transactionClient.message_trigger_rule_branch_override.findUnique({
                    where: { branchId_ruleId: { branchId, ruleId } },
                });
                if (override?.isActive !== true) {
                    await transactionClient.message_trigger_rule_branch_override.upsert({
                        where: { branchId_ruleId: { branchId, ruleId } },
                        create: { branchId, ruleId, isActive: true },
                        update: { isActive: true, updatedAt: new Date() },
                    });
                }
            } else {
                const currentRule = await transactionClient.message_trigger_rule.findUnique({ where: { id: ruleId } });
                if (currentRule?.isActive === true) {
                    // The selected local row was already active. Leave it alone
                    // so repeated confirmation is idempotent.
                } else {
                    await transactionClient.message_trigger_rule.update({
                        where: { id: ruleId },
                        data: { isActive: true, jobsStale: true, updatedAt: new Date() },
                    });
                }
            }

            const afterRule = await transactionClient.message_trigger_rule.findUnique({ where: { id: ruleId } });
            if (!afterRule) throw new NotFoundException(`Trigger rule ${ruleId} not found`);
            const after = await this.readEffectiveRule(transactionClient, branchId, afterRule);
            const parentChanged = !parentWasEnabled;
            const childChanged = before.isActive !== after.isActive;
            if (parentChanged || childChanged) {
                await this.appendAudit(transactionClient, actor, {
                    branchId,
                    targetId: ruleId,
                    before: {
                        parentEnabled: parentWasEnabled,
                        ruleId,
                        ruleBranchId: rule.branchId,
                        ruleActive: before.isActive,
                    },
                    after: {
                        parentEnabled: true,
                        ruleId,
                        ruleBranchId: rule.branchId,
                        ruleActive: after.isActive,
                    },
                });
            }
            return after;
        };
        return transaction ? activate(transaction) : this.branchLock.runExclusive(branchId, activate);
    }

    async setGlobalRuleBranchActivation(
        branchId: string,
        ruleId: string,
        isActive: boolean,
        actor?: AdminAuditActor,
    ): Promise<MessageTriggerRuleEntity> {
        this.requireBranch(branchId);
        const effectiveActor = actor ?? currentAdminAuditActor();
        return this.branchLock.runExclusive(branchId, async (transaction) => {
            const lockedRules = await this.lockAutomaticRules(branchId, transaction);
            const rule = lockedRules.find((candidate) => candidate.id === ruleId);
            if (!rule || rule.branchId !== null) throw new NotFoundException(`Trigger rule ${ruleId} not found`);
            this.assertAutomaticRule(rule.templateKey, ruleId);
            if (isActive && !rule.isActive) throw new ConflictException("Global rule is disabled");
            const parentEnabled = await this.getTriggerDispatchEnabled(branchId, transaction);
            if (isActive && !parentEnabled) throw this.parentDisabledConflict();

            const before = await this.readEffectiveRule(transaction, branchId, rule);

            await transaction.message_trigger_rule_branch_override.upsert({
                where: { branchId_ruleId: { branchId, ruleId } },
                create: { branchId, ruleId, isActive },
                update: { isActive, updatedAt: new Date() },
            });
            if (!isActive) await this.cancelRuleJobs(branchId, ruleId, transaction);
            const refreshed = await transaction.message_trigger_rule.findUnique({ where: { id: ruleId } });
            if (!refreshed) throw new NotFoundException(`Trigger rule ${ruleId} not found`);
            const after = await this.readEffectiveRule(transaction, branchId, refreshed);
            if (before.isActive !== after.isActive) {
                await this.appendAudit(transaction, effectiveActor, {
                    branchId,
                    targetId: this.getParentKey(branchId),
                    before: { ruleId, ruleActive: before.isActive, parentEnabled },
                    after: { ruleId, ruleActive: after.isActive, parentEnabled },
                });
            }
            return after;
        });
    }

    /**
     * Run an automatic retry's claim/provider-start boundary while holding the
     * branch lock. The callback must persist the retry row and mark provider
     * acceptance started through the supplied transaction before returning.
     */
    async runAutomaticRetryIfEnabled<T>(
        branchId: string,
        triggerJobId: string,
        work: (transaction: AutomationTransaction) => Promise<T>,
    ): Promise<{ allowed: boolean; applies: boolean; value?: T }> {
        this.requireBranch(branchId);
        return this.branchLock.runExclusive(branchId, async (transaction) => {
            const candidate = await transaction.message_trigger_job.findUnique({
                where: { id: triggerJobId },
                include: { rule: true },
            });
            if (!candidate || candidate.branchId !== branchId) {
                return { allowed: false, applies: true };
            }
            if (candidate.status === "canceled") return { allowed: false, applies: true };
            if (!this.isAutomaticJob(candidate.templateKey, candidate.ruleId, candidate.dedupeKey)) {
                return { allowed: true, applies: false };
            }

            // A global rule can be edited from another branch. Lock that rule
            // before re-reading the source job so a global disable cannot
            // commit between the activation check and provider-start callback.
            const ruleRows = await transaction.$queryRaw<RetryRuleLockRow[]>(Prisma.sql`
                SELECT id, branch_id, is_active, template_key
                FROM "message_trigger_rule"
                WHERE id = ${candidate.ruleId}
                ORDER BY id
                FOR UPDATE
            `);
            const lockedRule = ruleRows[0];
            const jobRows = await transaction.$queryRaw<Array<{
                id: string;
                branch_id: string;
                rule_id: string;
                status: string;
                dedupe_key: string;
            }>>(Prisma.sql`
                SELECT id, branch_id, rule_id, status, dedupe_key
                FROM "message_trigger_job"
                WHERE id = ${triggerJobId}
                FOR UPDATE
            `);
            const lockedJob = jobRows[0];
            const job = await transaction.message_trigger_job.findUnique({
                where: { id: triggerJobId },
                include: { rule: true },
            });
            if (
                !lockedRule
                || !lockedJob
                || !job
                || job.branchId !== branchId
                || job.ruleId !== lockedRule.id
                || job.status === "canceled"
                || lockedJob.status === "canceled"
            ) {
                return { allowed: false, applies: true };
            }
            if (!job.rule) return { allowed: false, applies: true };
            if (!(await this.getTriggerDispatchEnabled(branchId, transaction))) return { allowed: false, applies: true };
            const ruleActive = lockedRule.branch_id === null
                ? (lockedRule.is_active && (await transaction.message_trigger_rule_branch_override.findUnique({
                    where: { branchId_ruleId: { branchId, ruleId: lockedRule.id } },
                }))?.isActive !== false)
                : lockedRule.branch_id === branchId && lockedRule.is_active;
            if (!ruleActive) return { allowed: false, applies: true };
            return { allowed: true, applies: true, value: await work(transaction) };
        });
    }

    async normalizeBranchOff(
        branchId: string,
        transaction: AutomationTransaction,
        lockedRules?: RuleRow[],
    ): Promise<void> {
        const ruleRows = lockedRules ?? await this.lockAutomaticRules(branchId, transaction);
        const globalRuleIds: string[] = [];
        for (const rule of ruleRows) {
            if (isManualMessageTriggerRule(rule)) continue;
            if (rule.branchId === null) {
                globalRuleIds.push(rule.id);
                continue;
            }
            if (rule.isActive || !rule.jobsStale) {
                await transaction.message_trigger_rule.update({
                    where: { id: rule.id },
                    data: { isActive: false, jobsStale: true, updatedAt: new Date() },
                });
            }
        }
        for (const ruleId of globalRuleIds) {
            await transaction.message_trigger_rule_branch_override.upsert({
                where: { branchId_ruleId: { branchId, ruleId } },
                create: { branchId, ruleId, isActive: false },
                update: { isActive: false, updatedAt: new Date() },
            });
        }
        await this.cancelMutableJobs(branchId, transaction);
    }

    private async lockAutomaticRules(
        branchId: string,
        transaction: AutomationTransaction,
    ): Promise<RuleRow[]> {
        return transaction.$queryRaw<RuleRow[]>(Prisma.sql`
            SELECT
                id,
                branch_id AS "branchId",
                name,
                is_active AS "isActive",
                event_type AS "eventType",
                offset_type AS "offsetType",
                offset_days AS "offsetDays",
                send_time AS "sendTime",
                recipient_type AS "recipientType",
                template_key AS "templateKey",
                is_default AS "isDefault",
                jobs_stale AS "jobsStale",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
            FROM "message_trigger_rule"
            WHERE (branch_id = ${branchId}::uuid OR branch_id IS NULL)
            ORDER BY id
            FOR UPDATE
        `);
    }

    private async cancelMutableJobs(branchId: string, transaction: AutomationTransaction): Promise<void> {
        const manualJob = manualMessageTriggerJobPredicate({
            templateKey: Prisma.sql`j.template_key`, ruleId: Prisma.sql`j.rule_id`, dedupeKey: Prisma.sql`j.dedupe_key`,
        });
        const rows = await transaction.$queryRaw<JobLockRow[]>(Prisma.sql`
            SELECT
                j.id,
                j.rule_id,
                j.status,
                j.cancel_reason,
                j.dedupe_key
            FROM "message_trigger_job" j
            JOIN "message_trigger_rule" r ON r.id = j.rule_id
            WHERE j.branch_id = ${branchId}::uuid
              AND NOT ${manualJob}
              AND (
                    j.status IN ('pending', 'processing')
                    OR (
                        j.status = 'failed'
                        AND j.rule_id = ${SERVICE_RECORD_LINK_RULE_ID}
                        AND j.cancel_reason = ${SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON}
                    )
              )
            ORDER BY j.id
            FOR UPDATE
        `);
        const canceledAt = new Date();
        for (const row of rows) {
            const reason = row.rule_id === SERVICE_RECORD_LINK_RULE_ID
                && row.status === "failed"
                && row.cancel_reason === SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON
                ? SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON
                : MESSAGE_AUTOMATION_PARENT_DISABLED_REASON;
            await transaction.message_trigger_job.update({
                where: { id: row.id },
                data: {
                    status: "canceled",
                    canceledAt,
                    cancelReason: reason,
                    canceledByUser: false,
                    claimToken: null,
                    nextAttemptAt: null,
                    updatedAt: canceledAt,
                },
            });
        }
    }

    private async cancelRuleJobs(
        branchId: string,
        ruleId: string,
        transaction: AutomationTransaction,
    ): Promise<void> {
        const manualJob = manualMessageTriggerJobPredicate({
            templateKey: Prisma.sql`template_key`, ruleId: Prisma.sql`rule_id`, dedupeKey: Prisma.sql`dedupe_key`,
        });
        const rows = await transaction.$queryRaw<Array<{ id: string; status: string; cancel_reason: string | null }>>(Prisma.sql`
            SELECT id, status, cancel_reason
            FROM "message_trigger_job"
            WHERE branch_id = ${branchId}::uuid
              AND rule_id = ${ruleId}
              AND NOT ${manualJob}
              AND (
                    status IN ('pending', 'processing')
                    OR (status = 'failed' AND cancel_reason = ${SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON})
              )
            ORDER BY id
            FOR UPDATE
        `);
        const now = new Date();
        for (const row of rows) {
            await transaction.message_trigger_job.update({
                where: { id: row.id },
                data: {
                    status: "canceled",
                    canceledAt: now,
                    cancelReason: row.cancel_reason === SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON
                        ? SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON
                        : MESSAGE_AUTOMATION_PARENT_DISABLED_REASON,
                    canceledByUser: false,
                    claimToken: null,
                    nextAttemptAt: null,
                    updatedAt: now,
                },
            });
        }
    }

    private async readEffectiveRule(
        transaction: AutomationTransaction,
        branchId: string,
        rule: RuleRow,
    ): Promise<MessageTriggerRuleEntity> {
        const override = rule.branchId === null
            ? await transaction.message_trigger_rule_branch_override.findUnique({
                where: { branchId_ruleId: { branchId, ruleId: rule.id } },
            })
            : null;
        const entity = this.toEntity(rule);
        if (rule.branchId === null) {
            entity.isLockedByGlobal = !rule.isActive;
            entity.isActive = rule.isActive && override?.isActive !== false;
        }
        return entity;
    }

    private toEntity(row: RuleRow): MessageTriggerRuleEntity {
        return MessageTriggerRuleEntity.reconstitute(
            row.id,
            row.branchId,
            row.name,
            row.isActive,
            row.eventType as MessageTriggerRuleEntity["eventType"],
            row.offsetType as MessageTriggerRuleEntity["offsetType"],
            row.offsetDays,
            row.recipientType as MessageTriggerRuleEntity["recipientType"],
            row.templateKey as MessageTriggerRuleEntity["templateKey"],
            new Date(row.createdAt),
            new Date(row.updatedAt),
            row.isDefault,
            row.jobsStale,
            row.sendTime,
        );
    }

    private assertAutomaticRule(templateKey: string, ruleId: string): void {
        if (isManualMessageTriggerRule({ templateKey, id: ruleId })) {
            throw new BadRequestException(`Rule ${ruleId} is a manual message rule`);
        }
    }

    private isAutomaticJob(templateKey: string, ruleId: string, dedupeKey: string): boolean {
        return !isManualMessageTriggerJob({ templateKey, ruleId, dedupeKey });
    }

    private parentDisabledConflict(): ConflictException {
        return new ConflictException({
            code: MESSAGE_AUTOMATION_PARENT_DISABLED_CODE,
            message: "Message automation parent is disabled",
        });
    }

    private requireBranch(branchId: string): void {
        if (!branchId || !branchId.trim()) throw new BadRequestException("Branch is required");
    }

    private async appendAudit(
        transaction: AutomationTransaction,
        actor: AdminAuditActor | undefined,
        params: {
            branchId: string;
            targetId: string;
            before: unknown;
            after: unknown;
        },
    ): Promise<void> {
        if (!actor?.userId) throw new Error("Authenticated actor is required for audited message automation mutations");
        await this.auditWriter.append(transaction, {
            actor,
            branchId: params.branchId,
            action: "system_setting.message_policy_activation.updated",
            targetType: "system_setting",
            targetId: params.targetId,
            before: params.before,
            after: params.after,
            outcome: "success",
            source: "backend",
        });
    }
}

function digest(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
