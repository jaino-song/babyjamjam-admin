import type { AgentAutomationAuthority, AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { AgentAutomationRecordStoreService } from "./agent-automation-record-store.service";

const branchId = "76000000-0000-4000-8000-000000000001";
const scheduleIncarnationId = "76000000-0000-4000-8000-000000000002";
const mutationId = "76000000-0000-4000-8000-000000000003";
const digest = "a".repeat(64);

function employeeAssignmentEffect(): AgentAutomationEffect {
    return {
        kind: "employee-assignment",
        ruleId: "assignment-rule",
        scheduleId: 7,
        recipientType: "primary-employee",
        templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        change: "refresh",
        recipientDigest: digest,
        sourceDigest: digest,
        templateDigest: digest,
        policyDigest: digest,
        recipeDigest: digest,
    };
}

function taskAuthority(effect: AgentAutomationEffect): AgentAutomationAuthority {
    return {
        version: 1,
        id: "76000000-0000-4000-8000-000000000004",
        scope: {
            branchId,
            clientId: 41,
            clientIdentity: digest,
            kind: effect.kind,
            ruleId: effect.ruleId,
            scheduleId: effect.scheduleId,
            scheduleIdentity: digest,
            recipientType: effect.recipientType,
        },
        sequence: 1,
        previousId: null,
        origin: {
            kind: "task",
            userId: "76000000-0000-4000-8000-000000000005",
            actionId: "76000000-0000-4000-8000-000000000006",
            taskId: "76000000-0000-4000-8000-000000000007",
            taskRevision: 1,
            consentEventId: "76000000-0000-4000-8000-000000000008",
        },
        decision: "allow",
        noSend: false,
        effects: [effect],
        scopeEffectDigest: digest,
        reviewedEffectDigest: digest,
        reviewedPolicyDigest: digest,
        recordedAt: "2026-09-18T00:00:00.000Z",
        recordDigest: digest,
    };
}

describe("AgentAutomationRecordStoreService schedule-write fence", () => {
    it("appends a same-transaction cancellation for an allowed task schedule scope", async () => {
        const transaction = {
            client: { findFirst: jest.fn().mockResolvedValue({ id: 41, createdAt: new Date("2026-01-01T00:00:00.000Z") }) },
            employee_schedule: {
                findMany: jest.fn().mockResolvedValue([{ id: 7, incarnationId: scheduleIncarnationId }]),
            },
            message_trigger_rule: {
                findMany: jest.fn().mockResolvedValue([{ id: "assignment-rule", branchId }]),
            },
        };
        const branchLocks = {
            runExclusive: jest.fn(async (_branch: string, work: (tx: typeof transaction) => Promise<unknown>) => work(transaction)),
        };
        const store = new AgentAutomationRecordStoreService(branchLocks as never);
        const effect = employeeAssignmentEffect();
        jest.spyOn(store, "readLineageEvidence").mockResolvedValue({
            batch: { authorities: [taskAuthority(effect)], coverages: [] },
            creationSubjects: [],
        });
        const append = jest.spyOn(store, "appendOrdinarySuccessors").mockResolvedValue(undefined);

        await store.appendScheduleWriteFence(transaction as never, {
            branchId,
            clientId: 41,
            mutationId,
            scheduleIds: [7],
        });

        expect(append).toHaveBeenCalledWith(transaction, {
            branchId,
            clientId: 41,
            mutationId,
            operation: "schedule-write",
            effects: [{ ...effect, change: "cancel" }],
        });
    });

    it("does not create a successor for an already denied task scope", async () => {
        const transaction = {
            client: { findFirst: jest.fn().mockResolvedValue({ id: 41, createdAt: new Date("2026-01-01T00:00:00.000Z") }) },
            employee_schedule: {
                findMany: jest.fn().mockResolvedValue([{ id: 7, incarnationId: scheduleIncarnationId }]),
            },
            message_trigger_rule: {
                findMany: jest.fn().mockResolvedValue([{ id: "assignment-rule", branchId }]),
            },
        };
        const branchLocks = {
            runExclusive: jest.fn(async (_branch: string, work: (tx: typeof transaction) => Promise<unknown>) => work(transaction)),
        };
        const store = new AgentAutomationRecordStoreService(branchLocks as never);
        const effect = employeeAssignmentEffect();
        jest.spyOn(store, "readLineageEvidence").mockResolvedValue({
            batch: { authorities: [{ ...taskAuthority(effect), decision: "deny", noSend: true }], coverages: [] },
            creationSubjects: [],
        });
        const append = jest.spyOn(store, "appendOrdinarySuccessors").mockResolvedValue(undefined);

        await store.appendScheduleWriteFence(transaction as never, {
            branchId,
            clientId: 41,
            mutationId,
            scheduleIds: [7],
        });

        expect(append).not.toHaveBeenCalled();
    });
});
