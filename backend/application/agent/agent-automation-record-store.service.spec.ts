import type { AgentAutomationAuthority, AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { AGENT_AUTOMATION_RECORD_PAYLOAD_KEY } from "domain/constants/agent-automation-storage";
import { agentAutomationEffectDigest, agentAutomationRecordDigest } from "./agent-automation-consent";
import { AgentAutomationRecordRefusedError, AgentAutomationRecordStoreService } from "./agent-automation-record-store.service";

const branchId = "76000000-0000-4000-8000-000000000001";
const scheduleIncarnationId = "76000000-0000-4000-8000-000000000002";
const mutationId = "76000000-0000-4000-8000-000000000003";
const taskId = "76000000-0000-4000-8000-000000000004";
const digest = "a".repeat(64);

function employeeAssignmentEffect(change: AgentAutomationEffect["change"] = "refresh"): AgentAutomationEffect {
    return {
        kind: "employee-assignment",
        ruleId: "assignment-rule",
        scheduleId: 7,
        recipientType: "primary-employee",
        templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        change,
        recipientDigest: digest,
        sourceDigest: digest,
        templateDigest: digest,
        policyDigest: digest,
        recipeDigest: digest,
    };
}

function taskAuthority(effect: AgentAutomationEffect, decision: AgentAutomationAuthority["decision"] = "allow"): AgentAutomationAuthority {
    const record: AgentAutomationAuthority = {
        version: 1,
        id: "76000000-0000-4000-8000-000000000005",
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
            userId: "76000000-0000-4000-8000-000000000006",
            actionId: "76000000-0000-4000-8000-000000000007",
            taskId,
            taskRevision: 1,
            consentEventId: "76000000-0000-4000-8000-000000000008",
        },
        decision,
        noSend: decision !== "allow",
        effects: [effect],
        scopeEffectDigest: agentAutomationEffectDigest([effect]),
        reviewedEffectDigest: digest,
        reviewedPolicyDigest: digest,
        recordedAt: "2026-09-18T00:00:00.000Z",
        recordDigest: "",
    };
    return { ...record, recordDigest: agentAutomationRecordDigest(record) };
}

function ordinaryAuthority(effect: AgentAutomationEffect): AgentAutomationAuthority {
    const origin = { kind: "ordinary" as const, mutationId, operation: "schedule-write" as const };
    const record: AgentAutomationAuthority = {
        ...taskAuthority(effect),
        id: "76000000-0000-4000-8000-000000000009",
        sequence: 2,
        previousId: "76000000-0000-4000-8000-000000000005",
        origin,
        decision: "deny",
        noSend: true,
        effects: [effect],
        scopeEffectDigest: agentAutomationEffectDigest([effect]),
        reviewedEffectDigest: agentAutomationEffectDigest([effect]),
        recordedAt: "2026-09-18T00:01:00.000Z",
        recordDigest: "",
    };
    return { ...record, recordDigest: agentAutomationRecordDigest(record) };
}

function transaction() {
    return {
        client: {
            findFirst: jest.fn().mockResolvedValue({ id: 41, createdAt: new Date("2026-01-01T00:00:00.000Z") }),
        },
        employee_schedule: {
            findMany: jest.fn().mockResolvedValue([{ id: 7, incarnationId: scheduleIncarnationId }]),
            findFirst: jest.fn().mockResolvedValue({ incarnationId: scheduleIncarnationId }),
        },
        message_trigger_rule: {
            findMany: jest.fn().mockResolvedValue([{ id: "assignment-rule", branchId }]),
        },
        message_trigger_job: {
            create: jest.fn().mockResolvedValue(undefined),
        },
    };
}

