import { fireEvent, render, screen } from "@testing-library/react";

import { DocumentJobFailurePopup } from "./DocumentJobFailurePopup";
import { DocumentJobFailurePopupStack } from "./DocumentJobFailurePopupStack";

describe("DocumentJobFailurePopup", () => {
  it("renders copy, runs the action and closes", () => {
    const onAction = jest.fn();
    const onClose = jest.fn();

    render(
      <DocumentJobFailurePopup
        data-component="desktop_test_failure"
        title="계약서 자동 전송 실패"
        description="김하늘 님"
        actionLabel="직접 작성하기"
        onAction={onAction}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("계약서 자동 전송 실패");
    fireEvent.click(screen.getByRole("button", { name: "직접 작성하기" }));
    fireEvent.click(screen.getByRole("button", { name: "알림 닫기" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("DocumentJobFailurePopupStack", () => {
  it("renders nothing without items or overflow", () => {
    const { container } = render(<DocumentJobFailurePopupStack data-component="desktop_test_stack" items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("numbers its items and labels the overflow popup", () => {
    render(
      <DocumentJobFailurePopupStack
        data-component="desktop_test_stack"
        items={[
          { key: "a", title: "하나", actionLabel: "열기", onAction: jest.fn(), onClose: jest.fn() },
          { key: "b", title: "둘", actionLabel: "열기", onAction: jest.fn(), onClose: jest.fn() },
        ]}
        overflow={{ title: "실패 3건 더 보기", actionLabel: "목록 보기", onAction: jest.fn(), onClose: jest.fn() }}
      />,
    );

    expect(screen.getByRole("region", { name: "전자문서 처리 실패 알림" })).toBeInTheDocument();
    expect(document.querySelector('[data-component="desktop_test_stack_item-0"]')).toHaveTextContent("하나");
    expect(document.querySelector('[data-component="desktop_test_stack_item-1"]')).toHaveTextContent("둘");
    expect(document.querySelector('[data-component="desktop_test_stack_overflow"]')).toHaveTextContent("실패 3건 더 보기");
  });
});
