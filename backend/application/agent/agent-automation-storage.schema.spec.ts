import type { AgentAutomationAuthority, AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import { agentAutomationEffectDigest, agentAutomationPolicyDigest, agentAutomationRecordDigest } from "./agent-automation-consent";
import { AgentAutomationEffectStorageSchema, AgentAutomationScopeStorageSchema, parseAgentAutomationAuthority, parseAgentAutomationJobSeal } from "./agent-automation-storage.schema";

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
            scope: record.scope, memberDigest: agentAutomationEffectDigest(record.effects), reviewedEffectDigest: record.reviewedEffectDigest, concreteJobDigest: "a".repeat(64) };
        expect(parseAgentAutomationJobSeal(seal)).toEqual(seal);
        expect(parseAgentAutomationJobSeal({ ...seal, approved: true })).toBeNull();
        expect(parseAgentAutomationJobSeal({ authorityId: record.id })).toBeNull();
        expect(parseAgentAutomationJobSeal({ ...seal, concreteJobDigest: undefined })).toBeNull();
        expect(parseAgentAutomationJobSeal({ ...seal, scope: { ...seal.scope, recipientPhone: "01012345678" } })).toBeNull();
    });

    it("requires an exact nonempty affected set for deny and noSend records", () => {
        for (const noSend of [false, true]) {
            const denied = { ...authority(), decision: "deny" as const, noSend, effects: [], scopeEffectDigest: agentAutomationEffectDigest([]) };
            denied.recordDigest = agentAutomationRecordDigest(denied);
            expect(parseAgentAutomationAuthority(denied)).toBeNull();
        }
    });

    it("accepts only the canonical template, recipient and dedicated rule combinations", () => {
        const client = authority().effects[0]!;
        const employee = { ...client, kind: "employee-assignment" as const, scheduleId: 12,
            recipientType: "primary-employee" as const, templateKey: "EMPLOYEE_ASSIGNED" as const };
        const link = { ...employee, kind: "service-record-link" as const,
            ruleId: "system:service_record_link", templateKey: "SERVICE_RECORD_LINK" as const };
        for (const valid of [client, employee, { ...employee, recipientType: "secondary-employee" }, link]) {
            expect(AgentAutomationEffectStorageSchema.safeParse(valid).success).toBe(true);
        }
        for (const invalid of [
            { ...client, templateKey: "SERVICE_RECORD_LINK" }, { ...client, templateKey: "EMPLOYEE_ASSIGNED" },
            { ...client, ruleId: "system:service_record_link" }, { ...client, ruleId: "agent-sms:forged" },
            { ...employee, templateKey: "INFO" }, { ...employee, recipientType: "client" },
            { ...employee, ruleId: "system:service_record_link" }, { ...link, templateKey: "INFO" },
            { ...link, recipientType: "secondary-employee" }, { ...link, ruleId: "rule-a" },
            { ...link, scheduleId: null },
        ]) expect(AgentAutomationEffectStorageSchema.safeParse(invalid).success).toBe(false);
        const linkScope = { ...authority().scope, kind: link.kind, ruleId: link.ruleId,
            scheduleId: 12, scheduleIdentity: hash, recipientType: link.recipientType };
        expect(AgentAutomationScopeStorageSchema.safeParse(linkScope).success).toBe(true);
        for (const invalid of [{ ...linkScope, recipientType: "secondary-employee" }, { ...linkScope, ruleId: "rule-a" },
            { ...linkScope, scheduleIdentity: null }, { ...linkScope, kind: "employee-assignment" }]) {
            expect(AgentAutomationScopeStorageSchema.safeParse(invalid).success).toBe(false);
        }
    });
});
