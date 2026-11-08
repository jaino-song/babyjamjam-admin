import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isCaregiverTriggerTemplate, isCompatibleMessageTriggerTemplate, MessageTriggerEventType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import type { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import type { CaregiverSourceSnapshot } from "domain/entities/message-trigger-job.entity";
import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import { MESSAGE_TRIGGER_RULE_REPOSITORY, type IMessageTriggerRuleRepository } from "domain/repositories/message-trigger-rule.repository.interface";
import { computeServiceStatus } from "domain/value-objects/service-status.vo";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { normalizePhone } from "application/utils/normalize-phone";
import { ClientAutomationSourceReader } from "./client-automation-source.reader";
import { CaregiverTemplateResolverService } from "./caregiver-template-resolver.service";
import { computeScheduledFor, getKstCalendarDate, type ClientTriggerSource, type MessageTriggerJobRecipe } from "./message-trigger-recipes";
import type { ClientMessageEffectPolicy, ClientMessageLogicalSubject } from "./client-message-effect-recipe";
import type { SmsTriggerDeliverySnapshot } from "./sms-trigger-delivery.service";

export interface CaregiverRecipientResolution {
    ruleId: string;
    recipientType: MessageTriggerRecipientType;
    employeeId: number | null;
    employeeScheduleId: number | null;
    recipientName: string | null;
    recipientPhone: string | null;
    templateKey: MessageTriggerTemplateKey;
    body: string | null;
    count: number;
    scheduledFor: string | null;
    anchorSource: "employee_schedule.startDate" | "employee_schedule.endDate";
    anchorDate: string | null;
    outcome: "ready" | "skip" | "needs_setup" | "unavailable";
    reason: string | null;
    recipe?: MessageTriggerJobRecipe;
}
export interface CaregiverRecipientSet { complete: boolean; recipients: CaregiverRecipientResolution[] }

/** One canonical schedule-set resolver for preview, materialization, impact and authority. No writes. */
@Injectable()
export class MessageTriggerRecipientResolverService {
    constructor(
        private readonly sources: ClientAutomationSourceReader,
        private readonly templates: CaregiverTemplateResolverService,
        @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY) private readonly rules: IMessageTriggerRuleRepository,
    ) {}

    async resolve(branchId: string, clientId: number, rules: MessageTriggerRuleEntity[], transaction?: Prisma.TransactionClient,
        options?: { clientOverride?: ClientTriggerSource; employeeScheduleId?: number; draft?: boolean; now?: Date }): Promise<CaregiverRecipientSet> {
        const now = options?.now ?? new Date();
        const caregiverRules = rules.filter((rule) => isCaregiverTriggerTemplate(rule.templateKey));
        const empty = (rule: MessageTriggerRuleEntity, reason: string, outcome: CaregiverRecipientResolution["outcome"] = "skip"): CaregiverRecipientResolution => ({
            ruleId: rule.id, recipientType: rule.recipientType, employeeId: null, employeeScheduleId: null,
            recipientName: null, recipientPhone: null, templateKey: rule.templateKey, body: null, count: 0, scheduledFor: null,
            anchorSource: rule.eventType === MessageTriggerEventType.SERVICE_END ? "employee_schedule.endDate" : "employee_schedule.startDate",
            anchorDate: null, outcome, reason,
        });
        try {
            const source = await this.sources.readCaregiverSource(branchId, clientId, transaction);
            if (!source.branch || !source.client || source.branch.id !== branchId || source.client.branchId !== branchId
                || source.schedules.length > 500 || Number.isNaN(now.getTime())) {
                return { complete: false, recipients: caregiverRules.map((rule) => empty(rule, "source_unavailable", "unavailable")) };
            }
            const { branch } = source;
            const client = { ...source.client, ...(options?.clientOverride ? {
                name: options.clientOverride.name, startDate: options.clientOverride.startDate, endDate: options.clientOverride.endDate,
            } : {}) };
            const selected = source.schedules.filter((schedule) => options?.employeeScheduleId === undefined || schedule.id === options.employeeScheduleId);
            if (options?.employeeScheduleId !== undefined && !selected.length) return { complete: false,
                recipients: caregiverRules.map((rule) => empty(rule, "schedule_unavailable", "unavailable")) };
            const recipients: CaregiverRecipientResolution[] = [];
            for (const rule of caregiverRules) {
                if (rule.branchId !== branchId || !rule.groupId || MessageTriggerRuleEntityReserved(rule.id)
                    || !isCompatibleMessageTriggerTemplate(rule)) return { complete: false, recipients: [empty(rule, "rule_unavailable", "unavailable")] };
                const group = options?.draft ? { id: rule.groupId, version: 1 } : await this.rules.findGroup(branchId, rule.groupId, transaction);
                if (!group || !Number.isInteger(group.version) || group.version < 1) return { complete: false, recipients: [empty(rule, "group_unavailable", "unavailable")] };
                // A known empty assignment set has its own literal meaning, independent of client phone/eligibility/anchors.
                if (!selected.length) { recipients.push(empty(rule, "배정 없음")); continue; }
                for (const schedule of selected) {
                    const row = empty(rule, "배정 없음");
                    row.employeeScheduleId = schedule.id;
                    if (schedule.branchId !== branchId || schedule.clientId !== clientId || schedule.replaced || schedule.terminatedAt
                        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(schedule.incarnationId)) {
                        return { complete: false, recipients: [empty(rule, "source_unavailable", "unavailable")] };
                    }
                    const employee = rule.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE ? schedule.primaryEmployee : schedule.secondaryEmployee;
                    if (!employee) { recipients.push(row); continue; }
                    row.employeeId = employee.id; row.recipientName = employee.name; row.recipientPhone = normalizePhone(employee.phone);
                    if (rule.recipientType === MessageTriggerRecipientType.SECONDARY_EMPLOYEE && schedule.primaryEmployeeId === employee.id
                        && caregiverRules.some((other) => other.groupId === rule.groupId && other.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE)) {
                        row.reason = "동일 제공인력 중복 제외"; recipients.push(row); continue;
                    }
                    const status = computeServiceStatus(client.serviceStatus, client.startDate, client.endDate, client.bookingConfirmedAt, now);
                    if (client.deletedAt || !client.createdAt || status === "terminated" || status === "pre_booking"
                        || employee.deletedAt || employee.smsAutomationEnabled !== true || employee.branchId !== branchId || !employee.name.trim()) {
                        row.reason = "자격 미충족"; recipients.push(row); continue;
                    }
                    if (!row.recipientPhone) { row.reason = "전화번호 없음"; recipients.push(row); continue; }
                    const anchor = rule.eventType === MessageTriggerEventType.SERVICE_END ? schedule.endDate : schedule.startDate;
                    if (!(anchor instanceof Date) || Number.isNaN(anchor.getTime()) || !(schedule.startDate instanceof Date)
                        || !(schedule.endDate instanceof Date) || Number.isNaN(schedule.startDate.getTime()) || Number.isNaN(schedule.endDate.getTime())) {
                        row.reason = "anchor 없음"; recipients.push(row); continue;
                    }
                    const variables = { employeeName: employee.name, clientName: client.name, branchName: branch.name,
                        serviceStartDate: getKstCalendarDate(schedule.startDate, 0), serviceEndDate: getKstCalendarDate(schedule.endDate, 0) };
                    const snapshot: CaregiverSourceSnapshot = { version: 1, groupId: group.id, groupVersion: group.version, ruleId: rule.id,
                        eventType: rule.eventType as "SERVICE_START" | "SERVICE_END",
                        schedule: { id: schedule.id, incarnationId: schedule.incarnationId, startDate: schedule.startDate.toISOString(),
                            endDate: schedule.endDate.toISOString(), replaced: false, terminatedAt: null },
                        employee: { id: employee.id, branchId, name: employee.name, phone: row.recipientPhone, deletedAt: null, smsAutomationEnabled: true },
                        client: { id: client.id, branchId, name: client.name, createdAt: client.createdAt.toISOString(), deletedAt: null,
                            serviceStatus: client.serviceStatus, startDate: client.startDate?.toISOString() ?? null,
                            endDate: client.endDate?.toISOString() ?? null, bookingConfirmedAt: client.bookingConfirmedAt?.toISOString() ?? null },
                        branchName: branch.name, variables: { ...variables } };
                    const scheduledFor = computeScheduledFor(anchor, rule, now);
                    row.anchorDate = getKstCalendarDate(anchor, 0); row.scheduledFor = scheduledFor.toISOString();
                    row.recipe = { branchId, ruleId: rule.id, clientId, employeeScheduleId: schedule.id, recipientType: rule.recipientType,
                        recipientPhone: row.recipientPhone, templateKey: rule.templateKey, scheduledFor,
                        dedupeKey: `group:${group.id}:child:${rule.id}:schedule:${schedule.id}:event:${rule.eventType}:employee:${employee.id}`,
                        payload: { clientId, clientName: client.name, employeeId: employee.id, employeeName: employee.name,
                            memberId: String(employee.id), recipientName: employee.name, recipientPhone: row.recipientPhone,
                            templateVariables: { ...variables }, caregiverSourceSnapshot: snapshot } };
                    try {
                        const template = await this.templates.resolve(branchId, rule.templateKey as unknown as SystemTemplateKey, transaction);
                        if (template.requiredVariableKeys.some((key) => !variables[key as keyof typeof variables]?.trim())) throw new Error("missing render input");
                        row.body = template.content.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => variables[key as keyof typeof variables] ?? "");
                        row.outcome = "ready"; row.reason = null; row.count = 1;
                    } catch {
                        row.outcome = "needs_setup"; row.reason = "template_unavailable";
                    }
                    recipients.push(row);
                    if (recipients.length > 500) return { complete: false, recipients: [] };
                }
            }
            for (const row of recipients) if (row.outcome === "ready" && recipients.some((other) => other !== row && other.employeeId !== row.employeeId
                && other.recipientPhone === row.recipientPhone && other.body !== row.body && other.recipe
                && other.employeeScheduleId === row.employeeScheduleId && other.recipe.payload.caregiverSourceSnapshot?.groupId === row.recipe?.payload.caregiverSourceSnapshot?.groupId
                && other.recipe.payload.caregiverSourceSnapshot?.eventType === row.recipe?.payload.caregiverSourceSnapshot?.eventType)) {
                row.outcome = "needs_setup"; row.reason = "recipient_phone_conflict"; row.count = 0;
            }
            return { complete: true, recipients };
        } catch {
            return { complete: false, recipients: caregiverRules.map((rule) => empty(rule, "source_unavailable", "unavailable")) };
        }
    }
}

