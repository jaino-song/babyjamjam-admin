import { render, screen } from "@testing-library/react";

import { MobileTwoButtonModal } from "./MobileTwoButtonModal";

describe("MobileTwoButtonModal", () => {
  it.each([undefined, "cancel-confirm"] as const)("renders cancel first at one third and confirm second at two thirds (order %s)", (actionOrder) => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(
      <MobileTwoButtonModal
        data-component="mobile_tests_two-button-modal_order"
        open
        title="계속할까요?"
        description="동작을 확인해 주세요."
        cancelLabel="취소"
        confirmLabel="확인"
        actionOrder={actionOrder}
        onOpenChange={jest.fn()}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].parentElement).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]");
    expect(buttons[0]).toHaveTextContent("취소");
    expect(buttons[0]).toHaveClass("min-w-0", "flex-1");
    expect(buttons[1]).toHaveTextContent("확인");
    expect(buttons[1]).toHaveClass("min-w-0", "flex-[2_1_0]");
  });

  it("uses the shared left-aligned 16px/14px header and renders form content", () => {
    render(
      <MobileTwoButtonModal
        data-component="mobile_tests_two-button-modal_default"
        open
        title="서비스 일정 변경"
        description="3회차 서비스 제공 날짜를 조정합니다."
        cancelLabel="취소"
        confirmLabel="일정 변경"
        loading
        confirmDisabled
        onOpenChange={jest.fn()}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      >
        <label htmlFor="service-date">3회차 서비스 제공 날짜</label>
        <input id="service-date" type="date" />
      </MobileTwoButtonModal>,
    );

    expect(screen.getByTestId("mobile-two-button-modal-header")).toHaveClass("gap-1", "text-left");
    expect(screen.getByText("서비스 일정 변경")).toHaveClass("text-base");
    expect(screen.getByText("서비스 일정 변경")).toHaveClass("break-keep", "[overflow-wrap:anywhere]");
    expect(screen.getByText("3회차 서비스 제공 날짜를 조정합니다.")).toHaveClass("break-keep", "[overflow-wrap:anywhere]");
    expect(screen.getByText("3회차 서비스 제공 날짜를 조정합니다.")).toHaveClass("text-sm", "leading-5");
    expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "처리 중" })).toBeDisabled();
  });

  it("forwards the caller context and keeps the source component identity", () => {
    render(
      <MobileTwoButtonModal
        data-component="mobile_contracts-new_confirmation_modal"
        open
        title="계약서 재생성 확인"
        description="새 계약서를 생성합니다."
        cancelLabel="취소"
        confirmLabel="생성"
        onOpenChange={jest.fn()}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-component", "mobile_contracts-new_confirmation_modal");
    expect(dialog).toHaveAttribute("data-source-component", "MobileTwoButtonModal");
    expect(screen.getByText("계약서 재생성 확인")).toHaveAttribute(
      "data-component",
      "mobile_contracts-new_confirmation_modal_title",
    );
    expect(screen.getByRole("button", { name: "생성" })).toHaveAttribute(
      "data-component",
      "mobile_contracts-new_confirmation_modal_confirm-button",
    );
  });
});
