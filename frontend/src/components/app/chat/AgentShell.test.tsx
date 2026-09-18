import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AgentShell } from "./AgentShell";

const mockSendMessage = jest.fn();
const mockLoadTaskSnapshot = jest.fn();
const mockRetryPendingTaskEvent = jest.fn();
const mockPatchTask = jest.fn();
const mockCommandTask = jest.fn();
const mockCreateTaskEventId = jest.fn(() => "44444444-4444-4444-8444-444444444444");
const mockRenameSession = jest.fn().mockResolvedValue(true);
const mockAgentChatState: {
    status: "ready" | "submitted" | "streaming";
    messages: Array<{ id: string; role: "assistant"; parts: Array<{ type: string; data?: unknown }> }>;
    error: Error | null;
    actionError: { code: string; message: string; effectState: "nothing-happened" | "succeeded-unconfirmed" | "partial" } | null;
    taskError: { code: string; taskId?: string; latestRevision?: number; pendingEventId?: string; message: string } | null;
    taskSnapshotState: { task: Record<string, unknown> | null; pendingEventIds: string[] };
    taskAccessState: { status: string };
    taskMutationInFlight: boolean;
    taskNeedsReconciliation: boolean;
} = {
    status: "ready",
    messages: [],
    error: null,
    actionError: null,
    taskError: null,
    taskSnapshotState: { task: null, pendingEventIds: [] },
    taskAccessState: { status: "idle" },
    taskMutationInFlight: false,
    taskNeedsReconciliation: false,
};

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/hooks/useAgentChat", () => ({
    useAgentChat: () => ({
        messages: mockAgentChatState.messages,
        sendMessage: mockSendMessage,
        status: mockAgentChatState.status,
        error: mockAgentChatState.error,
        actionError: mockAgentChatState.actionError,
        taskError: mockAgentChatState.taskError,
        taskSnapshotState: mockAgentChatState.taskSnapshotState,
        taskAccessState: mockAgentChatState.taskAccessState,
        taskMutationInFlight: mockAgentChatState.taskMutationInFlight,
        taskNeedsReconciliation: mockAgentChatState.taskNeedsReconciliation,
        createTaskEventId: mockCreateTaskEventId,
        patchTask: mockPatchTask,
        commandTask: mockCommandTask,
        loadTaskSnapshot: mockLoadTaskSnapshot,
        retryPendingTaskEvent: mockRetryPendingTaskEvent,
        stop: jest.fn(),
        regenerate: jest.fn(),
        resetBranch: jest.fn(),
        sessions: [{ id: "session-a", title: "첫 대화", updatedAt: "2026-08-03" }],
        selectSession: jest.fn(),
        renameSession: mockRenameSession,
        deleteSession: jest.fn(),
        approveAction: jest.fn(),
        rejectAction: jest.fn(),
        submitStructuredForm: jest.fn(),
        submitFeedback: jest.fn(),
    }),
}));

