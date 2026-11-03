import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AgentShell } from "./AgentShell";

const mockSendMessage = jest.fn();
const mockSelectSession = jest.fn();
const mockDeleteSession = jest.fn();
const mockResetBranch = jest.fn();
const mockStop = jest.fn();
const mockRegenerate = jest.fn();
const mockPush = jest.fn();
const mockDisplayed = { session: null as { id: string; title: string } | null };
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

jest.mock("./ChatWorkspaceStats", () => ({ ChatWorkspaceStats: () => null }));

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush }),
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
        stop: mockStop,
        regenerate: mockRegenerate,
        resetBranch: mockResetBranch,
        sessions: [{ id: "session-a", title: "첫 대화", updatedAt: "2026-08-03" }],
        selectSession: mockSelectSession,
        displayedSession: mockDisplayed.session,
        renameSession: mockRenameSession,
        deleteSession: mockDeleteSession,
        approveAction: jest.fn(),
        rejectAction: jest.fn(),
        submitStructuredForm: jest.fn(),
        submitFeedback: jest.fn(),
    }),
}));

describe("AgentShell input composition", () => {
    beforeEach(() => {
        mockDisplayed.session = null;
        mockSelectSession.mockClear(); mockDeleteSession.mockClear(); mockResetBranch.mockClear();
        mockStop.mockClear(); mockRegenerate.mockClear(); mockPush.mockClear();
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

    it("hides assistant bubbles containing only invisible parts", () => {
        mockAgentChatState.messages.push({ id: "empty", role: "assistant", parts: [{ type: "step-start" }, { type: "reasoning" }, { type: "text", text: "  " }] } as never);
        const { container } = render(<AgentShell />);
        expect(container.querySelector("article")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "좋아요" })).not.toBeInTheDocument();
    });

    it.each(["succeeded", "rejected"] as const)("shows the refreshed %s card read-only above its result", (status) => {
        mockAgentChatState.messages.push({ id: "agent-action-result:action-card", role: "assistant", parts: [
            { type: "data-action-proposal", data: { actionId: "action-card", capability: "service-records.edit", title: "제공기록지 정정", summary: "회차 변경 제안", expiresAt: "2026-01-01T00:00:00.000Z", expectedRevision: "revision-a", changes: { endDate: "2026-10-14" } } },
            { type: "data-action-result", data: { actionId: "action-card", status, summary: "작업 처리 결과" } },
        ] } as never);
        const { container } = render(<AgentShell />);
        const card = screen.getByLabelText("처리된 작업 제안");
        expect(card).toHaveTextContent("회차 변경 제안");
        expect(card.compareDocumentPosition(screen.getByText("작업 처리 결과")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole("button", { name: "승인하고 실행" })).not.toBeInTheDocument();
        expect(screen.queryByText("제공기록지 정정은 PC 관리자 화면에서 승인해 주세요.")).not.toBeInTheDocument();
        expect(container.querySelectorAll("article")).toHaveLength(1);
    });

    it("bounds its section under one application main and keeps header/composer outside the scroller", () => {
        const { container } = render(<main><AgentShell /></main>);
        const shell = container.querySelector('[data-component="desktop_chat_agent-shell"]');
        const thread = container.querySelector('[data-component="desktop_chat_agent-shell_thread"]');
        const scrollArea = container.querySelector('[data-slot="scroll-area"]');
        const viewport = container.querySelector('[data-radix-scroll-area-viewport]');
        const composer = container.querySelector('[data-component="desktop_chat_agent-shell_thread_composer"]');
        const header = container.querySelector('[data-component="desktop_chat_agent-shell_thread_header"]');
        expect(screen.getAllByRole("main")).toHaveLength(1);
        expect(shell?.tagName).toBe("SECTION");
        expect(shell).toHaveClass("h-full", "min-h-0", "overflow-hidden");
        expect(shell).not.toHaveClass("fixed");
        expect(thread).toHaveClass("flex", "h-full", "min-h-0", "overflow-hidden");
        expect(scrollArea).toHaveClass("min-h-0", "flex-1", "overflow-hidden");
        expect(viewport).toHaveClass("h-full", "w-full");
        expect(scrollArea?.parentElement).toBe(composer?.parentElement);
        expect(thread).toContainElement(header as HTMLElement);
        expect(scrollArea).not.toContainElement(header as HTMLElement);
        expect(scrollArea).not.toContainElement(composer as HTMLElement);
    });

    it("uses an accessible modal drawer, hides/inerts the background and restores focus on Escape", async () => {
        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            value: jest.fn(() => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
        });
        const { container } = render(<AgentShell />);
        const menu = screen.getByRole("button", { name: "사이드바 열기" });
        const shell = container.querySelector('[data-component="desktop_chat_agent-shell"]');
        const viewport = container.querySelector('[data-radix-scroll-area-viewport]');
        expect(menu).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("textbox", { name: "대화 검색" })).not.toBeInTheDocument();
        fireEvent.click(menu);
        const dialog = await screen.findByRole("dialog", { name: "대화 목록" });
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
        expect(shell).toHaveAttribute("inert");
        expect(shell?.closest('[aria-hidden="true"]')).not.toBeNull();
        expect(document.querySelectorAll(`#${menu.getAttribute("aria-controls")}`)).toHaveLength(1);
        expect(within(dialog).getByRole("textbox", { name: "대화 검색" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "사이드바 닫기" })).toBeInTheDocument();
        fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(menu).toHaveAttribute("aria-expanded", "false");
        expect(menu).toHaveFocus();
        expect(shell).not.toHaveAttribute("inert");
        expect(container.querySelector('[data-radix-scroll-area-viewport]')).toBe(viewport);
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
    it("uses confirmed header metadata, real session actions and preserves branch/back/new controls", () => {
        const back = jest.spyOn(window.history, "back").mockImplementation(() => undefined);
        const { rerender } = render(<AgentShell />);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("새 대화");
        fireEvent.click(screen.getByRole("button", { name: "첫 대화" }));
        expect(mockSelectSession).toHaveBeenCalledWith("session-a");
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("새 대화");
        mockDisplayed.session = { id: "session-a", title: "확인된 실제 제목" };
        rerender(<AgentShell />);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("확인된 실제 제목");
        expect(screen.getByRole("button", { name: "첫 대화" })).toHaveAttribute("aria-current", "true");
        fireEvent.change(screen.getByRole("textbox", { name: "대화 검색" }), { target: { value: "없음" } });
        expect(screen.queryByRole("button", { name: "첫 대화" })).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole("textbox", { name: "대화 검색" }), { target: { value: "첫" } });
        fireEvent.click(screen.getByRole("button", { name: "첫 대화 삭제" }));
        expect(mockDeleteSession).toHaveBeenCalledWith("session-a");
        fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
        expect(mockResetBranch).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "지점 바꾸기" }));
        expect(mockResetBranch).toHaveBeenCalledTimes(2);
        expect(mockPush).toHaveBeenCalledWith("/select-branch");
        fireEvent.click(screen.getByRole("button", { name: "기존 채팅으로 돌아가기" }));
        expect(back).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("button", { name: "산모 등록" })).not.toBeInTheDocument();
        back.mockRestore();
    });

    it("keeps stream stop and regenerate callbacks wired", () => {
        mockAgentChatState.status = "streaming";
        mockAgentChatState.error = new Error("stream");
        render(<AgentShell />);
        fireEvent.click(screen.getByRole("button", { name: "중지" }));
        expect(mockStop).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        expect(mockRegenerate).toHaveBeenCalledTimes(1);
    });

});
