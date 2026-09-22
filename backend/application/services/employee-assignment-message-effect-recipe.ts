import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { agentAutomationScheduleIdentity } from "application/agent/agent-automation-consent";
import type { ClientMessageEffectPolicy, ClientMessageLogicalSubject } from "./client-message-effect-recipe";
import { employeeAssignmentScheduleFingerprint, type EmployeeAssignmentScheduleSource, type MessageTriggerJobRecipe } from "./message-trigger-recipes";
import type { SmsTriggerDeliverySnapshot } from "./sms-trigger-delivery.service";

const RECIPE_VERSION = "employee-assignment-automation-recipe-v1";
const DIGEST = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/**
 * Rebuild the digest-only employee-assignment effect from the same canonical
 * recipe that materialization uses. The source, recipient and rendered
 * provider target are transient; only their hashes are returned.
 */
export function buildEmployeeAssignmentMessageEffect(input: {
    branchId: string;
    subject: ClientMessageLogicalSubject;
    rule: {
        id: string;
        branchId: string | null;
        isActive: boolean;
        eventType: MessageTriggerEventType;
        offsetType: MessageTriggerOffsetType;
        offsetDays: number;
        sendTime: string;
        recipientType: MessageTriggerRecipientType;
        templateKey: MessageTriggerTemplateKey;
    };
    schedule: EmployeeAssignmentScheduleSource & { incarnationId?: string };
    scheduleIdentity: string;
    recipe: MessageTriggerJobRecipe;
    snapshot: SmsTriggerDeliverySnapshot;
    change: AgentAutomationEffect["change"];
    policy: ClientMessageEffectPolicy;
}): AgentAutomationEffect | null {
    const { branchId, subject, rule, schedule, scheduleIdentity, recipe, snapshot, change, policy } = input;
    if (rule.branchId !== branchId || rule.id.startsWith("system:") || rule.id.startsWith("agent-sms:")
        || !rule.isActive || rule.eventType !== MessageTriggerEventType.EMPLOYEE_ASSIGNED
        || rule.offsetType !== MessageTriggerOffsetType.IMMEDIATE
        || rule.recipientType === MessageTriggerRecipientType.CLIENT
        || ![MessageTriggerRecipientType.PRIMARY_EMPLOYEE, MessageTriggerRecipientType.SECONDARY_EMPLOYEE].includes(rule.recipientType)
        || rule.templateKey !== MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED
        || schedule.branchId !== branchId || schedule.clientId !== recipe.clientId
        || schedule.replaced || schedule.terminatedAt !== null
        || recipe.employeeScheduleId !== schedule.id || recipe.recipientType !== rule.recipientType
        || recipe.templateKey !== rule.templateKey || snapshot.templateKey !== rule.templateKey
        || !DIGEST.test(scheduleIdentity) || !policy.dispatchEnabled || !policy.senderApproved
        || !policy.senderIdentityDigest || !DIGEST.test(policy.senderIdentityDigest)) {
        return null;
    }

    if (subject.kind === "client"
        ? (subject.clientId !== schedule.clientId || !DIGEST.test(subject.clientIdentity))
        : !UUID.test(subject.taskId)) {
        return null;
    }

    let canonicalScheduleIdentity: string;
    try {
        if (!schedule.incarnationId) return null;
        canonicalScheduleIdentity = agentAutomationScheduleIdentity(schedule.incarnationId);
    } catch {
        return null;
    }
    if (canonicalScheduleIdentity !== scheduleIdentity) return null;

    const employeeId = recipe.payload.employeeId;
    const employeeName = recipe.payload.employeeName;
    const employeeScheduleFingerprint = recipe.payload.employeeScheduleFingerprint;
    const expectedEmployee = rule.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
        ? schedule.primaryEmployee : schedule.secondaryEmployee;
    const expectedScheduleFingerprint = employeeAssignmentScheduleFingerprint(schedule, rule.recipientType);
    if (typeof employeeId !== "number" || !Number.isSafeInteger(employeeId) || employeeId < 1
        || typeof employeeName !== "string" || !employeeName
        || typeof employeeScheduleFingerprint !== "string" || !DIGEST.test(employeeScheduleFingerprint)
        || employeeScheduleFingerprint !== expectedScheduleFingerprint
        || !expectedEmployee || employeeId !== expectedEmployee.id || employeeName !== expectedEmployee.name
        || recipe.recipientPhone === null || typeof recipe.recipientPhone !== "string"
        || recipe.recipientPhone !== expectedEmployee.phone || snapshot.receiver !== expectedEmployee.phone
        || snapshot.recipientName !== expectedEmployee.name || !snapshot.message || !snapshot.title
        || !snapshot.templateVersion || !snapshot.templateHash || !snapshot.configVersion || !snapshot.configHash
        || !snapshot.snapshotHash) {
        return null;
    }

    const recipientType = rule.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
        ? "primary-employee" : "secondary-employee";
    return {
        kind: "employee-assignment",
        ruleId: rule.id,
        scheduleId: schedule.id,
        recipientType,
        templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        change,
        recipientDigest: agentBindingHash({ branchId, subject, recipientType, receiver: snapshot.receiver }),
        sourceDigest: agentBindingHash({ branchId, subject, scheduleIdentity,
            scheduleFingerprint: employeeScheduleFingerprint, employeeId, employeeName,
            recipientName: recipe.payload.recipientName, variables: recipe.payload.templateVariables }),
        templateDigest: agentBindingHash({ templateKey: snapshot.templateKey, templateVersion: snapshot.templateVersion,
            templateHash: snapshot.templateHash, configVersion: snapshot.configVersion, configHash: snapshot.configHash,
            message: snapshot.message, title: snapshot.title, requestedDeliveryType: snapshot.requestedDeliveryType,
            deliveryType: snapshot.deliveryType }),
        policyDigest: agentBindingHash({ version: RECIPE_VERSION, branchId, ...policy }),
        recipeDigest: agentBindingHash({ version: RECIPE_VERSION, scheduling: { kind: "materialization-time" },
            eventType: rule.eventType, offsetType: rule.offsetType, offsetDays: rule.offsetDays,
            sendTime: rule.sendTime, recipientType: rule.recipientType, scheduleIdentity,
            scheduleFingerprint: employeeScheduleFingerprint }),
    };
}
