import { render } from "@testing-library/react";
import { SplitLayout } from "../SplitLayout";

describe("SplitLayout", () => {
  it("animates each panel once when it mounts", () => {
    const { container } = render(
      <SplitLayout hasSelection>
        <div>목록</div>
        <div key="selected-detail">상세</div>
      </SplitLayout>,
    );

    expect(container.querySelector('[data-component="split-layout"]')).not.toHaveClass("animate-v3-slide-up");
    expect(container.querySelector('[data-panel="list"]')).toHaveClass("animate-v3-slide-up");
    expect(container.querySelector('[data-panel="detail"]')).toHaveClass("animate-v3-slide-up");
  });

  it("keeps detail panel mount animation independent from selection state", () => {
    const { container } = render(
      <SplitLayout hasSelection={false}>
        <div>목록</div>
        <div>빈 상태</div>
      </SplitLayout>,
    );

    expect(container.querySelector('[data-panel="detail"]')).toHaveClass("animate-v3-slide-up");
  });
});
