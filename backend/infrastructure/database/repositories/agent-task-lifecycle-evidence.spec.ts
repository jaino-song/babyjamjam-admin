import {
    lifecycleActionBlocks,
    lifecycleTaskActionEvidenceBlocks,
    type AgentTaskLifecycleActionEvidence,
    type AgentTaskLifecycleTaskEvidence,
} from "./agent-task-lifecycle-evidence";

describe("agent task lifecycle evidence", () => {
    const task: AgentTaskLifecycleTaskEvidence = {
        id: "task-a",
        sessionId: "session-a",
        userId: "user-a",
        branchId: "branch-a",
        activeActionId: "action-a",
    };
    const now = new Date("2026-09-17T00:00:00.000Z");

    function action(overrides: Partial<AgentTaskLifecycleActionEvidence> = {}): AgentTaskLifecycleActionEvidence {
        return {
            id: "action-a",
            taskId: "task-a",
            sessionId: "session-a",
            userId: "user-a",
            branchId: "branch-a",
            status: "succeeded",
            expiresAt: new Date("2026-09-18T00:00:00.000Z"),
            resultPartPersistedAt: now,
            ...overrides,
        };
    }

    it.each([
        ["executing", null],
        ["uncertain", now],
        ["proposed", new Date("2026-09-18T00:00:00.000Z")],
        ["succeeded", null],
        ["unknown", now],
    ])("blocks %s action evidence when unresolved", (status, resultPartPersistedAt) => {
        expect(lifecycleActionBlocks(action({ status, resultPartPersistedAt }), now)).toBe(true);
    });

    it("allows a persisted non-uncertain terminal forward link", () => {
        expect(lifecycleTaskActionEvidenceBlocks(task, [action()], now)).toBe(false);
    });

    it("blocks a dangling forward link", () => {
        expect(lifecycleTaskActionEvidenceBlocks(task, [], now)).toBe(true);
    });

    it("blocks a reverse link from another owner or session", () => {
        expect(lifecycleTaskActionEvidenceBlocks(
            { ...task, activeActionId: null },
            [action({ id: "action-foreign", userId: "user-b", taskId: "task-a" })],
            now,
        )).toBe(true);
    });

    it("blocks a same-scope unresolved historical reverse link", () => {
        expect(lifecycleTaskActionEvidenceBlocks(
            task,
            [action(), action({ id: "action-b", status: "executing", resultPartPersistedAt: null })],
            now,
        )).toBe(true);
    });

    it("allows same-scope persisted terminal and expired proposal history", () => {
        expect(lifecycleTaskActionEvidenceBlocks(
            task,
            [
                action(),
                action({ id: "action-b", status: "failed" }),
                action({ id: "action-c", status: "approved", expiresAt: new Date("2026-09-16T00:00:00.000Z") }),
            ],
            now,
        )).toBe(false);
    });

    it("allows a task without a forward link when reverse history is settled", () => {
        expect(lifecycleTaskActionEvidenceBlocks(
            { ...task, activeActionId: null },
            [action({ id: "action-b", status: "failed" })],
            now,
        )).toBe(false);
    });
});
