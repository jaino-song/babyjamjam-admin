import type { Prisma } from "@prisma/client";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { MESSAGE_TRIGGER_JOB_REPOSITORY, type IMessageTriggerJobRepository, type MessageTriggerJobReviewSnapshot } from "domain/repositories/message-trigger-job.repository.interface";
import type { ClientAutomationImpact, ClientAutomationImpactPort, ClientAutomationWrite, ClientAutomationWriteValues } from "domain/ports/client-automation-impact.port";
import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SERVICE_RECORD_LINK_RULE_ID, getServiceRecordLinkScheduledFor } from "domain/constants/service-record-link-message";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";
import { agentAutomationScheduleIdentity, canonicalAgentAutomationEffects } from "application/agent/agent-automation-consent";
import { normalizePhone } from "application/utils/normalize-phone";
import { AligoDefaultSenderPolicyService } from "./aligo-default-sender-policy.service";
import { ClientAutomationSourceReader, type ClientAutomationServiceRecordLinkSource } from "./client-automation-source.reader";
import { SmsTriggerDeliveryService } from "./sms-trigger-delivery.service";
import { describeClientMessageEffect, type ClientMessageEffectPolicy, type ClientMessageLogicalSubject } from "./client-message-effect-recipe";
import { buildClientMessageRecipe, buildEmployeeAssignmentMessageRecipe, isMessageRecipeWithinMaterializationWindow,
    shouldSkipClientPreStartCatchUp,
    type ClientTriggerSource, type MessageTriggerJobRecipe } from "./message-trigger-recipes";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    buildServiceRecordLinkPayload,
    DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL,
    describeServiceRecordLinkEffect,
} from "./service-record-link-automation-effect-recipe";

const VERSION = "client-automation-impact-v1";
const FIELDS = ["name", "phone", "type", "startDate", "endDate", "duration", "fullPrice", "grant", "actualPrice"] as const;
const CLIENT_EVENTS = new Set([MessageTriggerEventType.CLIENT_CREATED, MessageTriggerEventType.SERVICE_START, MessageTriggerEventType.SERVICE_END]);

/** Binding hashes accept JSON; materialization sources contain Date instances. */
function sourceHash(value: unknown): string {
    return agentBindingHash(JSON.parse(JSON.stringify(value)) as unknown);
}

/** A materialization timestamp and numeric create placeholder are not business source changes. */
function recipeSource(recipe: MessageTriggerJobRecipe | null, rule: MessageTriggerRuleEntity, subject?: ClientMessageLogicalSubject): string {
    return agentBindingHash(recipe ? {
        phone: normalizePhone(recipe.recipientPhone), name: recipe.payload.recipientName, variables: recipe.payload.templateVariables,
        scheduling: rule.offsetType === MessageTriggerOffsetType.IMMEDIATE ? "materialization-time"
            : subject?.kind === "task-client" && rule.eventType === MessageTriggerEventType.CLIENT_CREATED ? "committed-client-creation"
                : recipe.scheduledFor.toISOString(),
        fingerprint: recipe.payload.employeeScheduleFingerprint ?? null,
    } : null);
}

function jobVersion(job: MessageTriggerJobReviewSnapshot): string {
    return sourceHash({ id: job.id, branchId: job.branchId, ruleId: job.ruleId, status: job.status,
        scheduledFor: job.scheduledFor, recipientPhone: job.recipientPhone, payload: job.payload,
        updatedAt: job.updatedAt, claimToken: job.claimToken, dedupeKey: job.dedupeKey, canceledByUser: job.canceledByUser });
}

function validDate(value: Date): boolean {
    return value instanceof Date && !Number.isNaN(value.getTime());
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
        sourceDigest: agentBindingHash({ subject: input.subject, recipe: recipeSource(recipe, rule, input.subject), scheduleIdentity: input.scheduleIdentity ?? null }),
        templateDigest: agentBindingHash({ version: VERSION, unavailable: input.reason, templateKey: rule.templateKey }),
        policyDigest: agentBindingHash({ version: VERSION, ...input.policy }),
        recipeDigest: agentBindingHash({ version: VERSION, eventType: rule.eventType, offsetType: rule.offsetType,
            offsetDays: rule.offsetDays, sendTime: rule.sendTime }),
    };
}

