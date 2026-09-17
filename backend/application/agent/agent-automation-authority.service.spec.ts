import type { Prisma } from "@prisma/client";
import type { AgentAutomationCoverage, AgentAutomationEffect, AgentAutomationScope } from "domain/entities/agent-automation-consent";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { AgentAutomationRecordStoreService, agentAutomationTaskCommitReference } from "./agent-automation-record-store.service";
import { AgentAutomationAuthorityService } from "./agent-automation-authority.service";
import { agentAutomationCoverageRecordDigest, agentAutomationCoverageScope, agentAutomationGrandfatheredFingerprint } from "./agent-automation-coverage";

const id = (n: number) => `88000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (value: string) => agentBindingHash(value);
const branchId = id(1);
const clientId = 73;
const createdAt = new Date("2026-09-18T00:00:00.000Z");
const clientIdentity = agentBindingHash({ version: 1, resource: "client", id: clientId, createdAt: createdAt.toISOString() });
const scope: AgentAutomationScope = {
    branchId,
    clientId,
    clientIdentity,
    kind: "client-rule",
    ruleId: "rule-grandfathered",
    scheduleId: null,
    scheduleIdentity: null,
    recipientType: "client",
};
const effect: AgentAutomationEffect = {
    kind: "client-rule",
    ruleId: scope.ruleId,
    scheduleId: null,
    recipientType: "client",
    templateKey: "CLIENT_GREETING",
    change: "create",
    recipientDigest: digest("recipient"),
    sourceDigest: digest("source"),
    templateDigest: digest("template"),
    policyDigest: digest("policy"),
    recipeDigest: digest("recipe"),
};
const origin = {
    kind: "task" as const,
    userId: id(2),
    actionId: id(3),
    taskId: id(4),
    taskRevision: 2,
    consentEventId: null,
};

function coverageRecord(overrides: Partial<AgentAutomationCoverage> = {}): AgentAutomationCoverage {
    const record: AgentAutomationCoverage = {
        kind: "coverage",
        version: 1,
        id: id(5),
        scope: agentAutomationCoverageScope(scope),
        sequence: 1,
        previousId: null,
        origin,
        mutationDigest: digest("mutation"),
        grandfatheredScopes: [{ scope, fingerprint: agentAutomationGrandfatheredFingerprint(effect) }],
        recordedAt: "2026-09-18T00:01:00.000Z",
        recordDigest: "",
        ...overrides,
    };
    return { ...record, recordDigest: agentAutomationCoverageRecordDigest(record) };
}

function setup(record = coverageRecord()) {
    const records = {
        readLineageEvidence: jest.fn().mockResolvedValue({
            batch: { authorities: [], coverages: [record] },
            creationSubjects: [],
        }),
        verifyTaskCommitReference: jest.fn().mockResolvedValue(true),
    } as unknown as AgentAutomationRecordStoreService;
    const transaction = {
        client: {
            findFirst: jest.fn().mockResolvedValue({ id: clientId, createdAt }),
        },
        employee_schedule: { findFirst: jest.fn() },
    } as unknown as Prisma.TransactionClient;
    const authority = new AgentAutomationAuthorityService(records);
    const taskReference = agentAutomationTaskCommitReference({
        actionId: origin.actionId,
        taskId: origin.taskId,
        taskRevision: origin.taskRevision,
        batch: { authorities: [], coverages: [record] },
    });
    return { authority, records, transaction, taskReference };
}

const target = {
    branchId,
    clientId,
    kind: scope.kind,
    ruleId: scope.ruleId,
    scheduleId: null,
    recipientType: scope.recipientType,
} as const;

async function check(
    setupValue: ReturnType<typeof setup>,
    input: Parameters<AgentAutomationAuthorityService["check"]>[1] = {
        target,
        mode: "materialize",
        concreteJobDigest: digest("job"),
        taskReference: setupValue.taskReference,
    },
    currentEffect: AgentAutomationEffect = effect,
) {
    return setupValue.authority.check(setupValue.transaction, input, async () => currentEffect);
}

describe("AgentAutomationAuthorityService coverage task references", () => {
    it("accepts a coverage-only task carrier using the canonical rule-free coverage scope", async () => {
        const value = setup();
        await expect(check(value)).resolves.toEqual({ status: "legacy" });
        expect(value.records.verifyTaskCommitReference).toHaveBeenCalledWith(value.transaction, value.taskReference, branchId);
    });

    it("still requires the grandfathered exact rule and fingerprint", async () => {
        const value = setup();
        await expect(check(value, {
            target: { ...target, ruleId: "rule-not-grandfathered" },
            mode: "materialize",
            concreteJobDigest: digest("job"),
            taskReference: value.taskReference,
        }, { ...effect, ruleId: "rule-not-grandfathered" })).resolves.toMatchObject({
            status: "refused",
            reason: "automation-consent-denied",
        });

        const stale = setup();
        stale.records.verifyTaskCommitReference = jest.fn().mockResolvedValue(false) as never;
        await expect(check(stale)).resolves.toMatchObject({ status: "refused" });
    });

    it("refuses missing and cross-branch coverage carriers", async () => {
        const missing = setup();
        await expect(check(missing, {
            target,
            mode: "materialize",
            concreteJobDigest: digest("job"),
        })).resolves.toMatchObject({ status: "refused" });

        const crossBranch = setup();
        await expect(check(crossBranch, {
            target: { ...target, branchId: id(9) },
            mode: "materialize",
            concreteJobDigest: digest("job"),
            taskReference: crossBranch.taskReference,
        })).resolves.toMatchObject({ status: "refused" });
    });
});
