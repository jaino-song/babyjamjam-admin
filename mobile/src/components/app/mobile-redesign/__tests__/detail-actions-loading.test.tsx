import { fireEvent, render, screen } from "@testing-library/react";

import { MobileDetailActions } from "../detail-sheet";
import { MobileDetailSlideUp } from "../mobile-detail-slideup";

describe("MobileDetailActions busy", () => {
  it.each([undefined, "저장 중"])("preserves the raw button classes, hides its label and announces %s", (busyLabel) => {
    const onClick = jest.fn();
    const { rerender } = render(<MobileDetailActions data-component="mobile_tests_detail_actions" name="test" actions={[{ label: "저장", variant: "primary", busy: true, busyLabel, disabled: false, onClick }]} />);
    const button = screen.getByRole("button", { name: busyLabel ?? "처리 중" });
    expect(button).toHaveClass("btn", "btn-primary", "relative");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent("저장");
    expect(button.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<MobileDetailActions data-component="mobile_tests_detail_actions" name="test" actions={[{ label: "저장", onClick }]} />);
    const idle = screen.getByRole("button", { name: "저장" });
    expect(idle).toBeEnabled();
    expect(idle).not.toHaveAttribute("data-loading");
    expect(idle.querySelector("span")).toBeNull();
    fireEvent.click(idle);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("MobileDetailSlideUp busy", () => {
  it.each([undefined, "저장 중"])("disables the primary action and announces %s", (busyLabel) => {
    const onClick = jest.fn();
    render(<MobileDetailSlideUp name="mobile_tests_slideup" open onClose={jest.fn()} title="상세" primaryAction={{ label: "저장", onClick, busy: true, busyLabel, disabled: false }}>내용</MobileDetailSlideUp>);
    const button = screen.getByRole("button", { name: busyLabel ?? "처리 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent("저장");
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
