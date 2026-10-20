import { render, screen } from "@testing-library/react";

import { ServiceDateDisplay } from "./ServiceDateDisplay";

const BASE = "desktop_service-record-admin_wizard_date";

describe("ServiceDateDisplay", () => {
  it("shows the label and the revised date", () => {
    render(<ServiceDateDisplay data-component={BASE} label="3회차" revised="9월 21일" />);

    expect(screen.getByText("3회차")).toBeInTheDocument();
    expect(screen.getByText("9월 21일")).toHaveAttribute("data-slot", "revised-date");
  });

  it("shows the original date muted only when given", () => {
    const { rerender } = render(<ServiceDateDisplay data-component={BASE} label="3회차" revised="9월 21일" />);
    expect(screen.queryByText(/원본/)).toBeNull();

    rerender(<ServiceDateDisplay data-component={BASE} label="3회차" revised="9월 21일" original="9월 20일" />);
    const original = screen.getByText(/원본/);
    expect(original).toHaveTextContent("원본 9월 20일");
    expect(original).toHaveAttribute("data-slot", "original-date");
    expect(original).toHaveClass("text-v3-text-muted");
  });

  it("renders the action slot and the children slot but no button of its own", () => {
    const { container, rerender } = render(<ServiceDateDisplay data-component={BASE} label="3회차" revised="9월 21일" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector(`[data-component="${BASE}_action"]`)).toBeNull();
    expect(container.querySelector(`[data-component="${BASE}_extra"]`)).toBeNull();

    rerender(
      <ServiceDateDisplay
        data-component={BASE}
        label="3회차"
        revised="9월 21일"
        action={<button type="button">제공일 수정</button>}
      >
        <p>같은 회차의 추가 기록</p>
      </ServiceDateDisplay>,
    );
    expect(screen.getByRole("button", { name: "제공일 수정" })).toBeInTheDocument();
    expect(container.querySelector(`[data-component="${BASE}_action"]`)).toContainElement(
      screen.getByRole("button", { name: "제공일 수정" }),
    );
    expect(container.querySelector(`[data-component="${BASE}_extra"]`)).toContainElement(
      screen.getByText("같은 회차의 추가 기록"),
    );
  });

  it("names its children from the root data-component", () => {
    const { container } = render(
      <ServiceDateDisplay data-component={BASE} label="3회차" revised="9월 21일" original="9월 20일" action="x" />,
    );
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "ServiceDateDisplay");
    for (const suffix of ["row", "chip", "chip_label", "chip_date", "chip_date_revised", "chip_date_original", "action"]) {
      expect(container.querySelector(`[data-component="${BASE}_${suffix}"]`)).not.toBeNull();
    }
  });
});