describe("AgentAutomationRecordStoreService schedule-write successors", () => {
    it("appends one same-transaction cancellation successor for an allowed task scope", async () => {
        const tx = transaction();
        const branchLocks = {
            runExclusive: jest.fn(async (_branch: string, work: (value: typeof tx) => Promise<unknown>) => work(tx)),
        };
        const store = new AgentAutomationRecordStoreService(branchLocks as never);
        const effect = employeeAssignmentEffect();
        jest.spyOn(store, "readLineageEvidence").mockImplementation(async (_transaction, scope) => ({
            batch: {
                authorities: scope.ruleId === effect.ruleId && scope.recipientType === effect.recipientType
                    ? [taskAuthority(effect)] : [],
                coverages: [],
            },
            creationSubjects: [],
        }));

        await store.appendScheduleWriteFence(tx as never, {
            branchId,
            clientId: 41,
            mutationId,
            scheduleIds: [7],
        });

        expect(tx.message_trigger_job.create).toHaveBeenCalledTimes(1);
        const payload = tx.message_trigger_job.create.mock.calls[0]![0].data.payload;
        const terminal = payload[AGENT_AUTOMATION_RECORD_PAYLOAD_KEY];
        expect(terminal.commit).toEqual(expect.objectContaining({
            kind: "ordinary",
            mutationId,
            operation: "schedule-write",
            resourceId: 41,
        }));
        expect(terminal.record.effects[0]).toEqual({ ...effect, change: "cancel" });
    });

    it.each([
        ["deny", taskAuthority(employeeAssignmentEffect(), "deny")],
        ["noSend", { ...taskAuthority(employeeAssignmentEffect()), noSend: true }],
    ])("preserves an explicit task %s decision without appending an ordinary successor", async (_label, authority) => {
        const tx = transaction();
        const branchLocks = {
            runExclusive: jest.fn(async (_branch: string, work: (value: typeof tx) => Promise<unknown>) => work(tx)),
        };
        const store = new AgentAutomationRecordStoreService(branchLocks as never);
        jest.spyOn(store, "readLineageEvidence").mockResolvedValue({
            batch: { authorities: [authority], coverages: [] },
            creationSubjects: [],
        });

        await store.appendScheduleWriteFence(tx as never, {
            branchId,
            clientId: 41,
            mutationId,
            scheduleIds: [7],
        });

        expect(tx.message_trigger_job.create).not.toHaveBeenCalled();
    });

    it("fails closed when an identity-free lineage resolves to a stale schedule incarnation", async () => {
        const tx = transaction();
        const branchLocks = {
            runExclusive: jest.fn(async (_branch: string, work: (value: typeof tx) => Promise<unknown>) => work(tx)),
        };
        const store = new AgentAutomationRecordStoreService(branchLocks as never);
        jest.spyOn(store, "readLineageEvidence").mockRejectedValue(new AgentAutomationRecordRefusedError());

        await expect(store.appendScheduleWriteFence(tx as never, {
            branchId,
            clientId: 41,
            mutationId,
            scheduleIds: [7],
        })).rejects.toBeInstanceOf(AgentAutomationRecordRefusedError);
        expect(tx.message_trigger_job.create).not.toHaveBeenCalled();
    });

    it("is idempotent for a replayed ordinary mutation and refuses a changed duplicate", async () => {
        const effect = employeeAssignmentEffect("cancel");
        const tx = transaction();
        const branchLocks = {
            runExclusive: jest.fn(async (_branch: string, work: (value: typeof tx) => Promise<unknown>) => work(tx)),
        };
        const store = new AgentAutomationRecordStoreService(branchLocks as never);
        jest.spyOn(store, "readLineageEvidence").mockResolvedValue({
            batch: { authorities: [ordinaryAuthority(effect)], coverages: [] },
            creationSubjects: [],
        });

        await store.appendOrdinarySuccessors(tx as never, {
            branchId,
            clientId: 41,
            mutationId,
            operation: "schedule-write",
            effects: [effect],
        });
        expect(tx.message_trigger_job.create).not.toHaveBeenCalled();

        await expect(store.appendOrdinarySuccessors(tx as never, {
            branchId,
            clientId: 41,
            mutationId,
            operation: "schedule-write",
            effects: [{ ...effect, sourceDigest: "b".repeat(64) }],
        })).rejects.toBeInstanceOf(AgentAutomationRecordRefusedError);
    });
});
