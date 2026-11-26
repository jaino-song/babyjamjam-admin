import { fireEvent, render, screen } from "@testing-library/react";

import { TwoButtonModal } from "./TwoButtonModal";

describe("TwoButtonModal", () => {
  it("renders the standard compact approval design and actions", () => {
    const handleOpenChange = jest.fn();
    const handleApprove = jest.fn();

    render(
      <TwoButtonModal
        open
        onOpenChange={handleOpenChange}
        title="제공인력을 삭제하시겠어요?"
        description="삭제한 제공인력은 목록에서 사라져요."
        approvalLabel="삭제"
        approvalVariant="destructive"
        onApprove={handleApprove}
        dataComponent="desktop_employees_delete-approval"
      />,
    );

    const dialog = screen.getByRole("dialog");
    const header = dialog.querySelector('[data-slot="dialog-header"]');
    const title = screen.getByText("제공인력을 삭제하시겠어요?");
    const description = screen.getByText("삭제한 제공인력은 목록에서 사라져요.");
    const cancelButton = screen.getByRole("button", { name: "취소" });
    const approvalButton = screen.getByRole("button", { name: "삭제" });

    expect(dialog).toHaveAttribute("data-component", "desktop_employees_delete-approval");
    expect(dialog).toHaveClass("aspect-[5/3]", "sm:max-w-[300px]");
    expect(header).toHaveClass("gap-1");
    expect(header).not.toHaveClass("gap-2");
    expect(header).toHaveClass("text-left", "sm:text-left", "flex-1", "pb-0");
    expect(header).not.toHaveClass("text-center", "sm:text-center", "pb-3");
    expect(title).toHaveClass(
      "text-center",
      "text-[calc(16px*var(--v3-ui-scale,1))]",
      "leading-[calc(24px*var(--v3-ui-scale,1))]",
    );
    expect(description).toHaveClass("sr-only");
    expect(description).toHaveClass(
      "text-[calc(12px*var(--v3-ui-scale,1))]",
      "leading-[calc(20px*var(--v3-ui-scale,1))]",
    );
    expect(description).toHaveClass("mt-0", "text-left");
    expect(description).not.toHaveClass("text-center", "w-fit", "mx-auto", "whitespace-pre-line");
    expect(title).toHaveClass("break-keep", "[overflow-wrap:anywhere]");
    expect(description).toHaveClass("break-keep", "[overflow-wrap:anywhere]");
    expect(description).not.toHaveClass("mt-[calc(6px*var(--glint-ui-scale,1))]");
    expect(cancelButton).toHaveClass("w-1/2");
    expect(cancelButton).toHaveAttribute("data-variant", "neutral");
    expect(approvalButton).toHaveClass("w-1/2");
    expect(approvalButton).toHaveAttribute("data-variant", "destructive");

    fireEvent.click(cancelButton);
    expect(handleOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(approvalButton);
    expect(handleApprove).toHaveBeenCalledTimes(1);
  });

  it("locks both actions and shows the pending label while approving", () => {
    const handleOpenChange = jest.fn();
    const handleApprove = jest.fn();

    render(
      <TwoButtonModal
        open
        onOpenChange={handleOpenChange}
        title="문서를 삭제하시겠습니까?"
        description="삭제 중에는 창을 닫을 수 없습니다."
        approvalLabel="삭제"
        pendingLabel="삭제 중..."
        isPending
        onApprove={handleApprove}
      />,
    );

    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "삭제 중..." })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "삭제 중..." }));
    expect(handleApprove).not.toHaveBeenCalled();
    expect(handleOpenChange).not.toHaveBeenCalled();
  });

  it("supports a review body without changing the shared action layout", () => {
    render(
      <TwoButtonModal
        open
        size="detail"
        onOpenChange={jest.fn()}
        title="중복 전송 확인"
        description="최근 같은 메시지를 보낸 기록이 있습니다."
        isDescriptionVisuallyHidden={false}
        approvalLabel="전송"
        onApprove={jest.fn()}
      >
        <div data-testid="review-body">최근 전송 내역</div>
      </TwoButtonModal>,
    );

    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-[420px]");
    expect(screen.getByRole("dialog").querySelector('[data-slot="dialog-header"]')).toHaveClass("pb-3");
    expect(screen.getByText("최근 같은 메시지를 보낸 기록이 있습니다.")).not.toHaveClass("sr-only");
    expect(screen.getByTestId("review-body")).toBeInTheDocument();
    expect(screen.getByTestId("review-body").parentElement).toHaveClass("pb-3", "empty:hidden");
    expect(screen.getByRole("button", { name: "전송" })).toHaveClass("w-1/2");
  });

  it("keeps the compact width without the fixed ratio for a short review body", () => {
    render(
      <TwoButtonModal
        open
        size="review"
        onOpenChange={jest.fn()}
        title="확인이 필요해요"
        description="계약서 전자문서가 완료된 상태여서 전자문서는 변경할 수 없어요. 그래도 수정할까요?"
        isDescriptionVisuallyHidden={false}
        approvalLabel="수정"
        onApprove={jest.fn()}
      >
        <div data-testid="review-body">계약서와 달라지는 수정 사항</div>
      </TwoButtonModal>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("min-h-0", "sm:max-w-[300px]");
    expect(dialog).not.toHaveClass("aspect-[5/3]");
    expect(dialog.querySelector('[data-slot="dialog-header"]')).not.toHaveClass("flex-1");
    expect(dialog.querySelector('[data-slot="dialog-header"]')).toHaveClass("pb-3");
    const description = screen.getByText("계약서 전자문서가 완료된 상태여서 전자문서는 변경할 수 없어요. 그래도 수정할까요?");
    expect(description).not.toHaveClass("sr-only", "text-center");
    expect(description).toHaveClass(
      "text-[calc(12px*var(--v3-ui-scale,1))]",
      "text-v3-text-muted",
      "text-left",
      "mx-auto",
      "w-fit",
      "max-w-full",
      "whitespace-pre-line",
    );
    expect(screen.getByTestId("review-body").parentElement).toHaveClass("overflow-y-auto");
  });

  it("starts each sentence of a visible text description on its own line", () => {
    render(
      <TwoButtonModal
        open
        size="review"
        onOpenChange={jest.fn()}
        title="확인"
        description="메시지는 발송되지 않았습니다. 아래 링크를 복사해 주세요? 1. 항목은 2.5시간이에요!  끝"
        isDescriptionVisuallyHidden={false}
        approvalLabel="확인"
        onApprove={jest.fn()}
      />,
    );

    expect(screen.getByText(/메시지는 발송되지 않았습니다/).textContent).toBe(
      "메시지는 발송되지 않았습니다.\n아래 링크를 복사해 주세요?\n1. 항목은 2.5시간이에요!\n끝",
    );
  });

  it("leaves a hidden or non-text description as written", () => {
    const { rerender } = render(
      <TwoButtonModal
        open
        onOpenChange={jest.fn()}
        title="삭제할까요?"
        description="삭제하면 사라져요. 복구할 수 없어요."
        approvalLabel="삭제"
        onApprove={jest.fn()}
      />,
    );

    expect(screen.getByText("삭제하면 사라져요. 복구할 수 없어요.")).toHaveClass("sr-only");
    expect(screen.getByText("삭제하면 사라져요. 복구할 수 없어요.").textContent).toBe("삭제하면 사라져요. 복구할 수 없어요.");

    rerender(
      <TwoButtonModal
        open
        size="review"
        onOpenChange={jest.fn()}
        title="삭제할까요?"
        description={<span data-testid="node-description">삭제하면 사라져요. 복구할 수 없어요.</span>}
        isDescriptionVisuallyHidden={false}
        approvalLabel="삭제"
        onApprove={jest.fn()}
      />,
    );

    expect(screen.getByTestId("node-description").textContent).toBe("삭제하면 사라져요. 복구할 수 없어요.");
  });

  it("shows the description as the centered question in the question layout", () => {
    render(
      <TwoButtonModal
        open
        size="review"
        layout="question"
        onOpenChange={jest.fn()}
        title="확인이 필요해요"
        description="계약서 전자문서가 완료된 상태여서 전자문서는 변경할 수 없어요. 그래도 수정할까요?"
        isDescriptionVisuallyHidden
        approvalLabel="수정"
        onApprove={jest.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "확인이 필요해요" });
    const header = dialog.querySelector('[data-slot="dialog-header"]');
    const title = screen.getByText("확인이 필요해요");
    const description = screen.getByText("계약서 전자문서가 완료된 상태여서 전자문서는 변경할 수 없어요. 그래도 수정할까요?");

    expect(dialog).toHaveClass("min-h-[180px]", "sm:max-w-[300px]");
    expect(dialog).not.toHaveClass("min-h-0", "aspect-[5/3]");
    expect(header).toHaveClass("flex-1", "justify-start", "pb-3");
    expect(header).not.toHaveClass("justify-center");
    expect(title).toHaveClass("sr-only");
    expect(description).not.toHaveClass("sr-only", "text-left", "text-v3-text-muted", "whitespace-pre-line", "w-fit");
    expect(description).toHaveClass(
      "text-[calc(12px*var(--v3-ui-scale,1))]",
      "leading-[calc(20px*var(--v3-ui-scale,1))]",
      "my-auto",
      "py-5",
      "text-center",
      "text-balance",
      "font-semibold",
      "text-v3-dark",
    );
    expect(description.textContent).toBe("계약서 전자문서가 완료된 상태여서 전자문서는 변경할 수 없어요. 그래도 수정할까요?");
  });
});
