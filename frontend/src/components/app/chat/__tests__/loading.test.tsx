import { render, screen } from "@testing-library/react";

import { LegacyChatPage } from "../LegacyChatPage";
import { ToolIndicator } from "../tool-indicator";
import type { ChatState } from "@/hooks/useChatStream";

let mockState: ChatState = "connecting";
let mockTool: string | null = null;
const mockLoadHistory = jest.fn();
const mockMessages = [{ role: "user", content: "안녕하세요" }];

jest.mock("next/navigation", () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock("../ChatWorkspaceStats", () => ({ ChatWorkspaceStats: () => null }));
jest.mock("../AssistantMessage", () => ({ AssistantMessage: () => null }));
jest.mock("@/hooks/useChatStream", () => ({
  useChatStream: () => ({
    messages: mockMessages, state: mockState, currentTool: mockTool, isToolExecuting: true,
    sessionId: "session-1", isLoadingHistory: true, hasMoreHistory: false,
    loadHistory: mockLoadHistory, clearSession: jest.fn(), sendMessage: jest.fn(),
  }),
}));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: jest.fn() });
});

beforeEach(() => {
  mockState = "connecting";
  mockTool = null;
});

it.each([
  ["legacy", () => <LegacyChatPage />],
] as const)("%s announces generic connection, tool and history loading without visible wait copy", (_name, content) => {
  const { rerender } = render(content());
  for (const name of ["연결 중", "처리 중", "이전 대화 불러오는 중"]) {
    const status = screen.getByRole("status", { name });
    expect(status.querySelector(".sr-only")).toHaveTextContent(name);
    expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  }
  expect(screen.queryByText("연결 중...")).not.toBeInTheDocument();
  expect(screen.queryByText("처리 중...")).not.toBeInTheDocument();

  mockTool = "산모 검색";
  mockState = "streaming";
  rerender(content());
  expect(screen.getByText("산모 검색 실행 중...")).not.toHaveClass("sr-only");
  expect(screen.getByRole("status", { name: "산모 검색 실행 중" })).toBeInTheDocument();
  expect(screen.queryByRole("status", { name: "연결 중" })).not.toBeInTheDocument();
});

it("keeps useful per-tool labels and hides only the generic tool label", () => {
  const { rerender } = render(<ToolIndicator toolName={null} isExecuting />);
  expect(screen.getByText("처리 중")).toHaveClass("sr-only");
  expect(screen.queryByText("처리 중...")).not.toBeInTheDocument();
  rerender(<ToolIndicator toolName="searchClients" isExecuting />);
  expect(screen.getByText("산모 검색 중...")).not.toHaveClass("sr-only");
  expect(screen.getByRole("status", { name: "산모 검색 중" })).toBeInTheDocument();
  rerender(<ToolIndicator toolName="searchClients" isExecuting={false} />);
  expect(screen.queryByTestId("tool-indicator")).not.toBeInTheDocument();
});
