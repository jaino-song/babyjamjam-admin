import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { DetailEmptyState } from "../DetailEmptyState";
import { DetailPanel } from "../DetailPanel";

describe("DetailPanel", () => {
  it("renders emptyState through the root overlay layer", () => {
    const { container } = render(
      <DetailPanel
        title="상세"
        emptyState={
          <DetailEmptyState
            name="detail-panel-empty"
            icon={Users}
            message="항목을 선택하면 상세 정보가 표시됩니다."
            className="flex-none min-h-0"
          />
        }
      >
        {null}
      </DetailPanel>,
    );

    expect(container.querySelector('[data-component="detail-panel-overlay"]')).toBeInTheDocument();
    expect(screen.getByText("항목을 선택하면 상세 정보가 표시됩니다.")).toBeInTheDocument();
    expect(container.querySelector('[data-component="detail-panel-empty"]')).toBeInTheDocument();
  });
});
