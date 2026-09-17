import { randomUUID } from "node:crypto";

import type { AgentTask } from "@babyjamjam/shared";
import { assembleConversationContext } from "./conversation-context-assembler.service";

function task(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
        schemaVersion: 1,
        taskId: randomUUID(),
        sessionId: randomUUID(),
        kind: "clients.create",
        capabilityId: "clients.create",
        revision: 2,
        state: "collecting",
        confirmed: { name: "보호된 이름", phone: "01012345678" },
        tentative: { address: "보호된 주소" },
        clearedFields: [],
        provenance: {
            confirmed: {
                name: { source: "user", valueRef: randomUUID() },
                phone: { source: "user", valueRef: randomUUID() },
            },
            tentative: { address: { source: "wizard", valueRef: randomUUID() } },
        },
        issues: [{ code: "task.required", severity: "error", message: "A customer target is required" }],
        constraints: { noSend: true },
        choiceSets: [{ choiceSetRef: randomUUID(), options: [{ optionId: randomUUID(), label: "보호된 선택 라벨" }] }],
        orderedChoiceRefs: [],
        target: null,
        consent: { choice: "unanswered", binding: null },
        action: null,
        times: {
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-02-01T00:00:00.000Z",
        },
        currentSnapshotRef: randomUUID(),
        ...overrides,
    };
}

describe("conversation context assembler", () => {
    it("keeps live task state authoritative while stripping protected values and labels", () => {
        const live = task();
        const hint = {
            taskId: live.taskId,
            choiceSetRef: live.choiceSets[0]!.choiceSetRef,
            revision: live.revision,
        };
        const context = assembleConversationContext({
            messages: [
                {
                    id: "assistant-legacy",
                    role: "assistant",
                    parts: [{ type: "data-entity-choice", data: { choices: [{ id: "1", label: "보호된 선택 라벨" }] } }],
                },
                {
                    id: "user-current",
                    role: "user",
                    parts: [{ type: "text", text: "이름: 보호된 이름, 전화번호: 010-1234-5678 그리고 어떻게 진행되나요?" }],
                    displayedChoice: hint,
                },
            ] as never,
            summary: {
                version: "stale-summary",
                sourceMessageCount: 0,
                selectedEntities: { clients: { id: 7, name: "요약 고객" } },
                goals: ["비정규이름 확인: 비정규주소"],
            },
            tasks: [live],
            displayedChoice: hint,
            actionOutcomes: [{ capability: "clients.create", status: "saved", actionId: randomUUID() }],
            protectedValues: ["비정규이름", "비정규주소"],
        });

        const serialized = JSON.stringify(context);
        expect(context.activeTask?.revision).toBe(live.revision);
        expect(context.activeTask?.fieldStatus).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: "name", status: "confirmed" }),
            expect.objectContaining({ field: "phone", status: "confirmed" }),
        ]));
        expect(context.displayedChoice).toEqual(hint);
        expect(context.currentTurn.explicitOperations).toEqual([
            { op: "set", field: "name" },
            { op: "set", field: "phone" },
        ]);
        expect(serialized).not.toContain("보호된 이름");
        expect(serialized).not.toContain("01012345678");
        expect(serialized).not.toContain("비정규이름");
        expect(serialized).not.toContain("비정규주소");
        expect(serialized).not.toContain("보호된 선택 라벨");
        expect(serialized).not.toContain("요약 고객");
        expect(context.actionOutcomes).toEqual(expect.arrayContaining([
            expect.objectContaining({ capability: "clients.create", status: "saved" }),
        ]));
    });

    it("drops stale displayed-choice hints and keeps question turns read-only", () => {
        const live = task();
        const staleHint = {
            taskId: live.taskId,
            choiceSetRef: live.choiceSets[0]!.choiceSetRef,
            revision: live.revision - 1,
        };
        const context = assembleConversationContext({
            messages: [{ id: "question", role: "user", parts: [{ type: "text", text: "현재 상태를 알려줘?" }] }] as never,
            tasks: [live],
            displayedChoice: staleHint,
        });

        expect(context.displayedChoice).toBeUndefined();
        expect(context.currentTurn.isQuestion).toBe(true);
        expect(context.currentTurn.explicitOperations).toEqual([]);
        expect(context.activeTask?.taskId).toBe(live.taskId);
    });
});
