import { render, screen } from "@testing-library/react";
import { ListEmptyState } from "../ListEmptyState";
import { ListPanel } from "../ListPanel";

describe("ListPanel", () => {
  it("renders overlay through the root list-panel overlay layer", () => {
    const { container } = render(
      <ListPanel
        title="목록"
        subtitle="설명"
        overlay={
          <ListEmptyState
            name="list-panel-empty"
            message="항목이 없습니다."
            className="flex-none min-h-0"
          />
        }
      >
        {null}
      </ListPanel>,
    );

    expect(container.querySelector('[data-component="list-panel-overlay"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="list-panel-empty"]')).toBeInTheDocument();
    expect(screen.getByText("항목이 없습니다.")).toBeInTheDocument();
  });
});
