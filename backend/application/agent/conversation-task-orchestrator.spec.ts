import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
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
    it("records a canonical receipt for a pure question without changing task state", async () => {
        const current = task();
        const listForConversation = jest.fn().mockResolvedValue([current]);
        const recordConversationIntake = jest.fn().mockResolvedValue({ snapshot: current, receipt: receipt(current.taskId) });
        const replayConversationIntake = jest.fn().mockResolvedValue(null);
        const { orchestrator, policy } = build({ listForConversation, recordConversationIntake, replayConversationIntake });

        const result = await orchestrator.handleUserTurn({
            principal,
            sessionId,
            message: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "이 작업은 어떻게 진행되나요?" }] },
        });

        expect(result.isQuestion).toBe(true);
        expect(result.mutated).toBe(false);
        expect(result.task?.taskId).toBe(current.taskId);
        expect(recordConversationIntake).toHaveBeenCalledWith(principal, current.taskId, result.eventId, result.requestHash);
        expect(policy.assertCanCreate).toHaveBeenCalledWith(principal, "clients.create");

        replayConversationIntake.mockResolvedValueOnce({ snapshot: current, receipt: receipt(current.taskId) });
        const replay = await orchestrator.handleUserTurn({
            principal,
            sessionId,
            message: { id: result.canonical.messageId, role: "user", parts: [{ type: "text", text: "이 작업은 어떻게 진행되나요?" }] },
        });
        expect(replay.replayed).toBe(true);
        expect(replay.task?.taskId).toBe(current.taskId);
        expect(recordConversationIntake).toHaveBeenCalledTimes(1);
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

    it("does not create a task from labelled facts without a selected client write capability", async () => {
        const createFromConversation = jest.fn();
        const { orchestrator, policy } = build({ createFromConversation });

        const result = await orchestrator.handleUserTurn({
            principal,
            sessionId,
            message: {
                id: randomUUID(),
                role: "user",
                parts: [{ type: "text", text: "이름: 홍길동, 주소: 서울시 강남구" }],
            },
        });

        expect(result.refusal).toBe("unsupported-input");
        expect(result.mutated).toBe(false);
        expect(result.task).toBeNull();
        expect(createFromConversation).not.toHaveBeenCalled();
        expect(policy.assertCanCreate).not.toHaveBeenCalled();
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
        const intakeEventId = randomUUID();
        const current = task({
            confirmed: { name: "홍길동" },
            provenance: {
                confirmed: {
                    name: { source: "user", capturedAt: new Date().toISOString(), eventId: intakeEventId, valueRef: randomUUID() },
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
            intakeEventId,
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

    it("rejects stale or cross-field references and never promotes a tentative value", async () => {
        const intakeEventId = randomUUID();
        const staleEventId = randomUUID();
        const current = task({
            confirmed: { name: "홍길동" },
            tentative: { address: "서울시 희망 주소" },
            provenance: {
                confirmed: {
                    name: { source: "user", capturedAt: new Date().toISOString(), eventId: intakeEventId, valueRef: randomUUID() },
                },
                tentative: {
                    address: { source: "wizard", capturedAt: new Date().toISOString(), eventId: intakeEventId, valueRef: randomUUID() },
                },
            },
        });
        const patchFromConversation = jest.fn().mockResolvedValue({ snapshot: current, receipt: receipt(current.taskId) });
        const { orchestrator } = build({ get: jest.fn().mockResolvedValue(current), listForConversation: jest.fn().mockResolvedValue([current]), patchFromConversation });
        const confirmedRef = current.provenance.confirmed["name"]!.valueRef!;
        const tentativeRef = current.provenance.tentative["address"]!.valueRef!;

        await expect(orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId: staleEventId,
            operations: [{ op: "set", field: "name", valueRef: confirmedRef }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ message: "Task reference is stale" }) });

        await expect(orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId,
            operations: [{ op: "set", field: "phone", valueRef: confirmedRef }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ message: "Task reference is not owned by this turn" }) });

        await expect(orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId,
            operations: [{ op: "set", field: "address", valueRef: tentativeRef }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ message: "Tentative task reference cannot be confirmed" }) });

        await orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId,
            operations: [{ op: "mark-tentative", field: "address", valueRef: tentativeRef }],
        });
        expect(patchFromConversation).toHaveBeenCalledWith(
            principal,
            current.taskId,
            expect.objectContaining({ operations: [{ op: "mark-tentative", field: "address", value: "서울시 희망 주소" }] }),
            "model",
            expect.any(String),
            ["user"],
        );
    });

    it("requires field-specific correction evidence for clear and discard operations", async () => {
        const current = task({ confirmed: { address: "서울시", name: "홍길동" } });
        const patchFromConversation = jest.fn().mockResolvedValue({ snapshot: current, receipt: receipt(current.taskId) });
        const { orchestrator } = build({ get: jest.fn().mockResolvedValue(current), listForConversation: jest.fn().mockResolvedValue([current]), patchFromConversation });

        await expect(orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId: randomUUID(),
            operations: [{ op: "clear", field: "address" }],
            userCorrectionEvidence: [{ operation: "clear", field: "name" }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ message: "Explicit user correction is required for this field" }) });

        await orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId: randomUUID(),
            operations: [{ op: "clear", field: "address" }],
            userCorrectionEvidence: [{ operation: "clear", field: "address" }],
        });
        expect(patchFromConversation).toHaveBeenCalledWith(
            principal,
            current.taskId,
            expect.objectContaining({ operations: [{ op: "clear", field: "address" }] }),
            "model",
            expect.any(String),
            ["user"],
        );

        await orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId: randomUUID(),
            operations: [{ op: "discard-change", field: "address" }],
            userCorrectionEvidence: [{ operation: "discard-change", field: "address" }],
        });
        expect(patchFromConversation).toHaveBeenLastCalledWith(
            principal,
            current.taskId,
            expect.objectContaining({ operations: [{ op: "discard-change", field: "address" }] }),
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
            operations: [{ op: "discard-change", field: "name" }],
            userCorrectionEvidence: [{ operation: "clear", field: "name" }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ message: "Explicit user correction is required for this field" }) });
    });

    it("includes resolved mutation origins in the model event hash", async () => {
        const intakeEventId = randomUUID();
        const current = task({
            confirmed: { name: "홍길동", startDate: "2026-01-15" },
            provenance: {
                confirmed: {
                    name: { source: "user", capturedAt: new Date().toISOString(), eventId: intakeEventId, valueRef: randomUUID() },
                    startDate: { source: "user", capturedAt: new Date().toISOString(), eventId: intakeEventId, valueRef: randomUUID() },
                },
                tentative: {},
            },
        });
        const patchFromConversation = jest.fn().mockResolvedValue({ snapshot: current, receipt: receipt(current.taskId) });
        const { orchestrator } = build({ get: jest.fn().mockResolvedValue(current), listForConversation: jest.fn().mockResolvedValue([current]), patchFromConversation });
        await orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId,
            operations: [{ op: "set", field: "startDate", value: "2026-01-15" }],
        });
        const modelLiteralHash = patchFromConversation.mock.calls[0]?.[4];
        await orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            intakeEventId,
            operations: [{ op: "set", field: "startDate", valueRef: current.provenance.confirmed["startDate"]!.valueRef! }],
        });
        const userReferenceHash = patchFromConversation.mock.calls[1]?.[4];
        expect(modelLiteralHash).toEqual(expect.any(String));
        expect(userReferenceHash).toEqual(expect.any(String));
        expect(patchFromConversation.mock.calls[0]?.[2].operations).toEqual(patchFromConversation.mock.calls[1]?.[2].operations);
        expect(userReferenceHash).not.toBe(modelLiteralHash);
    });

    it("rejects a model write attempt on a pure-question turn before changing the task", async () => {
        const current = task({ confirmed: { name: "기존 이름" }, revision: 3 });
        const patchFromConversation = jest.fn();
        const createFromConversation = jest.fn();
        const { orchestrator } = build({
            get: jest.fn().mockResolvedValue(current),
            listForConversation: jest.fn().mockResolvedValue([current]),
            patchFromConversation,
            createFromConversation,
        });

        await expect(orchestrator.applyModelMutation({
            principal,
            sessionId,
            capabilityId: "clients.create",
            taskId: current.taskId,
            expectedRevision: current.revision,
            intakeEventId: randomUUID(),
            operations: [{ op: "set", field: "name", value: "변경 시도" }],
            allowMutation: false,
        })).rejects.toBeInstanceOf(ConflictException);

        expect(current.confirmed.name).toBe("기존 이름");
        expect(patchFromConversation).not.toHaveBeenCalled();
        expect(createFromConversation).not.toHaveBeenCalled();
    });
});
