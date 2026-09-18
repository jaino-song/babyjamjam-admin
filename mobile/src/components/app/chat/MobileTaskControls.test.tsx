import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AgentTaskSchema, type AgentTask } from "@babyjamjam/shared/agent";

import { MobileTaskControls } from "./MobileTaskControls";

if (typeof globalThis.ResizeObserver === "undefined") {
    Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: class ResizeObserverMock {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    });
}

const IDS = {
    task: "11111111-1111-4111-8111-111111111111",
    session: "22222222-2222-4222-8222-222222222222",
    snapshot: "33333333-3333-4333-8333-333333333333",
};

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return AgentTaskSchema.parse({
        schemaVersion: 1,
        taskId: IDS.task,
        sessionId: IDS.session,
        kind: "clients.create",
        capabilityId: "clients.create",
        revision: 2,
        state: "collecting",
        confirmed: { name: "홍길동", phone: "01012345678" },
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
        times: { createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:01.000Z" },
        currentSnapshotRef: IDS.snapshot,
        ...overrides,
    });
}

describe("MobileTaskControls", () => {
    it("patches edited fields with the current task revision and ignores concurrent taps", async () => {
        let resolvePatch: ((value: { status: "applied" }) => void) | undefined;
        const onPatch = jest.fn(() => new Promise<{ status: "applied" }>((resolve) => { resolvePatch = resolve; }));
        render(<MobileTaskControls data-component="mobile_chat_task_controls" task={makeTask()} onPatch={onPatch} onCommand={jest.fn()} />);

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "김하나" } });
        const submit = screen.getByRole("button", { name: "변경 적용" });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);
        fireEvent.click(submit);

        expect(onPatch).toHaveBeenCalledTimes(1);
        expect(onPatch).toHaveBeenCalledWith(IDS.task, [{ op: "set", field: "name", value: "김하나" }]);
        expect(submit).toBeDisabled();

        resolvePatch?.({ status: "applied" });
        await waitFor(() => expect(submit).toBeDisabled());
    });

    it("does not submit a patch while Korean IME is composing", async () => {
        const onPatch = jest.fn();
        render(<MobileTaskControls data-component="mobile_chat_task_controls" task={makeTask()} onPatch={onPatch} />);

        const input = screen.getByLabelText("이름");
        fireEvent.change(input, { target: { value: "한글" } });
        fireEvent.keyDown(input, { key: "Enter", isComposing: true });
        expect(onPatch).not.toHaveBeenCalled();

        fireEvent.keyDown(input, { key: "Enter", isComposing: false });
        expect(onPatch).toHaveBeenCalledWith(IDS.task, [{ op: "set", field: "name", value: "한글" }]);
        await waitFor(() => expect(screen.getByRole("button", { name: "변경 적용" })).toBeEnabled());
    });

    it("shows review and approval state while exposing lifecycle commands", () => {
        const onCommand = jest.fn();
        const task = makeTask({ state: "awaiting_approval", action: { actionId: IDS.snapshot, expectedRevision: "revision-1" } });
        render(<MobileTaskControls data-component="mobile_chat_task_controls" task={task} onPatch={jest.fn()} onCommand={onCommand} />);

        expect(screen.getByText("승인 대기")).toBeInTheDocument();
        expect(screen.getByText("승인 대기 작업")).toBeInTheDocument();
        expect(screen.getByText("승인 대기 중")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "취소" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "검토 준비" })).toBeEnabled();

        fireEvent.click(screen.getByRole("button", { name: "취소" }));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "초안 취소" })).toBeEnabled();
    });

    it("keeps every task action disabled while reconciliation is required", () => {
        const onPatch = jest.fn();
        const onCommand = jest.fn();
        render(<MobileTaskControls data-component="mobile_chat_task_controls" task={makeTask()} taskNeedsReconciliation onPatch={onPatch} onCommand={onCommand} />);

        expect(screen.getByRole("button", { name: "변경 적용" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "일시정지" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "검토 준비" })).toBeDisabled();
        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "변경" } });
        expect(onPatch).not.toHaveBeenCalled();
        expect(onCommand).not.toHaveBeenCalled();
    });
});
