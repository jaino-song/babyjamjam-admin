import { fireEvent, render, screen } from "@testing-library/react";

import { ApprovalTwoButtonModal } from "./ApprovalTwoButtonModal";

describe("ApprovalTwoButtonModal", () => {
  it("renders the standard mobile approval actions and closes from either action", () => {
    const handleOpenChange = jest.fn();
    const handleApprove = jest.fn();

    render(
      <ApprovalTwoButtonModal
        open
        onOpenChange={handleOpenChange}
        title="요청을 완료하지 못했습니다."
        description="잠시 후 다시 시도해 주세요."
        isDescriptionVisuallyHidden={false}
        cancelLabel="닫기"
        approvalLabel="확인"
        onApprove={handleApprove}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "요청을 완료하지 못했습니다." });
    expect(dialog).toHaveAttribute("data-component", "approval-two-button-modal");
    expect(screen.getByText("잠시 후 다시 시도해 주세요.")).not.toHaveClass("sr-only");

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(handleOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(handleApprove).toHaveBeenCalledTimes(1);
  });

  it("locks both actions while approval is pending", () => {
    render(
      <ApprovalTwoButtonModal
        open
        onOpenChange={jest.fn()}
        title="계약서를 생성하고 있습니다."
        description="잠시만 기다려 주세요."
        approvalLabel="확인"
        pendingLabel="처리 중..."
        isPending
        onApprove={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "처리 중..." })).toBeDisabled();
  });
});
