import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { AgentTask } from "@babyjamjam/shared";
import { AgentTaskService } from "./agent-task.service";
import { AgentTaskPolicyService } from "./agent-task-policy.service";
import { ConversationTaskOrchestratorService } from "./conversation-task-orchestrator.service";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

const principal: VerifiedTenantPrincipal = {
    userId: randomUUID(),
    branchId: randomUUID(),
    globalRole: "admin",
    branchRole: "manager",
};
const sessionId = randomUUID();

function task(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
        schemaVersion: 1,
        taskId: randomUUID(),
        sessionId,
        kind: "clients.create",
        capabilityId: "clients.create",
        revision: 1,
        state: "collecting",
        confirmed: {},
        tentative: {},
        clearedFields: [],
        provenance: { confirmed: {}, tentative: {} },
        issues: [],
        constraints: { noSend: false },
        choiceSets: [],
        orderedChoiceRefs: [],
        target: null,
        consent: { choice: "unanswered", binding: null },
        action: null,
        times: {
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            acceptedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-02-01T00:00:00.000Z",
        },
        currentSnapshotRef: randomUUID(),
        ...overrides,
    };
}

function receipt(taskId: string) {
    return {
        taskId,
        eventId: randomUUID(),
        eventHash: "a".repeat(64),
        acceptedRevision: 1,
        currentSnapshotRef: randomUUID(),
    };
}

function build(tasksOverrides: Record<string, jest.Mock> = {}, policyOverrides: Record<string, jest.Mock> = {}) {
    const tasks = {
        replayConversationIntake: jest.fn().mockResolvedValue(null),
        listForConversation: jest.fn().mockResolvedValue([]),
        recordConversationIntake: jest.fn(),
        createFromConversation: jest.fn(),
        patchFromConversation: jest.fn(),
        commandFromConversation: jest.fn(),
        get: jest.fn(),
        attachChoices: jest.fn(),
        ...tasksOverrides,
    } as unknown as AgentTaskService;
    const policy = {
        assertCanCreate: jest.fn().mockResolvedValue(undefined),
        ...policyOverrides,
    } as unknown as AgentTaskPolicyService;
    return { orchestrator: new ConversationTaskOrchestratorService(tasks, policy), tasks, policy };
}

