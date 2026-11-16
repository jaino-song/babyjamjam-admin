import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AgentMobileShell } from "./AgentMobileShell";

const mockSendMessage = jest.fn();
const mockRefreshTask = jest.fn();
const mockMessages: unknown[] = [];
let mockTaskNeedsReconciliation = false;
let mockDiscovery = "enabled";
const mockSelectSession = jest.fn();
const mockDeleteSession = jest.fn();
const mockResetBranch = jest.fn();
const mockNow = new Date();
const mockDate = (days: number) => {
    const date = new Date(mockNow);
    date.setDate(date.getDate() - days);
    return date.toISOString();
};

jest.mock("@/hooks/useAgentChat", () => ({
    AGENT_DISCOVERY_ERROR_MESSAGE: "AI 운영 코파일럿을 준비하지 못했습니다.",
    useAgentCapabilities: () => mockDiscovery,
    useAgentChat: () => ({
        messages: mockMessages,
        status: "ready",
        errorState: null,
        sendMessage: mockSendMessage,
        stop: jest.fn(),
        resetBranch: mockResetBranch,
        sessions: [
            { id: "session-old", title: "이전 대화", updatedAt: mockDate(10) },
            { id: "session-a", title: "첫 대화", updatedAt: mockDate(0) },
            { id: "session-week", title: "최근 대화", updatedAt: mockDate(3) },
        ],
        currentSessionId: "session-a",
        selectSession: mockSelectSession,
        deleteSession: mockDeleteSession,
        approveAction: jest.fn(),
        rejectAction: jest.fn(),
        submitStructuredForm: jest.fn(),
        submitFeedback: jest.fn(),
        task: null,
        taskNeedsReconciliation: mockTaskNeedsReconciliation,
        refreshTask: mockRefreshTask,
        commandTask: jest.fn(),
    }),
}));

