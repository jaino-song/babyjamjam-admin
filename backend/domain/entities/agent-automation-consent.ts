import type { AgentAutomationEffectSummary, AgentAutomationQuestion } from "@babyjamjam/shared";

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
}
