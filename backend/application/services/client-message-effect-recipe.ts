import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { EVENT_OFFSET_OPTIONS, isCompatibleMessageTriggerTemplate, isConfigurableSmsTriggerTemplate, MessageTriggerEventType,
    MessageTriggerOffsetType, MessageTriggerRecipientType } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import type { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import type { MessageAutomationPastTriggerConfig } from "domain/entities/system-setting.entity";
import { buildClientMessageRecipe, type ClientTriggerSource } from "./message-trigger-recipes";
import { withServiceEndNoticePreviewLink } from "./service-end-notice-preview";
import type { SmsTriggerDeliveryService } from "./sms-trigger-delivery.service";

/** Creation is a bounded recipe; the committed authority later binds the actual row incarnation. */
export type ClientMessageLogicalSubject =
    | { kind: "task-client"; taskId: string }
    | { kind: "client"; clientId: number; clientIdentity: string };

export interface ClientMessageEffectPolicy {
    dispatchEnabled: boolean;
    senderApproved: boolean;
    /** Digest supplied by the configured provider owner; never the sender number or credentials. */
    senderIdentityDigest: string | null;
    senderApprovedAt: string | null;
    pastTriggerEnabled: boolean;
    pastTriggerConfig: MessageAutomationPastTriggerConfig;
}

export type ClientMessageEffectDescription =
    | { status: "effect"; effect: AgentAutomationEffect }
    | { status: "none" }
    | { status: "unavailable"; reason: "sender-unavailable" | "unsupported-content" | "source-unavailable" };

const RECIPE_VERSION = "client-rule-automation-recipe-v1";
const DIGEST = /^[a-f0-9]{64}$/;

/**
 * Describes one client rule, using the materializer's recipe and the delivery
 * owner's canonical renderer. This is a building block, not the complete
 * affected-job planner: the caller must also account for cancellations and
 * schedule effects, check defaults, and persist consent under the task UoW.
 * No raw source, rendered body, phone, or preview job leaves this function.
 */
export async function describeClientMessageEffect(input: {
    branchId: string;
    subject: ClientMessageLogicalSubject;
    rule: MessageTriggerRuleEntity;
    /** Already normalized through the same customer-write path as persistence. */
    client: ClientTriggerSource;
    change: AgentAutomationEffect["change"];
    policy: ClientMessageEffectPolicy;
    now: Date;
    delivery: Pick<SmsTriggerDeliveryService, "resolveCanonicalDeliverySnapshot">;
}): Promise<ClientMessageEffectDescription> {
    const { rule, client, policy, subject } = input;
    // Generic client rules are branch-owned. Global/dedicated and manual jobs
    // have separate owners and cannot acquire authority through this builder.
    if (rule.branchId !== input.branchId || rule.id.startsWith("system:") || rule.id.startsWith("agent-sms:")
        || rule.recipientType !== MessageTriggerRecipientType.CLIENT
        || !isConfigurableSmsTriggerTemplate(rule.templateKey) || !isCompatibleMessageTriggerTemplate(rule)
        || !EVENT_OFFSET_OPTIONS[rule.eventType]?.includes(rule.offsetType)
        || Number.isNaN(input.now.getTime())) return { status: "unavailable", reason: "source-unavailable" };
    if (subject.kind === "client" && (subject.clientId !== client.id || !DIGEST.test(subject.clientIdentity))) {
        return { status: "unavailable", reason: "source-unavailable" };
    }
    if (subject.kind === "task-client" && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(subject.taskId)) {
        return { status: "unavailable", reason: "source-unavailable" };
    }
    if (!rule.isActive || !policy.dispatchEnabled) return { status: "none" };
    // Supply an ephemeral creation anchor only to the existing pure builder.
    // Neither this timestamp nor the temporary numeric ID is consent identity.
    const recipe = buildClientMessageRecipe(rule, subject.kind === "task-client"
        ? { ...client, createdAt: input.now } : client, input.now);
    if (!recipe) return { status: "none" };
    if (!policy.senderApproved || !policy.senderIdentityDigest || !DIGEST.test(policy.senderIdentityDigest)) {
        return { status: "unavailable", reason: "sender-unavailable" };
    }
    try {
        // The raw recipe never carries SERVICE_END_NOTICE's receipt link (it is
        // written only by ReceiptLinkDeliveryEnricher at real delivery time),
        // but the system template requires it. Render a placeholder-patched
        // preview copy instead of the raw recipe job; `recipe.payload` itself
        // (used below for sourceDigest) is untouched.
        const snapshot = await input.delivery.resolveCanonicalDeliverySnapshot(
            withServiceEndNoticePreviewLink(MessageTriggerJobEntity.create(recipe)),
        );
        const scheduling = rule.offsetType === MessageTriggerOffsetType.IMMEDIATE
            ? { kind: "materialization-time" }
            : rule.eventType === MessageTriggerEventType.CLIENT_CREATED && subject.kind === "task-client"
                ? { kind: "committed-client-creation" }
                : { kind: "calendar-time", scheduledFor: recipe.scheduledFor.toISOString() };
        return { status: "effect", effect: {
            kind: "client-rule", ruleId: rule.id, scheduleId: null, recipientType: "client",
            templateKey: rule.templateKey as AgentAutomationEffect["templateKey"], change: input.change,
            recipientDigest: agentBindingHash({ branchId: input.branchId, subject, recipientType: "client", receiver: snapshot.receiver }),
            sourceDigest: agentBindingHash({ subject, recipientName: recipe.payload.recipientName,
                variables: recipe.payload.templateVariables }),
            templateDigest: agentBindingHash({ templateKey: snapshot.templateKey, templateVersion: snapshot.templateVersion,
                templateHash: snapshot.templateHash, configVersion: snapshot.configVersion, configHash: snapshot.configHash,
                message: snapshot.message, title: snapshot.title, requestedDeliveryType: snapshot.requestedDeliveryType,
                deliveryType: snapshot.deliveryType }),
            policyDigest: agentBindingHash({ version: RECIPE_VERSION, branchId: input.branchId, ...policy }),
            recipeDigest: agentBindingHash({ version: RECIPE_VERSION, scheduling, eventType: rule.eventType,
                offsetType: rule.offsetType, offsetDays: rule.offsetDays, sendTime: rule.sendTime,
                recipientType: rule.recipientType }),
        } };
    } catch {
        // Link issuance/enrichment is deliberately not invoked for preview.
        // Missing or unbounded content requires another recipe owner before yes.
        return { status: "unavailable", reason: "unsupported-content" };
    }
}
