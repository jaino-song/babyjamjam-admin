import { render } from "@testing-library/react";
import { SplitLayout } from "../SplitLayout";

describe("SplitLayout", () => {
  it("animates the desktop detail panel when a selection is active", () => {
    const { container } = render(
      <SplitLayout hasSelection>
        <div>목록</div>
        <div key="selected-detail">상세</div>
      </SplitLayout>,
    );

    expect(container.querySelector('[data-panel="detail"]')).toHaveClass("animate-v3-slide-up");
  });

  it("does not animate the detail panel when no selection is active", () => {
    const { container } = render(
      <SplitLayout hasSelection={false}>
        <div>목록</div>
        <div>빈 상태</div>
      </SplitLayout>,
    );

    expect(container.querySelector('[data-panel="detail"]')).not.toHaveClass("animate-v3-slide-up");
  });
});
