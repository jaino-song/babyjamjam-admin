import { render, screen } from "@testing-library/react";

import { ChatFullscreen } from "../ChatFullscreen";

let mockHistoryLoading = true;
const mockMessages = [{ role: "user", content: "QA-이전 대화" }];
jest.mock("../AssistantMessage", () => ({ AssistantMessage: () => null }));
jest.mock("@/hooks/useChatStream", () => ({
  useChatStream: () => ({
    messages: mockMessages, state: "idle", sendMessage: jest.fn(), clearSession: jest.fn(),
    isToolExecuting: false, currentTool: null, loadHistory: jest.fn(),
    isLoadingHistory: mockHistoryLoading, hasMoreHistory: false,
  }),
}));

it("labels history pagination without hiding the existing conversation", () => {
  Element.prototype.scrollIntoView = jest.fn();
  const { rerender } = render(<ChatFullscreen open onClose={jest.fn()} />);
  const status = screen.getByRole("status", { name: "이전 대화를 불러오는 중" });
  expect(status.querySelector(".sr-only")).toHaveTextContent("이전 대화를 불러오는 중");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText("QA-이전 대화")).toBeInTheDocument();
  mockHistoryLoading = false;
  rerender(<ChatFullscreen open onClose={jest.fn()} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("QA-이전 대화")).toBeInTheDocument();
});