describe("AgentShell input composition", () => {
    beforeEach(() => {
        mockSendMessage.mockClear();
        mockLoadTaskSnapshot.mockReset();
        mockRetryPendingTaskEvent.mockReset();
        mockPatchTask.mockReset();
        mockCommandTask.mockReset();
        mockCreateTaskEventId.mockReset().mockReturnValue("44444444-4444-4444-8444-444444444444");
        mockRenameSession.mockClear();
        mockAgentChatState.status = "ready";
        mockAgentChatState.messages = [];
        mockAgentChatState.error = null;
        mockAgentChatState.actionError = null;
        mockAgentChatState.taskError = null;
        mockAgentChatState.taskSnapshotState = { task: null, pendingEventIds: [] };
        mockAgentChatState.taskAccessState = { status: "idle" };
        mockAgentChatState.taskMutationInFlight = false;
        mockAgentChatState.taskNeedsReconciliation = false;
        const media = {
            matches: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        };
        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            value: jest.fn(() => media),
        });
    });

    it("does not submit the composer while Korean IME is composing", () => {
        render(<AgentShell />);
        const composer = screen.getByRole("textbox", { name: "질문 입력" });

        fireEvent.change(composer, { target: { value: "한글" } });
        fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
        expect(mockSendMessage).not.toHaveBeenCalled();

        fireEvent.keyDown(composer, { key: "Enter", isComposing: false });
        expect(mockSendMessage).toHaveBeenCalledWith({ text: "한글" });
    });

    it("does not rename a session while Korean IME is composing", async () => {
        render(<AgentShell />);
        fireEvent.click(screen.getByRole("button", { name: "첫 대화 이름 변경" }));
        const renameInput = screen.getByRole("textbox", { name: "대화 제목" });
        fireEvent.change(renameInput, { target: { value: "새 제목" } });

        fireEvent.keyDown(renameInput, { key: "Enter", isComposing: true });
        expect(mockRenameSession).not.toHaveBeenCalled();

        fireEvent.keyDown(renameInput, { key: "Enter", isComposing: false });
        await waitFor(() => expect(mockRenameSession).toHaveBeenCalledWith("session-a", "새 제목"));
    });

    it("does not render the desktop archive action while retaining rename and delete actions", () => {
        render(<AgentShell />);

        expect(screen.queryByRole("button", { name: "첫 대화 보관" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "첫 대화 이름 변경" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "첫 대화 삭제" })).toBeInTheDocument();
    });

    it.each(["submitted", "streaming"] as const)("disables structured forms while the agent status is %s", (status) => {
        mockAgentChatState.status = status;
        mockAgentChatState.messages = [{
            id: "assistant-form",
            role: "assistant",
            parts: [{
                type: "data-form",
                data: {
                    formId: "profile-form",
                    title: "프로필",
                    schemaVersion: "1",
                    fields: [{ name: "name", label: "이름", type: "text" }],
                },
            }],
        }];

        render(<AgentShell />);

        expect(screen.getByRole("button", { name: "입력 제출" })).toBeDisabled();
        expect(screen.getByRole("heading", { name: "프로필" }).closest("form")).toHaveAttribute("aria-busy", "true");
    });

    it("keeps a ready no-task form available for input", () => {
        mockAgentChatState.messages = [{
            id: "assistant-form-ready",
            role: "assistant",
            parts: [{
                type: "data-form",
                data: {
                    formId: "profile-form-ready",
                    title: "프로필",
                    schemaVersion: "1",
                    fields: [{ name: "name", label: "이름", type: "text" }],
                },
            }],
        }];

        render(<AgentShell />);

        expect(screen.getByRole("button", { name: "입력 제출" })).toBeEnabled();
        expect(screen.getByRole("heading", { name: "프로필" }).closest("form")).not.toHaveAttribute("aria-busy", "true");
    });

    it("attaches the current task revision and event id to desktop patch and lifecycle intents", () => {
        const taskId = "11111111-1111-4111-8111-111111111111";
        const snapshotRef = "22222222-2222-4222-8222-222222222222";
        mockAgentChatState.taskSnapshotState = {
            pendingEventIds: [],
            task: {
                schemaVersion: 1,
                taskId,
                sessionId: "33333333-3333-4333-8333-333333333333",
                kind: "clients.create",
                capabilityId: "clients.create",
                revision: 4,
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
            },
        };
        mockAgentChatState.taskAccessState = { status: "authorized" };
        mockAgentChatState.messages = [{
            id: "assistant-task",
            role: "assistant",
            parts: [{ type: "data-task-snapshot", data: {
                taskId,
                snapshotRef,
                kind: "clients.create",
                capabilityId: "clients.create",
                revision: 4,
                state: "collecting",
                fieldStatus: [{ field: "name", status: "confirmed" }],
            } }],
        }];

        render(<AgentShell />);

        fireEvent.change(screen.getByRole("textbox", { name: "이름 변경값" }), { target: { value: "새 이름" } });
        fireEvent.click(screen.getByRole("button", { name: "변경 적용" }));
        fireEvent.click(screen.getByRole("button", { name: "검토 준비" }));

        expect(mockPatchTask).toHaveBeenCalledWith(taskId, [{ op: "set", field: "name", value: "새 이름" }], {
            expectedRevision: 4,
            clientEventId: "44444444-4444-4444-8444-444444444444",
        });
        expect(mockCommandTask).toHaveBeenCalledWith(taskId, { command: "prepare-review" }, {
            expectedRevision: 4,
            clientEventId: "44444444-4444-4444-8444-444444444444",
        });
    });

    it("offers a refresh action after a task conflict", async () => {
        const taskId = "11111111-1111-4111-8111-111111111111";
        mockAgentChatState.taskError = {
            code: "task_conflict",
            taskId,
            message: "작업이 변경되었습니다. 최신 초안을 새로고침한 뒤 새 변경 요청으로 다시 적용해 주세요.",
        };

        render(<AgentShell />);

        const retry = screen.getByRole("button", { name: "다시 시도" });
        expect(retry).toBeEnabled();
        fireEvent.click(retry);
        await waitFor(() => expect(mockLoadTaskSnapshot).toHaveBeenCalledWith(taskId));
    });

    it("recovers an uncertain mutation through refresh and one exact retry", async () => {
        const taskId = "11111111-1111-4111-8111-111111111111";
        const eventId = "44444444-4444-4444-8444-444444444444";
        mockAgentChatState.taskError = {
            code: "task_mutation_unconfirmed",
            taskId,
            pendingEventId: eventId,
            message: "초안 변경 요청의 최종 결과를 확인하지 못했습니다.",
        };
        mockLoadTaskSnapshot.mockImplementation(async () => {
            mockAgentChatState.taskError = {
                code: "task_pending_event",
                taskId,
                latestRevision: 2,
                pendingEventId: eventId,
                message: "확인되지 않은 초안 변경이 있습니다.",
            };
        });
        mockRetryPendingTaskEvent.mockImplementation(async () => {
            mockAgentChatState.taskError = null;
        });

        const view = render(<AgentShell />);
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        await waitFor(() => expect(mockLoadTaskSnapshot).toHaveBeenCalledTimes(1));

        view.rerender(<AgentShell />);
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        await waitFor(() => expect(mockRetryPendingTaskEvent).toHaveBeenCalledWith(taskId, eventId));
        expect(mockRetryPendingTaskEvent).toHaveBeenCalledTimes(1);

        view.rerender(<AgentShell />);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps stream and action errors in separate completed namespaces", () => {
        mockAgentChatState.error = new Error("stream failed");
        mockAgentChatState.actionError = { code: "action_failed", message: "작업 결과를 확인하세요.", effectState: "partial" };

        render(<AgentShell />);

        const alerts = screen.getAllByRole("alert");
        expect(alerts).toHaveLength(2);
        expect(alerts[0]).toHaveAttribute("data-component", "desktop_chat_agent-shell_thread_messages_stream-error");
        expect(alerts[1]).toHaveAttribute("data-component", "desktop_chat_agent-shell_thread_messages_action-error");
    });
});
