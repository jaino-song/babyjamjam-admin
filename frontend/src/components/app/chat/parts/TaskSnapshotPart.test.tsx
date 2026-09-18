import { fireEvent, render, screen } from "@testing-library/react";
import type { AgentTask } from "@babyjamjam/shared/agent";

import { TaskSnapshotPart } from "./TaskSnapshotPart";

const taskId = "11111111-1111-4111-8111-111111111111";
const snapshotRef = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
        schemaVersion: 1,
        taskId,
        sessionId,
        kind: "clients.create",
        capabilityId: "clients.create",
        revision: 2,
        state: "collecting",
        confirmed: { name: "기존 이름" },
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
        times: { createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z" },
        currentSnapshotRef: snapshotRef,
        ...overrides,
    };
}

const snapshot = {
    taskId,
    snapshotRef,
    kind: "clients.create" as const,
    capabilityId: "clients.create" as const,
    revision: 2,
    state: "collecting" as const,
    fieldStatus: [{ field: "name" as const, status: "confirmed" as const }],
};

describe("TaskSnapshotPart controls", () => {
    const dataComponent = "desktop_chat_task-snapshot";

    it("emits a revision-independent patch intent and lifecycle commands for the current snapshot", () => {
        const onPatch = jest.fn();
        const onCommand = jest.fn();
        render(<TaskSnapshotPart data-component={dataComponent} data={snapshot} task={makeTask()} onPatch={onPatch} onCommand={onCommand} />);

        fireEvent.change(screen.getByRole("textbox", { name: "이름 변경값" }), { target: { value: "새 이름" } });
        fireEvent.click(screen.getByRole("button", { name: "변경 적용" }));
        fireEvent.click(screen.getByRole("button", { name: "일시정지" }));
        fireEvent.click(screen.getByRole("button", { name: "검토 준비" }));
        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        expect(onPatch).toHaveBeenCalledWith(taskId, [{ op: "set", field: "name", value: "새 이름" }]);
        expect(onCommand).toHaveBeenNthCalledWith(1, taskId, { command: "pause" });
        expect(onCommand).toHaveBeenNthCalledWith(2, taskId, { command: "prepare-review" });
        expect(onCommand).toHaveBeenNthCalledWith(3, taskId, { command: "cancel" });
    });

    it("does not submit a patch when Enter is an IME composition event", () => {
        const onPatch = jest.fn();
        render(<TaskSnapshotPart data-component={dataComponent} data={snapshot} task={makeTask()} onPatch={onPatch} />);

        const input = screen.getByRole("textbox", { name: "이름 변경값" });
        fireEvent.change(input, { target: { value: "한글" } });
        fireEvent.keyDown(input, { key: "Enter", isComposing: true });
        expect(onPatch).not.toHaveBeenCalled();

        fireEvent.keyDown(input, { key: "Enter", isComposing: false });
        expect(onPatch).toHaveBeenCalledWith(taskId, [{ op: "set", field: "name", value: "한글" }]);
    });

    it("disables edits and commands while a task mutation is busy", () => {
        const onPatch = jest.fn();
        const onCommand = jest.fn();
        render(<TaskSnapshotPart data-component={dataComponent} data={snapshot} task={makeTask()} taskBusy onPatch={onPatch} onCommand={onCommand} />);

        expect(screen.getByRole("button", { name: "변경 적용" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "일시정지" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "검토 준비" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "변경 적용" }));
        fireEvent.click(screen.getByRole("button", { name: "일시정지" }));
        expect(onPatch).not.toHaveBeenCalled();
        expect(onCommand).not.toHaveBeenCalled();
    });

    it("shows resume for a paused task and keeps stale snapshot controls hidden", () => {
        const onCommand = jest.fn();
        const { rerender } = render(<TaskSnapshotPart data-component={dataComponent} data={snapshot} task={makeTask({ state: "paused" })} onCommand={onCommand} />);

        expect(screen.getByRole("button", { name: "재개" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "일시정지" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "재개" }));
        expect(onCommand).toHaveBeenCalledWith(taskId, { command: "resume" });

        rerender(<TaskSnapshotPart data-component={dataComponent} data={snapshot} task={makeTask({ revision: 3, currentSnapshotRef: "44444444-4444-4444-8444-444444444444" })} onCommand={onCommand} />);
        expect(screen.queryByRole("button", { name: "재개" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "변경 적용" })).not.toBeInTheDocument();
    });

    it("surfaces review and approval state without replacing the approval card", () => {
        render(<TaskSnapshotPart data-component={dataComponent} data={{ ...snapshot, state: "awaiting_approval" }} task={makeTask({ state: "awaiting_approval", action: { actionId: taskId, expectedRevision: "revision-2" } })} onCommand={jest.fn()} />);

        expect(screen.getByText("승인 대기 중")).toBeInTheDocument();
        expect(screen.getByText(/아래 승인 카드/)).toBeInTheDocument();
    });
});
