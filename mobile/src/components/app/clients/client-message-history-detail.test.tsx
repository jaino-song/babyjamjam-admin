import { fireEvent, render, screen } from "@testing-library/react";

import {
  ClientMessageHistoryDetail,
  type ClientMessageHistoryDetailView,
} from "./client-message-history-detail";

const baseView: ClientMessageHistoryDetailView = {
  title: "서비스 안내",
  templateLabel: "서비스 안내",
  channelLabel: "메시지",
  statusLabel: "추가 정보 필요",
  statusTone: "orange",
  sentAtLabel: "7월 16일 오전 10:00",
  recipientName: "김고객",
  recipientPhone: "01012345678",
  messageBody: "안녕하세요",
  failureReason: null,
};

function renderDetail(
  view: Partial<ClientMessageHistoryDetailView>,
  props: Partial<Parameters<typeof ClientMessageHistoryDetail>[0]> = {},
) {
  return render(
    <ClientMessageHistoryDetail
      data-component="test_detail"
      view={{ ...baseView, ...view }}
      onBack={jest.fn()}
      {...props}
    />,
  );
}

describe("ClientMessageHistoryDetail", () => {
  it("shows the 추가 필요 정보 row for a needs_setup message and no 실패 사유", () => {
    renderDetail({ setupReason: "연락처가 연결되지 않았습니다." });

    expect(screen.getByText("추가 필요 정보")).toBeInTheDocument();
    expect(screen.getByText("연락처가 연결되지 않았습니다.")).toBeInTheDocument();
    expect(screen.queryByText("실패 사유")).not.toBeInTheDocument();
  });

  it("hides the 추가 필요 정보 row when there is no setup reason", () => {
    renderDetail({ setupReason: null });

    expect(screen.queryByText("추가 필요 정보")).not.toBeInTheDocument();
  });

  it("shows no 재발송 button for a needs_setup message when the caller passes no handler", () => {
    renderDetail({ setupReason: "연락처가 연결되지 않았습니다." });

    expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
  });

  it("shows the 재발송 button for a non-failed message when the caller allows it, and calls the handler", () => {
    const onRetry = jest.fn();
    renderDetail({ setupReason: "연락처가 연결되지 않았습니다." }, { canRetry: true, onRetry });

    fireEvent.click(screen.getByRole("button", { name: "재발송" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides the button when the caller does not allow a retry, even with a handler", () => {
    renderDetail({}, { canRetry: false, onRetry: jest.fn() });

    expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
  });

  it("hides the button when allowed but no handler is given", () => {
    renderDetail({}, { canRetry: true });

    expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
  });

  it("keeps the failed-message retry with its old pending label", () => {
    renderDetail(
      { statusTone: "burgundy", statusLabel: "발송 실패", failureReason: "발신번호 인증에 실패했습니다." },
      { canRetry: true, isRetrying: true, onRetry: jest.fn() },
    );

    const button = screen.getByRole("button", { name: "재발송 중..." });
    expect(button).toBeDisabled();
    expect(screen.getByText("실패 사유")).toBeInTheDocument();
  });

  it("shows the caller's pending label while retrying", () => {
    renderDetail(
      { setupReason: "연락처가 연결되지 않았습니다." },
      { canRetry: true, isRetrying: true, onRetry: jest.fn(), retryPendingLabel: "재발송 중" },
    );

    expect(screen.getByRole("button", { name: "재발송 중" })).toBeDisabled();
  });
});