/**
 * Keep a dedicated schedule/link scope in the reviewed artifact even when the
 * opaque service-record token or its global rule has not been provisioned yet.
 * The descriptor is deliberately digest-only: it can support a deny/no-send
 * coverage record, but it can never be promoted to a sendable recipe.
 */
function unavailableServiceRecordLinkEffect(input: {
    branchId: string;
    subject: ClientMessageLogicalSubject;
    link: ClientAutomationServiceRecordLinkSource;
    policy: ClientMessageEffectPolicy;
    change: AgentAutomationEffect["change"];
    reason: string;
}): AgentAutomationEffect {
    const schedule = input.link.schedule;
    const employee = schedule.primaryEmployee;
    const scheduleIdentity = (() => {
        try { return agentAutomationScheduleIdentity(schedule.incarnationId); } catch { return null; }
    })();
    const scheduledFor = validDate(schedule.startDate) ? getServiceRecordLinkScheduledFor(schedule.startDate).toISOString() : null;
    return {
        kind: "service-record-link",
        ruleId: SERVICE_RECORD_LINK_RULE_ID,
        scheduleId: schedule.id,
        recipientType: "primary-employee",
        templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        change: input.change,
        recipientDigest: agentBindingHash({
            branchId: input.branchId,
            subject: input.subject,
            recipientType: "primary-employee",
            receiver: normalizePhone(employee?.phone ?? "") || null,
        }),
        sourceDigest: agentBindingHash({
            version: VERSION,
            branchId: input.branchId,
            subject: input.subject,
            schedule: {
                id: schedule.id,
                incarnationId: scheduleIdentity,
                clientId: schedule.clientId,
                primaryEmployeeId: schedule.primaryEmployeeId,
                startDate: validDate(schedule.startDate) ? schedule.startDate.toISOString() : null,
                endDate: validDate(schedule.endDate) ? schedule.endDate.toISOString() : null,
            },
            serviceRecordCaseId: input.link.serviceRecordCase?.id ?? null,
            tokenState: input.link.token ? "present-but-unusable" : "missing",
        }),
        templateDigest: agentBindingHash({
            version: VERSION,
            unavailable: input.reason,
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        }),
        policyDigest: agentBindingHash({ version: VERSION, ...input.policy }),
        recipeDigest: agentBindingHash({
            version: VERSION,
            operation: "service-record-link",
            scheduledFor,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.SAME_DAY,
            offsetDays: 0,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            scheduleIdentity,
            reason: input.reason,
        }),
    };
}

function defaultServiceRecordLinkRule(): MessageTriggerRuleEntity {
    const epoch = new Date(0);
    return MessageTriggerRuleEntity.reconstitute(
        SERVICE_RECORD_LINK_RULE_ID,
        null,
        "제공기록지 링크",
        true,
        MessageTriggerEventType.SERVICE_START,
        MessageTriggerOffsetType.SAME_DAY,
        0,
        MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
        MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        epoch,
        epoch,
        false,
        false,
        "15:00",
    );
}

/**
 * Reads a complete bounded customer-rule delta. No provision, enrichment, intent,
 * job, log or customer write is reachable here. The caller still owns target CAS,
 * question persistence, review, committed authority and materialization.
 */
