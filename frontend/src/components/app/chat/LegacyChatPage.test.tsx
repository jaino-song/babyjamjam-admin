import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import type { ChatMessage, ChatState } from "@/hooks/useChatStream";
import { AssistantMessage } from "./AssistantMessage";
import { LegacyChatPage } from "./LegacyChatPage";

const { renderToString } = jest.requireActual<typeof import("react-dom/server")>("react-dom/server.node");

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
    it("hydrates server-null session markup with a client-cached session without recovery or remount", async () => {
        mockState.sessionId = null;
        const container = document.createElement("div");
        container.innerHTML = renderToString(<LegacyChatPage />);
        document.body.appendChild(container);
        const serverWorkspace = container.querySelector('[data-component="desktop_chat_page"]');
        const serverViewport = container.querySelector('[data-component="desktop_chat_page_messages"]');
        const serverComposer = container.querySelector('[aria-label="질문 입력"]');
        expect(container.querySelector("h1")).toHaveTextContent("새 대화");
        expect(container).toHaveTextContent("아직 대화가 없습니다.");
        expect(serverComposer).toBeInTheDocument();
        expect(mockHistory).not.toHaveBeenCalled();

        // The real hook sees null on the server and reads this cached id in its client initializer.
        window.localStorage.setItem("ai_chat_session_id", "returning-session");
        mockState.sessionId = window.localStorage.getItem("ai_chat_session_id");
        const onRecoverableError = jest.fn();
        let root: Root | undefined;
        try {
            await act(async () => {
                root = hydrateRoot(container, <LegacyChatPage />, { onRecoverableError });
            });
            expect(onRecoverableError).not.toHaveBeenCalled();
            expect(container.querySelector('[data-component="desktop_chat_page"]')).toBe(serverWorkspace);
            expect(container.querySelector('[data-component="desktop_chat_page_messages"]')).toBe(serverViewport);
            expect(container.querySelector('[aria-label="질문 입력"]')).toBe(serverComposer);
            expect(container.querySelector("h1")).toHaveTextContent("현재 대화");
            expect(container.querySelector('[data-component="desktop_chat_page_sidebar_current"]')).toHaveAttribute("aria-current", "true");
            expect(container).not.toHaveTextContent("아직 대화가 없습니다.");
            expect(mockHistory).toHaveBeenCalledTimes(1);
            expect(mockHistory).toHaveBeenCalledWith(0);

            mockState.sessionId = null;
            await act(async () => { root?.render(<LegacyChatPage />); });
            expect(container.querySelector("h1")).toHaveTextContent("새 대화");
            expect(container.querySelector('[data-component="desktop_chat_page_sidebar_current"]')).not.toBeInTheDocument();
            expect(container).toHaveTextContent("아직 대화가 없습니다.");
            expect(container.querySelector('[data-component="desktop_chat_page_messages"]')).toBe(serverViewport);
        } finally {
            await act(async () => { root?.unmount(); });
            container.remove();
            window.localStorage.removeItem("ai_chat_session_id");
        }
    });

    it("sizes only Legacy workspace prose while retaining heading/code semantics and default widget text", () => {
        const css = readFileSync(resolve(__dirname, "../../../app/globals.css"), "utf8");
        const marker = "/* Chat workspace normal conversation text; rich registry cards and widgets retain their typography. */";
        expect(css).toContain(marker);
        const style = document.createElement("style");
        style.textContent = 'p, li { font-size: 12.8px; line-height: 21.76px; } .markdown-content h1 { font-size: 24px; line-height: 40.8px; } .markdown-content code { font-size: 14px; line-height: 20px; }' + css.slice(css.indexOf(marker));
        document.head.appendChild(style);
        try {
            mockState.messages = [message("사용자 본문", "user"), message("# 마크다운 제목\n\nAI 본문\n\n- 목록 항목\n\n`inline`")];
            const { container } = render(<>
                <LegacyChatPage />
                <div data-testid="widget-prose"><AssistantMessage message={message("위젯 본문")} messageIndex={0} sessionId="widget-session" onSubmitFeedback={jest.fn()} /></div>
            </>);
            for (const text of ["사용자 본문", "AI 본문", "목록 항목"]) {
                expect(getComputedStyle(screen.getByText(text)).fontSize).toBe("16px");
                expect(getComputedStyle(screen.getByText(text)).lineHeight).toBe("28px");
            }
            expect(getComputedStyle(screen.getByRole("heading", { name: "마크다운 제목" })).fontSize).toBe("24px");
            expect(getComputedStyle(screen.getByText("inline")).fontSize).toBe("14px");
            expect(getComputedStyle(screen.getByText("위젯 본문")).fontSize).toBe("12.8px");
            expect(screen.getByTestId("widget-prose").querySelector('[data-slot="chat-workspace-assistant-prose"]')).not.toBeInTheDocument();
            expect(container.querySelector('[data-slot="chat-workspace-user-text"]')).toHaveTextContent("사용자 본문");
        } finally { style.remove(); }
    });

});
