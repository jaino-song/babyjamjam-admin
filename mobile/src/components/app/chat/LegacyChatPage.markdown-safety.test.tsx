import { render, screen } from "@testing-library/react";

import { LegacyChatPage } from "./LegacyChatPage";

// Unlike LegacyChatPage.test.tsx, react-markdown is NOT mocked here: these
// tests exercise the real markdown pipeline (remark-gfm autolinks, the
// `a`/`img` overrides from agent-markdown-link-components) to verify that
// this legacy surface — served to every branch that has not been switched
// to the AgentShell — carries the same link/image restrictions as the
// AgentShell part registry.
jest.mock("@/components/app/chat/CodeBlock", () => ({
  CodeBlock: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => ({ name: "테스트 사용자", branchName: "테스트 지점" }),
}));

let mockMessages: Array<{ id: string; role: "assistant"; content: string; timestamp: string }> = [];

jest.mock("@/hooks/useChatStream", () => ({
  useChatStream: () => ({
    messages: mockMessages,
    state: "idle",
    sendMessage: jest.fn(),
    clearSession: jest.fn(),
    isToolExecuting: false,
    currentTool: null,
    loadHistory: jest.fn(),
    isLoadingHistory: false,
    hasMoreHistory: false,
  }),
}));

function renderWithMessage(content: string) {
  mockMessages = [{ id: "assistant-1", role: "assistant", content, timestamp: new Date().toISOString() }];
  return render(<LegacyChatPage />);
}

describe("LegacyChatPage markdown safety (real react-markdown pipeline)", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: jest.fn(),
    });
  });

  it("renders an external http(s) link as non-clickable text with its destination host", () => {
    renderWithMessage("[계약서 확인](https://evil.test/?d=customer-data)");
    expect(screen.queryByRole("link", { name: /계약서 확인/ })).not.toBeInTheDocument();
    expect(document.querySelector("a")).not.toBeInTheDocument();
    expect(document.body.textContent).toContain("evil.test");
  });

  it("never renders a real <img> element, only the alt text", () => {
    renderWithMessage("![내부 문서](https://evil.test/x.png)");
    expect(document.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("내부 문서")).toBeInTheDocument();
  });

  it("keeps a same-origin path as a real, same-tab link", () => {
    renderWithMessage("[내부 링크](/clients/1)");
    const link = screen.getByRole("link", { name: "내부 링크" });
    expect(link).toHaveAttribute("href", "/clients/1");
  });
});
