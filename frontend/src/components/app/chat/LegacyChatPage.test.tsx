import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChatMessage, ChatState } from "@/hooks/useChatStream";
import { LegacyChatPage } from "./LegacyChatPage";

const mockBack = jest.fn();
const mockSend = jest.fn();
const mockConfirm = jest.fn();
const mockCancel = jest.fn();
const mockClear = jest.fn();
const mockHistory = jest.fn();
const mockState = {
    messages: [] as ChatMessage[], state: "idle" as ChatState, sessionId: "legacy-session" as string | null,
    pendingConfirmation: null as unknown, hasMoreHistory: true, isLoadingHistory: false,
};
jest.mock("next/navigation", () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock("./ChatWorkspaceStats", () => ({ ChatWorkspaceStats: () => null }));
jest.mock("./CodeBlock", () => ({ CodeBlock: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre> }));
jest.mock("@/hooks/useChatStream", () => ({ useChatStream: () => ({ ...mockState, sendMessage: mockSend, confirmAction: mockConfirm, cancelAction: mockCancel, clearSession: mockClear, loadHistory: mockHistory, isToolExecuting: false, currentTool: null }) }));

const message = (content: string, role: "user" | "assistant" = "assistant"): ChatMessage => ({ content, role, timestamp: "2026-11-03T00:00:00Z" });
describe("LegacyChatPage workspace preservation", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockState.messages = [];
        mockState.state = "idle";
        mockState.sessionId = "legacy-session";
        mockState.pendingConfirmation = null;
        mockState.hasMoreHistory = true;
        mockState.isLoadingHistory = false;
        Element.prototype.scrollIntoView = jest.fn();
        Object.defineProperty(window, "matchMedia", { configurable: true, value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
    });
    it("mounts history inside a bounded section, keeps destructive clear distinct from sending and preserves back", () => {
        const { container } = render(<main><LegacyChatPage /></main>);
        expect(mockHistory).toHaveBeenCalledWith(0);
        expect(screen.getAllByRole("main")).toHaveLength(1);
        const root = container.querySelector('[data-component="desktop_chat_page"]');
        expect(root?.tagName).toBe("SECTION");
        expect(root).toHaveClass("h-full", "min-h-0", "overflow-hidden");
        expect(root).not.toHaveClass("fixed");
        expect(screen.queryByRole("button", { name: "새 대화" })).not.toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: "대화 검색" })).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId("chat-clear"));
        expect(mockClear).toHaveBeenCalledTimes(1);
        expect(mockSend).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId("chat-back"));
        expect(mockBack).toHaveBeenCalledTimes(1);
    });
    it("preserves all three quick actions and disables them and confirmation while streaming", () => {
        mockState.messages = [message("확인해 주세요")];
        mockState.pendingConfirmation = { type: "update" };
        const { rerender } = render(<LegacyChatPage />);
        for (const label of ["산모 등록", "계약서 전송", "계약서 상태 조회"]) {
            fireEvent.click(screen.getByRole("button", { name: label }));
            expect(mockSend).toHaveBeenLastCalledWith(label);
        }
        fireEvent.click(screen.getByRole("button", { name: "확인" }));
        fireEvent.click(screen.getByRole("button", { name: "취소" }));
        expect(mockConfirm).toHaveBeenCalledTimes(1);
        expect(mockCancel).toHaveBeenCalledTimes(1);
        mockState.state = "streaming";
        rerender(<LegacyChatPage />);
        for (const label of ["산모 등록", "계약서 전송", "계약서 상태 조회", "확인", "취소"]) expect(screen.getByRole("button", { name: label })).toBeDisabled();
        mockState.messages = [{ ...message("작성 중"), isStreaming: true }];
        rerender(<LegacyChatPage />);
        expect(screen.queryByRole("button", { name: "확인" })).not.toBeInTheDocument();
    });
    it("attaches pagination to the actual viewport and preserves prepend anchoring without remounting", async () => {
        const latest = message("마지막 메시지");
        mockState.messages = [latest];
        const { container, rerender } = render(<LegacyChatPage />);
        const viewport = container.querySelector('[data-component="desktop_chat_page_messages"]') as HTMLDivElement;
        const composer = screen.getByRole("textbox", { name: "질문 입력" });
        expect(viewport).not.toContainElement(composer);
        let height = 500;
        Object.defineProperty(viewport, "scrollHeight", { configurable: true, get: () => height });
        viewport.scrollTop = 20;
        fireEvent.scroll(viewport);
        expect(mockHistory).toHaveBeenLastCalledWith(1);
        mockState.messages = [message("이전 기록"), latest];
        height = 780;
        rerender(<LegacyChatPage />);
        await waitFor(() => expect(viewport.scrollTop).toBe(280));
        expect(container.querySelector('[data-component="desktop_chat_page_messages"]')).toBe(viewport);
        mockState.isLoadingHistory = true;
        rerender(<LegacyChatPage />);
        mockHistory.mockClear();
        fireEvent.scroll(viewport);
        expect(mockHistory).not.toHaveBeenCalled();
    });
    it("keeps markdown restrictions, posts feedback with the real session/index, and guards IME", async () => {
        mockState.messages = [message("요청", "user"), message("[위험](https://outside.test) [고객](/clients)")];
        global.fetch = jest.fn().mockResolvedValue({ ok: true });
        render(<LegacyChatPage />);
        expect(screen.queryByRole("link", { name: "위험" })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "고객" })).toHaveAttribute("href", "/clients");
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "도움이 됐어요" })); });
        expect(global.fetch).toHaveBeenCalledWith("/api/ai/chat/feedback", expect.objectContaining({ body: JSON.stringify({ sessionId: "legacy-session", messageIndex: 1, type: "positive" }) }));
        const input = screen.getByRole("textbox", { name: "질문 입력" });
        fireEvent.change(input, { target: { value: "한글 질문" } });
        fireEvent.keyDown(input, { key: "Enter", isComposing: true });
        expect(mockSend).not.toHaveBeenCalled();
        fireEvent.keyDown(input, { key: "Enter" });
        expect(mockSend).toHaveBeenCalledWith("한글 질문");
    });
});
