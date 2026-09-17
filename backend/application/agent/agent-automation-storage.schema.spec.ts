import type { AgentAutomationAuthority, AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import { agentAutomationEffectDigest, agentAutomationPolicyDigest, agentAutomationRecordDigest } from "./agent-automation-consent";
import { parseAgentAutomationAuthority, parseAgentAutomationJobSeal } from "./agent-automation-storage.schema";

const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64);
function authority(): AgentAutomationAuthority {
    const effects: AgentAutomationEffect[] = [{ kind: "client-rule", ruleId: "rule-a", scheduleId: null,
        recipientType: "client", templateKey: "CLIENT_GREETING", change: "create", recipientDigest: hash,
        sourceDigest: hash, templateDigest: hash, policyDigest: hash, recipeDigest: hash }];
    const record: AgentAutomationAuthority = { version: 1, id: id(1), scope: { branchId: id(2), clientId: 1,
        clientIdentity: hash, kind: "client-rule", ruleId: "rule-a", recipientType: "client", scheduleId: null, scheduleIdentity: null }, sequence: 1, previousId: null,
        origin: { kind: "task", userId: id(3), actionId: id(4), taskId: id(5), taskRevision: 4, consentEventId: id(6) },
        decision: "allow", noSend: false, effects, scopeEffectDigest: agentAutomationEffectDigest(effects),
        reviewedEffectDigest: agentAutomationEffectDigest(effects), reviewedPolicyDigest: agentAutomationPolicyDigest(effects),
        recordedAt: "2026-09-17T00:00:00.000Z", recordDigest: "" };
    return { ...record, recordDigest: agentAutomationRecordDigest(record) };
}

describe("strict private automation storage", () => {
    it("round-trips the digest-only record and refuses extra fields even with a recomputed checksum", () => {
        const record = authority();
        expect(parseAgentAutomationAuthority(JSON.parse(JSON.stringify(record)))).toEqual(record);
        for (const extra of [{ phone: "01012345678" }, { body: "private" }, { approved: true }]) {
            const injected = { ...record, ...extra };
            injected.recordDigest = agentAutomationRecordDigest(injected);
            expect(parseAgentAutomationAuthority(injected)).toBeNull();
        }
    });

    it("rejects inconsistent consent, member scope, hashes and unknown versions", () => {
        const record = authority();
        for (const changed of [{ ...record, version: 2 }, { ...record, decision: "deny" },
            { ...record, noSend: true }, { ...record, effects: [{ ...record.effects[0]!, scheduleId: 12 }] },
            { ...record, origin: { ...record.origin, consentEventId: null } },
            { ...record, scopeEffectDigest: "b".repeat(64) }]) {
            expect(parseAgentAutomationAuthority(changed)).toBeNull();
        }
        const denied = { ...record, decision: "deny" as const, noSend: true };
        denied.recordDigest = agentAutomationRecordDigest(denied);
        expect(parseAgentAutomationAuthority(denied)).not.toBeNull();
    });

    it("treats a job seal as a finite reference, never as a caller-provided approval", () => {
        const record = authority();
        const seal = { version: 1, authorityId: record.id, authorityDigest: record.recordDigest,
            scope: record.scope, memberDigest: agentAutomationEffectDigest(record.effects), reviewedEffectDigest: record.reviewedEffectDigest };
        expect(parseAgentAutomationJobSeal(seal)).toEqual(seal);
        expect(parseAgentAutomationJobSeal({ ...seal, approved: true })).toBeNull();
        expect(parseAgentAutomationJobSeal({ authorityId: record.id })).toBeNull();
        expect(parseAgentAutomationJobSeal({ ...seal, scope: { ...seal.scope, recipientPhone: "01012345678" } })).toBeNull();
    });
});
