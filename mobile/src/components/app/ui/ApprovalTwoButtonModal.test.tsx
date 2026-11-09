import { fireEvent, render, screen } from "@testing-library/react";

import { ApprovalTwoButtonModal } from "./ApprovalTwoButtonModal";

describe("ApprovalTwoButtonModal", () => {
  it("renders the standard mobile approval actions and closes from either action", () => {
    const handleOpenChange = jest.fn();
    const handleApprove = jest.fn();

    render(
      <ApprovalTwoButtonModal
        data-component="mobile_tests_approval-modal_default"
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
    expect(dialog).toHaveAttribute("data-component", "mobile_tests_approval-modal_default");
    expect(dialog).toHaveClass(
      "w-[calc(min(100vw,390px)-2rem)]",
      "max-w-[358px]",
      "rounded-[24px]",
    );
    expect(screen.getByText("잠시 후 다시 시도해 주세요.")).not.toHaveClass("sr-only");
    expect(screen.getByText("요청을 완료하지 못했습니다.")).toHaveClass("break-keep", "[overflow-wrap:anywhere]");
    expect(screen.getByText("잠시 후 다시 시도해 주세요.")).toHaveClass("break-keep", "[overflow-wrap:anywhere]");
    expect(screen.getByRole("button", { name: "닫기" })).toHaveClass("h-11", "text-base", "leading-6");

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(handleOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(handleApprove).toHaveBeenCalledTimes(1);
  });

  it("locks both actions while approval is pending", () => {
    render(
      <ApprovalTwoButtonModal
        data-component="mobile_tests_approval-modal_pending"
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
    expect(screen.getByText("잠시만 기다려 주세요.")).toHaveClass("sr-only");
  });

  it.each(["compact", "detail"] as const)("uses layout B and renders modal body content for size %s", (size) => {
    render(
      <ApprovalTwoButtonModal
        data-component="mobile_tests_approval-modal_detail"
        open
        onOpenChange={jest.fn()}
        title="서비스 일정 변경"
        description="3회차 서비스 제공 날짜를 조정합니다."
        isDescriptionVisuallyHidden={false}
        size={size}
        approvalLabel="일정 변경"
        onApprove={jest.fn()}
      >
        <label htmlFor="schedule-date">3회차 서비스 제공 날짜</label>
        <input id="schedule-date" type="date" />
      </ApprovalTwoButtonModal>,
    );

    const dialog = screen.getByRole("dialog", { name: "서비스 일정 변경" });
    const title = screen.getByRole("heading", { name: "서비스 일정 변경" });
    const header = title.parentElement;
    const description = screen.getByText("3회차 서비스 제공 날짜를 조정합니다.");
    const cancel = screen.getByRole("button", { name: "취소" });
    const approve = screen.getByRole("button", { name: "일정 변경" });

    expect(dialog).toHaveClass("max-w-[358px]");
    expect(dialog).not.toHaveClass("min-h-[176px]");
    expect(header).toHaveClass(
      "flex", "flex-col", "items-center", "justify-center", "gap-1.5", "text-center",
    );
    expect(header).not.toHaveClass("flex-1");
    expect(header).not.toHaveClass("text-left");
    expect(title).toHaveClass(
      "text-center", "text-xl", "leading-7", "break-keep", "[overflow-wrap:anywhere]", "font-bold", "text-v3-dark",
    );
    expect(title).not.toHaveClass("text-left");
    expect(description).toHaveClass(
      "mt-0", "text-center", "text-base", "leading-6", "break-keep", "[overflow-wrap:anywhere]", "text-v3-text-muted",
    );
    expect(description).not.toHaveClass("sr-only");
    expect(cancel.parentElement).toHaveClass("mt-6", "flex", "gap-2");
    expect(cancel.parentElement).not.toHaveClass("mt-4");
    expect(cancel).toHaveClass("h-11", "w-1/2", "text-base", "leading-6");
    expect(approve).toHaveClass("h-11", "w-1/2", "text-base", "leading-6", "rounded-full");
    expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toBeInTheDocument();
  });
});
