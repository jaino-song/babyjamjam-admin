import { fireEvent, render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { DetailEmptyState } from "../DetailEmptyState";
import { DetailPanel } from "../DetailPanel";
import { SplitLayoutContext } from "../SplitLayoutContext";

describe("DetailPanel", () => {
  it("renders semantic header, main, and footer regions", () => {
    const { container } = render(
      <DetailPanel title="상세" footer={<button type="button">저장</button>}>
        본문
      </DetailPanel>,
    );

    expect(container.querySelector('header[data-component="detail-panel-header"]')).toBeInTheDocument();
    expect(container.querySelector('main[data-component="detail-panel-main"]')).toBeInTheDocument();
    expect(container.querySelector('footer[data-component="detail-panel-footer"]')).toBeInTheDocument();
  });

  it("keeps the bottom spacer below the scroll region without overlaying content", () => {
    const { container } = render(<DetailPanel title="상세">본문</DetailPanel>);

    const main = container.querySelector('[data-component="detail-panel-main"]');
    const scrollContent = container.querySelector('[data-component="detail-panel-scroll-content"]');
    const spacer = container.querySelector('[data-component="detail-panel-bottom-spacer"]');

    expect(main).toBeInTheDocument();
    expect(main).toHaveClass("flex-col");
    expect(scrollContent).toHaveClass("flex-1");
    expect(spacer).toBeInTheDocument();
    expect(spacer?.parentElement).toBe(main);
    expect(spacer?.previousElementSibling).toBe(scrollContent);
    expect(spacer).toHaveClass("shrink-0");
    expect(spacer).not.toHaveClass("absolute");
  });

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

  it("returns to the list from the compact back button", () => {
    const goToList = jest.fn();

    render(
      <SplitLayoutContext.Provider value={{ goToList, isMobile: true }}>
        <DetailPanel title="상세" compactBackLabel="고객 목록으로 돌아가기">{null}</DetailPanel>
      </SplitLayoutContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "고객 목록으로 돌아가기" }));

    expect(goToList).toHaveBeenCalledTimes(1);
  });

  it("renders the optional stepper on the right side of the structured header", () => {
    render(
      <DetailPanel
        title="전자계약서 작성"
        subtitle="고객에게 전자계약서를 발송합니다"
        stepper={<div data-testid="detail-panel-stepper">1 / 5</div>}
      >
        {null}
      </DetailPanel>,
    );

    expect(screen.getByTestId("detail-panel-stepper")).toBeInTheDocument();
    expect(screen.getByText("전자계약서 작성")).toBeInTheDocument();
  });
});