describe("ConversationTaskOrchestratorService", () => {
    it("leaves a pure question as a question without recording a task mutation", async () => {
        const current = task();
        const listForConversation = jest.fn().mockResolvedValue([current]);
        const recordConversationIntake = jest.fn();
        const { orchestrator, policy } = build({ listForConversation, recordConversationIntake });

        const result = await orchestrator.handleUserTurn({
            principal,
            sessionId,
            message: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "이 작업은 어떻게 진행되나요?" }] },
        });

        expect(result.isQuestion).toBe(true);
        expect(result.mutated).toBe(false);
        expect(result.task?.taskId).toBe(current.taskId);
        expect(recordConversationIntake).not.toHaveBeenCalled();
        expect(policy.assertCanCreate).not.toHaveBeenCalled();
    });

    it("stores explicit facts while retaining the question part of a mixed turn", async () => {
        const created = task();
        const createFromConversation = jest.fn().mockResolvedValue({ snapshot: created, receipt: receipt(created.taskId) });
        const { orchestrator } = build({ createFromConversation });

        const result = await orchestrator.handleUserTurn({
            principal,
            sessionId,
            capabilityId: "clients.create",
            message: {
                id: randomUUID(),
                role: "user",
                parts: [{ type: "text", text: "이름: 홍길동, 전화번호: 010-1234-5678 그리고 어떻게 진행되나요?" }],
            },
        });

        expect(result.isQuestion).toBe(true);
        expect(result.mutated).toBe(true);
        expect(result.operations).toEqual([
            { op: "set", field: "name", value: "홍길동" },
            { op: "set", field: "phone", value: "01012345678" },
        ]);
        expect(createFromConversation).toHaveBeenCalledWith(
            principal,
            expect.objectContaining({ sessionId, capabilityId: "clients.create", operations: result.operations }),
            "user",
            result.requestHash,
        );
    });

    it("refuses a clear fact when task mode is disabled without recording intake", async () => {
        const current = task();
        const patchFromConversation = jest.fn();
        const recordConversationIntake = jest.fn();
        const assertCanCreate = jest.fn().mockRejectedValue(new ForbiddenException("disabled"));
        const { orchestrator } = build(
            { listForConversation: jest.fn().mockResolvedValue([current]), patchFromConversation, recordConversationIntake },
            { assertCanCreate },
        );

        const result = await orchestrator.handleUserTurn({
            principal,
            sessionId,
            message: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "이름: 막아줘" }] },
        });

        expect(result.refusal).toBe("feature-disabled");
        expect(result.mutated).toBe(false);
        expect(patchFromConversation).not.toHaveBeenCalled();
        expect(recordConversationIntake).not.toHaveBeenCalled();
    });

    it("does not expose an old intake replay to the legacy feature-off path", async () => {
        const replaySnapshot = task();
        const replayConversationIntake = jest.fn().mockResolvedValue({ snapshot: replaySnapshot, receipt: receipt(replaySnapshot.taskId) });
        const assertCanCreate = jest.fn().mockRejectedValue(new ForbiddenException("disabled"));
        const { orchestrator } = build({ replayConversationIntake }, { assertCanCreate });

        const result = await orchestrator.handleUserTurn({
            principal,
            sessionId,
            message: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "이전 요청 다시 보여줘" }] },
        });

        expect(result.task).toBeNull();
        expect(result.refusal).toBe("feature-disabled");
        expect(result.replayed).toBe(true);
        expect(replayConversationIntake).toHaveBeenCalled();
    });

    it("accepts an ordinal only when its displayed choice hint is current", async () => {
        const choiceSetRef = randomUUID();
        const current = task({
            choiceSets: [{ choiceSetRef, options: [
                { optionId: randomUUID(), label: "고객 1" },
                { optionId: randomUUID(), label: "고객 2" },
            ] }],
            orderedChoiceRefs: [choiceSetRef],
        });
        const commandFromConversation = jest.fn().mockResolvedValue({ snapshot: task({ revision: 2 }), receipt: receipt(current.taskId) });
        const recordConversationIntake = jest.fn().mockResolvedValue({ snapshot: current, receipt: receipt(current.taskId) });
        const { orchestrator } = build({ listForConversation: jest.fn().mockResolvedValue([current]), commandFromConversation, recordConversationIntake });

        const accepted = await orchestrator.handleUserTurn({
            principal,
            sessionId,
            message: {
                id: randomUUID(),
                role: "user",
                displayedChoice: { taskId: current.taskId, choiceSetRef, revision: current.revision },
                parts: [{ type: "text", text: "2번" }],
            },
        });
        expect(accepted.mutated).toBe(true);
        expect(commandFromConversation).toHaveBeenCalledWith(
            principal,
            current.taskId,
            expect.objectContaining({ command: "select-target", choiceSetRef, optionId: current.choiceSets[0]!.options[1]!.optionId }),
            "user",
            accepted.requestHash,
        );

        const stale = await orchestrator.handleUserTurn({
            principal,
            sessionId,
            message: {
                id: randomUUID(),
                role: "user",
                displayedChoice: { taskId: current.taskId, choiceSetRef, revision: current.revision - 1 },
                parts: [{ type: "text", text: "1번" }],
            },
        });
        expect(stale.mutated).toBe(false);
        expect(recordConversationIntake).toHaveBeenCalled();
    });

    it("keeps model literals finite and resolves only exact user-owned references", async () => {
        const current = task({
            confirmed: { name: "홍길동" },
            provenance: {
                confirmed: {
                    name: { source: "user", valueRef: randomUUID() },
                },
                tentative: {},
            },
        });
        const patchFromConversation = jest.fn().mockResolvedValue({ snapshot: current, receipt: receipt(current.taskId) });
        const { orchestrator } = build({ get: jest.fn().mockResolvedValue(current), listForConversation: jest.fn().mockResolvedValue([current]), patchFromConversation });
        const ownedRef = current.provenance.confirmed["name"]!.valueRef!;

        await orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId: randomUUID(),
            operations: [{ op: "set", field: "name", valueRef: ownedRef }],
        });
        expect(patchFromConversation).toHaveBeenCalledWith(
            principal,
            current.taskId,
            expect.objectContaining({ operations: [{ op: "set", field: "name", value: "홍길동" }] }),
            "model",
            expect.any(String),
            ["user"],
        );

        await expect(orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId: randomUUID(),
            operations: [{ op: "set", field: "name", value: "임의 이름" }],
        })).rejects.toBeInstanceOf(BadRequestException);
    });
});
