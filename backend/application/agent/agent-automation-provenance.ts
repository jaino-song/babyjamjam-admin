import type { AgentAutomationCoverage, AgentAutomationEffect, AgentAutomationScope } from "domain/entities/agent-automation-consent";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { resolveAgentAutomationAuthority, type AgentAutomationResolution } from "./agent-automation-consent";
import { agentAutomationCoverageScope, agentAutomationGrandfatheredFingerprint, resolveAgentAutomationCoverageHead } from "./agent-automation-coverage";
import { AgentAutomationEffectStorageSchema, AgentAutomationScopeStorageSchema, parseAgentAutomationAuthority, parseAgentAutomationCoverage } from "./agent-automation-storage.schema";

export type AgentAutomationProvenanceResolution = AgentAutomationResolution
    | { status: "grandfathered"; coverage: AgentAutomationCoverage };

/**
 * The storage owner supplies complete identity-free lineages plus physical row
 * presence. Caller JSON, copied job seals or a missing parse result are never
 * provenance. The owner must also prove the records' committed mutations.
 */
export function resolveAgentAutomationProvenance(input: {
    exactRows: readonly unknown[];
    coverageRows: readonly unknown[];
    knownExactProvenance: boolean;
    knownCoverageProvenance: boolean;
    scope: AgentAutomationScope;
    effect: AgentAutomationEffect;
    currentScopeEffectDigest: string;
}): AgentAutomationProvenanceResolution {
    if (!AgentAutomationScopeStorageSchema.safeParse(input.scope).success || !AgentAutomationEffectStorageSchema.safeParse(input.effect).success
        || input.effect.kind !== input.scope.kind || input.effect.ruleId !== input.scope.ruleId
        || input.effect.scheduleId !== input.scope.scheduleId || input.effect.recipientType !== input.scope.recipientType) {
        return { status: "refused", reason: "scope-mismatch" };
    }
    const coverages = input.coverageRows.map(parseAgentAutomationCoverage);
    const exact = input.exactRows.map(parseAgentAutomationAuthority);
    if (coverages.some((record) => record === null) || exact.some((record) => record === null)) {
        return { status: "refused", reason: "invalid-chain" };
    }
    const coverage = resolveAgentAutomationCoverageHead({ records: coverages as AgentAutomationCoverage[],
        scope: agentAutomationCoverageScope(input.scope), knownProvenance: input.knownCoverageProvenance });
    if (coverage.status === "refused") return coverage;
    if (exact.length || input.knownExactProvenance) {
        return resolveAgentAutomationAuthority({ records: exact as NonNullable<typeof exact[number]>[],
            scope: input.scope, effect: input.effect, currentScopeEffectDigest: input.currentScopeEffectDigest, knownTaskOrigin: true });
    }
    if (coverage.status === "absent") return { status: "legacy" };
    try {
        const fingerprint = agentAutomationGrandfatheredFingerprint(input.effect);
        const scopeDigest = agentBindingHash(input.scope);
        return coverage.coverage.grandfatheredScopes.some((member) => agentBindingHash(member.scope) === scopeDigest && member.fingerprint === fingerprint)
            ? { status: "grandfathered", coverage: coverage.coverage }
            : { status: "refused", reason: "missing-authority" };
    } catch {
        return { status: "refused", reason: "effect-mismatch" };
    }
}
