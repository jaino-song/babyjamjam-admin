import type { AgentAutomationEffectSummary, AgentAutomationQuestion } from "@babyjamjam/shared";
import { AGENT_SMS_RULE_ID_PREFIX, CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";

/** Protected question recipe; only its public question may enter an owned REST snapshot. */
export interface AgentTaskAutomationState {
    version: 1;
    question: AgentAutomationQuestion;
    effects: AgentAutomationEffect[];
    noSendAtPresentation: boolean;
}

/** Private, digest-only recipe. This is never model input or a public mutation. */
export interface AgentAutomationEffect {
    kind: AgentAutomationEffectSummary["kind"];
    ruleId: string;
    scheduleId: number | null;
    recipientType: AgentAutomationEffectSummary["recipientType"];
    templateKey: AgentAutomationEffectSummary["templateKey"];
    change: AgentAutomationEffectSummary["change"];
    recipientDigest: string;
    sourceDigest: string;
    templateDigest: string;
    policyDigest: string;
    recipeDigest: string;
}

export interface AgentAutomationScope {
    branchId: string;
    clientId: number;
    /** Includes the original resource creation identity, not mutable updatedAt. */
    clientIdentity: string;
    kind: AgentAutomationEffect["kind"];
    ruleId: string;
    scheduleId: number | null;
    scheduleIdentity: string | null;
    recipientType: AgentAutomationEffect["recipientType"];
}

export type AgentAutomationOrigin =
    | { kind: "task"; userId: string; actionId: string; taskId: string; taskRevision: number; consentEventId: string | null }
    | { kind: "ordinary"; mutationId: string; operation: "client-write" | "schedule-write" | "manual-message" | "agent-message-retry" };

/**
 * Digest-only association carried from a committed task mutation to the
 * transient automation intent/materialization path.  The physical terminal
 * records remain the source of truth; this value is only a bounded lookup
 * reference and never contains customer, recipient or rendered-message data.
 */
export interface AgentAutomationRecordReference {
    id: string;
    recordDigest: string;
    scopeDigest: string;
}

export interface AgentAutomationTaskCommitReference {
    version: 1;
    actionId: string;
    taskId: string;
    taskRevision: number;
    authorities: AgentAutomationRecordReference[];
    coverages: AgentAutomationRecordReference[];
    commitDigest: string;
}

/** Appended in the same transaction as the customer/schedule mutation. */
export interface AgentAutomationAuthority {
    version: 1;
    id: string;
    scope: AgentAutomationScope;
    sequence: number;
    previousId: string | null;
    origin: AgentAutomationOrigin;
    decision: "allow" | "deny" | "none";
    noSend: boolean;
    effects: AgentAutomationEffect[];
    scopeEffectDigest: string;
    /** Whole reviewed question, including other operation scopes and recipients. */
    reviewedEffectDigest: string;
    reviewedPolicyDigest: string;
    recordedAt: string;
    recordDigest: string;
}

/** Reserved carrier; an identifier alone never proves consent. */
export interface AgentAutomationJobSeal {
    version: 1;
    authorityId: string;
    authorityDigest: string;
    scope: AgentAutomationScope;
    memberDigest: string;
    reviewedEffectDigest: string;
    /** Exact persisted delivery UUID, final timing, dedupe identity and source payload. */
    concreteJobDigest: string;
}

/** A provenance fence for operation families whose concrete rules may not exist yet. */
export type AgentAutomationCoverageScope = Omit<AgentAutomationScope, "ruleId">;
export interface AgentAutomationGrandfatheredScope {
    scope: AgentAutomationScope;
    /** Current exact rule, recipient, content, source and policy, independent of presentation change labels. */
    fingerprint: string;
}
export interface AgentAutomationCoverage {
    kind: "coverage";
    version: 1;
    id: string;
    scope: AgentAutomationCoverageScope;
    sequence: number;
    previousId: string | null;
    origin: AgentAutomationOrigin;
    /** Bound by the terminal storage writer to the same committed source mutation and receipt. */
    mutationDigest: string;
    grandfatheredScopes: AgentAutomationGrandfatheredScope[];
    recordedAt: string;
    recordDigest: string;
}

export function isAgentAutomationCoverageScopeValid(scope: AgentAutomationCoverageScope): boolean {
    if (scope.kind === "client-rule") return scope.scheduleId === null && scope.scheduleIdentity === null && scope.recipientType === "client";
    if (scope.scheduleId === null || scope.scheduleIdentity === null) return false;
    if (scope.kind === "service-record-link") return scope.recipientType === "primary-employee";
    return scope.kind === "employee-assignment" && (scope.recipientType === "primary-employee" || scope.recipientType === "secondary-employee");
}

/** Dedicated producers own their rule/recipient combination; generic rules cannot impersonate them. */
export function isAgentAutomationOperationValid(operation: Pick<AgentAutomationScope, "kind" | "ruleId" | "scheduleId" | "recipientType">): boolean {
    if (operation.kind === "service-record-link") {
        return operation.ruleId === SERVICE_RECORD_LINK_RULE_ID && operation.scheduleId !== null
            && operation.recipientType === "primary-employee";
    }
    if (operation.ruleId.startsWith("system:") || operation.ruleId.startsWith(AGENT_SMS_RULE_ID_PREFIX)) return false;
    if (operation.kind === "client-rule") return operation.scheduleId === null && operation.recipientType === "client";
    return operation.kind === "employee-assignment" && operation.scheduleId !== null
        && (operation.recipientType === "primary-employee" || operation.recipientType === "secondary-employee");
}

export function isAgentAutomationEffectVariantValid(effect: AgentAutomationEffect): boolean {
    if (!isAgentAutomationOperationValid(effect)) return false;
    if (effect.kind === "service-record-link") return effect.templateKey === MessageTriggerTemplateKey.SERVICE_RECORD_LINK;
    if (effect.kind === "employee-assignment") return effect.templateKey === MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED;
    return CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS.includes(effect.templateKey as MessageTriggerTemplateKey);
}
