import { render, screen, within } from "@testing-library/react";
import { ContractDocumentJobsList } from "./ContractDocumentJobsList";
import { ReceiptSendConfirmDialog } from "./ReceiptSendConfirmDialog";

describe("contract loading indicators", () => {
  it("uses an accessible Spinner without visible job loading copy", () => {
    render(<ContractDocumentJobsList isLoading collapsed={{ processing: false, attention: false, recent: false }}
      onToggle={jest.fn()} onSelect={jest.fn()} data-component="desktop_contracts_document-jobs_list" />);
    const status = screen.getByRole("status", { name: "전자문서 작업 불러오는 중" });
    expect(status).toHaveAttribute("data-component", "desktop_contracts_document-jobs_list_loading");
    expect(status).toHaveAttribute("data-source-component", "LoadingState");
    expect(within(status).getByText("전자문서 작업 불러오는 중")).toHaveClass("sr-only");
    expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("불러오는 중")).not.toBeInTheDocument();
  });

  it("keeps the receipt send action width and pending name while showing only a Spinner", () => {
    const props = { open: true, customerName: "QA-고객", onConfirm: jest.fn(), onOpenChange: jest.fn(), dataComponent: "desktop_contracts_receipt-confirm" };
    const { rerender } = render(<ReceiptSendConfirmDialog {...props} isPending />);
    const button = screen.getByRole("button", { name: "발송 예약 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(within(button).getByText("발송 예약 중")).toHaveClass("sr-only");
    rerender(<ReceiptSendConfirmDialog {...props} isPending={false} />);
    expect(screen.getByRole("button", { name: "발송하기" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "발송하기" })).not.toHaveAttribute("data-loading");
  });
});