@Injectable()
export class ClientAutomationImpactService implements ClientAutomationImpactPort {
    constructor(
        private readonly sources: ClientAutomationSourceReader,
        private readonly delivery: SmsTriggerDeliveryService,
        private readonly sender: AligoDefaultSenderPolicyService,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY) private readonly jobs: IMessageTriggerJobRepository,
        @Optional() private readonly configService?: ConfigService,
    ) {}

    async planClientWrite(branchId: string, write: ClientAutomationWrite): Promise<ClientAutomationImpact> {
        try {
            return await this.readPlan(branchId, write, new Date());
        } catch {
            // Read failures cannot become an empty effect set or expose source exception text.
            return this.unavailable("source-unavailable");
        }
    }

    /** Final source check inside the caller's existing branch automation transaction. */
    async planClientWriteInTransaction(transaction: Prisma.TransactionClient, branchId: string, write: ClientAutomationWrite): Promise<ClientAutomationImpact> {
        try { return await this.readPlan(branchId, write, new Date(), transaction); }
        catch { return this.unavailable("source-unavailable"); }
    }

    private unavailable(reason: NonNullable<ClientAutomationImpact["reason"]>): ClientAutomationImpact {
        return { availability: "unavailable", reason, effects: [], grandfatheredEffects: [], complete: false, clientIdentity: null,
            sourceGuard: agentBindingHash({ version: VERSION, unavailable: reason }), affectedJobs: [] };
    }

    private async readPlan(branchId: string, write: ClientAutomationWrite, now: Date, transaction?: Prisma.TransactionClient): Promise<ClientAutomationImpact> {
        const settings = transaction ? await this.sources.readClientAutomationSettings(branchId, transaction)
            : await this.sources.readClientAutomationSettings(branchId);
        if (settings.status !== "available") return this.unavailable("source-unavailable");
        // Dedicated system/manual producers have separate owners. Any other
        // active global rule cannot be silently omitted from a customer preview.
        if (settings.rules.some((rule) => rule.branchId === null && rule.isActive
            && !rule.id.startsWith("system:") && !rule.id.startsWith("agent-sms:"))) return this.unavailable("source-unavailable");
        const before = write.kind === "update" ? (transaction ? await this.sources.readClientAutomationSource(branchId, write.clientId, transaction)
            : await this.sources.readClientAutomationSource(branchId, write.clientId)) : null;
        if (write.kind === "update" && (!before || before.id !== write.clientId || !before.createdAt)) return this.unavailable("source-unavailable");
        const clientIdentity = before ? sourceHash({ version: 1, resource: "client", id: before.id, createdAt: before.createdAt }) : null;
        const subject: ClientMessageLogicalSubject = write.kind === "create"
            ? { kind: "task-client", taskId: write.taskId }
            : { kind: "client", clientId: write.clientId, clientIdentity: clientIdentity! };
        const after = this.mergeSource(before, write.values, now);
        if (!after.name || !after.phone) return this.unavailable("missing-input");
        if (write.values.areaId !== undefined) {
            after.area = write.values.areaId === null ? null : (transaction ? await this.sources.readClientAutomationArea(branchId, write.values.areaId, transaction)
                : await this.sources.readClientAutomationArea(branchId, write.values.areaId));
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
        const serviceRecordRule = settings.rules.find((rule) => rule.id === SERVICE_RECORD_LINK_RULE_ID && rule.branchId === null);
        // Keep the dedicated operation in the review/source guard even before
        // the global rule is provisioned. This prevents a later reconciliation
        // from inheriting a task mutation through an unreviewed legacy path.
        const serviceRecordReviewRule = serviceRecordRule ?? defaultServiceRecordLinkRule();
        const reviewRules = [...rules, serviceRecordReviewRule];
        const reviewRuleIds = reviewRules.map((rule) => rule.id);
        const jobs = before ? (transaction ? await this.jobs.findForClientAutomationReview(branchId, before.id, reviewRuleIds, transaction)
            : await this.jobs.findForClientAutomationReview(branchId, before.id, reviewRuleIds)) : [];
        if (reviewRules.length > 500 || jobs.length > 500 || jobs.some((job) => job.branchId !== branchId || job.clientId !== before!.id
            || typeof job.canceledByUser !== "boolean" || !reviewRules.some((rule) => rule.id === job.ruleId))) return this.unavailable("source-unavailable");
        const effects: AgentAutomationEffect[] = [];
        const grandfatheredEffects: AgentAutomationEffect[] = [];
        const affected = new Map<string, MessageTriggerJobReviewSnapshot>();
        let reason: ClientAutomationImpact["reason"] = !settings.defaultsPresent ? "missing-default-rules" : undefined;
        let complete = true;
        const noteUnavailable = (next: NonNullable<ClientAutomationImpact["reason"]>): void => { reason ??= next; };

        for (const rule of rules.filter((entry) => CLIENT_EVENTS.has(entry.eventType))) {
            if (rule.recipientType !== MessageTriggerRecipientType.CLIENT) { noteUnavailable("source-unavailable"); complete = false; continue; }
            const oldRecipe = before ? buildClientMessageRecipe(rule, before, now) : null;
            const newRecipe = rule.isActive && settings.dispatchEnabled ? buildClientMessageRecipe(rule, after, now) : null;
            if (before && recipeSource(oldRecipe, rule) === recipeSource(newRecipe, rule)) {
                // A task coverage record fences newly introduced rules, but it
                // must not suppress an unchanged rule that was already
                // independently authorized. Keep its exact current recipe as
                // a grandfathered member of the same operation family.
                if (oldRecipe) {
                    const described = await describeClientMessageEffect({ branchId, subject, rule,
                        client: before, change: "refresh", policy, now, delivery: transaction
                            ? { resolveCanonicalDeliverySnapshot: (job) => this.delivery.resolveCanonicalDeliverySnapshot(job, transaction) } : this.delivery });
                    if (described.status === "effect") grandfatheredEffects.push(described.effect);
                }
                continue;
            }
            const scopeJobs = jobs.filter((job) => job.ruleId === rule.id && job.employeeScheduleId === null && !isManualMessageTriggerJob(job));
            const mutable = scopeJobs.filter((job) => job.status === "pending" || job.status === "processing");
            if (scopeJobs.some((job) => job.status === "dispatching")) { noteUnavailable("source-unavailable"); complete = false; continue; }
            const processingImmediate = rule.offsetType === MessageTriggerOffsetType.IMMEDIATE && mutable.some((job) => job.status === "processing");
            if (processingImmediate && mutable.some((job) => job.status === "pending")) {
                // One operation cannot claim both refresh and cancellation in the
                // current public summary; refuse the mixed transition explicitly.
                noteUnavailable("source-unavailable"); complete = false; continue;
            }
            const terminalDedupe = newRecipe && scopeJobs.some((job) => job.dedupeKey === newRecipe.dedupeKey
                && (["sent", "failed"].includes(job.status) || job.canceledByUser));
            const eligible = newRecipe && !terminalDedupe && (write.kind === "create"
                ? !shouldSkipClientPreStartCatchUp(rule, after, now) && (settings.pastTriggerEnabled || newRecipe.scheduledFor > now)
                : !processingImmediate && mutable.some((job) => job.status === "pending") && rule.offsetType === MessageTriggerOffsetType.IMMEDIATE
                    || isMessageRecipeWithinMaterializationWindow(newRecipe, rule, false, now));
            if (!eligible && mutable.length === 0) continue;
            const change: AgentAutomationEffect["change"] = !eligible ? "cancel" : mutable.length ? "refresh" : "create";
            const recipe = eligible ? newRecipe! : oldRecipe;
            if (!recipe) { noteUnavailable("source-unavailable"); complete = false; continue; }
            const described = await describeClientMessageEffect({ branchId, subject, rule,
                client: eligible ? after : before!, change, policy, now, delivery: transaction
                    ? { resolveCanonicalDeliverySnapshot: (job) => this.delivery.resolveCanonicalDeliverySnapshot(job, transaction) } : this.delivery });
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
        let schedules: Awaited<ReturnType<ClientAutomationSourceReader["readClientAutomationSchedules"]>> = [];
        let serviceRecordLinks: Awaited<ReturnType<ClientAutomationSourceReader["readClientAutomationServiceRecordLinks"]>> = [];
        const nameChanged = before && before.name !== after.name;
        const periodChanged = before && sourceHash([before.startDate, before.endDate]) !== sourceHash([after.startDate, after.endDate]);
        if (before && (nameChanged || periodChanged)) {
            schedules = transaction ? await this.sources.readClientAutomationSchedules(branchId, before.id, transaction)
                : await this.sources.readClientAutomationSchedules(branchId, before.id);
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
                if (previousJobs.some((job) => job.canceledByUser && job.dedupeKey === recipe.dedupeKey)) continue;
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

            // The service-record-link owner uses the same customer task
            // authority as generic rules, but it has a dedicated recipe and
            // current token/case sources. A name correction changes the link
            // body, so the latest active schedule must be reviewed again.
            if (nameChanged && typeof this.sources.readClientAutomationServiceRecordLinks === "function") {
                serviceRecordLinks = transaction
                    ? await this.sources.readClientAutomationServiceRecordLinks(branchId, before.id, transaction)
                    : await this.sources.readClientAutomationServiceRecordLinks(branchId, before.id);
                if (serviceRecordLinks.length > 500) return this.unavailable("source-unavailable");

                const latestScheduleId = serviceRecordLinks.at(-1)?.schedule.id ?? null;
                for (const link of serviceRecordLinks) {
                    const schedule = link.schedule;
                    const previousJobs = jobs.filter((job) => job.ruleId === SERVICE_RECORD_LINK_RULE_ID
                        && job.employeeScheduleId === schedule.id && !isManualMessageTriggerJob(job));
                    const mutable = previousJobs.filter((job) => job.status === "pending" || job.status === "processing");
                    if (previousJobs.some((job) => job.status === "dispatching" || job.status === "failed")) {
                        noteUnavailable("source-unavailable"); complete = false; continue;
                    }
                    // ServiceRecordLinkService and the authority resolver use
                    // the newest active assignment as the canonical provider.
                    // Older rows are left untouched unless they already have a
                    // mutable job, in which case review must fail closed.
                    if (latestScheduleId !== null && schedule.id !== latestScheduleId) {
                        if (mutable.length > 0) { noteUnavailable("source-unavailable"); complete = false; }
                        continue;
                    }
                    let scheduleIdentity: string;
                    try {
                        scheduleIdentity = agentAutomationScheduleIdentity(schedule.incarnationId);
                    } catch {
                        // An invalid incarnation cannot safely anchor a deny/no-send
                        // coverage row. Keep this source incomplete.
                        noteUnavailable("source-unavailable"); complete = false; continue;
                    }
                    if (!validDate(schedule.startDate) || !validDate(schedule.endDate)) {
                        // A malformed date changes the operation identity. Do not
                        // manufacture an unavailable effect from an untrusted row.
                        noteUnavailable("source-unavailable"); complete = false; continue;
                    }
                    const unavailableChange: AgentAutomationEffect["change"] = mutable.length ? "refresh" : "create";
                    if (!serviceRecordRule) {
                        effects.push(unavailableServiceRecordLinkEffect({ branchId, subject, link,
                            policy, change: unavailableChange, reason: "missing-system-rule" }));
                        noteUnavailable("source-unavailable");
                        mutable.forEach((job) => affected.set(job.id, job));
                        continue;
                    }
                    if (!link.token || !schedule.primaryEmployee) {
                        effects.push(unavailableServiceRecordLinkEffect({ branchId, subject, link,
                            policy, change: unavailableChange, reason: link.token ? "missing-recipient" : "missing-link-token" }));
                        noteUnavailable("source-unavailable");
                        mutable.forEach((job) => affected.set(job.id, job));
                        continue;
                    }
                    const recipe = this.buildServiceRecordLinkRecipe(branchId, serviceRecordRule, link, after.name, now);
                    if (!recipe) {
                        effects.push(unavailableServiceRecordLinkEffect({ branchId, subject, link,
                            policy, change: unavailableChange, reason: "link-recipe-unavailable" }));
                        noteUnavailable("source-unavailable");
                        mutable.forEach((job) => affected.set(job.id, job));
                        continue;
                    }
                    const terminalDedupe = previousJobs.some((job) => job.dedupeKey === recipe.dedupeKey
                        && (["sent", "failed"].includes(job.status) || job.canceledByUser));
                    const eligible = !terminalDedupe && (settings.pastTriggerEnabled || recipe.scheduledFor > now);
                    if (!eligible && mutable.length === 0) continue;
                    const change: AgentAutomationEffect["change"] = !eligible ? "cancel" : mutable.length ? "refresh" : "create";
                    const previewRecipe = this.buildServiceRecordLinkRecipe(branchId, serviceRecordRule, link, after.name, now);
                    if (!previewRecipe) {
                        effects.push(unavailableServiceRecordLinkEffect({ branchId, subject, link,
                            policy, change, reason: "link-recipe-unavailable" }));
                        noteUnavailable("source-unavailable");
                        mutable.forEach((job) => affected.set(job.id, job));
                        continue;
                    }
                    let described: AgentAutomationEffect | null = null;
                    try {
                        const deliveryJob = MessageTriggerJobEntity.create(previewRecipe);
                        const snapshot = transaction
                            ? await this.delivery.resolveCanonicalDeliverySnapshot(deliveryJob, transaction)
                            : await this.delivery.resolveCanonicalDeliverySnapshot(deliveryJob);
                        described = describeServiceRecordLinkEffect({
                            branchId,
                            subject,
                            rule: serviceRecordRule,
                            schedule: { ...schedule, client: { ...schedule.client, name: after.name } },
                            serviceRecordCase: link.serviceRecordCase,
                            token: link.token,
                            scheduleIdentity,
                            serviceRecordUrl: previewRecipe.payload.buttonUrl as string,
                            sourcePayload: previewRecipe.payload as unknown as Record<string, unknown>,
                            scheduledFor: previewRecipe.scheduledFor,
                            dedupeKey: previewRecipe.dedupeKey,
                            snapshot,
                            change,
                            policy,
                            now,
                        });
                    } catch {
                        described = null;
                    }
                    if (!described) {
                        const unavailableReason = change === "cancel"
                            ? "source-unavailable"
                            : policy.dispatchEnabled && policy.senderApproved ? "unsupported-content" : "sender-unavailable";
                        effects.push(unavailableServiceRecordLinkEffect({ branchId, subject, link,
                            policy, change, reason: unavailableReason }));
                        noteUnavailable(unavailableReason);
                        mutable.forEach((job) => affected.set(job.id, job));
                        continue;
                    }
                    effects.push(described);
                    mutable.forEach((job) => affected.set(job.id, job));
                }
            }
        }
        if (effects.length > 500) return this.unavailable("source-unavailable");
        const canonical = canonicalAgentAutomationEffects(effects);
        return { availability: reason ? "unavailable" : canonical.length ? "available" : "none", ...(reason ? { reason } : {}),
            effects: canonical, grandfatheredEffects: canonicalAgentAutomationEffects(grandfatheredEffects), complete, clientIdentity,
            sourceGuard: sourceHash({ version: VERSION, branchId, subject, before,
                after: write.kind === "create" ? { ...after, createdAt: "committed-client-creation" } : after, policy,
                rules: [...reviewRules].sort((a, b) => a.id.localeCompare(b.id)),
                jobs: jobs.map((job) => ({ id: job.id, version: jobVersion(job) })).sort((a, b) => a.id.localeCompare(b.id)), schedules,
                serviceRecordLinks,
                grandfatheredEffects: canonicalAgentAutomationEffects(grandfatheredEffects) }),
            affectedJobs: [...affected.values()].map((job) => ({ id: job.id, version: jobVersion(job) })).sort((a, b) => a.id.localeCompare(b.id)) };
    }

    private buildServiceRecordLinkRecipe(
        branchId: string,
        rule: MessageTriggerRuleEntity,
        link: ClientAutomationServiceRecordLinkSource,
        clientName: string,
        now: Date,
    ): MessageTriggerJobRecipe | null {
        const { schedule, token } = link;
        const employee = schedule.primaryEmployee;
        if (!token || !employee || !validDate(now) || !validDate(schedule.startDate) || !validDate(schedule.endDate)) return null;
        if (!/^[A-Za-z0-9_-]+$/.test(token.linkTokenHash)) return null;
        const configuredBase = this.configService?.get<string>(
            "MOBILE_SERVICE_RECORD_BASE_URL",
            DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL,
        ) ?? DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL;
        const base = configuredBase.trim().replace(/\/+$/, "");
        let serviceRecordUrl: string;
        try {
            const parsed = new URL(`${base}/service-record/${token.linkTokenHash}`);
            if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
            serviceRecordUrl = parsed.toString();
        } catch {
            return null;
        }
        const scheduledFor = getServiceRecordLinkScheduledFor(schedule.startDate);
        const payload = buildServiceRecordLinkPayload({
            clientId: schedule.clientId,
            clientName,
            employeeId: employee.id,
            employeeName: employee.name,
            recipientPhone: employee.phone,
            buttonUrl: serviceRecordUrl,
            serviceRecordUrl,
            serviceStartDate: schedule.startDate.toISOString().slice(0, 10),
            serviceEndDate: schedule.endDate.toISOString().slice(0, 10),
        });
        return {
            branchId,
            ruleId: rule.id,
            scheduledFor,
            clientId: schedule.clientId,
            employeeScheduleId: schedule.id,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: employee.phone,
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${schedule.id}:primary`,
            payload: payload as unknown as MessageTriggerJobRecipe["payload"],
        };
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
