import type {
    AgentAutomationAuthority, AgentAutomationEffect, AgentAutomationScope,
} from "domain/entities/agent-automation-consent";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";

const DIGEST = /^[a-f0-9]{64}$/;

/** Lookup provenance before comparing creation identities, including after numeric ID reuse. */
export function agentAutomationLineageKey(scope: AgentAutomationScope): string {
    return agentBindingHash({ branchId: scope.branchId, clientId: scope.clientId, kind: scope.kind,
        ruleId: scope.ruleId, scheduleId: scope.scheduleId, recipientType: scope.recipientType });
}

export function agentAutomationScheduleIdentity(incarnationId: string): string {
    const normalized = incarnationId.toLowerCase();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(normalized)) {
        throw new Error("Invalid schedule incarnation identity");
    }
    return agentBindingHash({ version: 1, resource: "employee_schedule", incarnationId: normalized });
}

export function agentAutomationEffectIdentity(effect: AgentAutomationEffect): string {
    return JSON.stringify([effect.kind, effect.ruleId, effect.scheduleId, effect.recipientType]);
}

/** Order is presentation-only; duplicate recipe identities are ambiguous and refused. */
export function canonicalAgentAutomationEffects(effects: readonly AgentAutomationEffect[]): AgentAutomationEffect[] {
    if (effects.length > 500) throw new Error("Automation effect limit exceeded");
    const identities = new Set<string>();
    const ordered = effects.map((effect) => {
        const identity = agentAutomationEffectIdentity(effect);
        if (identities.has(identity)) throw new Error("Duplicate automation effect identity");
        identities.add(identity);
        for (const value of [effect.recipientDigest, effect.sourceDigest, effect.templateDigest,
            effect.policyDigest, effect.recipeDigest]) {
            if (!DIGEST.test(value)) throw new Error("Invalid automation effect digest");
        }
        return { ...effect };
    });
    return ordered.sort((left, right) => {
        const a = agentAutomationEffectIdentity(left);
        const b = agentAutomationEffectIdentity(right);
        return a < b ? -1 : a > b ? 1 : 0;
    });
}

export function agentAutomationEffectDigest(effects: readonly AgentAutomationEffect[]): string {
    return agentBindingHash(canonicalAgentAutomationEffects(effects));
}

export function agentAutomationPolicyDigest(effects: readonly AgentAutomationEffect[]): string {
    return agentBindingHash(canonicalAgentAutomationEffects(effects).map((effect) => ({
        identity: agentAutomationEffectIdentity(effect),
        policyDigest: effect.policyDigest, templateDigest: effect.templateDigest, recipeDigest: effect.recipeDigest,
    })));
}

/** Integrity checksum only; storage provenance and the committed mutation prove authority. */
export function agentAutomationRecordDigest(record: Omit<AgentAutomationAuthority, "recordDigest"> | AgentAutomationAuthority): string {
    const data: Omit<AgentAutomationAuthority, "recordDigest"> & { recordDigest?: string } = { ...record };
    delete data.recordDigest;
    return agentBindingHash({ ...data, effects: canonicalAgentAutomationEffects(data.effects) });
}

export type AgentAutomationResolution =
    | { status: "legacy" }
    | { status: "allowed"; authority: AgentAutomationAuthority }
    | { status: "suppressed"; authority: AgentAutomationAuthority }
    | { status: "refused"; reason: "missing-authority" | "invalid-chain" | "scope-mismatch" | "source-mismatch" | "effect-mismatch" };

/**
 * Pure resolver after strict storage decoding. All records for this operation
 * scope must be supplied; callers must never select a convenient older yes.
 */
export function resolveAgentAutomationAuthority(input: {
    records: readonly AgentAutomationAuthority[];
    scope: AgentAutomationScope;
    effect: AgentAutomationEffect;
    currentScopeEffectDigest: string;
    /** Derived from stored provenance, never a public request or missing JSON. */
    knownTaskOrigin: boolean;
}): AgentAutomationResolution {
    if (!input.records.length) {
        return input.knownTaskOrigin ? { status: "refused", reason: "missing-authority" } : { status: "legacy" };
    }
    const records = [...input.records].sort((a, b) => a.sequence - b.sequence);
    const ids = new Set<string>();
    const expectedScope = agentBindingHash(input.scope);
    try {
        for (let index = 0; index < records.length; index += 1) {
            const record = records[index]!;
            if (agentBindingHash(record.scope) !== expectedScope) return { status: "refused", reason: "scope-mismatch" };
            if (record.version !== 1 || record.sequence !== index + 1 || ids.has(record.id)
                || record.previousId !== (index === 0 ? null : records[index - 1]!.id)
                || (index === 0 && record.origin.kind !== "task")
                || record.recordDigest !== agentAutomationRecordDigest(record)
                || record.scopeEffectDigest !== agentAutomationEffectDigest(record.effects)
                || !DIGEST.test(record.reviewedEffectDigest) || !DIGEST.test(record.reviewedPolicyDigest)
                || record.effects.some((effect) => effect.kind !== record.scope.kind || effect.scheduleId !== record.scope.scheduleId
                    || effect.ruleId !== record.scope.ruleId || effect.recipientType !== record.scope.recipientType)
                || (record.decision === "allow" && (record.noSend || !record.effects.length
                    || (record.origin.kind === "task" && !record.origin.consentEventId)))
                || (record.decision === "none" && record.effects.length !== 0)) {
                return { status: "refused", reason: "invalid-chain" };
            }
            ids.add(record.id);
        }
        const authority = records[records.length - 1]!;
        if (authority.decision !== "allow" || authority.noSend) return { status: "suppressed", authority };
        if (input.currentScopeEffectDigest !== authority.scopeEffectDigest) return { status: "refused", reason: "source-mismatch" };
        const memberDigest = agentAutomationEffectDigest([input.effect]);
        if (!authority.effects.some((effect) => agentAutomationEffectDigest([effect]) === memberDigest)) {
            return { status: "refused", reason: "effect-mismatch" };
        }
        return { status: "allowed", authority };
    } catch {
        return { status: "refused", reason: "invalid-chain" };
    }
}
