import type { AgentAutomationAuthority, AgentAutomationCoverage, AgentAutomationEffect, AgentAutomationScope } from "domain/entities/agent-automation-consent";
import { agentAutomationEffectDigest, agentAutomationPolicyDigest, agentAutomationRecordDigest, agentAutomationScheduleIdentity } from "./agent-automation-consent";
import { agentAutomationCoverageLineageKey, agentAutomationCoverageRecordDigest, agentAutomationCoverageScope,
    agentAutomationGrandfatheredFingerprint, canonicalAgentAutomationGrandfatheredScopes } from "./agent-automation-coverage";
import { resolveAgentAutomationProvenance } from "./agent-automation-provenance";
import { AgentAutomationReceiptMetadataSchema, parseAgentAutomationCoverage } from "./agent-automation-storage.schema";

const id = (n: number) => `77000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (value: string) => value.repeat(64);
const scope: AgentAutomationScope = { branchId: id(1), clientId: 51, clientIdentity: digest("c"), kind: "client-rule",
    ruleId: "rule-a", scheduleId: null, scheduleIdentity: null, recipientType: "client" };
const effect: AgentAutomationEffect = { kind: "client-rule", ruleId: "rule-a", scheduleId: null, recipientType: "client",
    templateKey: "CLIENT_GREETING", change: "create", recipientDigest: digest("a"), sourceDigest: digest("b"),
    templateDigest: digest("c"), policyDigest: digest("d"), recipeDigest: digest("e") };
const origin = { kind: "task" as const, userId: id(2), actionId: id(3), taskId: id(4), taskRevision: 4, consentEventId: null };
function coverage(overrides: Partial<AgentAutomationCoverage> = {}): AgentAutomationCoverage {
    const record: AgentAutomationCoverage = { kind: "coverage", version: 1, id: id(5), scope: agentAutomationCoverageScope(scope),
        sequence: 1, previousId: null, origin, mutationDigest: digest("f"), grandfatheredScopes: [],
        recordedAt: "2026-09-17T00:00:00.000Z", recordDigest: "", ...overrides };
    return { ...record, recordDigest: agentAutomationCoverageRecordDigest(record) };
}
function authority(overrides: Partial<AgentAutomationAuthority> = {}): AgentAutomationAuthority {
    const record: AgentAutomationAuthority = { version: 1, id: id(6), scope, sequence: 1, previousId: null,
        origin: { ...origin, consentEventId: id(7) }, decision: "allow", noSend: false, effects: [effect],
        scopeEffectDigest: agentAutomationEffectDigest([effect]), reviewedEffectDigest: agentAutomationEffectDigest([effect]),
        reviewedPolicyDigest: agentAutomationPolicyDigest([effect]), recordedAt: "2026-09-17T00:00:00.000Z", recordDigest: "", ...overrides };
    return { ...record, recordDigest: agentAutomationRecordDigest(record) };
}
const grandfathered = () => ({ scope, fingerprint: agentAutomationGrandfatheredFingerprint(effect) });
function resolve(coverageRows: unknown[] = [], exactRows: unknown[] = [], overrides: Partial<Parameters<typeof resolveAgentAutomationProvenance>[0]> = {}) {
    return resolveAgentAutomationProvenance({ scope, effect, coverageRows, exactRows, knownCoverageProvenance: !!coverageRows.length,
        knownExactProvenance: !!exactRows.length, currentScopeEffectDigest: agentAutomationEffectDigest([effect]), ...overrides });
}

describe("operation coverage without fabricated rules or send authority", () => {
    it("retains missing-default and empty-effect task provenance when a rule is introduced later", () => {
        const fence = coverage();
        expect(parseAgentAutomationCoverage(fence)).toEqual(fence);
        expect(fence.grandfatheredScopes).toEqual([]);
        expect(resolve()).toEqual({ status: "legacy" });
        expect(resolve([fence])).toEqual({ status: "refused", reason: "missing-authority" });
        const newRule = { ...scope, ruleId: "introduced-later" };
        expect(resolve([fence], [], { scope: newRule, effect: { ...effect, ruleId: newRule.ruleId } }))
            .toEqual({ status: "refused", reason: "missing-authority" });
    });

    it("preserves only an exact independently authorized recipe, not future or changed rules", () => {
        const fence = coverage({ grandfatheredScopes: [grandfathered()] });
        expect(resolve([fence]).status).toBe("grandfathered");
        for (const changed of [{ ...effect, recipientDigest: digest("9") }, { ...effect, sourceDigest: digest("9") },
            { ...effect, templateDigest: digest("9") }, { ...effect, policyDigest: digest("9") }, { ...effect, recipeDigest: digest("9") }]) {
            expect(resolve([fence], [], { effect: changed })).toEqual({ status: "refused", reason: "missing-authority" });
        }
        expect(resolve([fence], [], { effect: { ...effect, change: "refresh" } }).status).toBe("grandfathered");
        expect(resolve([fence], [], { scope: { ...scope, ruleId: "rule-b" }, effect: { ...effect, ruleId: "rule-b" } }).status).toBe("refused");
    });

    it("allows a fresh exact approved member after provisioning without opening other rules", () => {
        const fence = coverage();
        expect(resolve([fence], [authority()]).status).toBe("allowed");
        expect(resolve([fence], [], { scope: { ...scope, ruleId: "rule-b" }, effect: { ...effect, ruleId: "rule-b" } }).status).toBe("refused");
        expect(resolve([fence], [authority({ decision: "deny", noSend: true })]).status).toBe("suppressed");
    });

    it("does not use a grandfathered entry to bypass a missing, invalid or stale exact lineage", () => {
        const fence = coverage({ grandfatheredScopes: [grandfathered()] });
        expect(resolve([fence], [], { knownExactProvenance: true })).toEqual({ status: "refused", reason: "missing-authority" });
        expect(resolve([fence], [{ ...authority(), decision: "deny" }])).toEqual({ status: "refused", reason: "invalid-chain" });
        expect(resolve([fence], [authority()], { currentScopeEffectDigest: digest("9") })).toEqual({ status: "refused", reason: "source-mismatch" });
    });

    it("validates coverage even when an exact allow record exists", () => {
        expect(resolve([{ ...coverage(), recordDigest: digest("0") }], [authority()])).toEqual({ status: "refused", reason: "invalid-chain" });
        expect(resolve([], [authority()], { knownCoverageProvenance: true })).toEqual({ status: "refused", reason: "missing-authority" });
    });

    it("resolves one complete task-rooted chain and refuses missing heads, forks or ordinary roots", () => {
        const root = coverage();
        const second = coverage({ id: id(8), sequence: 2, previousId: root.id, grandfatheredScopes: [grandfathered()],
            origin: { kind: "ordinary", mutationId: id(9), operation: "client-write" } });
        expect(resolve([second, root]).status).toBe("grandfathered");
        for (const rows of [[second], [root, second, coverage({ ...second, id: id(10) })],
            [root, coverage({ ...second, sequence: 3 })], [coverage({ origin: second.origin })]]) {
            expect(resolve(rows)).toEqual({ status: "refused", reason: "invalid-chain" });
        }
    });

    it("cannot turn physical malformed provenance into absent legacy history", () => {
        for (const raw of [null, {}, { version: 2 }, { ...coverage(), grandfatheredScopes: "*" },
            { ...coverage(), origin: { kind: "scheduler" } }]) {
            expect(resolve([raw], [], { knownCoverageProvenance: false })).toEqual({ status: "refused", reason: "invalid-chain" });
        }
        expect(resolve([], [], { knownCoverageProvenance: true })).toEqual({ status: "refused", reason: "missing-authority" });
    });

    it("refuses raw extra fields, wildcards and copied approvals even if checksums are recomputed", () => {
        const record = coverage();
        for (const extra of [{ approved: true }, { phone: "01000000041" }, { body: "private" }, { ruleId: "invented-rule" }]) {
            const changed = { ...record, ...extra };
            changed.recordDigest = agentAutomationCoverageRecordDigest(changed);
            expect(parseAgentAutomationCoverage(changed)).toBeNull();
        }
        const wildcard = { ...record, grandfatheredScopes: [{ scope: { ...scope, ruleId: "*" }, fingerprint: digest("a") }] };
        wildcard.recordDigest = agentAutomationCoverageRecordDigest(wildcard);
        expect(parseAgentAutomationCoverage(wildcard)).toBeNull();
    });

    it("does not accept manual sends/retries as operation-coverage replacements", () => {
        const root = coverage();
        for (const operation of ["manual-message", "agent-message-retry"] as const) {
            const changed = coverage({ id: id(8), sequence: 2, previousId: root.id,
                origin: { kind: "ordinary", mutationId: id(9), operation }, grandfatheredScopes: [grandfathered()] });
            expect(parseAgentAutomationCoverage(changed)).toBeNull();
            expect(resolve([root, changed])).toEqual({ status: "refused", reason: "invalid-chain" });
        }
    });

    it("separates operation families and recipients and refuses reused client/schedule identities", () => {
        const fence = coverage();
        const otherClient = { ...scope, clientIdentity: digest("9") };
        expect(agentAutomationCoverageLineageKey(agentAutomationCoverageScope(otherClient))).toBe(agentAutomationCoverageLineageKey(fence.scope));
        expect(resolve([fence], [], { scope: otherClient })).toEqual({ status: "refused", reason: "scope-mismatch" });
        const scheduled: AgentAutomationScope = { ...scope, kind: "employee-assignment", scheduleId: 12,
            scheduleIdentity: agentAutomationScheduleIdentity(id(11)), recipientType: "primary-employee" };
        const scheduleEffect: AgentAutomationEffect = { ...effect, kind: "employee-assignment", scheduleId: 12,
            templateKey: "EMPLOYEE_ASSIGNED", recipientType: "primary-employee" };
        const scheduleFence = coverage({ scope: agentAutomationCoverageScope(scheduled) });
        expect(resolve([scheduleFence], [], { scope: { ...scheduled, scheduleIdentity: agentAutomationScheduleIdentity(id(12)) }, effect: scheduleEffect }))
            .toEqual({ status: "refused", reason: "scope-mismatch" });
        expect(agentAutomationCoverageLineageKey({ ...scheduleFence.scope, recipientType: "secondary-employee" }))
            .not.toBe(agentAutomationCoverageLineageKey(scheduleFence.scope));
        expect(resolve([fence], [], { scope: { ...scope, branchId: id(12) } }).status).toBe("refused");
    });

    it("cannot match a fingerprint for a different scope or malformed effect", () => {
        const fence = coverage({ grandfatheredScopes: [grandfathered()] });
        expect(resolve([fence], [], { effect: { ...effect, ruleId: "rule-b" } })).toEqual({ status: "refused", reason: "scope-mismatch" });
        expect(resolve([], [], { effect: { ...effect, templateKey: "SERVICE_RECORD_LINK" } })).toEqual({ status: "refused", reason: "scope-mismatch" });
    });

    it("canonicalizes finite grandfathered sets and refuses duplicate or foreign lineages", () => {
        const first = grandfathered();
        const second = { scope: { ...scope, ruleId: "rule-b" }, fingerprint: digest("9") };
        expect(coverage({ grandfatheredScopes: [first, second] }).recordDigest).toBe(coverage({ grandfatheredScopes: [second, first] }).recordDigest);
        for (const members of [[first, first], [{ ...first, scope: { ...scope, clientIdentity: digest("9") } }], Array(501).fill(first)]) {
            expect(() => canonicalAgentAutomationGrandfatheredScopes(agentAutomationCoverageScope(scope), members)).toThrow();
        }
    });

    it("binds coverage-only committed receipts while keeping empty or duplicate references invalid", () => {
        const metadata = { version: 1, taskId: id(4), taskRevision: 4, questionRef: id(13),
            reviewedEffectDigest: agentAutomationEffectDigest([]), reviewedPolicyDigest: agentAutomationPolicyDigest([]),
            authorities: [], coverages: [{ id: id(5), recordDigest: coverage().recordDigest, scopeDigest: digest("a") }] };
        expect(AgentAutomationReceiptMetadataSchema.safeParse(metadata).success).toBe(true);
        expect(AgentAutomationReceiptMetadataSchema.safeParse({ ...metadata, coverages: [] }).success).toBe(false);
        expect(AgentAutomationReceiptMetadataSchema.safeParse({ ...metadata, authorities: metadata.coverages }).success).toBe(false);
        expect(AgentAutomationReceiptMetadataSchema.safeParse({ ...metadata, coverages: [...metadata.coverages, ...metadata.coverages] }).success).toBe(false);
        expect(AgentAutomationReceiptMetadataSchema.safeParse({ ...metadata, authorities: metadata.coverages, coverages: undefined }).success).toBe(true);
    });
});