describe("AgentMobileShell drawer accessibility", () => {
    beforeEach(() => {
        mockDiscovery = "enabled";
        mockSelectSession.mockClear();
        mockDeleteSession.mockClear();
        mockResetBranch.mockClear();
        mockMessages.length = 0;
        mockSendMessage.mockClear();
        mockRefreshTask.mockClear();
        mockTaskNeedsReconciliation = false;
    });

    it("groups real sessions, marks the current session, and closes on scrim tap", async () => {
        const user = userEvent.setup();
        const { container } = render(<AgentMobileShell />);
        await user.click(screen.getByRole("button", { name: "대화 목록" }));
        const drawer = screen.getByRole("dialog", { name: "대화 목록" });
        expect(drawer).toHaveAttribute("data-open", "true");
        expect(Array.from(drawer.querySelectorAll("h2")).map((heading) => heading.textContent)).toEqual(["오늘", "지난 7일", "이전"]);
        expect(screen.getByRole("button", { name: "첫 대화" })).toHaveAttribute("aria-current", "true");
        expect(container.querySelector('[data-slot="agent-session-row"][data-current="true"]')).toHaveTextContent("첫 대화");
        await user.click(screen.getByRole("button", { name: "대화 목록 닫기" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(drawer).toHaveAttribute("data-open", "false");
    });

    it("toggles the drawer from the hamburger and traps Tab within its controls", async () => {
        const user = userEvent.setup();
        render(<AgentMobileShell />);
        const menu = screen.getByRole("button", { name: "대화 목록" });
        await user.click(menu);
        await user.tab({ shift: true });
        expect(screen.getByRole("button", { name: "이전 대화 삭제" })).toHaveFocus();
        await user.tab();
        expect(menu).toHaveFocus();
        await user.click(menu);
        expect(menu).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("preserves selection, deletion, and new conversation actions", async () => {
        const user = userEvent.setup();
        render(<AgentMobileShell />);
        const menu = screen.getByRole("button", { name: "대화 목록" });
        await user.click(menu);
        await user.click(screen.getByRole("button", { name: "최근 대화 삭제" }));
        expect(mockDeleteSession).toHaveBeenCalledWith("session-week");
        await user.click(screen.getByRole("button", { name: "최근 대화" }));
        expect(mockSelectSession).toHaveBeenCalledWith("session-week");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        await user.click(menu);
        const drawer = screen.getByRole("dialog");
        fireEvent.click(drawer.querySelector('[data-slot="agent-session-new"]')!);
        expect(mockResetBranch).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows a safe discovery error and prevents sending a broken chat", () => {
        mockDiscovery = "discovery-error";
        render(<AgentMobileShell />);
        expect(screen.getByRole("alert")).toHaveTextContent("AI 운영 코파일럿을 준비하지 못했습니다.");
        expect(screen.getByRole("textbox", { name: "질문 입력" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "전송" })).toBeDisabled();
        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it.each(["loading", "discovery-error"])("disables all session actions during %s while keeping the hamburger usable", async (discovery) => {
        mockDiscovery = discovery;
        const user = userEvent.setup();
        render(<AgentMobileShell />);
        const menu = screen.getByRole("button", { name: "대화 목록" });
        expect(screen.getByRole("button", { name: "새 대화" })).toBeDisabled();
        await user.click(menu);
        const drawer = screen.getByRole("dialog", { name: "대화 목록" });
        const actions = within(drawer).getAllByRole("button");
        expect(actions).toHaveLength(7);
        for (const action of actions) {
            expect(action).toBeDisabled();
            await user.click(action);
        }
        expect(mockResetBranch).not.toHaveBeenCalled();
        expect(mockSelectSession).not.toHaveBeenCalled();
        expect(mockDeleteSession).not.toHaveBeenCalled();
        expect(menu).not.toBeDisabled();
        await user.click(menu);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("announces discovery loading with the shared spinner and a hidden label", () => {
        mockDiscovery = "loading";
        render(<AgentMobileShell />);
        expect(screen.getByRole("status")).toHaveTextContent("대화를 준비하고 있습니다.");
        expect(screen.getByText("대화를 준비하고 있습니다.")).toHaveClass("sr-only");
        expect(screen.getByRole("textbox", { name: "질문 입력" })).toBeDisabled();
    });

    it("hides assistant bubbles containing only invisible parts", () => {
        mockMessages.push({ id: "empty", role: "assistant", parts: [{ type: "step-start" }, { type: "reasoning" }, { type: "text", text: "  " }] } as never);
        const { container } = render(<AgentMobileShell />);
        expect(container.querySelector("article")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "좋아요" })).not.toBeInTheDocument();
    });

    it.each(["succeeded", "rejected"] as const)("shows the refreshed %s card read-only above its result", (status) => {
        mockMessages.push({ id: "agent-action-result:action-card", role: "assistant", parts: [
            { type: "data-action-proposal", data: { actionId: "action-card", capability: "service-records.edit", title: "제공기록지 정정", summary: "회차 변경 제안", expiresAt: "2026-01-01T00:00:00.000Z", expectedRevision: "revision-a", changes: { endDate: "2026-10-14" } } },
            { type: "data-action-result", data: { actionId: "action-card", status, summary: "작업 처리 결과" } },
        ] } as never);
        const { container } = render(<AgentMobileShell />);
        const card = screen.getByLabelText("처리된 작업 제안");
        expect(card).toHaveTextContent("회차 변경 제안");
        expect(card.compareDocumentPosition(screen.getByText("작업 처리 결과")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole("button", { name: "승인하고 실행" })).not.toBeInTheDocument();
        expect(screen.queryByText("제공기록지 정정은 PC 관리자 화면에서 승인해 주세요.")).not.toBeInTheDocument();
        expect(container.querySelectorAll("article")).toHaveLength(1);
    });

    it("moves focus into the modal drawer, inerts the app, and restores focus on Escape", async () => {
        const user = userEvent.setup();
        render(<AgentMobileShell />);
        const menu = screen.getByRole("button", { name: "대화 목록" });

        await user.click(menu);

        const dialog = screen.getByRole("dialog", { name: "대화 목록" });
        expect(dialog).toHaveFocus();
        expect(document.querySelector('[data-slot="application-content"]')).toHaveProperty("inert", true);
        expect(menu).not.toBeDisabled();

        await user.keyboard("{Escape}");

        await waitFor(() => expect(screen.queryByRole("dialog", { name: "대화 목록" })).not.toBeInTheDocument());
        expect(menu).toHaveFocus();
        expect(document.querySelector('[data-slot="application-content"]')).toHaveProperty("inert", false);
    });

    it("does not submit the composer while Korean IME is composing", () => {
        render(<AgentMobileShell />);
        const composer = screen.getByRole("textbox", { name: "질문 입력" });

        fireEvent.change(composer, { target: { value: "한글" } });
        fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
        expect(mockSendMessage).not.toHaveBeenCalled();

        fireEvent.keyDown(composer, { key: "Enter", isComposing: false });
        expect(mockSendMessage).toHaveBeenCalledWith("한글");
    });

    it("passes the full message ancestry to action approval parts", () => {
        mockMessages.push({
            id: "assistant-approval",
            role: "assistant",
            parts: [{
                type: "data-action-proposal",
                data: {
                    actionId: "action-1",
                    capability: "messages.send",
                    title: "메시지 발송",
                    summary: "발송 전에 확인해 주세요.",
                    expiresAt: "2099-08-03T00:00:00.000Z",
                    expectedRevision: "revision-1",
                    changes: { body: "안내" },
                },
            }],
        });

        render(<AgentMobileShell />);

        expect(screen.getByLabelText("승인 대기 작업")).toHaveAttribute(
            "data-component",
            "mobile_chat_agent-shell_thread_message-assistant_part-0_action-approval",
        );
    });

    it("shows no fallback warning for a normal reply carrying step-start markers around tool output", () => {
        mockMessages.push({
            id: "assistant-step-flow",
            role: "assistant",
            parts: [
                { type: "step-start" },
                { type: "text", text: "안내 문구입니다." },
                { type: "tool-lookup", state: "output-available", output: { ok: true } },
                { type: "step-start" },
                { type: "text", text: "마무리 문구입니다." },
            ],
        });

        render(<AgentMobileShell />);

        expect(screen.queryByText(/새 형식/)).not.toBeInTheDocument();
        expect(screen.getByText("안내 문구입니다.")).toBeInTheDocument();
        expect(screen.getByText("마무리 문구입니다.")).toBeInTheDocument();
    });

    it("offers a refresh action when another screen changed the task draft", () => {
        mockTaskNeedsReconciliation = true;

        render(<AgentMobileShell />);

        expect(screen.getAllByRole("alert")).toHaveLength(1);
        expect(screen.getByRole("alert")).toHaveTextContent("최신 초안을 확인한 뒤 다시 수정해 주세요.");
        fireEvent.click(screen.getByRole("button", { name: "최신 초안 불러오기" }));
        expect(mockRefreshTask).toHaveBeenCalledTimes(1);
    });
});