function MessageTriggerRuleEntityReserved(id: string): boolean { return id.startsWith("system:") || id.startsWith("agent-sms:"); }

/** The new family cannot acquire the old client or assignment recipe's consent. */
export function describeCaregiverMessageEffect(input: {
    branchId: string; subject: ClientMessageLogicalSubject; rule: MessageTriggerRuleEntity; recipe: MessageTriggerJobRecipe;
    policy: ClientMessageEffectPolicy; snapshot: Readonly<SmsTriggerDeliverySnapshot>; change: AgentAutomationEffect["change"];
}): AgentAutomationEffect | null {
    const { rule, recipe, snapshot, subject, policy } = input;
    const source = recipe.payload.caregiverSourceSnapshot;
    if (!source || source.version !== 1 || rule.branchId !== input.branchId || !rule.groupId || MessageTriggerRuleEntityReserved(rule.id)
        || !isCaregiverTriggerTemplate(rule.templateKey) || !isCompatibleMessageTriggerTemplate(rule) || recipe.employeeScheduleId == null
        || !policy.senderApproved || !policy.senderIdentityDigest || !policy.dispatchEnabled || !rule.isActive) return null;
    const recipientType = rule.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE ? "primary-employee" : "secondary-employee";
    return { kind: "caregiver-service", ruleId: rule.id, scheduleId: recipe.employeeScheduleId, recipientType, templateKey: rule.templateKey,
        change: input.change,
        recipientDigest: agentBindingHash({ branchId: input.branchId, subject, recipientType, receiver: snapshot.receiver }),
        sourceDigest: agentBindingHash({ subject, source }),
        templateDigest: agentBindingHash({ templateKey: snapshot.templateKey, templateVersion: snapshot.templateVersion, templateHash: snapshot.templateHash,
            configVersion: snapshot.configVersion, configHash: snapshot.configHash, message: snapshot.message, title: snapshot.title,
            requestedDeliveryType: snapshot.requestedDeliveryType, deliveryType: snapshot.deliveryType }),
        policyDigest: agentBindingHash({ version: "caregiver-service-v1", branchId: input.branchId, ...policy }),
        recipeDigest: agentBindingHash({ version: "caregiver-service-v1", groupVersion: source.groupVersion, eventType: rule.eventType,
            offsetType: rule.offsetType, offsetDays: rule.offsetDays, sendTime: rule.sendTime, scheduledFor: recipe.scheduledFor.toISOString(), dedupeKey: recipe.dedupeKey }),
    };
}
