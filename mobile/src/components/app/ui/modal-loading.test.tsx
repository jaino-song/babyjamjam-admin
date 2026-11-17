import { render, screen } from "@testing-library/react";

import { ApprovalTwoButtonModal } from "./ApprovalTwoButtonModal";
import { MobileTwoButtonModal } from "./MobileTwoButtonModal";

describe("ApprovalTwoButtonModal pending display", () => {
  const props = {
    "data-component": "mobile_tests_approval_pending",
    open: true,
    onOpenChange: jest.fn(),
    title: "확인",
    description: "진행할까요?",
    approvalLabel: "저장",
    onApprove: jest.fn(),
    isPending: true,
  };

  it.each([undefined, "저장 중"])("uses a Spinner and a hidden pending label (%s) by default", (pendingLabel) => {
    render(<ApprovalTwoButtonModal {...props} pendingLabel={pendingLabel} />);
    const button = screen.getByRole("button", { name: pendingLabel ?? "처리 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent("저장");
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(button.querySelector(".sr-only")).toHaveTextContent(pendingLabel ?? "처리 중");
  });

  it.each([undefined, "제출 중…"])("preserves visible text in legacy mode (%s)", (pendingLabel) => {
    render(<ApprovalTwoButtonModal {...props} pendingDisplay="text" pendingLabel={pendingLabel} />);
    const button = screen.getByRole("button", { name: pendingLabel ?? "저장" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.textContent).toBe(pendingLabel ?? "저장");
    expect(button.querySelector("span")).toBeNull();
    expect(button.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(button).not.toHaveAttribute("data-loading");
  });
});

describe("MobileTwoButtonModal loading", () => {
  it.each([undefined, "삭제 중"])("announces the loading label (%s) and disables both actions", (loadingLabel) => {
    render(<MobileTwoButtonModal
      data-component="mobile_tests_confirm_loading"
      open title="확인" description="삭제할까요?" cancelLabel="취소" confirmLabel="삭제"
      loading loadingLabel={loadingLabel} onOpenChange={jest.fn()} onCancel={jest.fn()} onConfirm={jest.fn()}
    />);
    const confirm = screen.getByRole("button", { name: loadingLabel ?? "처리 중" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm.querySelector('[data-slot="button-idle"]')).toHaveTextContent("삭제");
    expect(confirm.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
  });
});
