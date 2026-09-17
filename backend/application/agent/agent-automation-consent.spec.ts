import type { AgentAutomationAuthority, AgentAutomationEffect, AgentAutomationScope } from "domain/entities/agent-automation-consent";
import {
    agentAutomationEffectDigest, canonicalAgentAutomationEffects, agentAutomationPolicyDigest,
    agentAutomationRecordDigest, resolveAgentAutomationAuthority,
} from "./agent-automation-consent";

const hash = (s: string) => s.repeat(64);
const scope: AgentAutomationScope = { branchId: "branch-a", clientId: 51, clientIdentity: hash("c"), kind: "client-rule", scheduleId: null };
function effect(overrides: Partial<AgentAutomationEffect> = {}): AgentAutomationEffect {
    return { kind: "client-rule", ruleId: "rule-a", scheduleId: null, recipientType: "client", templateKey: "CLIENT_GREETING",
        change: "create", recipientDigest: hash("a"), sourceDigest: hash("b"), templateDigest: hash("c"),
        policyDigest: hash("d"), recipeDigest: hash("e"), ...overrides };
}
function record(overrides: Partial<AgentAutomationAuthority> = {}): AgentAutomationAuthority {
    const effects = [effect()];
    const data: AgentAutomationAuthority = { version: 1, id: "authority-1", scope, sequence: 1, previousId: null,
        origin: { kind: "task", userId: "user-a", actionId: "action-a", taskId: "task-a", taskRevision: 4, consentEventId: "answer-a" },
        decision: "allow", noSend: false, effects, scopeEffectDigest: agentAutomationEffectDigest(effects),
        reviewedEffectDigest: agentAutomationEffectDigest(effects), reviewedPolicyDigest: agentAutomationPolicyDigest(effects),
        recordedAt: "2026-09-17T00:00:00.000Z", recordDigest: "", ...overrides };
    return { ...data, recordDigest: agentAutomationRecordDigest(data) };
}
const resolve = (records: AgentAutomationAuthority[], knownTaskOrigin = false) => resolveAgentAutomationAuthority({
    records, scope, effect: effect(), currentScopeEffectDigest: agentAutomationEffectDigest([effect()]), knownTaskOrigin,
});

describe("canonical automation consent and append-only authority", () => {
    it("binds every member while ignoring input ordering", () => {
        const primary = effect({ kind: "employee-assignment", ruleId: "rule-b", scheduleId: 12, recipientType: "primary-employee" });
        const secondary = effect({ ...primary, recipientType: "secondary-employee", recipientDigest: hash("f") });
        const all = [effect(), primary, secondary];
        expect(agentAutomationEffectDigest(all)).toBe(agentAutomationEffectDigest([...all].reverse()));
        expect(agentAutomationPolicyDigest(all)).toBe(agentAutomationPolicyDigest([...all].reverse()));
        for (const changed of [all.slice(1), [...all, effect({ ruleId: "new-rule" })],
            [effect(), primary, { ...secondary, recipientDigest: hash("9") }],
            [effect(), primary, { ...secondary, policyDigest: hash("8") }],
            [effect(), primary, { ...secondary, templateDigest: hash("7") }]]) {
            expect(agentAutomationEffectDigest(changed)).not.toBe(agentAutomationEffectDigest(all));
        }
        expect(() => canonicalAgentAutomationEffects([effect(), effect({ sourceDigest: hash("9") })])).toThrow();
    });

    it("only uses legacy behavior when there is no known task-origin chain", () => {
        expect(resolve([]).status).toBe("legacy");
        expect(resolve([], true).status).toBe("refused");
        expect(resolve([record()]).status).toBe("allowed");
        expect(resolve([record({ decision: "deny" })]).status).toBe("suppressed");
        expect(resolve([record({ decision: "deny", noSend: true })]).status).toBe("suppressed");
        expect(resolve([record({ noSend: true })]).status).toBe("refused");
    });

    it("resolves a single append-only head and never falls back to stale yes", () => {
        const first = record();
        const next = record({ id: "authority-2", sequence: 2, previousId: first.id, decision: "deny",
            origin: { kind: "ordinary", mutationId: "mutation-2", operation: "client-write" } });
        expect(resolve([next, first]).status).toBe("suppressed");
        expect(resolve([next]).status).toBe("refused");
        expect(resolve([first, next, record({ ...next, id: "fork" })]).status).toBe("refused");
        expect(resolve([record({ ...next, sequence: 3 }), first]).status).toBe("refused");
        expect(resolve([record({ origin: next.origin })]).status).toBe("refused");
    });

    it("refuses mutated, foreign, reused-resource and mismatched-effect records", () => {
        for (const bad of [record({ scope: { ...scope, branchId: "other" } }),
            record({ scope: { ...scope, clientId: 52 } }), record({ scope: { ...scope, clientIdentity: hash("9") } }),
            { ...record(), decision: "deny" as const }, record({ scopeEffectDigest: hash("0") }),
            record({ effects: [effect({ recipientDigest: hash("9") })] })]) {
            expect(resolve([bad]).status).toBe("refused");
        }
    });
});
