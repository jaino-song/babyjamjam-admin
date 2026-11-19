import { fireEvent, render, screen } from "@testing-library/react";

import { ClientMessageHistoryDetail, type ClientMessageHistoryDetailView } from "./client-message-history-detail";

const view: ClientMessageHistoryDetailView = {
  title: "서비스 안내", templateLabel: "서비스 안내", channelLabel: "메시지",
  statusLabel: "발송 실패", statusTone: "burgundy", sentAtLabel: "11월 17일",
  recipientName: "QA-고객", recipientPhone: "01000000000", messageBody: "안내", failureReason: null,
};

it.each([undefined, "안내 재발송 중"])("centers a spinner and prevents another retry (label: %s)", (retryPendingLabel) => {
  const onRetry = jest.fn();
  const props = { view, onBack: jest.fn(), canRetry: true, onRetry, retryPendingLabel };
  const { rerender } = render(<ClientMessageHistoryDetail data-component="mobile_clients_detail_message" {...props} isRetrying />);
  const button = screen.getByRole("button", { name: retryPendingLabel ?? "재발송 중" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAttribute("data-loading", "");
  const idle = button.querySelector('[data-slot="button-idle"]');
  expect(idle).toHaveAttribute("aria-hidden", "true");
  expect(idle).toHaveClass("contents", "invisible");
  expect(idle).toHaveTextContent("재발송");
  expect(button.querySelector('[data-slot="button-spinner"]')).toHaveClass("absolute", "inset-0");
  fireEvent.click(button);
  expect(onRetry).not.toHaveBeenCalled();
  rerender(<ClientMessageHistoryDetail data-component="mobile_clients_detail_message" {...props} isRetrying={false} />);
  const ready = screen.getByRole("button", { name: "재발송" });
  expect(ready).toBeEnabled();
  expect(ready).not.toHaveAttribute("data-loading");
  fireEvent.click(ready);
  expect(onRetry).toHaveBeenCalledTimes(1);
});
