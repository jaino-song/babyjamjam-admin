import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ChatFullscreen } from "../ChatFullscreen";

const mockSendMessage = jest.fn();

// react-markdown is ESM; mock it for Jest.
jest.mock("react-markdown", () => ({
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("remark-gfm", () => ({
    __esModule: true,
    default: () => { },
}));

// Avoid importing CodeBlock/react-syntax-highlighter (ESM deps) in this test.
jest.mock("../AssistantMessage", () => ({
    AssistantMessage: () => <div data-testid="assistant-message" />,
}));

jest.mock("@/hooks/useChatStream", () => ({
    useChatStream: () => ({
        messages: [],
        state: "idle",
        sendMessage: mockSendMessage,
        clearSession: jest.fn(),
        isToolExecuting: false,
        currentTool: null,
        loadHistory: jest.fn(),
        isLoadingHistory: false,
        hasMoreHistory: false,
        totalMessages: 0,
    }),
}));

describe("ChatFullscreen shortcut chips", () => {
    beforeEach(() => {
        mockSendMessage.mockClear();
    });

    test("renders shortcut chips above input", () => {
        render(<ChatFullscreen open onClose={jest.fn()} />);

        expect(screen.getByText("산모 등록")).toBeInTheDocument();
        expect(screen.getByText("계약서 전송")).toBeInTheDocument();
        expect(screen.getByText("계약서 상태 조회")).toBeInTheDocument();
    });

    test("clicking chips sends the chip label as message", () => {
        render(<ChatFullscreen open onClose={jest.fn()} />);

        fireEvent.click(screen.getByText("산모 등록"));
        fireEvent.click(screen.getByText("계약서 전송"));
        fireEvent.click(screen.getByText("계약서 상태 조회"));

        expect(mockSendMessage).toHaveBeenCalledWith("산모 등록");
        expect(mockSendMessage).toHaveBeenCalledWith("계약서 전송");
        expect(mockSendMessage).toHaveBeenCalledWith("계약서 상태 조회");
    });
});
