import type { AgentAutomationCoverage, AgentAutomationCoverageScope, AgentAutomationEffect,
    AgentAutomationGrandfatheredScope, AgentAutomationScope } from "domain/entities/agent-automation-consent";
import { isAgentAutomationCoverageScopeValid, isAgentAutomationOperationValid } from "domain/entities/agent-automation-consent";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { agentAutomationLineageKey, canonicalAgentAutomationEffects } from "./agent-automation-consent";

const DIGEST = /^[a-f0-9]{64}$/;

export function agentAutomationCoverageScope(scope: AgentAutomationScope): AgentAutomationCoverageScope {
    return { branchId: scope.branchId, clientId: scope.clientId, clientIdentity: scope.clientIdentity,
        kind: scope.kind, scheduleId: scope.scheduleId, scheduleIdentity: scope.scheduleIdentity, recipientType: scope.recipientType };
}

/** Lookup before checking incarnation identities; a recreated numeric ID cannot become legacy. */
export function agentAutomationCoverageLineageKey(scope: AgentAutomationCoverageScope): string {
    return agentBindingHash({ branchId: scope.branchId, clientId: scope.clientId, kind: scope.kind,
        scheduleId: scope.scheduleId, recipientType: scope.recipientType });
}

export function agentAutomationGrandfatheredFingerprint(effect: AgentAutomationEffect): string {
    const canonical = canonicalAgentAutomationEffects([effect])[0]!;
    return agentBindingHash({ kind: canonical.kind, ruleId: canonical.ruleId, scheduleId: canonical.scheduleId,
        recipientType: canonical.recipientType, templateKey: canonical.templateKey,
        recipientDigest: canonical.recipientDigest, sourceDigest: canonical.sourceDigest,
        templateDigest: canonical.templateDigest, policyDigest: canonical.policyDigest, recipeDigest: canonical.recipeDigest });
}

export function canonicalAgentAutomationGrandfatheredScopes(
    scope: AgentAutomationCoverageScope, members: readonly AgentAutomationGrandfatheredScope[],
): AgentAutomationGrandfatheredScope[] {
    if (!isAgentAutomationCoverageScopeValid(scope) || members.length > 500) throw new Error("Invalid automation coverage");
    const identity = agentBindingHash(scope);
    const seen = new Set<string>();
    const entries = members.map((member) => {
        const lineage = agentAutomationLineageKey(member.scope);
        if (seen.has(lineage) || !DIGEST.test(member.fingerprint) || !isAgentAutomationOperationValid(member.scope)
            || agentBindingHash(agentAutomationCoverageScope(member.scope)) !== identity) throw new Error("Invalid grandfathered scope");
        seen.add(lineage);
        return { scope: { ...member.scope }, fingerprint: member.fingerprint };
    });
    return entries.sort((left, right) => agentAutomationLineageKey(left.scope).localeCompare(agentAutomationLineageKey(right.scope)));
}

/** An integrity checksum; only the owned terminal writer and committed evidence establish provenance. */
export function agentAutomationCoverageRecordDigest(record: Omit<AgentAutomationCoverage, "recordDigest"> | AgentAutomationCoverage): string {
    const data: Omit<AgentAutomationCoverage, "recordDigest"> & { recordDigest?: string } = { ...record };
    delete data.recordDigest;
    return agentBindingHash({ ...data, grandfatheredScopes: canonicalAgentAutomationGrandfatheredScopes(data.scope, data.grandfatheredScopes) });
}

export type AgentAutomationCoverageHead =
    | { status: "absent" }
    | { status: "head"; coverage: AgentAutomationCoverage }
    | { status: "refused"; reason: "missing-authority" | "invalid-chain" | "scope-mismatch" };

/** All records must be supplied after strict decoding; never select a convenient historical head. */
export function resolveAgentAutomationCoverageHead(input: {
    records: readonly AgentAutomationCoverage[]; scope: AgentAutomationCoverageScope; knownProvenance: boolean;
}): AgentAutomationCoverageHead {
    if (!input.records.length) return input.knownProvenance ? { status: "refused", reason: "missing-authority" } : { status: "absent" };
    const records = [...input.records].sort((left, right) => left.sequence - right.sequence);
    const identity = agentBindingHash(input.scope);
    const seen = new Set<string>();
    try {
        for (let index = 0; index < records.length; index += 1) {
            const record = records[index]!;
            if (agentBindingHash(record.scope) !== identity) return { status: "refused", reason: "scope-mismatch" };
            if (record.kind !== "coverage" || record.version !== 1 || record.sequence !== index + 1 || seen.has(record.id)
                || record.previousId !== (index === 0 ? null : records[index - 1]!.id)
                || (index === 0 && record.origin.kind !== "task")
                || (record.origin.kind === "ordinary" && !["client-write", "schedule-write"].includes(record.origin.operation))
                || !DIGEST.test(record.mutationDigest) || record.recordDigest !== agentAutomationCoverageRecordDigest(record)) {
                return { status: "refused", reason: "invalid-chain" };
            }
            seen.add(record.id);
        }
        return { status: "head", coverage: records[records.length - 1]! };
    } catch {
        return { status: "refused", reason: "invalid-chain" };
    }
}
