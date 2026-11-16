import { render, screen } from "@testing-library/react";

import { ChatFullscreen } from "../ChatFullscreen";

// Keep the header test independent of message rendering and its ESM dependencies.
jest.mock("../AssistantMessage", () => ({
  AssistantMessage: () => null,
}));

jest.mock("@/hooks/useChatStream", () => ({
  useChatStream: () => ({
    messages: [],
    state: "idle",
    sendMessage: jest.fn(),
    clearSession: jest.fn(),
    isToolExecuting: false,
    currentTool: null,
    loadHistory: jest.fn(),
    isLoadingHistory: false,
    hasMoreHistory: false,
    totalMessages: 0,
  }),
}));

describe("ChatFullscreen agent header", () => {
  it("shows 에이전트 as the open chat heading", () => {
    render(<ChatFullscreen open onClose={jest.fn()} />);

    expect(screen.getByRole("heading", { level: 2, name: "에이전트" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /어시스턴트/ })).not.toBeInTheDocument();
  });
});
