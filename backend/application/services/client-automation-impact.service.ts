import { Inject, Injectable } from "@nestjs/common";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { MESSAGE_TRIGGER_JOB_REPOSITORY, type IMessageTriggerJobRepository, type MessageTriggerJobReviewSnapshot } from "domain/repositories/message-trigger-job.repository.interface";
import type { ClientAutomationImpact, ClientAutomationImpactPort, ClientAutomationWrite, ClientAutomationWriteValues } from "domain/ports/client-automation-impact.port";
import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import type { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";
import { agentAutomationScheduleIdentity, canonicalAgentAutomationEffects } from "application/agent/agent-automation-consent";
import { normalizePhone } from "application/utils/normalize-phone";
import { AligoDefaultSenderPolicyService } from "./aligo-default-sender-policy.service";
import { MessageTriggerService } from "./message-trigger.service";
import { SmsTriggerDeliveryService } from "./sms-trigger-delivery.service";
import { describeClientMessageEffect, type ClientMessageEffectPolicy, type ClientMessageLogicalSubject } from "./client-message-effect-recipe";
import { buildClientMessageRecipe, buildEmployeeAssignmentMessageRecipe, isMessageRecipeWithinMaterializationWindow,
    type ClientTriggerSource, type MessageTriggerJobRecipe } from "./message-trigger-recipes";

const VERSION = "client-automation-impact-v1";
const FIELDS = ["name", "phone", "type", "startDate", "endDate", "duration", "fullPrice", "grant", "actualPrice"] as const;
const CLIENT_EVENTS = new Set([MessageTriggerEventType.CLIENT_CREATED, MessageTriggerEventType.SERVICE_START, MessageTriggerEventType.SERVICE_END]);

/** Binding hashes accept JSON; materialization sources contain Date instances. */
function sourceHash(value: unknown): string {
    return agentBindingHash(JSON.parse(JSON.stringify(value)) as unknown);
}

/** A materialization timestamp and numeric create placeholder are not business source changes. */
function recipeSource(recipe: MessageTriggerJobRecipe | null, rule: MessageTriggerRuleEntity): string {
    return agentBindingHash(recipe ? {
        phone: normalizePhone(recipe.recipientPhone), name: recipe.payload.recipientName, variables: recipe.payload.templateVariables,
        scheduling: rule.offsetType === MessageTriggerOffsetType.IMMEDIATE ? "materialization-time" : recipe.scheduledFor.toISOString(),
        fingerprint: recipe.payload.employeeScheduleFingerprint ?? null,
    } : null);
}

function jobVersion(job: MessageTriggerJobReviewSnapshot): string {
    return sourceHash({ id: job.id, branchId: job.branchId, ruleId: job.ruleId, status: job.status,
        scheduledFor: job.scheduledFor, recipientPhone: job.recipientPhone, payload: job.payload,
        updatedAt: job.updatedAt, claimToken: job.claimToken, dedupeKey: job.dedupeKey, canceledByUser: job.canceledByUser });
}

/** A failed preview is a finite denial descriptor, never a sendable content recipe. */
function unavailableEffect(input: {
    branchId: string; subject: ClientMessageLogicalSubject; rule: MessageTriggerRuleEntity;
    recipe: MessageTriggerJobRecipe; policy: ClientMessageEffectPolicy; change: AgentAutomationEffect["change"];
    kind: AgentAutomationEffect["kind"]; scheduleIdentity?: string; reason: string;
}): AgentAutomationEffect {
    const { recipe, rule } = input;
    const recipientType = rule.recipientType === MessageTriggerRecipientType.CLIENT ? "client"
        : rule.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE ? "primary-employee" : "secondary-employee";
    return { kind: input.kind, ruleId: rule.id, scheduleId: recipe.employeeScheduleId ?? null,
        recipientType, templateKey: rule.templateKey as AgentAutomationEffect["templateKey"], change: input.change,
        recipientDigest: agentBindingHash({ subject: input.subject, branchId: input.branchId, type: rule.recipientType, receiver: normalizePhone(recipe.recipientPhone) }),
        sourceDigest: agentBindingHash({ subject: input.subject, recipe: recipeSource(recipe, rule), scheduleIdentity: input.scheduleIdentity ?? null }),
        templateDigest: agentBindingHash({ version: VERSION, unavailable: input.reason, templateKey: rule.templateKey }),
        policyDigest: agentBindingHash({ version: VERSION, ...input.policy }),
        recipeDigest: agentBindingHash({ version: VERSION, eventType: rule.eventType, offsetType: rule.offsetType,
            offsetDays: rule.offsetDays, sendTime: rule.sendTime }),
    };
}

/**
 * Reads a complete bounded customer-rule delta. No provision, enrichment, intent,
 * job, log or customer write is reachable here. The caller still owns target CAS,
 * question persistence, review, committed authority and materialization.
 */
@Injectable()
export class ClientAutomationImpactService implements ClientAutomationImpactPort {
    constructor(
        private readonly triggers: MessageTriggerService,
        private readonly delivery: SmsTriggerDeliveryService,
        private readonly sender: AligoDefaultSenderPolicyService,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY) private readonly jobs: IMessageTriggerJobRepository,
    ) {}

    async planClientWrite(branchId: string, write: ClientAutomationWrite): Promise<ClientAutomationImpact> {
        try {
            return await this.readPlan(branchId, write, new Date());
        } catch {
            // Read failures cannot become an empty effect set or expose source exception text.
            return this.unavailable("source-unavailable");
        }
    }

    private unavailable(reason: NonNullable<ClientAutomationImpact["reason"]>): ClientAutomationImpact {
        return { availability: "unavailable", reason, effects: [], complete: false, clientIdentity: null,
            sourceGuard: agentBindingHash({ version: VERSION, unavailable: reason }), affectedJobs: [] };
    }

    private async readPlan(branchId: string, write: ClientAutomationWrite, now: Date): Promise<ClientAutomationImpact> {
        const settings = await this.triggers.readClientAutomationSettings(branchId);
        if (settings.status !== "available") return this.unavailable("source-unavailable");
        // Dedicated system/manual producers have separate owners. Any other
        // active global rule cannot be silently omitted from a customer preview.
        if (settings.rules.some((rule) => rule.branchId === null && rule.isActive
            && !rule.id.startsWith("system:") && !rule.id.startsWith("agent-sms:"))) return this.unavailable("source-unavailable");
        const before = write.kind === "update" ? await this.triggers.readClientAutomationSource(branchId, write.clientId) : null;
        if (write.kind === "update" && (!before || before.id !== write.clientId || !before.createdAt)) return this.unavailable("source-unavailable");
        const clientIdentity = before ? sourceHash({ version: 1, resource: "client", id: before.id, createdAt: before.createdAt }) : null;
        const subject: ClientMessageLogicalSubject = write.kind === "create"
            ? { kind: "task-client", taskId: write.taskId }
            : { kind: "client", clientId: write.clientId, clientIdentity: clientIdentity! };
        const after = this.mergeSource(before, write.values, now);
        if (!after.name || !after.phone) return this.unavailable("missing-input");
        if (write.values.areaId !== undefined) {
            after.area = write.values.areaId === null ? null : await this.triggers.readClientAutomationArea(branchId, write.values.areaId);
            if (write.values.areaId !== null && after.area === undefined) return this.unavailable("source-unavailable");
        }
        const sender = this.sender.read();
        const policy: ClientMessageEffectPolicy = {
            dispatchEnabled: settings.dispatchEnabled, senderApproved: settings.senderApproved,
            senderIdentityDigest: sender.availability === "available" ? sender.identityDigest : null,
            senderApprovedAt: settings.senderApprovedAt?.toISOString() ?? null,
            pastTriggerEnabled: settings.pastTriggerEnabled, pastTriggerConfig: settings.pastTriggerConfig,
        };
        const rules = settings.rules.filter((rule) => rule.branchId === branchId && !rule.id.startsWith("system:") && !rule.id.startsWith("agent-sms:"));
        const jobs = before ? await this.jobs.findForClientAutomationReview(branchId, before.id, rules.map((rule) => rule.id)) : [];
        if (rules.length > 500 || jobs.length > 500 || jobs.some((job) => job.branchId !== branchId || job.clientId !== before!.id
            || typeof job.canceledByUser !== "boolean" || !rules.some((rule) => rule.id === job.ruleId))) return this.unavailable("source-unavailable");
        const effects: AgentAutomationEffect[] = [];
        const affected = new Map<string, MessageTriggerJobReviewSnapshot>();
        let reason: ClientAutomationImpact["reason"] = !settings.defaultsPresent ? "missing-default-rules" : undefined;
        let complete = true;
        const noteUnavailable = (next: NonNullable<ClientAutomationImpact["reason"]>): void => { reason ??= next; };

        for (const rule of rules.filter((entry) => CLIENT_EVENTS.has(entry.eventType))) {
            if (rule.recipientType !== MessageTriggerRecipientType.CLIENT) { noteUnavailable("source-unavailable"); complete = false; continue; }
            const oldRecipe = before ? buildClientMessageRecipe(rule, before, now) : null;
            const newRecipe = rule.isActive && settings.dispatchEnabled ? buildClientMessageRecipe(rule, after, now) : null;
            if (before && recipeSource(oldRecipe, rule) === recipeSource(newRecipe, rule)) continue;
            const scopeJobs = jobs.filter((job) => job.ruleId === rule.id && job.employeeScheduleId === null && !isManualMessageTriggerJob(job));
            const mutable = scopeJobs.filter((job) => job.status === "pending" || job.status === "processing");
            if (scopeJobs.some((job) => job.status === "dispatching")) { noteUnavailable("source-unavailable"); complete = false; continue; }
            const terminalDedupe = newRecipe && scopeJobs.some((job) => job.dedupeKey === newRecipe.dedupeKey
                && (["sent", "failed"].includes(job.status) || job.canceledByUser));
            const eligible = newRecipe && !terminalDedupe && (write.kind === "create"
                ? settings.pastTriggerEnabled || newRecipe.scheduledFor > now
                : mutable.length > 0 && rule.offsetType === MessageTriggerOffsetType.IMMEDIATE
                    || isMessageRecipeWithinMaterializationWindow(newRecipe, rule, false, now));
            if (!eligible && mutable.length === 0) continue;
            const change: AgentAutomationEffect["change"] = !eligible ? "cancel" : mutable.length ? "refresh" : "create";
            const recipe = eligible ? newRecipe! : oldRecipe;
            if (!recipe) { noteUnavailable("source-unavailable"); complete = false; continue; }
            const described = await describeClientMessageEffect({ branchId, subject, rule,
                client: eligible ? after : before!, change, policy, now, delivery: this.delivery });
            let effect: AgentAutomationEffect;
            if (described.status === "effect") effect = described.effect;
            else {
                const unavailable = described.status === "unavailable" ? described.reason : "source-unavailable";
                effect = unavailableEffect({ branchId, subject, rule, recipe, policy, change, kind: "client-rule", reason: unavailable });
                if (change !== "cancel") noteUnavailable(unavailable);
            }
            if (change === "cancel") effect = { ...effect, sourceDigest: agentBindingHash({ canceled: true, after: recipeSource(newRecipe, rule), previous: effect.sourceDigest }) };
            effects.push(effect);
            mutable.forEach((job) => affected.set(job.id, job));
        }

        // A client-name correction refreshes existing active schedule recipes. It
        // never changes the source fingerprint format of legacy assignment jobs.
        let schedules: Awaited<ReturnType<MessageTriggerService["readClientAutomationSchedules"]>> = [];
        const nameChanged = before && before.name !== after.name;
        const periodChanged = before && sourceHash([before.startDate, before.endDate]) !== sourceHash([after.startDate, after.endDate]);
        if (before && (nameChanged || periodChanged)) {
            schedules = await this.triggers.readClientAutomationSchedules(branchId, before.id);
            if (schedules.length > 500 || schedules.some((schedule) => schedule.branchId !== branchId || schedule.clientId !== before.id
                || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(schedule.incarnationId))) {
                return this.unavailable("source-unavailable");
            }
            if (periodChanged && schedules.length) { noteUnavailable("unsupported-content"); complete = false; }
            if (nameChanged) for (const schedule of schedules) for (const rule of rules.filter((entry) => entry.isActive && entry.eventType === MessageTriggerEventType.EMPLOYEE_ASSIGNED)) {
                if (rule.templateKey !== MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED
                    || ![MessageTriggerRecipientType.PRIMARY_EMPLOYEE, MessageTriggerRecipientType.SECONDARY_EMPLOYEE].includes(rule.recipientType)) {
                    noteUnavailable("source-unavailable"); complete = false; continue;
                }
                const recipe = buildEmployeeAssignmentMessageRecipe(rule, { ...schedule, client: { ...schedule.client, name: after.name } }, now);
                if (!recipe) continue;
                const previousJobs = jobs.filter((job) => job.ruleId === rule.id && job.employeeScheduleId === schedule.id);
                if (previousJobs.some((job) => job.status === "sent" && job.payload.employeeId === recipe.payload.employeeId && job.recipientType === recipe.recipientType)) continue;
                if (previousJobs.some((job) => job.status === "dispatching" || job.status === "failed")) { noteUnavailable("source-unavailable"); complete = false; continue; }
                const mutable = previousJobs.filter((job) => job.status === "pending" || job.status === "processing");
                // EMPLOYEE_ASSIGNED is currently retired. Keep the exact affected
                // scope for denial; no renderer/enrichment substitute grants yes.
                const scheduleIdentity = agentAutomationScheduleIdentity(schedule.incarnationId);
                effects.push(unavailableEffect({ branchId, subject, rule, recipe, policy, kind: "employee-assignment", scheduleIdentity,
                    change: mutable.length ? "refresh" : "create", reason: "unsupported-content" }));
                noteUnavailable("unsupported-content");
                mutable.forEach((job) => affected.set(job.id, job));
            }
        }
        if (effects.length > 500) return this.unavailable("source-unavailable");
        const canonical = canonicalAgentAutomationEffects(effects);
        return { availability: reason ? "unavailable" : canonical.length ? "available" : "none", ...(reason ? { reason } : {}),
            effects: canonical, complete, clientIdentity,
            sourceGuard: sourceHash({ version: VERSION, branchId, subject, before,
                after: write.kind === "create" ? { ...after, createdAt: "committed-client-creation" } : after, policy,
                rules: [...rules].sort((a, b) => a.id.localeCompare(b.id)),
                jobs: jobs.map((job) => ({ id: job.id, version: jobVersion(job) })).sort((a, b) => a.id.localeCompare(b.id)), schedules }),
            affectedJobs: [...affected.values()].map((job) => ({ id: job.id, version: jobVersion(job) })).sort((a, b) => a.id.localeCompare(b.id)) };
    }

    private mergeSource(before: ClientTriggerSource | null, values: ClientAutomationWriteValues, now: Date): ClientTriggerSource {
        const source: ClientTriggerSource = before ? { ...before } : {
            id: 0, name: "", phone: null, type: null, startDate: null, endDate: null, duration: null,
            fullPrice: null, grant: null, actualPrice: null, serviceEndNoticeSentAt: null, area: null, createdAt: now,
        };
        for (const field of FIELDS) if (values[field] !== undefined) Object.assign(source, { [field]: values[field] });
        return source;
    }
}
