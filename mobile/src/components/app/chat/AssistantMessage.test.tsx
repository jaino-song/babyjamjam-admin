import { render, screen } from "@testing-library/react";

import { AssistantMessage } from "./AssistantMessage";
import type { ChatMessage } from "@/hooks/useChatStream";

// react-syntax-highlighter (pulled in by CodeBlock) ships ESM that jest's
// default transform cannot parse; none of these tests exercise a fenced
// code block, so a lightweight stand-in avoids that transform entirely.
jest.mock("./CodeBlock", () => ({
    CodeBlock: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}));

function renderAssistantMessage(content: string) {
    const message: ChatMessage = {
        role: "assistant",
        content,
        timestamp: new Date().toISOString(),
    };
    return render(
        <AssistantMessage
            data-component="test_assistant"
            message={message}
            messageIndex={0}
            sessionId="session-1"
            onSubmitFeedback={jest.fn()}
        />,
    );
}

// Legacy chat (this component) is served to every branch that has not been
// switched to the AgentShell, so model-authored markdown reaching it must
// get the same link/image restrictions as MobileAgentPartRegistry.
describe("AssistantMessage (mobile legacy chat) markdown safety", () => {
    it("renders an external http(s) link as non-clickable text with its destination host", () => {
        renderAssistantMessage("[계약서 확인](https://evil.test/?d=customer-data)");
        expect(screen.queryByRole("link", { name: /계약서 확인/ })).not.toBeInTheDocument();
        expect(document.querySelector("a")).not.toBeInTheDocument();
        expect(document.body.textContent).toContain("evil.test");
    });

    it("never renders a real <img> element, only the alt text", () => {
        renderAssistantMessage("![내부 문서](https://evil.test/x.png)");
        expect(document.querySelector("img")).not.toBeInTheDocument();
        expect(screen.getByText("내부 문서")).toBeInTheDocument();
    });

    it("keeps a same-origin path as a real, same-tab link", () => {
        renderAssistantMessage("[내부 링크](/clients/1)");
        const link = screen.getByRole("link", { name: "내부 링크" });
        expect(link).toHaveAttribute("href", "/clients/1");
    });

    it("renders a gfm email autolink's label without an appended host", () => {
        renderAssistantMessage("kim@example.com");
        expect(document.querySelector("a")).not.toBeInTheDocument();
        const text = document.body.textContent ?? "";
        expect(text).toContain("kim@example.com");
        expect(text.split("kim@example.com").length - 1).toBe(1);
    });

    it("renders a gfm www autolink's label without an appended host", () => {
        renderAssistantMessage("www.example.com/y");
        expect(document.querySelector("a")).not.toBeInTheDocument();
        const text = document.body.textContent ?? "";
        expect(text).toContain("www.example.com/y");
        expect(text.split("example.com").length - 1).toBe(1);
    });
});
